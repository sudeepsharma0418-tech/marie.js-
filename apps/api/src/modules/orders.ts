import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  addMoney,
  addQty,
  canTransition,
  cmpQty,
  lineAmount,
  marginPercent,
  percentOf,
  subMoney,
  subQty,
  toPaisa,
  toPercentMilli,
  type OrderStatus,
} from '@hp/shared';
import type { DbOrTx } from '../db/client';
import {
  hotels,
  orderEvents,
  orderLines,
  orders,
  poLines,
  priceHistory,
  products,
  purchaseOrders,
  supplierQuotations,
  suppliers,
  taxRates,
  users,
} from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { assertHotelAccess, can, canSeeCosts, hotelFilter, isInternal, type Ctx } from '../lib/context';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { idParam, pageQuery, paged, parse } from '../lib/http';
import { audit } from '../lib/audit';
import { nextDocumentNumber } from '../lib/numbering';
import { getSettings } from '../lib/settings';
import { notifyRoles } from '../lib/notify';
import { resolvePrices } from './pricing-engine';
import { runCreditCheck } from './finance-core';
import { addOrderEvent, lineQuantities, setOrderStatus } from './orders-core';
import { registerApprovalHandler, requestApproval } from './approvals';

const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Quantity with up to 3 decimals');
const moneyStr = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount with up to 2 decimals');

const lineInput = z.object({
  productId: z.uuid(),
  quantity: qtyStr,
  notes: z.string().max(500).nullable().optional(),
});

type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;

/** Price overrides and request quotes are kept when an order is re-priced on submission. */
const FIXED_SOURCES = ['override', 'request_quote'];

async function loadOrderForUpdate(tx: DbOrTx, ctx: Ctx, id: string): Promise<OrderRow> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
  if (!o) throw notFound('Order');
  assertHotelAccess(ctx, o.hotelId, 'Order');
  return o;
}

async function buildLines(tx: DbOrTx, hotelId: string, input: z.infer<typeof lineInput>[]) {
  if (input.length === 0) throw badRequest('An order needs at least one line');
  // merge duplicate products
  const merged = new Map<string, { quantity: string; notes?: string | null }>();
  for (const l of input) {
    if (cmpQty(l.quantity, '0') <= 0) throw badRequest('Quantities must be greater than zero');
    const prev = merged.get(l.productId);
    merged.set(l.productId, {
      quantity: prev ? addQty(prev.quantity, l.quantity) : l.quantity,
      notes: l.notes ?? prev?.notes,
    });
  }
  const ids = [...merged.keys()];
  const prods = await tx.select().from(products).where(inArray(products.id, ids));
  if (prods.length !== ids.length) throw badRequest('One or more products do not exist');
  const taxes = new Map((await tx.select().from(taxRates)).map((t) => [t.code, t]));
  const prices = await resolvePrices(tx, hotelId, ids);
  let lineNo = 0;
  return prods.map((p) => {
    const m = merged.get(p.id)!;
    if (!p.isActive) throw unprocessable(`${p.nameEn} is no longer available`);
    if (cmpQty(m.quantity, p.minOrderQty) < 0)
      throw unprocessable(`Minimum order for ${p.nameEn} is ${p.minOrderQty} ${p.sellingUnit}`);
    const price = prices.get(p.id)!;
    if (!price.available) throw unprocessable(`${p.nameEn} has no price yet. Please request a quote.`);
    const tax = taxes.get(p.taxCode);
    if (!tax || !tax.isActive) throw unprocessable(`Tax setting for ${p.nameEn} is not active`);
    return {
      lineNo: ++lineNo,
      productId: p.id,
      nameEn: p.nameEn,
      nameNe: p.nameNe,
      unit: p.sellingUnit,
      quantity: m.quantity,
      unitPrice: price.unitPrice,
      priceSource: price.source,
      taxCode: tax.code,
      taxRate: tax.ratePercent,
      lineSubtotal: lineAmount(m.quantity, price.unitPrice),
      notes: m.notes ?? null,
    };
  });
}

