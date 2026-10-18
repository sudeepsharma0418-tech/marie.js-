import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { cmpQty, subQty } from '@hp/shared';
import type { DbOrTx } from '../db/client';
import {
  hotelInventoryEvents,
  hotelLocations,
  hotelStockMovements,
  products,
  shelfProducts,
  users,
  hotels,
  deliveries,
} from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { assertHotelAccess, can, hotelFilter, type Ctx } from '../lib/context';
import { badRequest, notFound } from '../lib/errors';
import { idParam, parse } from '../lib/http';
import { qbool } from '../lib/http';
import { audit } from '../lib/audit';
import { canonical } from '../lib/audit';
import { randomToken, sha256 } from '../lib/crypto';
import { getSettings } from '../lib/settings';

const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Quantity with up to 3 decimals');
/** Lock key namespace for per-shelf-product serialisation. */
const LOCK_NS = 72_310_002;

export const inventoryEventSchema = z.object({
  /** Client-generated UUID. Re-sending the same id never applies the event twice. */
  id: z.uuid(),
  locationId: z.uuid(),
  productId: z.uuid(),
  action: z.enum(['usage', 'restock', 'correction', 'transfer']),
  quantity: qtyStr.optional(),
  countedQty: qtyStr.optional(),
  baseQty: z
    .string()
    .regex(/^-?\d+(\.\d{1,3})?$/)
    .optional(),
  toLocationId: z.uuid().optional(),
  deliveryId: z.uuid().optional(),
  reason: z.string().max(500).optional(),
  deviceId: z.string().max(100).optional(),
  clientRecordedAt: z.iso.datetime({ offset: true }),
  offline: z.boolean().default(false),
});
export type InventoryEventInput = z.infer<typeof inventoryEventSchema>;

export interface EventResult {
  id: string;
  status: 'applied' | 'needs_review' | 'rejected' | 'duplicate';
  flags: string[];
  message?: string;
  balance?: string;
  toBalance?: string;
}

export async function shelfBalance(db: DbOrTx, locationId: string, productId: string): Promise<string> {
  const [r] = await db
    .select({ q: sql<string>`coalesce(sum(${hotelStockMovements.quantity}), 0)::numeric(14,3)::text` })
    .from(hotelStockMovements)
    .where(and(eq(hotelStockMovements.locationId, locationId), eq(hotelStockMovements.productId, productId)));
  return r?.q ?? '0.000';
}

async function balancesFor(db: DbOrTx, hotelId: string) {
  const rows = await db
    .select({
      locationId: hotelStockMovements.locationId,
      productId: hotelStockMovements.productId,
      qty: sql<string>`sum(${hotelStockMovements.quantity})::numeric(14,3)::text`,
      lastAt: sql<Date>`max(${hotelStockMovements.occurredAt})`,
    })
    .from(hotelStockMovements)
    .where(eq(hotelStockMovements.hotelId, hotelId))
    .groupBy(hotelStockMovements.locationId, hotelStockMovements.productId);
  return new Map(rows.map((r) => [`${r.locationId}:${r.productId}`, r]));
}

function payloadHash(e: InventoryEventInput): string {
  const { offline: _o, ...rest } = e;
  return sha256(canonical(rest));
}

/**
 * Process one inventory event idempotently. Rules (docs/BUSINESS_RULES.md §Hotel inventory):
 *  - the event id is the idempotency key; a retry returns the original outcome
 *  - usage/restock are deltas and are applied even if the device's view was stale,
 *    because they describe something that physically happened; a resulting negative
 *    balance is applied but flagged for review
 *  - a correction sets an absolute count; if the device's base quantity differs from
 *    the server balance (someone else changed it meanwhile) it is NOT applied but
 *    held as needs_review so no history is silently overwritten
 *  - possible double taps (same user, shelf, product, action and qty within 10 s) are flagged
 */
