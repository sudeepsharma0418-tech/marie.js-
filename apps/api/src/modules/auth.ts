import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { PRIVILEGED_ROLES, ROLE_PERMISSIONS } from '@hp/shared';
import { authEvents, passwordResetTokens, sessions, userInvitations, users } from '../db/schema';
import { ctxOf, SESSION_COOKIE } from '../plugins/auth';
import { decrypt, encrypt, generateTotpSecret, randomToken, sha256, verifyTotp } from '../lib/crypto';
import { AppError, badRequest, notFound } from '../lib/errors';
import { parse } from '../lib/http';
import { audit } from '../lib/audit';
import { getSettings } from '../lib/settings';
import type { Db } from '../db/client';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
export const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(200);

// A real argon2 hash used to equalise timing when the email does not exist.
let dummyHash: Promise<string> | null = null;
const getDummy = () => (dummyHash ??= hash('not-a-real-password-placeholder'));

export const hashPassword = (pw: string) => hash(pw);

async function logAuth(
  db: Db,
  e: { userId?: string | null; email?: string; event: string; ip?: string; ua?: string; detail?: string },
) {
  await db.insert(authEvents).values({
    userId: e.userId ?? null,
    email: e.email ?? null,
    event: e.event,
    ip: e.ip ?? null,
    userAgent: e.ua ?? null,
    detail: e.detail ?? null,
  });
}

export async function createSession(
  db: Db,
  userId: string,
  mfaVerified: boolean,
  hours: number,
  ip?: string,
  ua?: string,
) {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  const [s] = await db
    .insert(sessions)
    .values({ userId, tokenHash: sha256(token), csrfToken, mfaVerified, ip, userAgent: ua, expiresAt })
    .returning();
  return { token, csrfToken, session: s! };
}

export async function revokeUserSessions(
  db: Db | Parameters<Parameters<Db['transaction']>[0]>[0],
  userId: string,
  reason: string,
) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: app.config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    hotelId: u.hotelId,
    preferredLanguage: u.preferredLanguage,
    mfaEnabled: u.mfaEnabled,
    isActive: u.isActive,
  };
}