/** Order totals are computed from lines (net of cancelled quantity), never typed in. */
export function computeTotals(lines: Pick<LineRow, 'quantity' | 'cancelledQty' | 'unitPrice' | 'taxRate'>[]) {
  let subtotal = '0.00';
  let tax = '0.00';
  for (const l of lines) {
    const net = subQty(l.quantity, l.cancelledQty ?? '0');
    const amt = lineAmount(net, l.unitPrice);
    subtotal = addMoney(subtotal, amt);
    tax = addMoney(tax, percentOf(amt, l.taxRate));
  }
  return { subtotal, taxTotal: tax, total: addMoney(subtotal, tax) };
}

async function recomputeOrderTotals(tx: DbOrTx, orderId: string) {
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const totals = computeTotals(lines);
  await tx
    .update(orders)
    .set({ ...totals, updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  return totals;
}

/** Re-price lines at submission so a stale draft cannot lock in an outdated price. */
async function repriceLines(tx: DbOrTx, order: OrderRow) {
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, order.id));
  const reprice = lines.filter((l) => !FIXED_SOURCES.includes(l.priceSource));
  const prices = await resolvePrices(
    tx,
    order.hotelId,
    reprice.map((l) => l.productId),
  );
  for (const l of reprice) {
    const p = prices.get(l.productId)!;
    if (!p.available) throw unprocessable(`${l.nameEn} has no price yet`);
    if (p.unitPrice !== l.unitPrice || p.source !== l.priceSource) {
      await tx
        .update(orderLines)
        .set({
          unitPrice: p.unitPrice,
          priceSource: p.source,
          lineSubtotal: lineAmount(l.quantity, p.unitPrice),
        })
        .where(eq(orderLines.id, l.id));
    }
  }
  return recomputeOrderTotals(tx, order.id);
}

/** Credit control step after hotel-side approval. Moves to approved or pending_approval. */
async function creditStep(tx: DbOrTx, ctx: Ctx, order: OrderRow, from: OrderStatus) {
  const totals = await repriceLines(tx, order);
  await setOrderStatus(tx, ctx, order.id, from, 'submitted', 'submitted');
  await tx
    .update(orders)
    .set({ submittedAt: new Date(), submittedBy: order.submittedBy ?? ctx.actor.id })
    .where(eq(orders.id, order.id));
  const check = await runCreditCheck(tx, order.hotelId, totals.total, order.id);
  await tx.update(orders).set({ creditCheck: check }).where(eq(orders.id, order.id));
  if (check.blocked) throw unprocessable('This account is closed and cannot place orders');
  if (check.requiresApproval) {
    await setOrderStatus(
      tx,
      ctx,
      order.id,
      'submitted',
      'pending_approval',
      'credit_review',
      check.reasons.join(', '),
    );
    const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, order.hotelId));
    await requestApproval(tx, ctx, {
      type: 'credit_order',
      targetType: 'order',
      targetId: order.id,
      hotelId: order.hotelId,
      amount: totals.total,
      summary: `Order ${order.orderNumber} from ${hotel!.legalName} (NPR ${totals.total}) needs credit approval: ${check.reasons.join(', ')}`,
      details: check,
    });
    return 'pending_approval' as const;
  }
  await tx.update(orders).set({ approvedAt: new Date() }).where(eq(orders.id, order.id));
  await setOrderStatus(tx, ctx, order.id, 'submitted', 'approved', 'auto_approved', 'Within credit terms');
  await notifyRoles(tx, ['procurement', 'owner'], {
    kind: 'order_approved',
    title: `New order ${order.orderNumber}`,
    body: `NPR ${totals.total}`,
    link: `/orders/${order.id}`,
  });
  return 'approved' as const;
}

async function submitOrder(tx: DbOrTx, ctx: Ctx, order: OrderRow) {
  if (order.status !== 'draft') throw conflict(`Order is ${order.status}, not draft`);
  const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, order.hotelId));
  await tx.update(orders).set({ submittedBy: ctx.actor.id }).where(eq(orders.id, order.id));
  // Purchasing staff orders may need the hotel manager's sign-off first.
  if (ctx.actor.role === 'hotel_purchaser' && hotel!.requireManagerApproval) {
    await setOrderStatus(tx, ctx, order.id, 'draft', 'pending_hotel_approval', 'sent_for_hotel_approval');
    await notifyRoles(
      tx,
      ['hotel_manager'],
      {
        kind: 'order_needs_hotel_approval',
        title: `Order ${order.orderNumber} needs your approval`,
        link: `/orders/${order.id}`,
      },
      order.hotelId,
    );
    return 'pending_hotel_approval' as const;
  }
  return creditStep(tx, ctx, { ...order, submittedBy: ctx.actor.id }, 'draft');
}