export async function processInventoryEvent(
  tx: DbOrTx,
  ctx: Ctx,
  e: InventoryEventInput,
): Promise<EventResult> {
  const hash = payloadHash(e);
  const [existing] = await tx.select().from(hotelInventoryEvents).where(eq(hotelInventoryEvents.id, e.id));
  if (existing) {
    if (existing.actorId !== ctx.actor.id && existing.hotelId !== ctx.actor.hotelId)
      return { id: e.id, status: 'rejected', flags: [], message: 'Event id already used' };
    if (existing.payloadHash !== hash)
      return {
        id: e.id,
        status: 'rejected',
        flags: ['id_reuse'],
        message: 'Event id was already used for a different action',
      };
    return {
      id: e.id,
      status: 'duplicate',
      flags: existing.flags,
      balance: await shelfBalance(tx, existing.locationId, existing.productId),
    };
  }

  const [loc] = await tx.select().from(hotelLocations).where(eq(hotelLocations.id, e.locationId));
  if (!loc || (ctx.actor.hotelId && loc.hotelId !== ctx.actor.hotelId))
    return { id: e.id, status: 'rejected', flags: [], message: 'Unknown shelf' };
  const hotelId = loc.hotelId;
  const reject = (message: string) => ({ id: e.id, status: 'rejected' as const, flags: [], message });

  if (loc.kind !== 'shelf' || !loc.isActive) return reject('Location is not an active shelf');
  const [assigned] = await tx
    .select()
    .from(shelfProducts)
    .where(and(eq(shelfProducts.locationId, loc.id), eq(shelfProducts.productId, e.productId)));
  if (!assigned) return reject('Product is not assigned to this shelf');

  if (e.action === 'correction') {
    if (!can(ctx, 'hotel_inventory.correct')) return reject('You are not allowed to correct quantities');
    if (e.countedQty === undefined) return reject('Counted quantity is required');
    if (!e.reason || e.reason.trim().length < 3) return reject('A reason is required for corrections');
  } else {
    if (!can(ctx, 'hotel_inventory.record')) return reject('You are not allowed to record inventory');
    if (!e.quantity || cmpQty(e.quantity, '0') <= 0) return reject('Quantity must be greater than zero');
  }
  let toLoc: typeof loc | undefined;
  if (e.action === 'transfer') {
    if (!e.toLocationId || e.toLocationId === e.locationId)
      return reject('Choose a different destination shelf');
    [toLoc] = await tx.select().from(hotelLocations).where(eq(hotelLocations.id, e.toLocationId));
    if (!toLoc || toLoc.hotelId !== hotelId || toLoc.kind !== 'shelf' || !toLoc.isActive)
      return reject('Unknown destination shelf');
  }
  if (e.deliveryId) {
    const [d] = await tx
      .select({ hotelId: deliveries.hotelId })
      .from(deliveries)
      .where(eq(deliveries.id, e.deliveryId));
    if (!d || d.hotelId !== hotelId) return reject('Unknown delivery');
  }

  // Serialise concurrent events on the same shelf/product (and destination).
  const lockKeys = [
    `${e.locationId}:${e.productId}`,
    ...(toLoc ? [`${toLoc.id}:${e.productId}`] : []),
  ].sort();
  for (const k of lockKeys) await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NS}, hashtext(${k}))`);

  const current = await shelfBalance(tx, e.locationId, e.productId);
  const flags: string[] = [];
  let status: 'applied' | 'needs_review' = 'applied';
  let delta: string | null = null;

  if (e.action === 'correction') {
    const stale = e.baseQty !== undefined && cmpQty(e.baseQty, current) !== 0;
    if (stale) {
      flags.push('stale_base');
      status = 'needs_review';
    } else {
      delta = subQty(e.countedQty!, current);
    }
  } else {
    delta = e.action === 'restock' ? e.quantity! : `-${e.quantity!}`;
    if (e.baseQty !== undefined && cmpQty(e.baseQty, current) !== 0) flags.push('stale_base');
    if (cmpQty(subQty(current, e.action === 'restock' ? '0' : e.quantity!), '0') < 0)
      flags.push('negative_balance');
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(hotelInventoryEvents)
      .where(
        and(
          eq(hotelInventoryEvents.actorId, ctx.actor.id),
          eq(hotelInventoryEvents.locationId, e.locationId),
          eq(hotelInventoryEvents.productId, e.productId),
          eq(hotelInventoryEvents.action, e.action),
          eq(hotelInventoryEvents.quantity, e.quantity!),
          sql`abs(extract(epoch from (${hotelInventoryEvents.clientRecordedAt} - ${e.clientRecordedAt}::timestamptz))) < 10`,
        ),
      );
    if ((recent?.n ?? 0) > 0) flags.push('possible_duplicate');
  }
  if (e.offline) flags.push('offline');

  await tx.insert(hotelInventoryEvents).values({
    id: e.id,
    hotelId,
    locationId: e.locationId,
    productId: e.productId,
    action: e.action,
    quantity: e.quantity ?? null,
    countedQty: e.countedQty ?? null,
    baseQty: e.baseQty ?? null,
    toLocationId: e.toLocationId ?? null,
    deliveryId: e.deliveryId ?? null,
    reason: e.reason ?? null,
    actorId: ctx.actor.id,
    deviceId: e.deviceId ?? null,
    source: e.offline ? 'offline_sync' : 'online',
    clientRecordedAt: new Date(e.clientRecordedAt),
    payloadHash: hash,
    status,
    flags,
  });

  const occurredAt = new Date(e.clientRecordedAt);
  if (delta !== null && cmpQty(delta, '0') !== 0) {
    if (e.action === 'transfer') {
      await tx.insert(hotelStockMovements).values([
        {
          hotelId,
          locationId: e.locationId,
          productId: e.productId,
          movementType: 'transfer_out',
          quantity: delta,
          eventId: e.id,
          actorId: ctx.actor.id,
          occurredAt,
        },
        {
          hotelId,
          locationId: toLoc!.id,
          productId: e.productId,
          movementType: 'transfer_in',
          quantity: e.quantity!,
          eventId: e.id,
          actorId: ctx.actor.id,
          occurredAt,
        },
      ]);
    } else {
      await tx.insert(hotelStockMovements).values({
        hotelId,
        locationId: e.locationId,
        productId: e.productId,
        movementType: e.action === 'usage' ? 'usage' : e.action === 'restock' ? 'restock' : 'correction',
        quantity: delta,
        eventId: e.id,
        actorId: ctx.actor.id,
        occurredAt,
      });
    }
  }
  if (e.action === 'correction' || flags.includes('negative_balance')) {
    await audit(tx, ctx, {
      action:
        e.action === 'correction'
          ? status === 'applied'
            ? 'hotel_inventory.corrected'
            : 'hotel_inventory.correction_held'
          : 'hotel_inventory.negative_balance',
      entityType: 'hotel_inventory_event',
      entityId: e.id,
      hotelId,
      reason: e.reason,
      before: { balance: current },
      after: { countedQty: e.countedQty, quantity: e.quantity, delta, flags },
    });
  }
  return {
    id: e.id,
    status,
    flags,
    balance: await shelfBalance(tx, e.locationId, e.productId),
    toBalance: toLoc ? await shelfBalance(tx, toLoc.id, e.productId) : undefined,
    message:
      status === 'needs_review'
        ? 'The shelf count changed since your device last synced. A manager will review this correction.'
        : undefined,
  };
}

export async function hotelInventoryRoutes(app: FastifyInstance) {
  const db = app.db;
  const view = guard('hotel_inventory.view', 'hotels.read_all');

  /** Location tree with shelves, assigned products and current balances. */
  app.get('/hotel-inventory/locations', { preHandler: view }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(z.object({ hotelId: z.uuid().optional() }), req.query);
    const hotelId = hotelFilter(ctx, q.hotelId);
    if (!hotelId) throw badRequest('hotelId is required');
    const locs = await db
      .select()
      .from(hotelLocations)
      .where(eq(hotelLocations.hotelId, hotelId))
      .orderBy(asc(hotelLocations.name));
    const assigned = await db
      .select({
        sp: shelfProducts,
        sku: products.sku,
        nameEn: products.nameEn,
        nameNe: products.nameNe,
        unit: products.sellingUnit,
      })
      .from(shelfProducts)
      .innerJoin(products, eq(products.id, shelfProducts.productId))
      .where(eq(shelfProducts.hotelId, hotelId))
      .orderBy(asc(products.nameEn));
    const bal = await balancesFor(db, hotelId);
    const canManage = can(ctx, 'hotel_inventory.manage_locations');
    return {
      items: locs.map((l) => ({
        ...l,
        // the QR token is only needed by people who print labels
        qrToken: canManage ? l.qrToken : undefined,
        products: assigned
          .filter((a) => a.sp.locationId === l.id)
          .map((a) => {
            const b = bal.get(`${l.id}:${a.sp.productId}`);
            const qty = b?.qty ?? '0.000';
            return {
              ...a.sp,
              sku: a.sku,
              nameEn: a.nameEn,
              nameNe: a.nameNe,
              unit: a.unit,
              balance: qty,
              low: cmpQty(qty, a.sp.minQty) <= 0,
              lastMovementAt: b?.lastAt ?? null,
            };
          }),
      })),
    };
  });

  app.post(
    '/hotel-inventory/locations',
    { preHandler: guard('hotel_inventory.manage_locations') },
    async (req) => {
      const ctx = ctxOf(req);
      const body = parse(
        z.object({
          hotelId: z.uuid().optional(),
          kind: z.enum(['area', 'shelf']),
          name: z.string().min(1).max(120),
          description: z.string().max(500).nullable().optional(),
          parentId: z.uuid().nullable().optional(),
        }),
        req.body,
      );
      const hotelId = ctx.actor.hotelId ?? body.hotelId;
      if (!hotelId) throw badRequest('hotelId is required');
      if (body.parentId) {
        const [p] = await db.select().from(hotelLocations).where(eq(hotelLocations.id, body.parentId));
        if (!p || p.hotelId !== hotelId || p.kind !== 'area')
          throw badRequest('Parent must be a storage area of the same hotel');
      }
      const loc = await db.transaction(async (tx) => {
        const [l] = await tx
          .insert(hotelLocations)
          .values({
            hotelId,
            kind: body.kind,
            name: body.name,
            description: body.description ?? null,
            parentId: body.parentId ?? null,
            qrToken: body.kind === 'shelf' ? randomToken(16) : null,
          })
          .returning();
        await audit(tx, ctx, {
          action: 'hotel_location.created',
          entityType: 'hotel_location',
          entityId: l!.id,
          hotelId,
          after: { name: l!.name, kind: l!.kind },
        });
        return l!;
      });
      return { location: loc };
    },
  );

  app.patch(
    '/hotel-inventory/locations/:id',
    { preHandler: guard('hotel_inventory.manage_locations') },
    async (req) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParam, req.params);
      const body = parse(
        z
          .object({
            name: z.string().min(1).max(120),
            description: z.string().nullable(),
            isActive: z.boolean(),
            regenerateQr: z.boolean(),
          })
          .partial(),
        req.body,
      );
      const [before] = await db.select().from(hotelLocations).where(eq(hotelLocations.id, id));
      if (!before) throw notFound('Location');
      assertHotelAccess(ctx, before.hotelId, 'Location');
      const { regenerateQr, ...changes } = body;
      const [loc] = await db.transaction(async (tx) => {
        const r = await tx
          .update(hotelLocations)
          .set({
            ...changes,
            ...(regenerateQr && before.kind === 'shelf' ? { qrToken: randomToken(16) } : {}),
          })
          .where(eq(hotelLocations.id, id))
          .returning();
        await audit(tx, ctx, {
          action: regenerateQr ? 'hotel_location.qr_regenerated' : 'hotel_location.updated',
          entityType: 'hotel_location',
          entityId: id,
          hotelId: before.hotelId,
          before: { name: before.name, isActive: before.isActive },
          after: { name: r[0]!.name, isActive: r[0]!.isActive },
        });
        return r;
      });
      return { location: loc };
    },
  );

  app.put(
    '/hotel-inventory/locations/:id/products/:productId',
    { preHandler: guard('hotel_inventory.manage_locations') },
    async (req) => {
      const ctx = ctxOf(req);
      const { id, productId } = parse(z.object({ id: z.uuid(), productId: z.uuid() }), req.params);
      const body = parse(
        z.object({
          defaultUsageQty: qtyStr.default('1'),
          minQty: qtyStr.default('0'),
          parQty: qtyStr.nullable().optional(),
          isActive: z.boolean().default(true),
          openingQty: qtyStr.optional(),
        }),
        req.body,
      );
      const [loc] = await db.select().from(hotelLocations).where(eq(hotelLocations.id, id));
      if (!loc || loc.kind !== 'shelf') throw notFound('Shelf');
      assertHotelAccess(ctx, loc.hotelId, 'Shelf');
      const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
      if (!p) throw notFound('Product');
      const sp = await db.transaction(async (tx) => {
        const { openingQty, ...values } = body;
        const [row] = await tx
          .insert(shelfProducts)
          .values({ hotelId: loc.hotelId, locationId: id, productId, ...values })
          .onConflictDoUpdate({ target: [shelfProducts.locationId, shelfProducts.productId], set: values })
          .returning();
        if (
          openingQty &&
          cmpQty(openingQty, '0') > 0 &&
          cmpQty(await shelfBalance(tx, id, productId), '0') === 0
        ) {
          await tx
            .insert(hotelStockMovements)
            .values({
              hotelId: loc.hotelId,
              locationId: id,
              productId,
              movementType: 'opening',
              quantity: openingQty,
              actorId: ctx.actor.id,
              occurredAt: new Date(),
            });
        }
        await audit(tx, ctx, {
          action: 'shelf_product.saved',
          entityType: 'shelf_product',
          entityId: row!.id,
          hotelId: loc.hotelId,
          after: { ...row, openingQty },
        });
        return row!;
      });
      return { shelfProduct: sp };
    },
  );

  /** Resolve a scanned shelf QR code. Another hotel's code looks exactly like an unknown code. */
  app.get('/hotel-inventory/scan/:token', { preHandler: guard('hotel_inventory.view') }, async (req) => {
    const ctx = ctxOf(req);
    const { token } = parse(z.object({ token: z.string().min(10).max(64) }), req.params);
    const [loc] = await db
      .select()
      .from(hotelLocations)
      .where(and(eq(hotelLocations.qrToken, token), eq(hotelLocations.isActive, true)));
    if (!loc || (ctx.actor.hotelId && loc.hotelId !== ctx.actor.hotelId)) throw notFound('Shelf');
    const parent = loc.parentId
      ? (
          await db
            .select({ name: hotelLocations.name })
            .from(hotelLocations)
            .where(eq(hotelLocations.id, loc.parentId))
        )[0]
      : null;
    const items = await db
      .select({
        sp: shelfProducts,
        nameEn: products.nameEn,
        nameNe: products.nameNe,
        unit: products.sellingUnit,
        sku: products.sku,
      })
      .from(shelfProducts)
      .innerJoin(products, eq(products.id, shelfProducts.productId))
      .where(and(eq(shelfProducts.locationId, loc.id), eq(shelfProducts.isActive, true)))
      .orderBy(asc(products.nameEn));
    const bal = await balancesFor(db, loc.hotelId);
    return {
      shelf: { id: loc.id, name: loc.name, areaName: parent?.name ?? null, hotelId: loc.hotelId },
      products: items.map((i) => ({
        productId: i.sp.productId,
        nameEn: i.nameEn,
        nameNe: i.nameNe,
        sku: i.sku,
        unit: i.unit,
        defaultUsageQty: i.sp.defaultUsageQty,
        minQty: i.sp.minQty,
        balance: bal.get(`${loc.id}:${i.sp.productId}`)?.qty ?? '0.000',
      })),
      serverTime: new Date().toISOString(),
    };
  });

  /**
   * Minimal data for offline use: shelves, product names, units and balances for
   * the user's own hotel. No prices, costs or financial data are included.
   */
  app.get(
    '/hotel-inventory/offline-snapshot',
    { preHandler: guard('hotel_inventory.record') },
    async (req) => {
      const ctx = ctxOf(req);
      const hotelId = ctx.actor.hotelId;
      if (!hotelId) throw badRequest('Offline inventory is available to hotel users');
      const settings = await getSettings(db);
      const shelves = await db
        .select({
          id: hotelLocations.id,
          name: hotelLocations.name,
          qrToken: hotelLocations.qrToken,
          parentId: hotelLocations.parentId,
        })
        .from(hotelLocations)
        .where(
          and(
            eq(hotelLocations.hotelId, hotelId),
            eq(hotelLocations.kind, 'shelf'),
            eq(hotelLocations.isActive, true),
          ),
        );
      const areas = await db
        .select({ id: hotelLocations.id, name: hotelLocations.name })
        .from(hotelLocations)
        .where(and(eq(hotelLocations.hotelId, hotelId), eq(hotelLocations.kind, 'area')));
      const areaName = new Map(areas.map((a) => [a.id, a.name]));
      const assigned = await db
        .select({
          locationId: shelfProducts.locationId,
          productId: shelfProducts.productId,
          defaultUsageQty: shelfProducts.defaultUsageQty,
          minQty: shelfProducts.minQty,
          nameEn: products.nameEn,
          nameNe: products.nameNe,
          unit: products.sellingUnit,
        })
        .from(shelfProducts)
        .innerJoin(products, eq(products.id, shelfProducts.productId))
        .where(and(eq(shelfProducts.hotelId, hotelId), eq(shelfProducts.isActive, true)));
      const bal = await balancesFor(db, hotelId);
      const generatedAt = new Date();
      return {
        userId: ctx.actor.id,
        hotelId,
        generatedAt: generatedAt.toISOString(),
        expiresAt: new Date(generatedAt.getTime() + settings.offlineAccessHours * 3600_000).toISOString(),
        canCorrect: can(ctx, 'hotel_inventory.correct'),
        shelves: shelves.map((s) => ({
          id: s.id,
          name: s.name,
          areaName: s.parentId ? (areaName.get(s.parentId) ?? null) : null,
          qrToken: s.qrToken,
          products: assigned
            .filter((a) => a.locationId === s.id)
            .map((a) => ({
              productId: a.productId,
              nameEn: a.nameEn,
              nameNe: a.nameNe,
              unit: a.unit,
              defaultUsageQty: a.defaultUsageQty,
              minQty: a.minQty,
              balance: bal.get(`${s.id}:${a.productId}`)?.qty ?? '0.000',
            })),
        })),
      };
    },
  );

  /** Submit one or more events (online use and offline sync share this endpoint). */
  app.post('/hotel-inventory/events', { preHandler: guard('hotel_inventory.record') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(z.object({ events: z.array(z.unknown()).min(1).max(200) }), req.body);
    const results: EventResult[] = [];
    // Each event commits independently so one bad event never blocks the rest of a sync batch.
    for (const raw of body.events) {
      const parsed = inventoryEventSchema.safeParse(raw);
      if (!parsed.success) {
        const id = (raw as { id?: unknown })?.id;
        results.push({
          id: typeof id === 'string' ? id : 'unknown',
          status: 'rejected',
          flags: [],
          message: parsed.error.issues[0]?.message ?? 'Invalid event',
        });
        continue;
      }
      try {
        results.push(await db.transaction((tx) => processInventoryEvent(tx, ctx, parsed.data)));
      } catch (err) {
        // A concurrent retry of the same id loses the primary-key race: report it as a duplicate.
        if (
          (err as { code?: string; cause?: { code?: string } }).code === '23505' ||
          (err as { cause?: { code?: string } }).cause?.code === '23505'
        ) {
          results.push({ id: parsed.data.id, status: 'duplicate', flags: [] });
        } else throw err;
      }
    }
    return { results, serverTime: new Date().toISOString() };
  });

  app.get('/hotel-inventory/events', { preHandler: view }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({
        hotelId: z.uuid().optional(),
        status: z.enum(['applied', 'needs_review', 'rejected']).optional(),
        flagged: qbool(false),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const hotelId = hotelFilter(ctx, q.hotelId);
    const conds = [];
    if (hotelId) conds.push(eq(hotelInventoryEvents.hotelId, hotelId));
    if (q.status) conds.push(eq(hotelInventoryEvents.status, q.status));
    if (q.flagged)
      conds.push(
        sql`cardinality(${hotelInventoryEvents.flags}) > 0 and not (${hotelInventoryEvents.flags} <@ array['offline']::text[])`,
      );
    // inventory staff only see their own history
    if (ctx.actor.role === 'hotel_inventory') conds.push(eq(hotelInventoryEvents.actorId, ctx.actor.id));
    const rows = await db
      .select({
        e: hotelInventoryEvents,
        actorName: users.name,
        nameEn: products.nameEn,
        nameNe: products.nameNe,
        unit: products.sellingUnit,
        shelfName: hotelLocations.name,
      })
      .from(hotelInventoryEvents)
      .innerJoin(products, eq(products.id, hotelInventoryEvents.productId))
      .innerJoin(hotelLocations, eq(hotelLocations.id, hotelInventoryEvents.locationId))
      .leftJoin(users, eq(users.id, hotelInventoryEvents.actorId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(hotelInventoryEvents.receivedAt))
      .limit(q.limit);
    return {
      items: rows.map((r) => ({
        ...r.e,
        actorName: r.actorName,
        nameEn: r.nameEn,
        nameNe: r.nameNe,
        unit: r.unit,
        shelfName: r.shelfName,
      })),
    };
  });

  /** Manager decision on a held correction. Accepting applies the count against the balance now. */
  app.post(
    '/hotel-inventory/events/:id/review',
    { preHandler: guard('hotel_inventory.review') },
    async (req) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParam, req.params);
      const body = parse(
        z.object({ decision: z.enum(['accept', 'reject']), note: z.string().min(3).max(500) }),
        req.body,
      );
      const result = await db.transaction(async (tx) => {
        const [ev] = await tx
          .select()
          .from(hotelInventoryEvents)
          .where(eq(hotelInventoryEvents.id, id))
          .for('update');
        if (!ev) throw notFound('Event');
        assertHotelAccess(ctx, ev.hotelId, 'Event');
        if (ev.status !== 'needs_review') throw badRequest('This event is not waiting for review');
        await tx.execute(
          sql`select pg_advisory_xact_lock(${LOCK_NS}, hashtext(${`${ev.locationId}:${ev.productId}`}))`,
        );
        const current = await shelfBalance(tx, ev.locationId, ev.productId);
        let delta: string | null = null;
        if (body.decision === 'accept' && ev.action === 'correction' && ev.countedQty !== null) {
          delta = subQty(ev.countedQty, current);
          if (cmpQty(delta, '0') !== 0) {
            await tx
              .insert(hotelStockMovements)
              .values({
                hotelId: ev.hotelId,
                locationId: ev.locationId,
                productId: ev.productId,
                movementType: 'correction',
                quantity: delta,
                eventId: ev.id,
                actorId: ctx.actor.id,
                occurredAt: new Date(),
              });
          }
        }
        await tx
          .update(hotelInventoryEvents)
          .set({
            status: body.decision === 'accept' ? 'applied' : 'rejected',
            reviewedBy: ctx.actor.id,
            reviewedAt: new Date(),
            reviewNote: body.note,
          })
          .where(eq(hotelInventoryEvents.id, id));
        await audit(tx, ctx, {
          action: `hotel_inventory.review_${body.decision}`,
          entityType: 'hotel_inventory_event',
          entityId: id,
          hotelId: ev.hotelId,
          reason: body.note,
          before: { balance: current },
          after: { delta },
        });
        return { balance: await shelfBalance(tx, ev.locationId, ev.productId) };
      });
      return result;
    },
  );

  app.get('/hotel-inventory/movements', { preHandler: view }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({
        hotelId: z.uuid().optional(),
        locationId: z.uuid().optional(),
        productId: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const hotelId = hotelFilter(ctx, q.hotelId);
    if (!hotelId) throw badRequest('hotelId is required');
    const conds = [eq(hotelStockMovements.hotelId, hotelId)];
    if (q.locationId) conds.push(eq(hotelStockMovements.locationId, q.locationId));
    if (q.productId) conds.push(eq(hotelStockMovements.productId, q.productId));
    const rows = await db
      .select({
        m: hotelStockMovements,
        nameEn: products.nameEn,
        nameNe: products.nameNe,
        unit: products.sellingUnit,
        shelfName: hotelLocations.name,
        actorName: users.name,
      })
      .from(hotelStockMovements)
      .innerJoin(products, eq(products.id, hotelStockMovements.productId))
      .innerJoin(hotelLocations, eq(hotelLocations.id, hotelStockMovements.locationId))
      .leftJoin(users, eq(users.id, hotelStockMovements.actorId))
      .where(and(...conds))
      .orderBy(desc(hotelStockMovements.id))
      .limit(q.limit);
    return {
      items: rows.map((r) => ({
        ...r.m,
        nameEn: r.nameEn,
        nameNe: r.nameNe,
        unit: r.unit,
        shelfName: r.shelfName,
        actorName: r.actorName,
      })),
    };
  });

  app.get('/hotel-inventory/low-stock', { preHandler: view }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(z.object({ hotelId: z.uuid().optional() }), req.query);
    const hotelId = hotelFilter(ctx, q.hotelId);
    const hotelIds = hotelId ? [hotelId] : (await db.select({ id: hotels.id }).from(hotels)).map((h) => h.id);
    const items = [];
    for (const hid of hotelIds) {
      const assigned = await db
        .select({
          sp: shelfProducts,
          nameEn: products.nameEn,
          nameNe: products.nameNe,
          unit: products.sellingUnit,
          shelfName: hotelLocations.name,
        })
        .from(shelfProducts)
        .innerJoin(products, eq(products.id, shelfProducts.productId))
        .innerJoin(hotelLocations, eq(hotelLocations.id, shelfProducts.locationId))
        .where(and(eq(shelfProducts.hotelId, hid), eq(shelfProducts.isActive, true)));
      const bal = await balancesFor(db, hid);
      for (const a of assigned) {
        const qty = bal.get(`${a.sp.locationId}:${a.sp.productId}`)?.qty ?? '0.000';
        if (cmpQty(qty, a.sp.minQty) <= 0)
          items.push({
            hotelId: hid,
            locationId: a.sp.locationId,
            shelfName: a.shelfName,
            productId: a.sp.productId,
            nameEn: a.nameEn,
            nameNe: a.nameNe,
            unit: a.unit,
            balance: qty,
            minQty: a.sp.minQty,
            parQty: a.sp.parQty,
          });
      }
    }
    return { items };
  });
}
