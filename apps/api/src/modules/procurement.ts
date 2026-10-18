import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  PO_STATUSES,
  PO_TRANSITIONS,
  addMoney,
  addQty,
  canTransition,
  cmpMoney,
  cmpQty,
  lineAmount,
  percentOf,
  subQty,
  type PoStatus,
} from '@hp/shared';
import type { DbOrTx } from '../db/client';
import {
  goodsReceiptLines,
  goodsReceipts,
  hotels,
  hubReservations,
  hubStockMovements,
  orderLines,
  orders,
  poLines,
  products,
  purchaseOrders,
  suppliers,
  taxRates,
  users,
} from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { can, canSeeCosts, type Ctx } from '../lib/context';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { idParam, parse } from '../lib/http';
import { audit } from '../lib/audit';
import { nextDocumentNumber } from '../lib/numbering';
import { getSettings } from '../lib/settings';
import { notifyRoles } from '../lib/notify';
import { registerApprovalHandler, requestApproval } from './approvals';
import { refreshOrderStatus } from './orders-core';

const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Quantity with up to 3 decimals');
const moneyStr = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount with up to 2 decimals');

type PoRow = typeof purchaseOrders.$inferSelect;

export interface NewPoLine {
  productId: string;
  orderLineId?: string | null;
  quotationId?: string | null;
  quantity: string;
  unitCost: string;
  taxRate?: string | null;
}

export async function createPurchaseOrder(
  tx: DbOrTx,
  ctx: Ctx,
  input: {
    supplierId: string;
    fulfillment: 'hub' | 'direct';
    directHotelId?: string | null;
    expectedDate?: string | null;
    notes?: string | null;
    lines: NewPoLine[];
  },
): Promise<PoRow> {
  const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
  if (!supplier || supplier.status !== 'active') throw unprocessable('Supplier is not active');
  if (input.fulfillment === 'direct' && !input.directHotelId)
    throw badRequest('Direct delivery needs a hotel');
  const prods = await tx
    .select({ id: products.id, taxCode: products.taxCode })
    .from(products)
    .where(
      inArray(
        products.id,
        input.lines.map((l) => l.productId),
      ),
    );
  const taxes = new Map((await tx.select().from(taxRates)).map((t) => [t.code, t.ratePercent]));
  const prodTax = new Map(prods.map((p) => [p.id, taxes.get(p.taxCode) ?? '0.000']));
  let subtotal = '0.00';
  let tax = '0.00';
  const lines = input.lines.map((l, i) => {
    if (!prodTax.has(l.productId)) throw badRequest('Unknown product on purchase order');
    if (cmpQty(l.quantity, '0') <= 0) throw badRequest('Quantities must be positive');
    const taxRate = l.taxRate ?? prodTax.get(l.productId)!;
    const amt = lineAmount(l.quantity, l.unitCost);
    subtotal = addMoney(subtotal, amt);
    tax = addMoney(tax, percentOf(amt, taxRate));
    return {
      lineNo: i + 1,
      productId: l.productId,
      orderLineId: l.orderLineId ?? null,
      quotationId: l.quotationId ?? null,
      quantity: l.quantity,
      unitCost: l.unitCost,
      taxRate,
      lineSubtotal: amt,
    };
  });
  const poNumber = await nextDocumentNumber(tx, 'purchase_order');
  const [po] = await tx
    .insert(purchaseOrders)
    .values({
      poNumber,
      supplierId: input.supplierId,
      fulfillment: input.fulfillment,
      directHotelId: input.fulfillment === 'direct' ? input.directHotelId! : null,
      expectedDate: input.expectedDate ?? null,
      notes: input.notes ?? null,
      subtotal,
      taxTotal: tax,
      total: addMoney(subtotal, tax),
      createdBy: ctx.actor.id,
    })
    .returning();
  await tx.insert(poLines).values(lines.map((l) => ({ ...l, poId: po!.id })));
  await audit(tx, ctx, {
    action: 'purchase_order.created',
    entityType: 'purchase_order',
    entityId: po!.id,
    after: { poNumber, supplierId: input.supplierId, total: po!.total, lines: lines.length },
  });
  return po!;
}