/** Shapes an order for the caller: hotel users never see supplier selections, costs or margins. */
function orderView(ctx: Ctx, o: OrderRow, lines: LineRow[]) {
  const internal = canSeeCosts(ctx);
  const outLines = lines.map((l) => {
    if (internal) {
      const expectedCost = l.expectedUnitCost
        ? lineAmount(subQty(l.quantity, l.cancelledQty), l.expectedUnitCost)
        : null;
      const revenue = lineAmount(subQty(l.quantity, l.cancelledQty), l.unitPrice);
      return {
        ...l,
        expectedLineCost: expectedCost,
        expectedMarginPercent: expectedCost ? marginPercent(revenue, expectedCost) : null,
      };
    }
    const {
      selectedSupplierId: _s,
      selectedQuotationId: _q,
      expectedUnitCost: _c,
      priceSource: _p,
      ...pub
    } = l;
    return pub;
  });
  const { creditCheck, idempotencyKey: _k, ...rest } = o;
  return { ...rest, creditCheck: isInternal(ctx) ? creditCheck : undefined, lines: outLines };
}

export async function orderRoutes(app: FastifyInstance) {
  const db = app.db;
  const readGuard = guard('orders.read_all', 'orders.read_own_hotel');

  app.get('/orders', { preHandler: readGuard }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      pageQuery.extend({
        status: z.enum(ORDER_STATUSES).optional(),
        statuses: z.string().optional(),
        hotelId: z.uuid().optional(),
        q: z.string().optional(),
      }),
      req.query,
    );
    const conds = [];
    const hotelId = hotelFilter(ctx, q.hotelId);
    if (hotelId) conds.push(eq(orders.hotelId, hotelId));
    if (q.status) conds.push(eq(orders.status, q.status));
    if (q.statuses) conds.push(inArray(orders.status, q.statuses.split(',') as OrderStatus[]));
    if (q.q) conds.push(or(ilike(orders.orderNumber, `%${q.q}%`), ilike(hotels.legalName, `%${q.q}%`)));
    const where = conds.length ? and(...conds) : undefined;
    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(orders)
      .innerJoin(hotels, eq(hotels.id, orders.hotelId))
      .where(where);
    const rows = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        hotelId: orders.hotelId,
        hotelName: hotels.legalName,
        status: orders.status,
        total: orders.total,
        requestedDeliveryDate: orders.requestedDeliveryDate,
        submittedAt: orders.submittedAt,
        createdAt: orders.createdAt,
        createdByName: users.name,
        lineCount: sql<number>`(select count(*)::int from order_lines l where l.order_id = orders.id)`,
      })
      .from(orders)
      .innerJoin(hotels, eq(hotels.id, orders.hotelId))
      .leftJoin(users, eq(users.id, orders.createdBy))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return paged(rows, Number(total), q.page, q.pageSize);
  });

  app.get('/orders/:id', { preHandler: readGuard }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const [o] = await db.select().from(orders).where(eq(orders.id, id));
    if (!o) throw notFound('Order');
    assertHotelAccess(ctx, o.hotelId, 'Order');
    const lines = await db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, id))
      .orderBy(asc(orderLines.lineNo));
    const events = await db
      .select({ e: orderEvents, actorName: users.name })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.actorId))
      .where(
        isInternal(ctx)
          ? eq(orderEvents.orderId, id)
          : and(eq(orderEvents.orderId, id), eq(orderEvents.visibleToHotel, true)),
      )
      .orderBy(asc(orderEvents.createdAt));
    const [hotel] = await db
      .select({ id: hotels.id, legalName: hotels.legalName, code: hotels.code })
      .from(hotels)
      .where(eq(hotels.id, o.hotelId));
    const quantities = Object.fromEntries(await lineQuantities(db, id));
    return {
      order: orderView(ctx, o, lines),
      hotel,
      quantities,
      events: events.map((r) => ({ ...r.e, actorName: r.actorName })),
    };
  });

  app.post('/orders', { preHandler: guard('orders.create', 'orders.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        hotelId: z.uuid().optional(),
        lines: z.array(lineInput).min(1).max(200),
        requestedDeliveryDate: z.iso.date().nullable().optional(),
        deliveryWindow: z.enum(['morning', 'afternoon', 'any']).default('any'),
        deliveryNotes: z.string().max(1000).nullable().optional(),
        submit: z.boolean().default(false),
        idempotencyKey: z.string().min(8).max(100).optional(),
      }),
      req.body,
    );
    const hotelId = ctx.actor.hotelId ?? body.hotelId;
    if (!hotelId) throw badRequest('hotelId is required');
    if (!ctx.actor.hotelId && !can(ctx, 'orders.manage')) throw forbidden();
    // A repeated submission with the same key returns the original order (double-click safe).
    if (body.idempotencyKey) {
      const [dup] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.hotelId, hotelId), eq(orders.idempotencyKey, body.idempotencyKey)));
      if (dup)
        return {
          order: orderView(
            ctx,
            dup,
            await db.select().from(orderLines).where(eq(orderLines.orderId, dup.id)),
          ),
          duplicate: true,
        };
    }
    const result = await db.transaction(async (tx) => {
      const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, hotelId));
      if (!hotel) throw notFound('Hotel');
      if (hotel.status === 'closed') throw unprocessable('This account is closed');
      const lines = await buildLines(tx, hotelId, body.lines);
      const orderNumber = await nextDocumentNumber(tx, 'order');
      const totals = computeTotals(lines.map((l) => ({ ...l, cancelledQty: '0' })));
      const [o] = await tx
        .insert(orders)
        .values({
          orderNumber,
          hotelId,
          createdBy: ctx.actor.id,
          requestedDeliveryDate: body.requestedDeliveryDate ?? null,
          deliveryWindow: body.deliveryWindow,
          deliveryNotes: body.deliveryNotes ?? null,
          idempotencyKey: body.idempotencyKey ?? null,
          ...totals,
        })
        .returning();
      await tx.insert(orderLines).values(lines.map((l) => ({ ...l, orderId: o!.id })));
      await addOrderEvent(tx, ctx, o!.id, { to: 'draft', event: 'created' });
      await audit(tx, ctx, {
        action: 'order.created',
        entityType: 'order',
        entityId: o!.id,
        hotelId,
        after: { orderNumber, total: totals.total, lines: lines.length },
      });
      if (body.submit) await submitOrder(tx, ctx, o!);
      const [fresh] = await tx.select().from(orders).where(eq(orders.id, o!.id));
      return fresh!;
    });
    const lines = await db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, result.id))
      .orderBy(asc(orderLines.lineNo));
    return { order: orderView(ctx, result, lines) };
  });

  /** Replace the lines of a draft order. */
  app.put('/orders/:id/lines', { preHandler: guard('orders.create', 'orders.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        lines: z.array(lineInput).min(1).max(200),
        requestedDeliveryDate: z.iso.date().nullable().optional(),
        deliveryWindow: z.enum(['morning', 'afternoon', 'any']).optional(),
        deliveryNotes: z.string().max(1000).nullable().optional(),
      }),
      req.body,
    );
    await db.transaction(async (tx) => {
      const o = await loadOrderForUpdate(tx, ctx, id);
      if (o.status !== 'draft') throw conflict('Only draft orders can be edited');
      const lines = await buildLines(tx, o.hotelId, body.lines);
      await tx.delete(orderLines).where(eq(orderLines.orderId, id));
      await tx.insert(orderLines).values(lines.map((l) => ({ ...l, orderId: id })));
      const { lines: _l, ...header } = body;
      await tx
        .update(orders)
        .set({ ...header, updatedAt: new Date() })
        .where(eq(orders.id, id));
      await recomputeOrderTotals(tx, id);
      await audit(tx, ctx, {
        action: 'order.edited',
        entityType: 'order',
        entityId: id,
        hotelId: o.hotelId,
        after: { lines: lines.length },
      });
    });
    return { ok: true };
  });

  app.post('/orders/:id/submit', { preHandler: guard('orders.create', 'orders.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const status = await db.transaction(async (tx) =>
      submitOrder(tx, ctx, await loadOrderForUpdate(tx, ctx, id)),
    );
    return { status };
  });

  app.post('/orders/:id/hotel-approve', { preHandler: guard('orders.approve_hotel') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const status = await db.transaction(async (tx) => {
      const o = await loadOrderForUpdate(tx, ctx, id);
      if (o.status !== 'pending_hotel_approval') throw conflict('Order is not waiting for hotel approval');
      await tx
        .update(orders)
        .set({ hotelApprovedBy: ctx.actor.id, hotelApprovedAt: new Date() })
        .where(eq(orders.id, id));
      await addOrderEvent(tx, ctx, id, { event: 'hotel_approved' });
      return creditStep(tx, ctx, o, 'pending_hotel_approval');
    });
    return { status };
  });

  app.post('/orders/:id/hotel-return', { preHandler: guard('orders.approve_hotel') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const { note } = parse(z.object({ note: z.string().max(500).optional() }), req.body);
    await db.transaction(async (tx) => {
      const o = await loadOrderForUpdate(tx, ctx, id);
      if (o.status !== 'pending_hotel_approval') throw conflict('Order is not waiting for hotel approval');
      await setOrderStatus(tx, ctx, id, o.status, 'draft', 'returned_to_draft', note);
    });
    return { ok: true };
  });

  app.post('/orders/:id/cancel', { preHandler: guard('orders.create', 'orders.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
    await db.transaction(async (tx) => {
      const o = await loadOrderForUpdate(tx, ctx, id);
      if (!canTransition(ORDER_TRANSITIONS, o.status, 'cancelled'))
        throw conflict(`An order that is ${o.status} cannot be cancelled`);
      // Hotels can cancel until procurement starts. After that, staff must check supplier commitments.
      if (
        !isInternal(ctx) &&
        !['draft', 'pending_hotel_approval', 'submitted', 'pending_approval', 'approved'].includes(o.status)
      ) {
        throw unprocessable('Procurement has started. Please contact us to cancel this order.');
      }
      const [committed] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(poLines)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
        .innerJoin(orderLines, eq(orderLines.id, poLines.orderLineId))
        .where(
          and(
            eq(orderLines.orderId, id),
            inArray(purchaseOrders.status, ['sent', 'confirmed', 'partially_received', 'received', 'closed']),
          ),
        );
      if ((committed?.n ?? 0) > 0)
        throw unprocessable(
          'Supplier purchases are already committed for this order; cancel or return them first',
        );
      // cancel any draft/pending POs created only for this order
      const draftPos = await tx
        .selectDistinct({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .innerJoin(poLines, eq(poLines.poId, purchaseOrders.id))
        .innerJoin(orderLines, eq(orderLines.id, poLines.orderLineId))
        .where(
          and(
            eq(orderLines.orderId, id),
            inArray(purchaseOrders.status, ['draft', 'pending_approval', 'approved']),
          ),
        );
      for (const po of draftPos) {
        await tx
          .update(purchaseOrders)
          .set({ status: 'cancelled', cancelledReason: `Order cancelled: ${reason}` })
          .where(eq(purchaseOrders.id, po.id));
      }
      await tx.update(orders).set({ cancelledReason: reason }).where(eq(orders.id, id));
      await setOrderStatus(tx, ctx, id, o.status, 'cancelled', 'cancelled', reason);
    });
    return { ok: true };
  });

  app.post('/orders/:id/reorder', { preHandler: guard('orders.create') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const [o] = await db.select().from(orders).where(eq(orders.id, id));
    if (!o) throw notFound('Order');
    assertHotelAccess(ctx, o.hotelId, 'Order');
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, id));
    const active = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          inArray(
            products.id,
            lines.map((l) => l.productId),
          ),
          eq(products.isActive, true),
        ),
      );
    const activeIds = new Set(active.map((a) => a.id));
    const keep = lines.filter((l) => activeIds.has(l.productId));
    if (!keep.length) throw unprocessable('None of the products in this order are still available');
    const created = await db.transaction(async (tx) => {
      const built = await buildLines(
        tx,
        o.hotelId,
        keep.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      );
      const orderNumber = await nextDocumentNumber(tx, 'order');
      const totals = computeTotals(built.map((l) => ({ ...l, cancelledQty: '0' })));
      const [n] = await tx
        .insert(orders)
        .values({ orderNumber, hotelId: o.hotelId, createdBy: ctx.actor.id, ...totals })
        .returning();
      await tx.insert(orderLines).values(built.map((l) => ({ ...l, orderId: n!.id })));
      await addOrderEvent(tx, ctx, n!.id, {
        to: 'draft',
        event: 'created',
        note: `Reorder of ${o.orderNumber}`,
      });
      return n!;
    });
    return { order: created, skipped: lines.length - keep.length };
  });

  /* ------------------------- internal operations ------------------------ */

  /** Change a line's selling price. Large deviations need owner approval. */
  app.post('/orders/:id/lines/:lineId/price', { preHandler: guard('orders.price_override') }, async (req) => {
    const ctx = ctxOf(req);
    const { id, lineId } = parse(z.object({ id: z.uuid(), lineId: z.uuid() }), req.params);
    const body = parse(z.object({ unitPrice: moneyStr, reason: z.string().min(3) }), req.body);
    return db.transaction(async (tx) => {
      const o = await loadOrderForUpdate(tx, ctx, id);
      if (['cancelled', 'rejected', 'closed'].includes(o.status)) throw conflict('Order is closed');
      const [line] = await tx
        .select()
        .from(orderLines)
        .where(and(eq(orderLines.id, lineId), eq(orderLines.orderId, id)));
      if (!line) throw notFound('Order line');
      const q = (await lineQuantities(tx, id)).get(lineId)!;
      if (cmpQty(q.invoiced, '0') > 0)
        throw unprocessable('This line has been invoiced; use a credit note instead');
      const rulePrice = (await resolvePrices(tx, o.hotelId, [line.productId])).get(line.productId)!.unitPrice;
      const settings = await getSettings(tx);
      const deviation =
        toPaisa(rulePrice) === 0n
          ? 100_000n
          : ((toPaisa(body.unitPrice) - toPaisa(rulePrice)) * 100_000n) / toPaisa(rulePrice);
      const absDev = deviation < 0n ? -deviation : deviation;
      const needsApproval =
        absDev > toPercentMilli(settings.priceOverrideThresholdPercent) && !can(ctx, 'approvals.decide');
      if (needsApproval) {
        const approval = await requestApproval(tx, ctx, {
          type: 'price_override',
          targetType: 'order_line',
          targetId: lineId,
          hotelId: o.hotelId,
          amount: body.unitPrice,
          summary: `Price override on ${o.orderNumber} / ${line.nameEn}: ${line.unitPrice} → ${body.unitPrice} (rule price ${rulePrice})`,
          details: {
            orderId: id,
            lineId,
            unitPrice: body.unitPrice,
            previous: line.unitPrice,
            rulePrice,
            reason: body.reason,
          },
        });
        return { applied: false, approval };
      }
      await applyLinePrice(tx, ctx, o, line, body.unitPrice, body.reason);
      return { applied: true };
    });
  });

  /** Manual supplier selection for a line (procurement staff decide; no automatic matching). */
  app.put('/orders/:id/lines/:lineId/sourcing', { preHandler: guard('procurement.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id, lineId } = parse(z.object({ id: z.uuid(), lineId: z.uuid() }), req.params);
    const body = parse(
      z.object({
        supplierId: z.uuid(),
        quotationId: z.uuid().nullable().optional(),
        unitCost: moneyStr.optional(),
      }),
      req.body,
    );
    const result = await db.transaction(async (tx) => {
      const o = await loadOrderForUpdate(tx, ctx, id);
      if (
        !['approved', 'procurement', 'consolidating', 'ready_for_dispatch', 'partially_delivered'].includes(
          o.status,
        )
      ) {
        throw conflict(`Suppliers can be selected once the order is approved (order is ${o.status})`);
      }
      const [line] = await tx
        .select()
        .from(orderLines)
        .where(and(eq(orderLines.id, lineId), eq(orderLines.orderId, id)));
      if (!line) throw notFound('Order line');
      const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, body.supplierId));
      if (!supplier || supplier.status !== 'active') throw unprocessable('Supplier is not active');
      let unitCost = body.unitCost;
      if (body.quotationId) {
        const [qt] = await tx
          .select()
          .from(supplierQuotations)
          .where(eq(supplierQuotations.id, body.quotationId));
        if (!qt || qt.supplierId !== body.supplierId || qt.productId !== line.productId)
          throw badRequest('Quotation does not match this supplier and product');
        unitCost ??= qt.unitCost;
      }
      if (!unitCost) throw badRequest('Provide a quotation or a unit cost');
      const [updated] = await tx
        .update(orderLines)
        .set({
          selectedSupplierId: body.supplierId,
          selectedQuotationId: body.quotationId ?? null,
          expectedUnitCost: unitCost,
        })
        .where(eq(orderLines.id, lineId))
        .returning();
      await addOrderEvent(tx, ctx, id, {
        event: 'supplier_selected',
        note: `${line.nameEn}: ${supplier.name} @ ${unitCost}`,
        visibleToHotel: false,
      });
      await audit(tx, ctx, {
        action: 'order.supplier_selected',
        entityType: 'order_line',
        entityId: lineId,
        hotelId: o.hotelId,
        before: { supplierId: line.selectedSupplierId, unitCost: line.expectedUnitCost },
        after: { supplierId: body.supplierId, quotationId: body.quotationId, unitCost },
      });
      return updated!;
    });
    return { line: result };
  });

  /** Expected margin and reconciliation for staff. */
  app.get(
    '/orders/:id/procurement',
    { preHandler: guard('procurement.manage', 'costs.view') },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const [o] = await db.select().from(orders).where(eq(orders.id, id));
      if (!o) throw notFound('Order');
      const lines = await db
        .select({ line: orderLines, supplierName: suppliers.name })
        .from(orderLines)
        .leftJoin(suppliers, eq(suppliers.id, orderLines.selectedSupplierId))
        .where(eq(orderLines.orderId, id))
        .orderBy(asc(orderLines.lineNo));
      const qty = await lineQuantities(db, id);
      let revenue = '0.00';
      let cost = '0.00';
      let costComplete = true;
      const out = lines.map(({ line, supplierName }) => {
        const q = qty.get(line.id)!;
        const rev = lineAmount(q.needed, line.unitPrice);
        revenue = addMoney(revenue, rev);
        const c = line.expectedUnitCost ? lineAmount(q.needed, line.expectedUnitCost) : null;
        if (c) cost = addMoney(cost, c);
        else costComplete = false;
        return {
          ...line,
          supplierName,
          quantities: q,
          expectedRevenue: rev,
          expectedCost: c,
          toPurchase: maxZero(subQty(q.needed, q.purchased)),
        };
      });
      const pos = await db
        .selectDistinct({ po: purchaseOrders, supplierName: suppliers.name })
        .from(purchaseOrders)
        .innerJoin(poLines, eq(poLines.poId, purchaseOrders.id))
        .innerJoin(orderLines, eq(orderLines.id, poLines.orderLineId))
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .where(eq(orderLines.orderId, id));
      return {
        lines: out,
        purchaseOrders: pos.map((p) => ({ ...p.po, supplierName: p.supplierName })),
        expected: {
          revenue,
          cost,
          grossMargin: subMoney(revenue, cost),
          marginPercent: marginPercent(revenue, cost),
          costComplete,
        },
      };
    },
  );

  /** Create draft supplier POs, one per selected supplier, for quantities not yet purchased. */
  app.post('/orders/:id/purchase-orders', { preHandler: guard('procurement.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        fulfillment: z.enum(['hub', 'direct']).default('hub'),
        expectedDate: z.iso.date().nullable().optional(),
      }),
      req.body,
    );
    const created = await db.transaction(async (tx) => {
      const o = await loadOrderForUpdate(tx, ctx, id);
      if (
        !['approved', 'procurement', 'consolidating', 'ready_for_dispatch', 'partially_delivered'].includes(
          o.status,
        )
      ) {
        throw conflict(`Purchase orders can only be created for approved orders (order is ${o.status})`);
      }
      const lines = await tx
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, id))
        .orderBy(asc(orderLines.lineNo));
      const qty = await lineQuantities(tx, id);
      const bySupplier = new Map<string, { line: LineRow; qty: string }[]>();
      for (const l of lines) {
        const remaining = subQty(qty.get(l.id)!.needed, qty.get(l.id)!.purchased);
        if (cmpQty(remaining, '0') <= 0) continue;
        if (!l.selectedSupplierId || !l.expectedUnitCost) continue;
        const list = bySupplier.get(l.selectedSupplierId) ?? [];
        list.push({ line: l, qty: remaining });
        bySupplier.set(l.selectedSupplierId, list);
      }
      if (bySupplier.size === 0)
        throw unprocessable('Select a supplier for each line that still needs purchasing');
      const { createPurchaseOrder } = await import('./procurement');
      const pos = [];
      for (const [supplierId, items] of bySupplier) {
        pos.push(
          await createPurchaseOrder(tx, ctx, {
            supplierId,
            fulfillment: body.fulfillment,
            directHotelId: body.fulfillment === 'direct' ? o.hotelId : null,
            expectedDate: body.expectedDate ?? null,
            lines: items.map((i) => ({
              productId: i.line.productId,
              orderLineId: i.line.id,
              quotationId: i.line.selectedQuotationId,
              quantity: i.qty,
              unitCost: i.line.expectedUnitCost!,
              taxRate: i.line.taxRate,
            })),
          }),
        );
      }
      if (o.status === 'approved')
        await setOrderStatus(tx, ctx, id, 'approved', 'procurement', 'procurement_started');
      return pos;
    });
    return { purchaseOrders: created };
  });
}

