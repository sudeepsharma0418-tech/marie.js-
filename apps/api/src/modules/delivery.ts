import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DELIVERY_TRANSITIONS, addQty, canTransition, cmpQty, subQty, type DeliveryStatus } from '@hp/shared';
import type { DbOrTx } from '../db/client';
import {
  attachments,
  deliveries,
  deliveryLines,
  deliveryRuns,
  hotels,
  hubReservations,
  hubStockMovements,
  orderLines,
  orders,
  users,
} from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { assertHotelAccess, type Ctx } from '../lib/context';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { idParam, parse } from '../lib/http';
import { audit } from '../lib/audit';
import { nextDocumentNumber } from '../lib/numbering';
import { getSettings } from '../lib/settings';
import { notifyRoles } from '../lib/notify';
import { addOrderEvent, lineQuantities, refreshOrderStatus } from './orders-core';
import { hubStock } from './hub';

const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Quantity with up to 3 decimals');

type DeliveryRow = typeof deliveries.$inferSelect;

async function loadDelivery(tx: DbOrTx, ctx: Ctx, id: string, lock = false): Promise<DeliveryRow> {
  const q = tx.select().from(deliveries).where(eq(deliveries.id, id));
  const [d] = lock ? await q.for('update') : await q;
  if (!d) throw notFound('Delivery');
  assertHotelAccess(ctx, d.hotelId, 'Delivery');
  // drivers only see deliveries on their own runs
  if (ctx.actor.role === 'driver') {
    if (!d.runId) throw notFound('Delivery');
    const [run] = await tx
      .select({ driverId: deliveryRuns.driverId })
      .from(deliveryRuns)
      .where(eq(deliveryRuns.id, d.runId));
    if (run?.driverId !== ctx.actor.id) throw notFound('Delivery');
  }
  return d;
}

function assertDeliveryTransition(d: DeliveryRow, to: DeliveryStatus) {
  if (!canTransition(DELIVERY_TRANSITIONS, d.status, to))
    throw conflict(`A delivery that is ${d.status} cannot become ${to}`);
}

/**
 * After goods reach the hotel: refresh the order, generate the draft invoice
 * if the company invoices on delivery, and tell the hotel.
 */
export async function afterDeliveryConfirmed(tx: DbOrTx, ctx: Ctx, d: DeliveryRow) {
  await refreshOrderStatus(tx, ctx, d.orderId);
  const settings = await getSettings(tx);
  if (settings.invoiceTrigger === 'on_delivery') {
    const { createDraftInvoiceForOrder } = await import('./finance');
    await createDraftInvoiceForOrder(tx, ctx, d.orderId, { quiet: true });
  }
  const [o] = await tx
    .select({ orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.id, d.orderId));
  await notifyRoles(
    tx,
    ['hotel_manager', 'hotel_purchaser'],
    {
      kind: 'delivery_completed',
      title: `Delivery for ${o!.orderNumber}: ${d.status.replace('_', ' ')}`,
      link: `/orders/${d.orderId}`,
    },
    d.hotelId,
  );
}

/** Supplier delivered straight to the hotel (no hub dispatch). */
export async function recordDirectDelivery(
  tx: DbOrTx,
  ctx: Ctx,
  input: {
    orderId: string;
    poId: string;
    recipientName: string;
    lines: { orderLineId: string; productId: string; accepted: string; damaged: string }[];
  },
) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
  const deliveryNumber = await nextDocumentNumber(tx, 'delivery');
  const allGood = input.lines.every((l) => cmpQty(l.damaged, '0') === 0);
  const [d] = await tx
    .insert(deliveries)
    .values({
      deliveryNumber,
      orderId: input.orderId,
      hotelId: o!.hotelId,
      directPoId: input.poId,
      status: allGood ? 'delivered' : 'partially_delivered',
      dispatchedAt: new Date(),
      dispatchedBy: ctx.actor.id,
      deliveredAt: new Date(),
      confirmedBy: ctx.actor.id,
      recipientName: input.recipientName,
      notes: 'Direct supplier delivery',
      createdBy: ctx.actor.id,
    })
    .returning();
  await tx.insert(deliveryLines).values(
    input.lines.map((l) => ({
      deliveryId: d!.id,
      orderLineId: l.orderLineId,
      productId: l.productId,
      qtyDispatched: addQty(l.accepted, l.damaged),
      qtyDelivered: l.accepted,
      qtyDamaged: l.damaged,
    })),
  );
  await addOrderEvent(tx, ctx, input.orderId, {
    event: 'direct_delivery',
    note: `${deliveryNumber} received by ${input.recipientName}`,
  });
  await audit(tx, ctx, {
    action: 'delivery.direct_recorded',
    entityType: 'delivery',
    entityId: d!.id,
    hotelId: o!.hotelId,
    after: { deliveryNumber, lines: input.lines },
  });
  await afterDeliveryConfirmed(tx, ctx, d!);
  return d!;
}