async function setPoStatus(
  tx: DbOrTx,
  ctx: Ctx,
  po: PoRow,
  to: PoStatus,
  extra: Partial<PoRow> = {},
  reason?: string,
) {
  if (!canTransition(PO_TRANSITIONS, po.status, to))
    throw conflict(`A purchase order that is ${po.status} cannot become ${to}`);
  const [u] = await tx
    .update(purchaseOrders)
    .set({ ...extra, status: to, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, po.id))
    .returning();
  await audit(tx, ctx, {
    action: `purchase_order.${to}`,
    entityType: 'purchase_order',
    entityId: po.id,
    reason,
    before: { status: po.status },
    after: { status: to, ...extra },
  });
  return u!;
}

async function loadPo(tx: DbOrTx, id: string, lock = true) {
  const q = tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  const [po] = lock ? await q.for('update') : await q;
  if (!po) throw notFound('Purchase order');
  return po;
}

/** Accepted quantity per PO line. */
async function receivedByLine(tx: DbOrTx, poId: string) {
  const rows = await tx
    .select({
      poLineId: poLines.id,
      ordered: poLines.quantity,
      accepted: sql<string>`coalesce(sum(${goodsReceiptLines.qtyAccepted}), 0)::numeric(14,3)::text`,
      damaged: sql<string>`coalesce(sum(${goodsReceiptLines.qtyDamaged}), 0)::numeric(14,3)::text`,
    })
    .from(poLines)
    .leftJoin(goodsReceiptLines, eq(goodsReceiptLines.poLineId, poLines.id))
    .where(eq(poLines.poId, poId))
    .groupBy(poLines.id);
  return new Map(rows.map((r) => [r.poLineId, r]));
}

