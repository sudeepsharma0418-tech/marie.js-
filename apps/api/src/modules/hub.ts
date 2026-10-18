import type { FastifyInstance } from 'fastify';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { cmpMoney, cmpQty, lineAmount, subQty } from '@hp/shared';
import type { DbOrTx } from '../db/client';
import { hotels, hubStockMovements, orderLines, orders, products, users } from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { can, canSeeCosts, type Ctx } from '../lib/context';
import { badRequest, notFound, unprocessable } from '../lib/errors';
import { parse } from '../lib/http';
import { qbool } from '../lib/http';
import { audit } from '../lib/audit';
import { getSettings } from '../lib/settings';
import { registerApprovalHandler, requestApproval } from './approvals';
import { lineQuantities } from './orders-core';

const signedQty = z.string().regex(/^-?\d+(\.\d{1,3})?$/, 'Quantity with up to 3 decimals');

export interface HubStockRow {
  productId: string;
  onHand: string;
  reserved: string;
  available: string;
  incoming: string;
}

/**
 * Hub stock figures, all derived from ledgers:
 *   onHand    = SUM(hub_stock_movements)        physically at the hub
 *   reserved  = SUM(hub_reservations)           held for specific customer order lines
 *   available = onHand - reserved
 *   incoming  = ordered from suppliers on committed hub POs, not yet accepted (unverified)
 */
