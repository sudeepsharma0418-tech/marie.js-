import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, authEvents, notifications, users } from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { can, hotelFilter } from '../lib/context';
import { idParam, parse, todayNepal } from '../lib/http';
import { verifyAuditChain } from '../lib/audit';
import { notFound } from '../lib/errors';

export async function adminRoutes(app: FastifyInstance) {
  const db = app.db;

  /* ------------------------------- audit ------------------------------- */

  app.get('/audit', { preHandler: guard('audit.view') }, async (req) => {
    const q = parse(
      z.object({
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        actorId: z.uuid().optional(),
        hotelId: z.uuid().optional(),
        action: z.string().optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        beforeId: z.coerce.number().int().optional(),
      }),
      req.query,
    );
    const conds = [];
    if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
    if (q.actorId) conds.push(eq(auditLogs.actorId, q.actorId));
    if (q.hotelId) conds.push(eq(auditLogs.hotelId, q.hotelId));
    if (q.action) conds.push(sql`${auditLogs.action} like ${q.action + '%'}`);
    if (q.from) conds.push(gte(auditLogs.occurredAt, new Date(`${q.from}T00:00:00+05:45`)));
    if (q.to) conds.push(lte(auditLogs.occurredAt, new Date(`${q.to}T23:59:59.999+05:45`)));
    if (q.beforeId) conds.push(sql`${auditLogs.id} < ${q.beforeId}`);
    const rows = await db
      .select({ a: auditLogs, actorName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(q.limit);
    return { items: rows.map((r) => ({ ...r.a, actorName: r.actorName })) };
  });

  /** Recompute the hash chain to detect any tampering with stored audit records. */
  app.get('/audit/verify', { preHandler: guard('audit.view') }, async () => verifyAuditChain(db));

  app.get('/auth-events', { preHandler: guard('audit.view') }, async (req) => {
    const q = parse(
      z.object({
        userId: z.uuid().optional(),
        event: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const conds = [];
    if (q.userId) conds.push(eq(authEvents.userId, q.userId));
    if (q.event) conds.push(eq(authEvents.event, q.event));
    const items = await db
      .select()
      .from(authEvents)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(authEvents.id))
      .limit(q.limit);
    return { items };
  });

  /* --------------------------- notifications --------------------------- */

  app.get('/notifications', { preHandler: guard() }, async (req) => {
    const ctx = ctxOf(req);
    const items = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.actor.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [unread] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.actor.id), isNull(notifications.readAt)));
    return { items, unread: unread?.n ?? 0 };
  });

  app.post('/notifications/:id/read', { preHandler: guard() }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const r = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.actor.id)))
      .returning({ id: notifications.id });
    if (!r.length) throw notFound('Notification');
    return { ok: true };
  });

  app.post('/notifications/read-all', { preHandler: guard() }, async (req) => {
    const ctx = ctxOf(req);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.actor.id), isNull(notifications.readAt)));
    return { ok: true };
  });

  /* ------------------------------ dashboard ---------------------------- */

  /** Role-specific counters for the home screen. */
  app.get('/dashboard', { preHandler: guard() }, async (req) => {
    const ctx = ctxOf(req);
    const one = async (q: ReturnType<typeof sql>) =>
      ((await db.execute<Record<string, unknown>>(q)).rows[0] ?? {}) as Record<string, unknown>;
    const today = todayNepal();
    const out: Record<string, unknown> = { role: ctx.actor.role, today };
    if (ctx.actor.role === 'owner' || ctx.actor.role === 'procurement') {
      Object.assign(
        out,
        await one(sql`select
          (select count(*)::int from approval_requests where status = 'pending') as pending_approvals,
          (select count(*)::int from orders where status = 'approved') as orders_to_source,
          (select count(*)::int from orders where status in ('procurement','consolidating')) as orders_in_procurement,
          (select count(*)::int from orders where status = 'ready_for_dispatch') as orders_ready,
          (select count(*)::int from product_requests where status in ('open','investigating')) as open_requests,
          (select count(*)::int from invoices where status = 'draft') as draft_invoices,
          (select count(*)::int from purchase_orders where status in ('approved')) as pos_to_send`),
      );
      if (can(ctx, 'finance.view_all')) {
        Object.assign(
          out,
          await one(sql`select
            (select coalesce(sum(debit - credit), 0)::numeric(14,2)::text from ledger_entries where account = 'accounts_receivable') as receivables,
            (select coalesce(sum(credit - debit), 0)::numeric(14,2)::text from ledger_entries where account = 'accounts_payable') as payables,
            (select coalesce(sum(taxable_total + exempt_total), 0)::numeric(14,2)::text from invoices where status = 'issued' and to_char(invoice_date, 'YYYY-MM') = to_char(${today}::date, 'YYYY-MM')) as sales_this_month,
            (select count(*)::int from invoices i where i.status = 'issued' and i.due_date < ${today}
               and i.total > coalesce((select sum(amount) from payment_allocations pa where pa.invoice_id = i.id and pa.reversed_at is null), 0)
                 + coalesce((select sum(total) from credit_notes cn where cn.invoice_id = i.id and cn.status = 'issued'), 0)) as overdue_invoices`),
        );
      }
    } else if (ctx.actor.role === 'warehouse') {
      Object.assign(
        out,
        await one(sql`select
          (select count(*)::int from purchase_orders where status in ('sent','confirmed','partially_received') and fulfillment = 'hub') as pos_to_receive,
          (select count(*)::int from orders where status in ('consolidating','ready_for_dispatch')) as orders_consolidating,
          (select count(*)::int from deliveries where status = 'scheduled') as deliveries_to_dispatch`),
      );
    } else if (ctx.actor.role === 'driver') {
      Object.assign(
        out,
        await one(sql`select
          (select count(*)::int from deliveries d join delivery_runs r on r.id = d.run_id where r.driver_id = ${ctx.actor.id} and d.status in ('scheduled','dispatched')) as my_open_deliveries,
          (select count(*)::int from deliveries d join delivery_runs r on r.id = d.run_id where r.driver_id = ${ctx.actor.id} and r.scheduled_date = ${today}) as my_deliveries_today`),
      );
    } else {
      const hotelId = hotelFilter(ctx)!;
      Object.assign(
        out,
        await one(sql`select
          (select count(*)::int from orders where hotel_id = ${hotelId} and status not in ('draft','delivered','closed','cancelled','rejected')) as open_orders,
          (select count(*)::int from orders where hotel_id = ${hotelId} and status = 'pending_hotel_approval') as awaiting_my_approval,
          (select count(*)::int from orders where hotel_id = ${hotelId} and status = 'draft') as drafts`),
      );
      if (can(ctx, 'finance.view_own_hotel')) {
        Object.assign(
          out,
          await one(
            sql`select (select coalesce(sum(debit - credit), 0)::numeric(14,2)::text from ledger_entries where account = 'accounts_receivable' and party_id = ${hotelId}) as outstanding_balance`,
          ),
        );
      }
    }
    return out;
  });
}
