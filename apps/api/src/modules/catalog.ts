import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { marginPercent, subMoney } from '@hp/shared';
import {
  categories,
  priceHistory,
  pricingRules,
  products,
  supplierProducts,
  suppliers,
  taxRates,
  units,
  hotels,
} from '../db/schema';
import { PRICING_SCOPES } from '../db/schema/catalog';
import { ctxOf, guard } from '../plugins/auth';
import { canSeeCosts, hotelFilter, isInternal } from '../lib/context';
import { badRequest, notFound } from '../lib/errors';
import { idParam, pageQuery, paged, parse, parsePatch } from '../lib/http';
import { qbool } from '../lib/http';
import { audit } from '../lib/audit';
import { resolvePrices } from './pricing-engine';

const moneyStr = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount with up to 2 decimals');
const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Quantity with up to 3 decimals');

const productBody = z.object({
  sku: z.string().regex(/^[A-Z0-9-]{2,30}$/, 'Uppercase letters, digits and dashes'),
  barcode: z.string().max(50).nullable().optional(),
  nameEn: z.string().min(1).max(200),
  nameNe: z.string().min(1).max(200),
  descriptionEn: z.string().nullable().optional(),
  descriptionNe: z.string().nullable().optional(),
  categoryId: z.uuid(),
  brand: z.string().nullable().optional(),
  specifications: z.string().nullable().optional(),
  imageAttachmentId: z.uuid().nullable().optional(),
  sellingUnit: z.string(),
  purchaseUnit: z.string(),
  unitsPerPurchaseUnit: qtyStr.default('1'),
  referenceCost: moneyStr.default('0'),
  taxCode: z.string(),
  minOrderQty: qtyStr.default('1'),
  isActive: z.boolean().default(true),
});

