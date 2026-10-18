import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { HOTEL_ROLES, INTERNAL_ROLES, ROLES, isHotelRole, type Role } from '@hp/shared';
import { hotels, userInvitations, users } from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { can, type Ctx } from '../lib/context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { parse } from '../lib/http';
import { audit } from '../lib/audit';
import { randomToken, sha256 } from '../lib/crypto';
import { revokeUserSessions } from './auth';

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  phone: users.phone,
  role: users.role,
  hotelId: users.hotelId,
  isActive: users.isActive,
  mfaEnabled: users.mfaEnabled,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

/** Hotel managers may manage purchasing and inventory staff in their own hotel only. */
const HOTEL_MANAGER_ASSIGNABLE: Role[] = ['hotel_purchaser', 'hotel_inventory'];

function assertCanManage(ctx: Ctx, role: Role, hotelId: string | null) {
  if (can(ctx, 'users.manage_internal')) return;
  if (
    can(ctx, 'users.manage_own_hotel') &&
    ctx.actor.hotelId &&
    hotelId === ctx.actor.hotelId &&
    HOTEL_MANAGER_ASSIGNABLE.includes(role)
  )
    return;
  throw forbidden();
}

export async function userRoutes(app: FastifyInstance) {
  const db = app.db;
  const manage = guard('users.manage_internal', 'users.manage_own_hotel');

  app.get('/users', { preHandler: manage }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({ hotelId: z.uuid().optional(), scope: z.enum(['internal', 'hotel', 'all']).default('all') }),
      req.query,
    );
    const conds = [];
    if (!can(ctx, 'users.manage_internal')) conds.push(eq(users.hotelId, ctx.actor.hotelId!));
    else if (q.hotelId) conds.push(eq(users.hotelId, q.hotelId));
    else if (q.scope === 'internal') conds.push(isNull(users.hotelId));
    else if (q.scope === 'hotel') conds.push(sql`${users.hotelId} is not null`);
    const items = await db
      .select({ ...userColumns, hotelName: hotels.legalName })
      .from(users)
      .leftJoin(hotels, eq(hotels.id, users.hotelId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(users.name));
    return { items };
  });

  app.post('/users/invitations', { preHandler: manage }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        email: z.email(),
        name: z.string().min(1).max(120),
        role: z.enum(ROLES),
        hotelId: z.uuid().nullable().optional(),
      }),
      req.body,
    );
    const hotelId = isHotelRole(body.role) ? (body.hotelId ?? ctx.actor.hotelId) : null;
    if (isHotelRole(body.role) && !hotelId) throw badRequest('Hotel users must belong to a hotel');
    if (!isHotelRole(body.role) && body.hotelId) throw badRequest('Internal users cannot belong to a hotel');
    assertCanManage(ctx, body.role, hotelId);
    if (hotelId) {
      const [h] = await db.select({ id: hotels.id }).from(hotels).where(eq(hotels.id, hotelId));
      if (!h) throw notFound('Hotel');
    }
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${body.email})`);
    if (existing) throw conflict('A user with this email already exists');

    const token = randomToken();
    const inv = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(userInvitations)
        .values({
          email: body.email.toLowerCase(),
          name: body.name,
          role: body.role,
          hotelId,
          tokenHash: sha256(token),
          invitedBy: ctx.actor.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
        })
        .returning();
      await audit(tx, ctx, {
        action: 'user.invited',
        entityType: 'user_invitation',
        entityId: row!.id,
        hotelId,
        after: { email: row!.email, role: row!.role },
      });
      return row!;
    });
    // No email provider yet: the inviter shares this one-time link through a trusted channel.
    return {
      id: inv.id,
      inviteUrl: `${app.config.WEB_ORIGIN}/accept-invite?token=${token}`,
      expiresAt: inv.expiresAt,
    };
  });

  app.get('/users/invitations', { preHandler: manage }, async (req) => {
    const ctx = ctxOf(req);
    const conds = [isNull(userInvitations.acceptedAt), isNull(userInvitations.revokedAt)];
    if (!can(ctx, 'users.manage_internal')) conds.push(eq(userInvitations.hotelId, ctx.actor.hotelId!));
    const items = await db
      .select({
        id: userInvitations.id,
        email: userInvitations.email,
        name: userInvitations.name,
        role: userInvitations.role,
        hotelId: userInvitations.hotelId,
        expiresAt: userInvitations.expiresAt,
        createdAt: userInvitations.createdAt,
      })
      .from(userInvitations)
      .where(and(...conds));
    return { items };
  });

  app.patch('/users/:id', { preHandler: manage }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(
      z.object({
        name: z.string().min(1).max(120).optional(),
        phone: z.string().max(30).nullable().optional(),
        role: z.enum(ROLES).optional(),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );
    const [before] = await db.select().from(users).where(eq(users.id, id));
    if (!before) throw notFound('User');
    if (before.hotelId && ctx.actor.hotelId && before.hotelId !== ctx.actor.hotelId) throw notFound('User');
    assertCanManage(ctx, before.role, before.hotelId);
    if (body.role) {
      assertCanManage(ctx, body.role, before.hotelId);
      const wasHotel = isHotelRole(before.role);
      if (wasHotel !== isHotelRole(body.role))
        throw badRequest('Cannot move a user between hotel and internal roles');
    }
    if (id === ctx.actor.id && (body.isActive === false || (body.role && body.role !== before.role))) {
      throw badRequest('You cannot deactivate yourself or change your own role');
    }
    const after = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(users)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      // Deactivation or a role change ends every session immediately.
      if (body.isActive === false || (body.role && body.role !== before.role)) {
        await revokeUserSessions(tx, id, body.isActive === false ? 'deactivated' : 'role_changed');
      }
      await audit(tx, ctx, {
        action:
          body.isActive === false ? 'user.deactivated' : body.role ? 'user.role_changed' : 'user.updated',
        entityType: 'user',
        entityId: id,
        hotelId: before.hotelId,
        before: { name: before.name, role: before.role, isActive: before.isActive },
        after: { name: u!.name, role: u!.role, isActive: u!.isActive },
      });
      return u!;
    });
    return { user: { id: after.id, name: after.name, role: after.role, isActive: after.isActive } };
  });

  app.post('/users/:id/revoke-sessions', { preHandler: guard('users.manage_internal') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await db.transaction(async (tx) => {
      await revokeUserSessions(tx, id, 'admin_revoked');
      await audit(tx, ctx, { action: 'user.sessions_revoked', entityType: 'user', entityId: id });
    });
    return { ok: true };
  });

  app.post('/users/:id/reset-mfa', { preHandler: guard('users.manage_internal') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq(users.id, id));
      await revokeUserSessions(tx, id, 'mfa_reset');
      await audit(tx, ctx, { action: 'user.mfa_reset', entityType: 'user', entityId: id });
    });
    return { ok: true };
  });

  void INTERNAL_ROLES;
  void HOTEL_ROLES;
}
