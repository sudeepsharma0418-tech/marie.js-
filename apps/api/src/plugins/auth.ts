import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { PRIVILEGED_ROLES, type Permission, roleHas } from '@hp/shared';
import { sessions, users } from '../db/schema';
import { sha256, safeEqual } from '../lib/crypto';
import { forbidden, unauthorized, AppError } from '../lib/errors';
import type { Ctx } from '../lib/context';
import { getSettings } from '../lib/settings';

export const SESSION_COOKIE = 'hp_sid';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx | null;
    sessionId: string | null;
    sessionCsrf: string | null;
  }
}

/** Routes reachable while MFA is pending or enrolment is required. */
const MFA_PENDING_ALLOWED = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/mfa/verify',
  '/api/v1/auth/mfa/setup',
  '/api/v1/auth/mfa/enable',
]);

/** Public endpoints never look at an existing session (so a stale cookie cannot trip CSRF). */
const PUBLIC = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/password/forgot',
  '/api/v1/auth/password/reset',
  '/api/v1/auth/invitations/accept',
  '/api/v1/health',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('ctx', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('sessionCsrf', null);

  app.addHook('preHandler', async (req: FastifyRequest) => {
    const path = req.routeOptions.url ?? req.url;
    if (PUBLIC.has(path)) return;
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer ?? req.cookies[SESSION_COOKIE] ?? null;
    if (!token) return;

    const now = new Date();
    const [row] = await app.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
      )
      .limit(1);
    if (!row || !row.user.isActive) return;

    // Cookie-authenticated state changes must carry the session's CSRF token.
    // Bearer tokens (future mobile apps) are not sent automatically by browsers, so no CSRF risk.
    if (!bearer && !SAFE_METHODS.has(req.method)) {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, row.session.csrfToken)) {
        throw new AppError(403, 'csrf', 'Missing or invalid CSRF token');
      }
    }

    if (!MFA_PENDING_ALLOWED.has(path)) {
      if (row.user.mfaEnabled && !row.session.mfaVerified) {
        throw new AppError(401, 'mfa_required', 'Multi-factor verification required');
      }
      if (!row.user.mfaEnabled && PRIVILEGED_ROLES.includes(row.user.role)) {
        const settings = await getSettings(app.db);
        if (settings.mfaEnforced)
          throw new AppError(403, 'mfa_enrolment_required', 'Set up multi-factor authentication to continue');
      }
    }

    if (now.getTime() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
      await app.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
    }

    req.sessionId = row.session.id;
    req.sessionCsrf = row.session.csrfToken;
    req.ctx = {
      actor: {
        id: row.user.id,
        role: row.user.role,
        hotelId: row.user.hotelId,
        name: row.user.name,
        email: row.user.email,
      },
      ip: req.ip,
      requestId: req.id,
    };
  });
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] });

/** Returns the authenticated context or throws 401. */
export function ctxOf(req: FastifyRequest): Ctx {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
}

/** preHandler guard: authenticated and holding at least one of the permissions. */
export function guard(...perms: Permission[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const ctx = ctxOf(req);
    if (perms.length && !perms.some((p) => roleHas(ctx.actor.role, p))) throw forbidden();
  };
}