export async function procurementRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/purchase-orders', { preHandler: guard('procurement.manage', 'hub.receive') }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({
        status: z.enum(PO_STATUSES).optional(),
        statuses: z.string().optional(),
        supplierId: z.uuid().optional(),
      }),
      req.query,
    );
    const conds = [];
    if (q.status) conds.push(eq(purchaseOrders.status, q.status));
    if (q.statuses) conds.push(inArray(purchaseOrders.status, q.statuses.split(',') as PoStatus[]));
    if (q.supplierId) conds.push(eq(purchaseOrders.supplierId, q.supplierId));
    // Hub staff only see POs they need to receive, without money.
    if (!canSeeCosts(ctx))
      conds.push(inArray(purchaseOrders.status, ['sent', 'confirmed', 'partially_received']));
    const rows = await db
      .select({ po: purchaseOrders, supplierName: suppliers.name, hotelName: hotels.legalName })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .leftJoin(hotels, eq(hotels.id, purchaseOrders.directHotelId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(200);
    return {
      items: rows.map((r) => {
        const base = { ...r.po, supplierName: r.supplierName, hotelName: r.hotelName };
        if (canSeeCosts(ctx)) return base;
        const { subtotal: _s, taxTotal: _t, total: _tt, ...rest } = base;
        return rest;
      }),
    };
  });

  app.get('/purchase-orders/:id', { preHandler: guard('procurement.manage', 'hub.receive') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const po = await loadPo(db, id, false);
    const showCost = canSeeCosts(ctx);
    if (!showCost && !['sent', 'confirmed', 'partially_received', 'received'].includes(po.status))
      throw notFound('Purchase order');
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
    const lines = await db
      .select({
        line: poLines,
        sku: products.sku,
        nameEn: products.nameEn,
        nameNe: products.nameNe,
        unit: products.sellingUnit,
        orderId: orderLines.orderId,
        orderNumber: orders.orderNumber,
        hotelName: hotels.legalName,
      })
      .from(poLines)
      .innerJoin(products, eq(products.id, poLines.productId))
      .leftJoin(orderLines, eq(orderLines.id, poLines.orderLineId))
      .leftJoin(orders, eq(orders.id, orderLines.orderId))
      .leftJoin(hotels, eq(hotels.id, orders.hotelId))
      .where(eq(poLines.poId, id))
      .orderBy(asc(poLines.lineNo));
    const received = await receivedByLine(db, id);
    const receipts = await db
      .select({ r: goodsReceipts, receivedByName: users.name })
      .from(goodsReceipts)
      .leftJoin(users, eq(users.id, goodsReceipts.receivedBy))
      .where(eq(goodsReceipts.poId, id))
      .orderBy(desc(goodsReceipts.receivedAt));
    const outLines = lines.map((r) => {
      const rec = received.get(r.line.id)!;
      const base = {
        ...r.line,
        sku: r.sku,
        nameEn: r.nameEn,
        nameNe: r.nameNe,
        unit: r.unit,
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        hotelName: r.hotelName,
        accepted: rec.accepted,
        damaged: rec.damaged,
        remaining: subQty(r.line.quantity, rec.accepted),
      };
      if (showCost) return base;
      const { unitCost: _u, lineSubtotal: _l, taxRate: _t, ...rest } = base;
      return rest;
    });
    const header = showCost ? po : (({ subtotal: _s, taxTotal: _t, total: _tt, ...rest }) => rest)(po);
    return {
      purchaseOrder: header,
      supplier: showCost ? supplier : { id: supplier!.id, name: supplier!.name, phone: supplier!.phone },
      lines: outLines,
      receipts: receipts.map((r) => ({ ...r.r, receivedByName: r.receivedByName })),
    };
  });

  /** Manual PO (e.g. stock purchase for the hub or for an unlisted product). */
  app.post('/purchase-orders', { preHandler: guard('procurement.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        supplierId: z.uuid(),
        fulfillment: z.enum(['hub', 'direct']).default('hub'),
        directHotelId: z.uuid().nullable().optional(),
        expectedDate: z.iso.date().nullable().optional(),
        notes: z.string().nullable().optional(),
        lines: z
          .array(
            z.object({
              productId: z.uuid(),
              orderLineId: z.uuid().nullable().optional(),
              quantity: qtyStr,
              unitCost: moneyStr,
            }),
          )
          .min(1),
      }),
      req.body,
    );
    const po = await db.transaction((tx) => createPurchaseOrder(tx, ctx, body));
    return { purchaseOrder: po };
  });

  /** Submit for approval. Below the configured threshold it is approved automatically. */
  app.post('/purchase-orders/:id/submit', { preHandler: guard('procurement.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    return db.transaction(async (tx) => {
      const po = await loadPo(tx, id);
      if (po.status !== 'draft') throw conflict(`Purchase order is ${po.status}`);
      const settings = await getSettings(tx);
      const threshold = settings.poApprovalThreshold;
      const needsApproval = cmpMoney(threshold, '0') === 0 || cmpMoney(po.total, threshold) >= 0;
      if (needsApproval && !can(ctx, 'approvals.decide')) {
        const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
        const approval = await requestApproval(tx, ctx, {
          type: 'purchase_order',
          targetType: 'purchase_order',
          targetId: po.id,
          amount: po.total,
          summary: `Purchase order ${po.poNumber} to ${supplier!.name} for NPR ${po.total}`,
          details: { poNumber: po.poNumber, supplierId: po.supplierId, total: po.total },
        });
        const updated = await setPoStatus(tx, ctx, po, 'pending_approval', {
          submittedAt: new Date(),
          approvalId: approval.id,
        });
        return { purchaseOrder: updated, approval };
      }
      const updated = await setPoStatus(
        tx,
        ctx,
        po,
        'approved',
        { submittedAt: new Date(), approvedBy: ctx.actor.id, approvedAt: new Date() },
        needsApproval ? 'Approved by owner' : `Below approval threshold ${threshold}`,
      );
      return { purchaseOrder: updated };
    });
  });

  /** Staff have sent the approved PO to the supplier (phone, email, in person). */
  app.post('/purchase-orders/:id/send', { preHandler: guard('procurement.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const po = await db.transaction(async (tx) => {
      const p = await loadPo(tx, id);
      if (p.status !== 'approved' || !p.approvedAt)
        throw unprocessable('Only approved purchase orders can be sent to the supplier');
      return setPoStatus(tx, ctx, p, 'sent', { sentAt: new Date() });
    });
    return { purchaseOrder: po };
  });

  app.post('/purchase-orders/:id/confirm', { preHandler: guard('procurement.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        supplierReference: z.string().max(100).nullable().optional(),
        expectedDate: z.iso.date().nullable().optional(),
      }),
      req.body,
    );
    const po = await db.transaction(async (tx) => {
      const p = await loadPo(tx, id);
      return setPoStatus(tx, ctx, p, 'confirmed', {
        confirmedAt: new Date(),
        supplierReference: body.supplierReference ?? null,
        expectedDate: body.expectedDate ?? p.expectedDate,
      });
    });
    return { purchaseOrder: po };
  });

  app.post('/purchase-orders/:id/cancel', { preHandler: guard('procurement.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    const po = await db.transaction(async (tx) => {
      const p = await loadPo(tx, id);
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(goodsReceipts)
        .where(eq(goodsReceipts.poId, id));
      if ((r?.n ?? 0) > 0)
        throw unprocessable('Goods have been received on this purchase order; close it instead');
      return setPoStatus(tx, ctx, p, 'cancelled', { cancelledReason: reason }, reason);
    });
    return { purchaseOrder: po };
  });

  /** Close a partially received PO short (supplier cannot deliver the rest). */
  app.post('/purchase-orders/:id/close', { preHandler: guard('procurement.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    const po = await db.transaction(async (tx) =>
      setPoStatus(tx, ctx, await loadPo(tx, id), 'closed', {}, reason),
    );
    return { purchaseOrder: po };
  });

  /* ------------------------------ receiving ------------------------------ */

  app.post('/purchase-orders/:id/receipts', { preHandler: guard('hub.receive') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        lines: z
          .array(
            z.object({
              poLineId: z.uuid(),
              qtyAccepted: qtyStr,
              qtyDamaged: qtyStr.default('0'),
              notes: z.string().max(500).nullable().optional(),
            }),
          )
          .min(1),
        supplierDeliveryNote: z.string().max(100).nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        recipientName: z.string().max(120).optional(),
        idempotencyKey: z.string().min(8).max(100).optional(),
      }),
      req.body,
    );
    if (body.idempotencyKey) {
      const [dup] = await db
        .select()
        .from(goodsReceipts)
        .where(eq(goodsReceipts.idempotencyKey, body.idempotencyKey));
      if (dup) return { receipt: dup, duplicate: true };
    }
    const receipt = await db.transaction(async (tx) => {
      const po = await loadPo(tx, id);
      if (!['sent', 'confirmed', 'partially_received'].includes(po.status)) {
        throw unprocessable(
          `Goods can only be received against a sent or confirmed purchase order (this one is ${po.status})`,
        );
      }
      const lines = await tx.select().from(poLines).where(eq(poLines.poId, id));
      const byId = new Map(lines.map((l) => [l.id, l]));
      const received = await receivedByLine(tx, id);
      const seen = new Set<string>();
      for (const l of body.lines) {
        const pl = byId.get(l.poLineId);
        if (!pl) throw badRequest('Line does not belong to this purchase order');
        if (seen.has(l.poLineId)) throw badRequest('Each line may appear once per receipt');
        seen.add(l.poLineId);
        if (cmpQty(addQty(l.qtyAccepted, l.qtyDamaged), '0') <= 0)
          throw badRequest('Enter a received or damaged quantity');
        const remaining = subQty(pl.quantity, received.get(pl.id)!.accepted);
        if (cmpQty(l.qtyAccepted, remaining) > 0) {
          throw unprocessable(
            `Accepted quantity exceeds what is outstanding on line ${pl.lineNo} (${remaining})`,
            { poLineId: pl.id, remaining },
          );
        }
      }
      const direct = po.fulfillment === 'direct';
      if (direct && !body.recipientName)
        throw badRequest('Recipient name at the hotel is required for direct deliveries');
      const receiptNumber = await nextDocumentNumber(tx, 'goods_receipt');
      const [gr] = await tx
        .insert(goodsReceipts)
        .values({
          receiptNumber,
          poId: id,
          location: direct ? 'hotel' : 'hub',
          receivedBy: ctx.actor.id,
          supplierDeliveryNote: body.supplierDeliveryNote ?? null,
          notes: body.notes ?? null,
          idempotencyKey: body.idempotencyKey ?? null,
        })
        .returning();
      const affectedOrders = new Set<string>();
      const directLines: { orderLineId: string; productId: string; accepted: string; damaged: string }[] = [];
      for (const l of body.lines) {
        const pl = byId.get(l.poLineId)!;
        const [grl] = await tx
          .insert(goodsReceiptLines)
          .values({
            receiptId: gr!.id,
            poLineId: pl.id,
            productId: pl.productId,
            qtyAccepted: l.qtyAccepted,
            qtyDamaged: l.qtyDamaged,
            notes: l.notes ?? null,
          })
          .returning();
        if (direct) {
          if (pl.orderLineId)
            directLines.push({
              orderLineId: pl.orderLineId,
              productId: pl.productId,
              accepted: l.qtyAccepted,
              damaged: l.qtyDamaged,
            });
        } else if (cmpQty(l.qtyAccepted, '0') > 0) {
          // Only accepted goods become hub stock. Damaged goods stay on the receipt record.
          await tx.insert(hubStockMovements).values({
            productId: pl.productId,
            movementType: 'receipt',
            quantity: l.qtyAccepted,
            receiptLineId: grl!.id,
            orderLineId: pl.orderLineId,
            reason: `${receiptNumber} from ${po.poNumber}`,
            actorId: ctx.actor.id,
          });
          if (pl.orderLineId) {
            await tx
              .insert(hubReservations)
              .values({
                productId: pl.productId,
                orderLineId: pl.orderLineId,
                quantity: l.qtyAccepted,
                reason: 'receipt',
                actorId: ctx.actor.id,
              });
          }
        }
        if (pl.orderLineId) {
          const [ol] = await tx
            .select({ orderId: orderLines.orderId })
            .from(orderLines)
            .where(eq(orderLines.id, pl.orderLineId));
          affectedOrders.add(ol!.orderId);
        }
      }
      // PO status from reconciled quantities
      const after = await receivedByLine(tx, id);
      const complete = lines.every((pl) => cmpQty(after.get(pl.id)!.accepted, pl.quantity) >= 0);
      const next: PoStatus = complete ? 'received' : 'partially_received';
      if (next !== po.status) await setPoStatus(tx, ctx, po, next);
      await audit(tx, ctx, {
        action: 'goods_receipt.recorded',
        entityType: 'goods_receipt',
        entityId: gr!.id,
        after: { receiptNumber, poNumber: po.poNumber, location: gr!.location, lines: body.lines },
      });

      if (direct && directLines.length) {
        const { recordDirectDelivery } = await import('./delivery');
        const byOrder = new Map<string, typeof directLines>();
        for (const dl of directLines) {
          const [ol] = await tx
            .select({ orderId: orderLines.orderId })
            .from(orderLines)
            .where(eq(orderLines.id, dl.orderLineId));
          byOrder.set(ol!.orderId, [...(byOrder.get(ol!.orderId) ?? []), dl]);
        }
        for (const [orderId, dls] of byOrder) {
          await recordDirectDelivery(tx, ctx, {
            orderId,
            poId: po.id,
            recipientName: body.recipientName!,
            lines: dls,
          });
        }
      }
      for (const orderId of affectedOrders) await refreshOrderStatus(tx, ctx, orderId);
      if (!direct) {
        await notifyRoles(tx, ['procurement'], {
          kind: 'goods_received',
          title: `Goods received on ${po.poNumber}`,
          link: `/purchase-orders/${po.id}`,
        });
      }
      return gr!;
    });
    return { receipt };
  });
}

/* ------------------------------ approval hooks ------------------------------ */

registerApprovalHandler('purchase_order', {
  async onApprove(tx, ctx, req) {
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, req.targetId))
      .for('update');
    if (!po || po.status !== 'pending_approval') return;
    await setPoStatus(
      tx,
      ctx,
      po,
      'approved',
      { approvedBy: ctx.actor.id, approvedAt: new Date() },
      req.decisionNote ?? undefined,
    );
  },
  async onReject(tx, ctx, req) {
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, req.targetId))
      .for('update');
    if (!po || po.status !== 'pending_approval') return;
    await setPoStatus(
      tx,
      ctx,
      po,
      req.status === 'cancelled' ? 'cancelled' : 'rejected',
      {},
      req.decisionNote ?? undefined,
    );
  },
});
