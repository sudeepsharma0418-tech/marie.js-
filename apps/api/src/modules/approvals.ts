import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { APPROVAL_TYPES, type ApprovalType } from '@hp/shared';
import type { DbOrTx } from '../db/client';
import { approvalRequests, hotels, users } from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { can, type Ctx } from '../lib/context';
import { conflict, forbidden, notFound } from '../lib/errors';
import { idParam, parse } from '../lib/http';
import { audit } from '../lib/audit';
import { getSettings } from '../lib/settings';
import { notifyRoles, notifyUsers } from '../lib/notify';

export type ApprovalRequest = typeof approvalRequests.$inferSelect;

export interface ApprovalHandler {
  onApprove(tx: DbOrTx, ctx: Ctx, req: ApprovalRequest): Promise<void>;
  onReject(tx: DbOrTx, ctx: Ctx, req: ApprovalRequest): Promise<void>;
}

const handlers = new Map<ApprovalType, ApprovalHandler>();

/** Modules register what happens when their approval requests are decided. */
export function registerApprovalHandler(type: ApprovalType, handler: ApprovalHandler) {
  handlers.set(type, handler);
}

export async function requestApproval(
  tx: DbOrTx,
  ctx: Ctx,
  input: {
    type: ApprovalType;
    targetType: string;
    targetId: string;
    hotelId?: string | null;
    amount?: string | null;
    summary: string;
    details?: unknown;
  },
): Promise<ApprovalRequest> {
  const [existing] = await tx
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.type, input.type),
        eq(approvalRequests.targetId, input.targetId),
        eq(approvalRequests.status, 'pending'),
      ),
    );
  if (existing) return existing;
  const [row] = await tx
    .insert(approvalRequests)
    .values({ ...input, details: input.details ?? null, requestedBy: ctx.actor.id })
    .returning();
  await audit(tx, ctx, {
    action: 'approval.requested',
    entityType: 'approval_request',
    entityId: row!.id,
    hotelId: input.hotelId,
    after: {
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      amount: input.amount,
      summary: input.summary,
    },
  });
  await notifyRoles(tx, ['owner'], {
    kind: 'approval_requested',
    title: 'Approval needed',
    body: input.summary,
    link: `/approvals/${row!.id}`,
  });
  return row!;
}

/**
 * Decide an approval request. Only holders of approvals.decide (the owner) can
 * decide, and nobody may approve their own request unless the owner has allowed
 * owner self-approval in settings (single-owner business); that is audited.
 */
export async function decideApproval(
  tx: DbOrTx,
  ctx: Ctx,
  id: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<ApprovalRequest> {
  if (!can(ctx, 'approvals.decide')) throw forbidden('Only the owner can decide approvals');
  const [req] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for('update');
  if (!req) throw notFound('Approval request');
  if (req.status !== 'pending') throw conflict(`This request is already ${req.status}`);
  const selfDecision = req.requestedBy === ctx.actor.id;
  if (selfDecision && decision === 'approved') {
    const settings = await getSettings(tx);
    if (!(settings.allowOwnerSelfApproval && ctx.actor.role === 'owner')) {
      throw forbidden('You cannot approve your own request');
    }
  }
  const [updated] = await tx
    .update(approvalRequests)
    .set({ status: decision, decidedBy: ctx.actor.id, decidedAt: new Date(), decisionNote: note ?? null })
    .where(eq(approvalRequests.id, id))
    .returning();
  const handler = handlers.get(req.type);
  if (handler) {
    if (decision === 'approved') await handler.onApprove(tx, ctx, updated!);
    else await handler.onReject(tx, ctx, updated!);
  }
  await audit(tx, ctx, {
    action: `approval.${decision}`,
    entityType: 'approval_request',
    entityId: id,
    hotelId: req.hotelId,
    reason: note,
    before: { status: 'pending' },
    after: { status: decision, type: req.type, targetId: req.targetId, selfDecision },
  });
  await notifyUsers(tx, [req.requestedBy], {
    kind: `approval_${decision}`,
    title: `Request ${decision}`,
    body: req.summary,
    link: `/approvals/${id}`,
  });
  return updated!;
}

export async function approvalRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/approvals', { preHandler: guard('approvals.decide', 'approvals.request') }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({
        status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
        type: z.enum(APPROVAL_TYPES).optional(),
      }),
      req.query,
    );
    const conds = [];
    if (q.status) conds.push(eq(approvalRequests.status, q.status));
    if (q.type) conds.push(eq(approvalRequests.type, q.type));
    // requesters who cannot decide see only their own requests
    if (!can(ctx, 'approvals.decide')) conds.push(eq(approvalRequests.requestedBy, ctx.actor.id));
    const rows = await db
      .select({ a: approvalRequests, requestedByName: users.name, hotelName: hotels.legalName })
      .from(approvalRequests)
      .leftJoin(users, eq(users.id, approvalRequests.requestedBy))
      .leftJoin(hotels, eq(hotels.id, approvalRequests.hotelId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(approvalRequests.requestedAt))
      .limit(200);
    return {
      items: rows.map((r) => ({ ...r.a, requestedByName: r.requestedByName, hotelName: r.hotelName })),
    };
  });

  app.get('/approvals/:id', { preHandler: guard('approvals.decide', 'approvals.request') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const [a] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    if (!a || (!can(ctx, 'approvals.decide') && a.requestedBy !== ctx.actor.id))
      throw notFound('Approval request');
    return { approval: a };
  });

  app.post('/approvals/:id/decide', { preHandler: guard('approvals.decide') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(1000).optional() }),
      req.body,
    );
    const approval = await db.transaction((tx) => decideApproval(tx, ctx, id, body.decision, body.note));
    return { approval };
  });

  app.post('/approvals/:id/cancel', { preHandler: guard('approvals.request') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const approval = await db.transaction(async (tx) => {
      const [a] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for('update');
      if (!a || a.requestedBy !== ctx.actor.id) throw notFound('Approval request');
      if (a.status !== 'pending') throw conflict(`This request is already ${a.status}`);
      const [u] = await tx
        .update(approvalRequests)
        .set({ status: 'cancelled', decidedAt: new Date() })
        .where(eq(approvalRequests.id, id))
        .returning();
      const handler = handlers.get(a.type);
      if (handler) await handler.onReject(tx, ctx, u!);
      await audit(tx, ctx, {
        action: 'approval.cancelled',
        entityType: 'approval_request',
        entityId: id,
        hotelId: a.hotelId,
      });
      return u!;
    });
    return { approval };
  });
}