function maxZero(q: string) {
  return cmpQty(q, '0') < 0 ? '0.000' : q;
}

async function applyLinePrice(
  tx: DbOrTx,
  ctx: Ctx,
  o: OrderRow,
  line: LineRow,
  unitPrice: string,
  reason: string,
  approvalId?: string,
) {
  await tx
    .update(orderLines)
    .set({ unitPrice, priceSource: 'override', lineSubtotal: lineAmount(line.quantity, unitPrice) })
    .where(eq(orderLines.id, line.id));
  await recomputeOrderTotals(tx, o.id);
  await tx.insert(priceHistory).values({
    entity: 'order_line',
    entityId: line.id,
    productId: line.productId,
    hotelId: o.hotelId,
    oldValue: line.unitPrice,
    newValue: unitPrice,
    reason,
    changedBy: ctx.actor.id,
    approvalId: approvalId ?? null,
  });
  await addOrderEvent(tx, ctx, o.id, {
    event: 'price_changed',
    note: `${line.nameEn}: ${line.unitPrice} → ${unitPrice}`,
    visibleToHotel: true,
  });
  await audit(tx, ctx, {
    action: 'order.price_override',
    entityType: 'order_line',
    entityId: line.id,
    hotelId: o.hotelId,
    reason,
    before: { unitPrice: line.unitPrice },
    after: { unitPrice, approvalId },
  });
}