export async function deliveryRoutes(app: FastifyInstance) {
  const db = app.db;
  const viewGuard = guard(
    'delivery.manage',
    'delivery.view_assigned',
    'orders.read_own_hotel',
    'hub.dispatch',
  );

  /* ------------------------------- runs ------------------------------- */

  app.get(
    '/delivery-runs',
    { preHandler: guard('delivery.manage', 'delivery.view_assigned', 'hub.dispatch') },
    async (req) => {
      const ctx = ctxOf(req);
      const q = parse(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
      const conds = [];
      if (ctx.actor.role === 'driver') conds.push(eq(deliveryRuns.driverId, ctx.actor.id));
      if (q.from) conds.push(sql`${deliveryRuns.scheduledDate} >= ${q.from}`);
      if (q.to) conds.push(sql`${deliveryRuns.scheduledDate} <= ${q.to}`);
      const rows = await db
        .select({
          run: deliveryRuns,
          driverName: users.name,
          stops: sql<number>`(select count(*)::int from deliveries d where d.run_id = delivery_runs.id and d.status <> 'cancelled')`,
        })
        .from(deliveryRuns)
        .leftJoin(users, eq(users.id, deliveryRuns.driverId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(deliveryRuns.scheduledDate))
        .limit(200);
      return { items: rows.map((r) => ({ ...r.run, driverName: r.driverName, stops: r.stops })) };
    },
  );

  app.post('/delivery-runs', { preHandler: guard('delivery.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        scheduledDate: z.iso.date(),
        windowStart: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        windowEnd: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        driverId: z.uuid().nullable().optional(),
        vehicle: z.string().max(50).nullable().optional(),
        routeNotes: z.string().max(2000).nullable().optional(),
      }),
      req.body,
    );
    if (body.driverId) {
      const [drv] = await db.select().from(users).where(eq(users.id, body.driverId));
      if (!drv || drv.role !== 'driver' || !drv.isActive)
        throw badRequest('Assigned user is not an active driver');
    }
    const run = await db.transaction(async (tx) => {
      const runNumber = await nextDocumentNumber(tx, 'delivery_run');
      const [r] = await tx
        .insert(deliveryRuns)
        .values({ ...body, runNumber, createdBy: ctx.actor.id })
        .returning();
      await audit(tx, ctx, {
        action: 'delivery_run.created',
        entityType: 'delivery_run',
        entityId: r!.id,
        after: r,
      });
      return r!;
    });
    return { run };
  });

  app.patch('/delivery-runs/:id', { preHandler: guard('delivery.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z
        .object({
          scheduledDate: z.iso.date(),
          windowStart: z.string().nullable(),
          windowEnd: z.string().nullable(),
          driverId: z.uuid().nullable(),
          vehicle: z.string().nullable(),
          routeNotes: z.string().nullable(),
          status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']),
        })
        .partial(),
      req.body,
    );
    if (body.driverId) {
      const [drv] = await db.select().from(users).where(eq(users.id, body.driverId));
      if (!drv || drv.role !== 'driver' || !drv.isActive)
        throw badRequest('Assigned user is not an active driver');
    }
    const [before] = await db.select().from(deliveryRuns).where(eq(deliveryRuns.id, id));
    if (!before) throw notFound('Delivery run');
    const [run] = await db.transaction(async (tx) => {
      const r = await tx
        .update(deliveryRuns)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(deliveryRuns.id, id))
        .returning();
      await audit(tx, ctx, {
        action: 'delivery_run.updated',
        entityType: 'delivery_run',
        entityId: id,
        before,
        after: r[0],
      });
      return r;
    });
    return { run };
  });

  /* ---------------------------- deliveries ---------------------------- */

  app.get('/deliveries', { preHandler: viewGuard }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({
        runId: z.uuid().optional(),
        orderId: z.uuid().optional(),
        status: z.string().optional(),
        date: z.iso.date().optional(),
      }),
      req.query,
    );
    const conds = [];
    if (ctx.actor.hotelId) conds.push(eq(deliveries.hotelId, ctx.actor.hotelId));
    if (ctx.actor.role === 'driver') conds.push(eq(deliveryRuns.driverId, ctx.actor.id));
    if (q.runId) conds.push(eq(deliveries.runId, q.runId));
    if (q.orderId) conds.push(eq(deliveries.orderId, q.orderId));
    if (q.status) conds.push(inArray(deliveries.status, q.status.split(',') as DeliveryStatus[]));
    if (q.date) conds.push(eq(deliveryRuns.scheduledDate, q.date));
    const rows = await db
      .select({
        d: deliveries,
        orderNumber: orders.orderNumber,
        hotelName: hotels.legalName,
        deliveryAddress: hotels.deliveryAddress,
        address: hotels.address,
        contactPhone: hotels.primaryContactPhone,
        runNumber: deliveryRuns.runNumber,
        scheduledDate: deliveryRuns.scheduledDate,
        windowStart: deliveryRuns.windowStart,
        windowEnd: deliveryRuns.windowEnd,
        driverName: users.name,
      })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .innerJoin(hotels, eq(hotels.id, deliveries.hotelId))
      .leftJoin(deliveryRuns, eq(deliveryRuns.id, deliveries.runId))
      .leftJoin(users, eq(users.id, deliveryRuns.driverId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(deliveries.createdAt))
      .limit(200);
    return {
      items: rows.map((r) => ({
        ...r.d,
        orderNumber: r.orderNumber,
        hotelName: r.hotelName,
        deliveryAddress: r.deliveryAddress ?? r.address,
        contactPhone: r.contactPhone,
        runNumber: r.runNumber,
        scheduledDate: r.scheduledDate,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        driverName: r.driverName,
      })),
    };
  });

  app.get('/deliveries/:id', { preHandler: viewGuard }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const d = await loadDelivery(db, ctx, id);
    const lines = await db
      .select({
        l: deliveryLines,
        nameEn: orderLines.nameEn,
        nameNe: orderLines.nameNe,
        unit: orderLines.unit,
      })
      .from(deliveryLines)
      .innerJoin(orderLines, eq(orderLines.id, deliveryLines.orderLineId))
      .where(eq(deliveryLines.deliveryId, id));
    const [hotel] = await db
      .select({
        legalName: hotels.legalName,
        deliveryAddress: hotels.deliveryAddress,
        address: hotels.address,
        deliveryInstructions: hotels.deliveryInstructions,
        primaryContactName: hotels.primaryContactName,
        primaryContactPhone: hotels.primaryContactPhone,
      })
      .from(hotels)
      .where(eq(hotels.id, d.hotelId));
    const [order] = await db
      .select({ orderNumber: orders.orderNumber, deliveryNotes: orders.deliveryNotes })
      .from(orders)
      .where(eq(orders.id, d.orderId));
    const run = d.runId
      ? (await db.select().from(deliveryRuns).where(eq(deliveryRuns.id, d.runId)))[0]
      : null;
    return {
      delivery: d,
      lines: lines.map((r) => ({ ...r.l, nameEn: r.nameEn, nameNe: r.nameNe, unit: r.unit })),
      hotel,
      order,
      run,
    };
  });

  /** Schedule a delivery of reserved hub stock for an order. Defaults to everything ready. */
  app.post('/deliveries', { preHandler: guard('delivery.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        orderId: z.uuid(),
        runId: z.uuid().nullable().optional(),
        instructions: z.string().max(1000).nullable().optional(),
        lines: z.array(z.object({ orderLineId: z.uuid(), quantity: qtyStr })).optional(),
      }),
      req.body,
    );
    const delivery = await db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, body.orderId)).for('update');
      if (!o) throw notFound('Order');
      if (['cancelled', 'rejected', 'closed', 'draft'].includes(o.status))
        throw unprocessable(`Order is ${o.status}`);
      if (body.runId) {
        const [run] = await tx.select().from(deliveryRuns).where(eq(deliveryRuns.id, body.runId));
        if (!run || ['completed', 'cancelled'].includes(run.status))
          throw unprocessable('Delivery run is not open');
      }
      const q = await lineQuantities(tx, o.id);
      const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id));
      const wanted =
        body.lines ??
        lines
          .map((l) => ({
            orderLineId: l.id,
            quantity: subQty(q.get(l.id)!.reserved, q.get(l.id)!.scheduled),
          }))
          .filter((l) => cmpQty(l.quantity, '0') > 0);
      if (!wanted.length) throw unprocessable('Nothing is reserved at the hub for this order yet');
      for (const w of wanted) {
        const lq = q.get(w.orderLineId);
        if (!lq) throw badRequest('Line does not belong to this order');
        const free = subQty(lq.reserved, lq.scheduled);
        if (cmpQty(w.quantity, '0') <= 0) throw badRequest('Quantities must be positive');
        if (cmpQty(w.quantity, free) > 0)
          throw unprocessable(`Only ${free} is reserved and unscheduled for this line`, {
            orderLineId: w.orderLineId,
            free,
          });
      }
      const deliveryNumber = await nextDocumentNumber(tx, 'delivery');
      const [d] = await tx
        .insert(deliveries)
        .values({
          deliveryNumber,
          runId: body.runId ?? null,
          orderId: o.id,
          hotelId: o.hotelId,
          instructions: body.instructions ?? null,
          createdBy: ctx.actor.id,
        })
        .returning();
      const productOf = new Map(lines.map((l) => [l.id, l.productId]));
      await tx.insert(deliveryLines).values(
        wanted.map((w) => ({
          deliveryId: d!.id,
          orderLineId: w.orderLineId,
          productId: productOf.get(w.orderLineId)!,
          qtyDispatched: w.quantity,
        })),
      );
      await addOrderEvent(tx, ctx, o.id, { event: 'delivery_scheduled', note: deliveryNumber });
      await audit(tx, ctx, {
        action: 'delivery.scheduled',
        entityType: 'delivery',
        entityId: d!.id,
        hotelId: o.hotelId,
        after: { deliveryNumber, lines: wanted },
      });
      return d!;
    });
    return { delivery };
  });

  app.patch('/deliveries/:id', { preHandler: guard('delivery.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        runId: z.uuid().nullable().optional(),
        instructions: z.string().nullable().optional(),
        stopOrder: z.string().nullable().optional(),
      }),
      req.body,
    );
    const d = await db.transaction(async (tx) => {
      const cur = await loadDelivery(tx, ctx, id, true);
      if (cur.status !== 'scheduled') throw conflict('Only scheduled deliveries can be changed');
      const [u] = await tx
        .update(deliveries)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(deliveries.id, id))
        .returning();
      await audit(tx, ctx, {
        action: 'delivery.updated',
        entityType: 'delivery',
        entityId: id,
        hotelId: cur.hotelId,
        before: cur,
        after: u,
      });
      return u!;
    });
    return { delivery: d };
  });

  /** Goods leave the hub: stock and reservations are reduced in the same transaction. */
  app.post(
    '/deliveries/:id/dispatch',
    { preHandler: guard('hub.dispatch', 'delivery.manage') },
    async (req) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParam, req.params);
      const d = await db.transaction(async (tx) => {
        const cur = await loadDelivery(tx, ctx, id, true);
        assertDeliveryTransition(cur, 'dispatched');
        const lines = await tx.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, id));
        const q = await lineQuantities(tx, cur.orderId);
        const stock = await hubStock(
          tx,
          lines.map((l) => l.productId),
        );
        for (const l of lines) {
          const lq = q.get(l.orderLineId)!;
          if (cmpQty(l.qtyDispatched, lq.reserved) > 0)
            throw unprocessable(`Reserved stock is short for a line (reserved ${lq.reserved})`);
          if (cmpQty(l.qtyDispatched, stock.get(l.productId)!.onHand) > 0)
            throw unprocessable('Hub stock on hand is lower than the dispatch quantity');
          await tx.insert(hubStockMovements).values({
            productId: l.productId,
            movementType: 'dispatch',
            quantity: `-${l.qtyDispatched}`,
            deliveryLineId: l.id,
            orderLineId: l.orderLineId,
            reason: cur.deliveryNumber,
            actorId: ctx.actor.id,
          });
          await tx.insert(hubReservations).values({
            productId: l.productId,
            orderLineId: l.orderLineId,
            quantity: `-${l.qtyDispatched}`,
            reason: 'dispatch',
            actorId: ctx.actor.id,
          });
        }
        const [u] = await tx
          .update(deliveries)
          .set({
            status: 'dispatched',
            dispatchedAt: new Date(),
            dispatchedBy: ctx.actor.id,
            updatedAt: new Date(),
          })
          .where(eq(deliveries.id, id))
          .returning();
        if (cur.runId)
          await tx
            .update(deliveryRuns)
            .set({ status: 'in_progress' })
            .where(and(eq(deliveryRuns.id, cur.runId), eq(deliveryRuns.status, 'planned')));
        await addOrderEvent(tx, ctx, cur.orderId, { event: 'dispatched', note: cur.deliveryNumber });
        await audit(tx, ctx, {
          action: 'delivery.dispatched',
          entityType: 'delivery',
          entityId: id,
          hotelId: cur.hotelId,
          before: { status: cur.status },
          after: { status: 'dispatched' },
        });
        await refreshOrderStatus(tx, ctx, cur.orderId);
        return u!;
      });
      return { delivery: d };
    },
  );

  /**
   * Driver confirms what actually happened at the hotel. For each line:
   * dispatched = delivered + damaged + missing + returned. Returned goods go back
   * into hub stock and are re-reserved for the order.
   */
  app.post(
    '/deliveries/:id/confirm',
    { preHandler: guard('delivery.confirm', 'delivery.manage') },
    async (req) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParam, req.params);
      const body = parse(
        z.object({
          recipientName: z.string().min(1).max(120),
          recipientPhone: z.string().max(30).nullable().optional(),
          notes: z.string().max(1000).nullable().optional(),
          signatureAttachmentId: z.uuid().nullable().optional(),
          photoAttachmentId: z.uuid().nullable().optional(),
          lines: z
            .array(
              z.object({
                deliveryLineId: z.uuid(),
                qtyDelivered: qtyStr,
                qtyDamaged: qtyStr.default('0'),
                qtyMissing: qtyStr.default('0'),
                qtyReturned: qtyStr.default('0'),
                notes: z.string().max(500).nullable().optional(),
              }),
            )
            .min(1),
        }),
        req.body,
      );
      const d = await db.transaction(async (tx) => {
        const cur = await loadDelivery(tx, ctx, id, true);
        if (cur.status !== 'dispatched')
          throw conflict(`Delivery is ${cur.status}; only dispatched deliveries can be confirmed`);
        const lines = await tx.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, id));
        const byId = new Map(lines.map((l) => [l.id, l]));
        if (body.lines.length !== lines.length || !body.lines.every((l) => byId.has(l.deliveryLineId))) {
          throw badRequest('Confirm every line of the delivery exactly once');
        }
        for (const attId of [body.signatureAttachmentId, body.photoAttachmentId]) {
          if (!attId) continue;
          const [a] = await tx.select().from(attachments).where(eq(attachments.id, attId));
          if (!a || a.category !== 'delivery_evidence' || (a.hotelId && a.hotelId !== cur.hotelId))
            throw badRequest('Invalid delivery evidence');
        }
        let allDelivered = true;
        for (const c of body.lines) {
          const l = byId.get(c.deliveryLineId)!;
          const sum = addQty(c.qtyDelivered, c.qtyDamaged, c.qtyMissing, c.qtyReturned);
          if (cmpQty(sum, l.qtyDispatched) !== 0) {
            throw unprocessable(
              `Delivered + damaged + missing + returned must equal the dispatched quantity (${l.qtyDispatched})`,
              { deliveryLineId: l.id },
            );
          }
          if (cmpQty(c.qtyDelivered, l.qtyDispatched) !== 0) allDelivered = false;
          await tx
            .update(deliveryLines)
            .set({
              qtyDelivered: c.qtyDelivered,
              qtyDamaged: c.qtyDamaged,
              qtyMissing: c.qtyMissing,
              qtyReturned: c.qtyReturned,
              notes: c.notes ?? null,
            })
            .where(eq(deliveryLines.id, l.id));
          if (cmpQty(c.qtyReturned, '0') > 0) {
            await tx.insert(hubStockMovements).values({
              productId: l.productId,
              movementType: 'delivery_return',
              quantity: c.qtyReturned,
              deliveryLineId: l.id,
              orderLineId: l.orderLineId,
              reason: `Returned from ${cur.deliveryNumber}`,
              actorId: ctx.actor.id,
            });
            await tx.insert(hubReservations).values({
              productId: l.productId,
              orderLineId: l.orderLineId,
              quantity: c.qtyReturned,
              reason: 'delivery_return',
              actorId: ctx.actor.id,
            });
          }
        }
        const status: DeliveryStatus = allDelivered ? 'delivered' : 'partially_delivered';
        const [u] = await tx
          .update(deliveries)
          .set({
            status,
            deliveredAt: new Date(),
            confirmedBy: ctx.actor.id,
            recipientName: body.recipientName,
            recipientPhone: body.recipientPhone ?? null,
            signatureAttachmentId: body.signatureAttachmentId ?? null,
            photoAttachmentId: body.photoAttachmentId ?? null,
            notes: body.notes ?? cur.notes,
            updatedAt: new Date(),
          })
          .where(eq(deliveries.id, id))
          .returning();
        await addOrderEvent(tx, ctx, cur.orderId, {
          event: status,
          note: `${cur.deliveryNumber} received by ${body.recipientName}${allDelivered ? '' : ' (with exceptions)'}`,
        });
        await audit(tx, ctx, {
          action: `delivery.${status}`,
          entityType: 'delivery',
          entityId: id,
          hotelId: cur.hotelId,
          after: { status, lines: body.lines, recipientName: body.recipientName },
        });
        if (!allDelivered) {
          await notifyRoles(tx, ['owner', 'procurement'], {
            kind: 'delivery_exception',
            title: `Delivery exception on ${cur.deliveryNumber}`,
            link: `/deliveries/${id}`,
          });
        }
        await afterDeliveryConfirmed(tx, ctx, u!);
        await closeRunIfDone(tx, cur.runId);
        return u!;
      });
      return { delivery: d };
    },
  );

  /** Delivery could not be completed: everything goes back to the hub and is re-reserved. */
  app.post(
    '/deliveries/:id/fail',
    { preHandler: guard('delivery.confirm', 'delivery.manage') },
    async (req) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParam, req.params);
      const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
      const d = await db.transaction(async (tx) => {
        const cur = await loadDelivery(tx, ctx, id, true);
        assertDeliveryTransition(cur, 'failed');
        const lines = await tx.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, id));
        for (const l of lines) {
          await tx
            .update(deliveryLines)
            .set({ qtyDelivered: '0', qtyReturned: l.qtyDispatched })
            .where(eq(deliveryLines.id, l.id));
          await tx.insert(hubStockMovements).values({
            productId: l.productId,
            movementType: 'delivery_return',
            quantity: l.qtyDispatched,
            deliveryLineId: l.id,
            orderLineId: l.orderLineId,
            reason: `Failed delivery ${cur.deliveryNumber}: ${reason}`,
            actorId: ctx.actor.id,
          });
          await tx.insert(hubReservations).values({
            productId: l.productId,
            orderLineId: l.orderLineId,
            quantity: l.qtyDispatched,
            reason: 'delivery_return',
            actorId: ctx.actor.id,
          });
        }
        const [u] = await tx
          .update(deliveries)
          .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
          .where(eq(deliveries.id, id))
          .returning();
        await addOrderEvent(tx, ctx, cur.orderId, {
          event: 'delivery_failed',
          note: `${cur.deliveryNumber}: ${reason}`,
        });
        await audit(tx, ctx, {
          action: 'delivery.failed',
          entityType: 'delivery',
          entityId: id,
          hotelId: cur.hotelId,
          reason,
        });
        await notifyRoles(tx, ['owner', 'procurement'], {
          kind: 'delivery_failed',
          title: `Delivery ${cur.deliveryNumber} failed`,
          body: reason,
          link: `/deliveries/${id}`,
        });
        await refreshOrderStatus(tx, ctx, cur.orderId);
        await closeRunIfDone(tx, cur.runId);
        return u!;
      });
      return { delivery: d };
    },
  );

  app.post('/deliveries/:id/cancel', { preHandler: guard('delivery.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const d = await db.transaction(async (tx) => {
      const cur = await loadDelivery(tx, ctx, id, true);
      assertDeliveryTransition(cur, 'cancelled');
      const [u] = await tx
        .update(deliveries)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(deliveries.id, id))
        .returning();
      await audit(tx, ctx, {
        action: 'delivery.cancelled',
        entityType: 'delivery',
        entityId: id,
        hotelId: cur.hotelId,
      });
      return u!;
    });
    return { delivery: d };
  });
}

async function closeRunIfDone(tx: DbOrTx, runId: string | null) {
  if (!runId) return;
  const [open] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(deliveries)
    .where(and(eq(deliveries.runId, runId), inArray(deliveries.status, ['scheduled', 'dispatched'])));
  if ((open?.n ?? 0) === 0)
    await tx
      .update(deliveryRuns)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(deliveryRuns.id, runId));
}