export async function hubStock(db: DbOrTx, productIds?: string[]): Promise<Map<string, HubStockRow>> {
  const filter = productIds?.length
    ? sql`where p.id in (${sql.join(
        productIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const rows = await db.execute<{
    product_id: string;
    on_hand: string;
    reserved: string;
    incoming: string;
  }>(sql`
    select p.id as product_id,
      coalesce((select sum(m.quantity) from hub_stock_movements m where m.product_id = p.id), 0)::numeric(14,3)::text as on_hand,
      coalesce((select sum(r.quantity) from hub_reservations r where r.product_id = p.id), 0)::numeric(14,3)::text as reserved,
      coalesce((select sum(pl.quantity - coalesce((select sum(g.qty_accepted) from goods_receipt_lines g where g.po_line_id = pl.id), 0))
                from po_lines pl join purchase_orders po on po.id = pl.po_id
                where pl.product_id = p.id and po.fulfillment = 'hub' and po.status in ('sent', 'confirmed', 'partially_received')), 0)::numeric(14,3)::text as incoming
    from products p ${filter}
  `);
  const out = new Map<string, HubStockRow>();
  for (const r of rows.rows) {
    out.set(r.product_id, {
      productId: r.product_id,
      onHand: r.on_hand,
      reserved: r.reserved,
      available: subQty(r.on_hand, r.reserved),
      incoming: r.incoming,
    });
  }
  return out;
}

async function postAdjustment(
  tx: DbOrTx,
  ctx: Ctx,
  input: {
    productId: string;
    quantity: string;
    movementType: 'adjustment' | 'write_off' | 'return_to_supplier';
    reason: string;
    approvalId?: string;
  },
) {
  if (cmpQty(input.quantity, '0') < 0) {
    // lock product row to serialise concurrent decreases
    await tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).for('update');
    const stock = (await hubStock(tx, [input.productId])).get(input.productId)!;
    if (cmpQty(subQty(stock.available, input.quantity.slice(1)), '0') < 0) {
      throw unprocessable(`Only ${stock.available} available (reserved stock must be released first)`);
    }
  }
  const [m] = await tx
    .insert(hubStockMovements)
    .values({
      productId: input.productId,
      movementType: input.movementType,
      quantity: input.quantity,
      reason: input.reason,
      approvalId: input.approvalId ?? null,
      actorId: ctx.actor.id,
    })
    .returning();
  await audit(tx, ctx, {
    action: `hub_stock.${input.movementType}`,
    entityType: 'hub_stock_movement',
    entityId: m!.id,
    reason: input.reason,
    after: m,
  });
  return m!;
}

export async function hubRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/hub/stock', { preHandler: guard('hub.stock.view') }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(z.object({ q: z.string().optional(), onlyNonZero: qbool(true) }), req.query);
    const prods = await db
      .select({
        id: products.id,
        sku: products.sku,
        nameEn: products.nameEn,
        nameNe: products.nameNe,
        unit: products.sellingUnit,
        referenceCost: products.referenceCost,
      })
      .from(products)
      .orderBy(asc(products.nameEn));
    const stock = await hubStock(db);
    const items = prods
      .map((p) => {
        const s = stock.get(p.id)!;
        const row = {
          ...p,
          ...s,
          stockValue: canSeeCosts(ctx) ? lineAmount(s.onHand, p.referenceCost) : undefined,
        };
        if (!canSeeCosts(ctx)) delete (row as { referenceCost?: string }).referenceCost;
        return row;
      })
      .filter(
        (r) =>
          !q.onlyNonZero ||
          cmpQty(r.onHand, '0') !== 0 ||
          cmpQty(r.incoming, '0') !== 0 ||
          cmpQty(r.reserved, '0') !== 0,
      )
      .filter((r) => !q.q || `${r.sku} ${r.nameEn} ${r.nameNe}`.toLowerCase().includes(q.q.toLowerCase()));
    return { items };
  });

  app.get('/hub/movements', { preHandler: guard('hub.stock.view') }, async (req) => {
    const q = parse(
      z.object({
        productId: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const rows = await db
      .select({ m: hubStockMovements, sku: products.sku, nameEn: products.nameEn, actorName: users.name })
      .from(hubStockMovements)
      .innerJoin(products, eq(products.id, hubStockMovements.productId))
      .leftJoin(users, eq(users.id, hubStockMovements.actorId))
      .where(q.productId ? eq(hubStockMovements.productId, q.productId) : undefined)
      .orderBy(desc(hubStockMovements.id))
      .limit(q.limit);
    return { items: rows.map((r) => ({ ...r.m, sku: r.sku, nameEn: r.nameEn, actorName: r.actorName })) };
  });

  /**
   * Stock corrections. Decreases worth at least the write-off threshold need owner
   * approval (threshold 0 = every decrease); the owner's own corrections apply directly.
   */
  app.post('/hub/adjustments', { preHandler: guard('hub.stock.adjust') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        productId: z.uuid(),
        quantity: signedQty,
        movementType: z.enum(['adjustment', 'write_off', 'return_to_supplier']).default('adjustment'),
        reason: z.string().min(3).max(500),
      }),
      req.body,
    );
    if (cmpQty(body.quantity, '0') === 0) throw badRequest('Quantity cannot be zero');
    if (body.movementType !== 'adjustment' && cmpQty(body.quantity, '0') > 0)
      throw badRequest('Write-offs and supplier returns reduce stock (use a negative quantity)');
    const [product] = await db.select().from(products).where(eq(products.id, body.productId));
    if (!product) throw notFound('Product');
    return db.transaction(async (tx) => {
      if (cmpQty(body.quantity, '0') < 0 && !can(ctx, 'approvals.decide')) {
        const settings = await getSettings(tx);
        const value = lineAmount(body.quantity.slice(1), product.referenceCost);
        const threshold = settings.writeOffApprovalThreshold;
        if (cmpMoney(threshold, '0') === 0 || cmpMoney(value, threshold) >= 0) {
          const approval = await requestApproval(tx, ctx, {
            type: 'stock_write_off',
            targetType: 'product',
            targetId: product.id,
            amount: value,
            summary: `Reduce hub stock of ${product.nameEn} by ${body.quantity.slice(1)} ${product.sellingUnit} (${body.movementType}): ${body.reason}`,
            details: body,
          });
          return { applied: false, approval };
        }
      }
      const movement = await postAdjustment(tx, ctx, body);
      return { applied: true, movement };
    });
  });

  /** Orders being consolidated at the hub, with per-line progress. No prices. */
  app.get('/hub/consolidation', { preHandler: guard('hub.stock.view') }, async () => {
    const open = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        hotelName: hotels.legalName,
        requestedDeliveryDate: orders.requestedDeliveryDate,
      })
      .from(orders)
      .innerJoin(hotels, eq(hotels.id, orders.hotelId))
      .where(
        inArray(orders.status, ['procurement', 'consolidating', 'ready_for_dispatch', 'partially_delivered']),
      )
      .orderBy(asc(orders.requestedDeliveryDate), asc(orders.createdAt));
    const items = [];
    for (const o of open) {
      const lines = await db
        .select({
          id: orderLines.id,
          nameEn: orderLines.nameEn,
          nameNe: orderLines.nameNe,
          unit: orderLines.unit,
        })
        .from(orderLines)
        .where(eq(orderLines.orderId, o.id));
      const q = await lineQuantities(db, o.id);
      items.push({ ...o, lines: lines.map((l) => ({ ...l, ...q.get(l.id)! })) });
    }
    return { items };
  });
}

registerApprovalHandler('stock_write_off', {
  async onApprove(tx, ctx, req) {
    const d = req.details as {
      productId: string;
      quantity: string;
      movementType: 'adjustment' | 'write_off' | 'return_to_supplier';
      reason: string;
    };
    await postAdjustment(tx, { ...ctx }, { ...d, approvalId: req.id });
  },
  async onReject() {},
});