/* ------------------------------ approval hooks ------------------------------ */

registerApprovalHandler('credit_order', {
  async onApprove(tx, ctx, req) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, req.targetId)).for('update');
    if (!o || o.status !== 'pending_approval') return;
    await tx
      .update(orders)
      .set({ approvedBy: ctx.actor.id, approvedAt: new Date() })
      .where(eq(orders.id, o.id));
    await setOrderStatus(
      tx,
      ctx,
      o.id,
      'pending_approval',
      'approved',
      'credit_approved',
      req.decisionNote ?? undefined,
    );
    await notifyRoles(tx, ['procurement'], {
      kind: 'order_approved',
      title: `Order ${o.orderNumber} approved`,
      link: `/orders/${o.id}`,
    });
  },
  async onReject(tx, ctx, req) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, req.targetId)).for('update');
    if (!o || o.status !== 'pending_approval') return;
    await setOrderStatus(
      tx,
      ctx,
      o.id,
      'pending_approval',
      'rejected',
      'credit_rejected',
      req.decisionNote ?? undefined,
    );
    await notifyRoles(
      tx,
      ['hotel_manager', 'hotel_purchaser'],
      {
        kind: 'order_rejected',
        title: `Order ${o.orderNumber} was not approved`,
        body: req.decisionNote ?? undefined,
        link: `/orders/${o.id}`,
      },
      o.hotelId,
    );
  },
});

registerApprovalHandler('price_override', {
  async onApprove(tx, ctx, req) {
    const d = req.details as { orderId: string; lineId: string; unitPrice: string; reason: string };
    const [o] = await tx.select().from(orders).where(eq(orders.id, d.orderId)).for('update');
    const [line] = await tx.select().from(orderLines).where(eq(orderLines.id, d.lineId));
    if (!o || !line) return;
    await applyLinePrice(tx, ctx, o, line, d.unitPrice, d.reason, req.id);
  },
  async onReject() {},
});