export async function authRoutes(app: FastifyInstance) {
  const db = app.db;
  const loginLimit = {
    rateLimit: { max: app.config.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' },
  };

  app.post('/auth/login', { config: loginLimit }, async (req, reply) => {
    const body = parse(z.object({ email: z.email(), password: z.string().min(1).max(200) }), req.body);
    const ua = req.headers['user-agent'];
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${body.email})`);
    const fail = async (detail: string) => {
      await logAuth(db, {
        userId: user?.id,
        email: body.email,
        event: 'login_failed',
        ip: req.ip,
        ua,
        detail,
      });
      throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    };
    if (!user || !user.passwordHash) {
      await verify(await getDummy(), body.password).catch(() => false);
      return fail('unknown_user');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await logAuth(db, { userId: user.id, email: body.email, event: 'login_locked', ip: req.ip, ua });
      throw new AppError(429, 'locked', 'Too many failed attempts. Try again later.');
    }
    const ok = await verify(user.passwordHash, body.password).catch(() => false);
    if (!ok || !user.isActive) {
      const count = user.failedLoginCount + 1;
      await db
        .update(users)
        .set({
          failedLoginCount: count >= MAX_FAILED ? 0 : count,
          lockedUntil: count >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      return fail(!user.isActive ? 'inactive' : 'bad_password');
    }
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    const settings = await getSettings(db);
    const { token, csrfToken, session } = await createSession(
      db,
      user.id,
      !user.mfaEnabled,
      settings.sessionHours,
      req.ip,
      ua,
    );
    await logAuth(db, { userId: user.id, email: user.email, event: 'login_success', ip: req.ip, ua });
    setSessionCookie(app, reply, token, session.expiresAt);
    return {
      user: publicUser(user),
      csrfToken,
      mfaRequired: user.mfaEnabled,
      // Returned for non-browser clients (future mobile apps) that use Bearer auth.
      token: req.headers['x-client'] === 'mobile' ? token : undefined,
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionId) {
      await db
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'logout' })
        .where(eq(sessions.id, req.sessionId));
      await logAuth(db, { userId: req.ctx?.actor.id, event: 'logout', ip: req.ip });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const ctx = ctxOf(req);
    const [user] = await db.select().from(users).where(eq(users.id, ctx.actor.id));
    const [session] = await db.select().from(sessions).where(eq(sessions.id, req.sessionId!));
    const settings = await getSettings(db);
    return {
      user: publicUser(user!),
      permissions: ROLE_PERMISSIONS[user!.role],
      csrfToken: req.sessionCsrf,
      mfaPending: user!.mfaEnabled && !session!.mfaVerified,
      mfaEnrolmentRequired:
        settings.mfaEnforced && !user!.mfaEnabled && PRIVILEGED_ROLES.includes(user!.role),
      offlineAccessHours: settings.offlineAccessHours,
      company: { name: settings.tradeName ?? settings.legalName, currency: settings.currency },
    };
  });

  app.patch('/auth/me', async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({ preferredLanguage: z.enum(['en', 'ne']).optional(), phone: z.string().max(30).optional() }),
      req.body,
    );
    const [u] = await db
      .update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, ctx.actor.id))
      .returning();
    return { user: publicUser(u!) };
  });

  /* ------------------------------ MFA ------------------------------ */

  app.post('/auth/mfa/setup', async (req) => {
    const ctx = ctxOf(req);
    const [user] = await db.select().from(users).where(eq(users.id, ctx.actor.id));
    if (user!.mfaEnabled) throw badRequest('MFA is already enabled');
    const secret = generateTotpSecret();
    await db
      .update(users)
      .set({ mfaSecretEnc: encrypt(secret, app.config.APP_ENCRYPTION_KEY) })
      .where(eq(users.id, user!.id));
    const label = encodeURIComponent(`HotelProc:${user!.email}`);
    return {
      secret,
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=HotelProc&algorithm=SHA1&digits=6&period=30`,
    };
  });

  app.post('/auth/mfa/enable', async (req) => {
    const ctx = ctxOf(req);
    const { code } = parse(z.object({ code: z.string() }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, ctx.actor.id));
    if (!user!.mfaSecretEnc) throw badRequest('Start MFA setup first');
    if (!verifyTotp(decrypt(user!.mfaSecretEnc, app.config.APP_ENCRYPTION_KEY), code))
      throw badRequest('Invalid code');
    await db.transaction(async (tx) => {
      await tx.update(users).set({ mfaEnabled: true }).where(eq(users.id, user!.id));
      await tx.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, req.sessionId!));
      await audit(tx, ctx, { action: 'user.mfa_enabled', entityType: 'user', entityId: user!.id });
    });
    return { ok: true };
  });

  app.post('/auth/mfa/verify', { config: loginLimit }, async (req) => {
    const ctx = ctxOf(req);
    const { code } = parse(z.object({ code: z.string() }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, ctx.actor.id));
    if (!user!.mfaEnabled || !user!.mfaSecretEnc) throw badRequest('MFA is not enabled');
    if (!verifyTotp(decrypt(user!.mfaSecretEnc, app.config.APP_ENCRYPTION_KEY), code)) {
      await logAuth(db, { userId: user!.id, event: 'mfa_failed', ip: req.ip });
      throw new AppError(401, 'invalid_code', 'Invalid code');
    }
    await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, req.sessionId!));
    await logAuth(db, { userId: user!.id, event: 'mfa_verified', ip: req.ip });
    return { ok: true };
  });

  /* --------------------------- passwords --------------------------- */

  app.post('/auth/password/change', async (req) => {
    const ctx = ctxOf(req);
    const body = parse(z.object({ currentPassword: z.string(), newPassword: passwordSchema }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, ctx.actor.id));
    if (!user!.passwordHash || !(await verify(user!.passwordHash, body.currentPassword))) {
      throw badRequest('Current password is incorrect');
    }
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(body.newPassword) })
        .where(eq(users.id, user!.id));
      // sign out every other session
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'password_changed' })
        .where(
          and(
            eq(sessions.userId, user!.id),
            isNull(sessions.revokedAt),
            sql`${sessions.id} <> ${req.sessionId}`,
          ),
        );
      await audit(tx, ctx, { action: 'user.password_changed', entityType: 'user', entityId: user!.id });
    });
    return { ok: true };
  });

  app.post('/auth/password/forgot', { config: loginLimit }, async (req) => {
    const { email } = parse(z.object({ email: z.email() }), req.body);
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    if (user && user.isActive) {
      const token = randomToken();
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
      await logAuth(db, { userId: user.id, email, event: 'password_reset_requested', ip: req.ip });
      // No email provider is integrated yet. Outside production the link is logged
      // so the flow can be tested; in production an administrator must configure email.
      if (app.config.NODE_ENV !== 'production') {
        req.log.info(
          { resetUrl: `${app.config.WEB_ORIGIN}/reset-password?token=${token}` },
          'password reset link (dev only)',
        );
      }
    }
    // Same response whether or not the account exists.
    return { ok: true };
  });

  app.post('/auth/password/reset', { config: loginLimit }, async (req) => {
    const body = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, sha256(body.token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      );
    if (!row) throw badRequest('This reset link is invalid or has expired');
    await db.transaction(async (tx) => {
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(body.password), failedLoginCount: 0, lockedUntil: null })
        .where(eq(users.id, row.userId));
      await revokeUserSessions(tx, row.userId, 'password_reset');
      await audit(tx, null, { action: 'user.password_reset', entityType: 'user', entityId: row.userId });
    });
    return { ok: true };
  });

  app.post('/auth/invitations/accept', { config: loginLimit }, async (req, reply) => {
    const body = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
    const [inv] = await db
      .select()
      .from(userInvitations)
      .where(
        and(
          eq(userInvitations.tokenHash, sha256(body.token)),
          isNull(userInvitations.acceptedAt),
          isNull(userInvitations.revokedAt),
          gt(userInvitations.expiresAt, new Date()),
        ),
      );
    if (!inv) throw badRequest('This invitation is invalid or has expired');
    const user = await db.transaction(async (tx) => {
      await tx.update(userInvitations).set({ acceptedAt: new Date() }).where(eq(userInvitations.id, inv.id));
      const [u] = await tx
        .insert(users)
        .values({
          email: inv.email,
          name: inv.name,
          role: inv.role,
          hotelId: inv.hotelId,
          passwordHash: await hashPassword(body.password),
        })
        .returning();
      await audit(tx, null, {
        action: 'user.invitation_accepted',
        entityType: 'user',
        entityId: u!.id,
        hotelId: u!.hotelId,
        after: { email: u!.email, role: u!.role },
      });
      return u!;
    });
    const settings = await getSettings(db);
    const { token, csrfToken, session } = await createSession(
      db,
      user.id,
      true,
      settings.sessionHours,
      req.ip,
      req.headers['user-agent'],
    );
    setSessionCookie(app, reply, token, session.expiresAt);
    return { user: publicUser(user), csrfToken };
  });

  /* ---------------------------- sessions --------------------------- */

  app.get('/auth/sessions', async (req) => {
    const ctx = ctxOf(req);
    const rows = await db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, ctx.actor.id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
    return { items: rows.map((r) => ({ ...r, current: r.id === req.sessionId })) };
  });

  app.post('/auth/sessions/:id/revoke', async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const res = await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'user_revoked' })
      .where(and(eq(sessions.id, id), eq(sessions.userId, ctx.actor.id)))
      .returning({ id: sessions.id });
    if (!res.length) throw notFound('Session');
    return { ok: true };
  });
}
