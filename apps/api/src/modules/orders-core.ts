import { and, eq, sql } from 'drizzle-orm';
import { addQty, cmpQty, subQty, type OrderStatus } from '@hp/shared';
import type { DbOrTx } from '../db/client';
import { deliveries, orderEvents, orderLines, orders } from '../db/schema';
import type { Ctx } from '../lib/context';
import { audit } from '../lib/audit';

export interface LineQuantities {
  orderLineId: string;
  ordered: string;
  cancelled: string;
  needed: string;
  purchased: string;
  received: string;
  damagedOnReceipt: string;
  reserved: string;
  scheduled: string;
  dispatched: string;
  delivered: string;
  invoiced: string;
}

/**
 * Reconciles every stage for each order line from the underlying records.
 * Nothing here is a stored counter: all values are sums over source documents.
 */
export async function lineQuantities(db: DbOrTx, orderId: string): Promise<Map<string, LineQuantities>> {
  const rows = await db.execute<{
    id: string;
    quantity: string;
    cancelled_qty: string;
    purchased: string;
    received: string;
    damaged: string;
    reserved: string;
    scheduled: string;
    dispatched: string;
    delivered: string;
    invoiced: string;
  }>(sql`
    select ol.id, ol.quantity::text, ol.cancelled_qty::text,
      coalesce((select sum(pl.quantity) from po_lines pl join purchase_orders po on po.id = pl.po_id
                where pl.order_line_id = ol.id and po.status not in ('cancelled', 'rejected')), 0)::numeric(14,3)::text as purchased,
      coalesce((select sum(grl.qty_accepted) from goods_receipt_lines grl join po_lines pl on pl.id = grl.po_line_id
                where pl.order_line_id = ol.id), 0)::numeric(14,3)::text as received,
      coalesce((select sum(grl.qty_damaged) from goods_receipt_lines grl join po_lines pl on pl.id = grl.po_line_id
                where pl.order_line_id = ol.id), 0)::numeric(14,3)::text as damaged,
      coalesce((select sum(r.quantity) from hub_reservations r where r.order_line_id = ol.id), 0)::numeric(14,3)::text as reserved,
      coalesce((select sum(dl.qty_dispatched) from delivery_lines dl join deliveries d on d.id = dl.delivery_id
                where dl.order_line_id = ol.id and d.status = 'scheduled'), 0)::numeric(14,3)::text as scheduled,
      coalesce((select sum(dl.qty_dispatched) from delivery_lines dl join deliveries d on d.id = dl.delivery_id
                where dl.order_line_id = ol.id and d.status not in ('scheduled', 'cancelled')), 0)::numeric(14,3)::text as dispatched,
      coalesce((select sum(dl.qty_delivered) from delivery_lines dl join deliveries d on d.id = dl.delivery_id
                where dl.order_line_id = ol.id and d.status in ('delivered', 'partially_delivered')), 0)::numeric(14,3)::text as delivered,
      coalesce((select sum(il.quantity) from invoice_lines il join invoices i on i.id = il.invoice_id
                where il.order_line_id = ol.id and i.status <> 'discarded'), 0)::numeric(14,3)::text as invoiced
    from order_lines ol where ol.order_id = ${orderId}
  `);
  const map = new Map<string, LineQuantities>();
  for (const r of rows.rows) {
    map.set(r.id, {
      orderLineId: r.id,
      ordered: r.quantity,
      cancelled: r.cancelled_qty,
      needed: subQty(r.quantity, r.cancelled_qty),
      purchased: r.purchased,
      received: r.received,
      damagedOnReceipt: r.damaged,
      reserved: r.reserved,
      scheduled: r.scheduled,
      dispatched: r.dispatched,
      delivered: r.delivered,
      invoiced: r.invoiced,
    });
  }
  return map;
}

export async function addOrderEvent(
  tx: DbOrTx,
  ctx: Ctx | null,
  orderId: string,
  e: {
    from?: OrderStatus | null;
    to?: OrderStatus | null;
    event: string;
    note?: string | null;
    visibleToHotel?: boolean;
  },
) {
  await tx.insert(orderEvents).values({
    orderId,
    fromStatus: e.from ?? null,
    toStatus: e.to ?? null,
    event: e.event,
    note: e.note ?? null,
    visibleToHotel: e.visibleToHotel ?? true,
    actorId: ctx?.actor.id ?? null,
  });
}

export async function setOrderStatus(
  tx: DbOrTx,
  ctx: Ctx,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  event: string,
  note?: string,
) {
  await tx.update(orders).set({ status: to, updatedAt: new Date() }).where(eq(orders.id, orderId));
  await addOrderEvent(tx, ctx, orderId, { from, to, event, note });
  await audit(tx, ctx, {
    action: `order.${event}`,
    entityType: 'order',
    entityId: orderId,
    before: { status: from },
    after: { status: to },
    reason: note,
  });
}

const FULFILLMENT: OrderStatus[] = [
  'procurement',
  'consolidating',
  'ready_for_dispatch',
  'dispatched',
  'partially_delivered',
  'delivered',
];

/**
 * Derive the fulfilment status from reconciled quantities after receipts,
 * dispatches and deliveries. Priority:
 *   delivered > dispatched (a delivery is on the road) > partially_delivered
 *   > ready_for_dispatch (everything outstanding is reserved at the hub)
 *   > consolidating (some goods at the hub) > procurement
 */
export async function refreshOrderStatus(tx: DbOrTx, ctx: Ctx, orderId: string): Promise<OrderStatus> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order) throw new Error('order not found');
  if (!FULFILLMENT.includes(order.status)) return order.status;
  const q = [...(await lineQuantities(tx, orderId)).values()].filter((l) => cmpQty(l.needed, '0') > 0);
  const [onRoad] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(deliveries)
    .where(and(eq(deliveries.orderId, orderId), eq(deliveries.status, 'dispatched')));

  let next: OrderStatus;
  const allDelivered = q.length > 0 && q.every((l) => cmpQty(l.delivered, l.needed) >= 0);
  const anyDelivered = q.some((l) => cmpQty(l.delivered, '0') > 0);
  const allCovered = q.every((l) => cmpQty(addQty(l.delivered, l.reserved), l.needed) >= 0);
  const anyAtHub = q.some((l) => cmpQty(l.reserved, '0') > 0 || cmpQty(l.received, '0') > 0);
  if (allDelivered) next = 'delivered';
  else if ((onRoad?.n ?? 0) > 0) next = 'dispatched';
  else if (anyDelivered) next = 'partially_delivered';
  else if (allCovered && anyAtHub) next = 'ready_for_dispatch';
  else if (anyAtHub) next = 'consolidating';
  else next = 'procurement';

  if (next !== order.status) {
    await tx.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, orderId));
    await addOrderEvent(tx, ctx, orderId, { from: order.status, to: next, event: 'status_auto' });
  }
  return next;
}

export async function orderLinesOf(db: DbOrTx, orderId: string) {
  return db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(orderLines.lineNo);
}