export async function catalogRoutes(app: FastifyInstance) {
  const db = app.db;

  /* ----------------------------- categories ----------------------------- */

  app.get('/categories', { preHandler: guard('catalog.read') }, async () => {
    const rows = await db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        code: categories.code,
        nameEn: categories.nameEn,
        nameNe: categories.nameNe,
        sortOrder: categories.sortOrder,
        isActive: categories.isActive,
        productCount: sql<number>`(select count(*)::int from products p where p.category_id = categories.id and p.is_active)`,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.nameEn));
    return { items: rows };
  });

  app.post('/categories', { preHandler: guard('catalog.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
        nameEn: z.string().min(1),
        nameNe: z.string().min(1),
        parentId: z.uuid().nullable().optional(),
        sortOrder: z.number().int().default(0),
      }),
      req.body,
    );
    const cat = await db.transaction(async (tx) => {
      const [c] = await tx.insert(categories).values(body).returning();
      await audit(tx, ctx, { action: 'category.created', entityType: 'category', entityId: c!.id, after: c });
      return c!;
    });
    return { category: cat };
  });

  app.patch('/categories/:id', { preHandler: guard('catalog.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z
        .object({
          nameEn: z.string().min(1),
          nameNe: z.string().min(1),
          parentId: z.uuid().nullable(),
          sortOrder: z.number().int(),
          isActive: z.boolean(),
        })
        .partial(),
      req.body,
    );
    if (body.parentId === id) throw badRequest('A category cannot be its own parent');
    const [before] = await db.select().from(categories).where(eq(categories.id, id));
    if (!before) throw notFound('Category');
    const [after] = await db.transaction(async (tx) => {
      const r = await tx.update(categories).set(body).where(eq(categories.id, id)).returning();
      await audit(tx, ctx, {
        action: 'category.updated',
        entityType: 'category',
        entityId: id,
        before,
        after: r[0],
      });
      return r;
    });
    return { category: after };
  });

  /* ------------------------------ products ------------------------------ */

  /**
   * Catalog listing. Hotel users get their own selling prices and never see costs.
   * Internal users may pass hotelId to preview a hotel's prices; they also see cost and margin.
   */
  app.get('/products', { preHandler: guard('catalog.read') }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      pageQuery.extend({
        q: z.string().trim().optional(),
        categoryId: z.uuid().optional(),
        hotelId: z.uuid().optional(),
        includeInactive: qbool(false),
        sort: z.enum(['name', 'sku', 'newest']).default('name'),
      }),
      req.query,
    );
    const conds = [];
    if (!q.includeInactive || !isInternal(ctx)) conds.push(eq(products.isActive, true));
    if (q.categoryId) {
      // include direct subcategories
      const subs = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.parentId, q.categoryId));
      conds.push(inArray(products.categoryId, [q.categoryId, ...subs.map((s) => s.id)]));
    }
    if (q.q) {
      const like = `%${q.q}%`;
      conds.push(
        or(
          ilike(products.nameEn, like),
          ilike(products.nameNe, like),
          ilike(products.sku, like),
          ilike(products.brand, like),
          eq(products.barcode, q.q),
        ),
      );
    }
    const where = conds.length ? and(...conds) : undefined;
    const order =
      q.sort === 'sku'
        ? asc(products.sku)
        : q.sort === 'newest'
          ? desc(products.createdAt)
          : asc(products.nameEn);
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(products).where(where);
    const rows = await db
      .select({
        product: products,
        categoryNameEn: categories.nameEn,
        categoryNameNe: categories.nameNe,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    const hotelId = hotelFilter(ctx, q.hotelId);
    const prices = await resolvePrices(
      db,
      hotelId,
      rows.map((r) => r.product.id),
    );
    const showCost = canSeeCosts(ctx);
    const items = rows.map(({ product: p, categoryNameEn, categoryNameNe }) => {
      const price = prices.get(p.id)!;
      const base = {
        id: p.id,
        sku: p.sku,
        barcode: p.barcode,
        nameEn: p.nameEn,
        nameNe: p.nameNe,
        descriptionEn: p.descriptionEn,
        descriptionNe: p.descriptionNe,
        categoryId: p.categoryId,
        categoryNameEn,
        categoryNameNe,
        brand: p.brand,
        specifications: p.specifications,
        imageAttachmentId: p.imageAttachmentId,
        sellingUnit: p.sellingUnit,
        taxCode: p.taxCode,
        minOrderQty: p.minOrderQty,
        isActive: p.isActive,
        unitPrice: price.available ? price.unitPrice : null,
        priceAvailable: price.available,
      };
      if (!showCost) return base;
      return {
        ...base,
        purchaseUnit: p.purchaseUnit,
        unitsPerPurchaseUnit: p.unitsPerPurchaseUnit,
        referenceCost: p.referenceCost,
        priceSource: price.source,
        marginPercent: marginPercent(price.unitPrice, p.referenceCost),
      };
    });
    return paged(items, Number(total), q.page, q.pageSize);
  });

  app.get('/products/:id', { preHandler: guard('catalog.read') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ hotelId: z.uuid().optional() }), req.query);
    const [p] = await db.select().from(products).where(eq(products.id, id));
    if (!p || (!p.isActive && !isInternal(ctx))) throw notFound('Product');
    const hotelId = hotelFilter(ctx, q.hotelId);
    const price = (await resolvePrices(db, hotelId, [id])).get(id)!;
    if (!canSeeCosts(ctx)) {
      const { referenceCost: _c, purchaseUnit: _pu, unitsPerPurchaseUnit: _u, isDemo: _d, ...pub } = p;
      return {
        product: {
          ...pub,
          unitPrice: price.available ? price.unitPrice : null,
          priceAvailable: price.available,
        },
      };
    }
    const supplierLinks = await db
      .select({ link: supplierProducts, supplierName: suppliers.name })
      .from(supplierProducts)
      .innerJoin(suppliers, eq(suppliers.id, supplierProducts.supplierId))
      .where(eq(supplierProducts.productId, id));
    const history = await db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.productId, id))
      .orderBy(desc(priceHistory.createdAt))
      .limit(50);
    return {
      product: {
        ...p,
        unitPrice: price.unitPrice,
        priceSource: price.source,
        marginPercent: marginPercent(price.unitPrice, p.referenceCost),
      },
      suppliers: supplierLinks.map((s) => ({ ...s.link, supplierName: s.supplierName })),
      priceHistory: history,
    };
  });

  async function validateRefs(body: Partial<z.infer<typeof productBody>>) {
    if (body.categoryId) {
      const [c] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, body.categoryId));
      if (!c) throw badRequest('Unknown category');
    }
    for (const u of [body.sellingUnit, body.purchaseUnit]) {
      if (u && !(await db.select().from(units).where(eq(units.code, u))).length)
        throw badRequest(`Unknown unit ${u}`);
    }
    if (body.taxCode && !(await db.select().from(taxRates).where(eq(taxRates.code, body.taxCode))).length) {
      throw badRequest('Unknown tax code');
    }
  }

  app.post('/products', { preHandler: guard('catalog.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(productBody, req.body);
    await validateRefs(body);
    const product = await db.transaction(async (tx) => {
      const [p] = await tx.insert(products).values(body).returning();
      await audit(tx, ctx, { action: 'product.created', entityType: 'product', entityId: p!.id, after: p });
      await tx.insert(priceHistory).values({
        entity: 'product_cost',
        entityId: p!.id,
        productId: p!.id,
        oldValue: null,
        newValue: p!.referenceCost,
        reason: 'Product created',
        changedBy: ctx.actor.id,
      });
      return p!;
    });
    return { product };
  });

  app.patch('/products/:id', { preHandler: guard('catalog.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parsePatch(productBody.extend({ reason: z.string().optional() }), req.body);
    const { reason, ...changes } = body;
    await validateRefs(changes);
    const [before] = await db.select().from(products).where(eq(products.id, id));
    if (!before) throw notFound('Product');
    const costChanged =
      changes.referenceCost !== undefined && subMoney(changes.referenceCost, before.referenceCost) !== '0.00';
    if (costChanged && !reason) throw badRequest('A reason is required when changing the reference cost');
    const product = await db.transaction(async (tx) => {
      const [p] = await tx
        .update(products)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      if (costChanged) {
        await tx.insert(priceHistory).values({
          entity: 'product_cost',
          entityId: id,
          productId: id,
          oldValue: before.referenceCost,
          newValue: p!.referenceCost,
          reason,
          changedBy: ctx.actor.id,
        });
      }
      await audit(tx, ctx, {
        action: 'product.updated',
        entityType: 'product',
        entityId: id,
        reason,
        before,
        after: p,
      });
      return p!;
    });
    return { product };
  });

  /* ---------------------------- pricing rules --------------------------- */

  app.get('/pricing-rules', { preHandler: guard('pricing.manage') }, async (req) => {
    const q = parse(
      z.object({
        hotelId: z.uuid().optional(),
        productId: z.uuid().optional(),
        includeInactive: qbool(false),
      }),
      req.query,
    );
    const conds = [];
    if (!q.includeInactive) conds.push(eq(pricingRules.isActive, true));
    if (q.hotelId) conds.push(eq(pricingRules.hotelId, q.hotelId));
    if (q.productId) conds.push(eq(pricingRules.productId, q.productId));
    const items = await db
      .select({
        rule: pricingRules,
        hotelName: hotels.legalName,
        categoryName: categories.nameEn,
        productName: products.nameEn,
        productSku: products.sku,
      })
      .from(pricingRules)
      .leftJoin(hotels, eq(hotels.id, pricingRules.hotelId))
      .leftJoin(categories, eq(categories.id, pricingRules.categoryId))
      .leftJoin(products, eq(products.id, pricingRules.productId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(pricingRules.scope), desc(pricingRules.createdAt));
    return {
      items: items.map((r) => ({
        ...r.rule,
        hotelName: r.hotelName,
        categoryName: r.categoryName,
        productName: r.productName,
        productSku: r.productSku,
      })),
    };
  });

  app.post('/pricing-rules', { preHandler: guard('pricing.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        scope: z.enum(PRICING_SCOPES),
        hotelId: z.uuid().nullable().optional(),
        categoryId: z.uuid().nullable().optional(),
        productId: z.uuid().nullable().optional(),
        ruleType: z.enum(['markup_percent', 'fixed_price']),
        value: z.string().regex(/^\d+(\.\d{1,3})?$/),
        validFrom: z.iso.date().optional(),
        validTo: z.iso.date().nullable().optional(),
        reason: z.string().min(3),
        /** Replace (deactivate) the currently active rule for the same target. */
        replaceExisting: z.boolean().default(true),
      }),
      req.body,
    );
    if (body.ruleType === 'fixed_price' && !/^\d+(\.\d{1,2})?$/.test(body.value))
      throw badRequest('Fixed prices have at most 2 decimals');
    const rule = await db.transaction(async (tx) => {
      const sameTarget = and(
        eq(pricingRules.scope, body.scope),
        eq(pricingRules.isActive, true),
        body.hotelId ? eq(pricingRules.hotelId, body.hotelId) : sql`${pricingRules.hotelId} is null`,
        body.categoryId
          ? eq(pricingRules.categoryId, body.categoryId)
          : sql`${pricingRules.categoryId} is null`,
        body.productId ? eq(pricingRules.productId, body.productId) : sql`${pricingRules.productId} is null`,
      );
      const previous = await tx.select().from(pricingRules).where(sameTarget);
      if (body.replaceExisting && previous.length) {
        await tx.update(pricingRules).set({ isActive: false }).where(sameTarget);
      }
      const { replaceExisting: _r, ...values } = body;
      const [r] = await tx
        .insert(pricingRules)
        .values({ ...values, createdBy: ctx.actor.id })
        .returning();
      const prev = previous[0];
      await tx.insert(priceHistory).values({
        entity: 'pricing_rule',
        entityId: r!.id,
        productId: r!.productId,
        hotelId: r!.hotelId,
        oldValue: prev ? `${prev.ruleType}:${prev.value}` : null,
        newValue: `${r!.ruleType}:${r!.value}`,
        reason: body.reason,
        changedBy: ctx.actor.id,
      });
      await audit(tx, ctx, {
        action: 'pricing_rule.created',
        entityType: 'pricing_rule',
        entityId: r!.id,
        hotelId: r!.hotelId,
        reason: body.reason,
        before: prev ?? null,
        after: r,
      });
      return r!;
    });
    return { rule };
  });

  app.post('/pricing-rules/:id/deactivate', { preHandler: guard('pricing.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    const [before] = await db.select().from(pricingRules).where(eq(pricingRules.id, id));
    if (!before) throw notFound('Pricing rule');
    await db.transaction(async (tx) => {
      await tx.update(pricingRules).set({ isActive: false }).where(eq(pricingRules.id, id));
      await tx.insert(priceHistory).values({
        entity: 'pricing_rule',
        entityId: id,
        productId: before.productId,
        hotelId: before.hotelId,
        oldValue: `${before.ruleType}:${before.value}`,
        newValue: 'deactivated',
        reason,
        changedBy: ctx.actor.id,
      });
      await audit(tx, ctx, {
        action: 'pricing_rule.deactivated',
        entityType: 'pricing_rule',
        entityId: id,
        hotelId: before.hotelId,
        reason,
        before,
      });
    });
    return { ok: true };
  });

  app.get('/pricing/preview', { preHandler: guard('pricing.manage') }, async (req) => {
    const q = parse(z.object({ hotelId: z.uuid().optional(), productIds: z.string().optional() }), req.query);
    const ids = q.productIds?.split(',').filter(Boolean) ?? [];
    const prices = await resolvePrices(db, q.hotelId ?? null, ids);
    return { items: Object.fromEntries(prices) };
  });
}
