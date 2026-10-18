import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  products,
  supplierContacts,
  supplierProducts,
  supplierQuotations,
  suppliers,
  users,
} from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { badRequest, notFound } from '../lib/errors';
import { idParam, parse, todayNepal, parsePatch } from '../lib/http';
import { qbool } from '../lib/http';
import { audit } from '../lib/audit';

const moneyStr = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount with up to 2 decimals');
const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/);

const supplierBody = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,20}$/),
  name: z.string().min(1).max(200),
  pan: z
    .string()
    .regex(/^\d{9}$/, 'PAN is 9 digits')
    .nullable()
    .optional(),
  vatNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.email().nullable().optional(),
  contactName: z.string().nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).default(1),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  termsNotes: z.string().nullable().optional(),
  status: z.enum(['active', 'inactive', 'blocked']).default('active'),
  notes: z.string().nullable().optional(),
});

/** Supplier records and costs are internal and confidential: no hotel role holds these permissions. */
export async function supplierRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/suppliers', { preHandler: guard('suppliers.read') }, async (req) => {
    const q = parse(
      z.object({
        q: z.string().optional(),
        status: z.enum(['active', 'inactive', 'blocked']).optional(),
        productId: z.uuid().optional(),
      }),
      req.query,
    );
    const conds = [];
    if (q.status) conds.push(eq(suppliers.status, q.status));
    if (q.q)
      conds.push(
        or(
          ilike(suppliers.name, `%${q.q}%`),
          ilike(suppliers.code, `%${q.q}%`),
          ilike(suppliers.contactName, `%${q.q}%`),
        ),
      );
    let rows = await db
      .select()
      .from(suppliers)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(suppliers.name));
    if (q.productId) {
      const links = await db
        .select({ supplierId: supplierProducts.supplierId })
        .from(supplierProducts)
        .where(eq(supplierProducts.productId, q.productId));
      const ids = new Set(links.map((l) => l.supplierId));
      rows = rows.filter((r) => ids.has(r.id));
    }
    return { items: rows };
  });

  app.get('/suppliers/:id', { preHandler: guard('suppliers.read') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    if (!s) throw notFound('Supplier');
    const contacts = await db.select().from(supplierContacts).where(eq(supplierContacts.supplierId, id));
    const productLinks = await db
      .select({
        link: supplierProducts,
        sku: products.sku,
        nameEn: products.nameEn,
        sellingUnit: products.sellingUnit,
      })
      .from(supplierProducts)
      .innerJoin(products, eq(products.id, supplierProducts.productId))
      .where(eq(supplierProducts.supplierId, id))
      .orderBy(asc(products.nameEn));
    const quotations = await db
      .select({ q: supplierQuotations, nameEn: products.nameEn, sku: products.sku })
      .from(supplierQuotations)
      .innerJoin(products, eq(products.id, supplierQuotations.productId))
      .where(eq(supplierQuotations.supplierId, id))
      .orderBy(desc(supplierQuotations.createdAt))
      .limit(100);
    return {
      supplier: s,
      contacts,
      products: productLinks.map((p) => ({
        ...p.link,
        sku: p.sku,
        nameEn: p.nameEn,
        sellingUnit: p.sellingUnit,
      })),
      quotations: quotations.map((r) => ({ ...r.q, nameEn: r.nameEn, sku: r.sku })),
    };
  });

  app.post('/suppliers', { preHandler: guard('suppliers.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(supplierBody, req.body);
    const supplier = await db.transaction(async (tx) => {
      const [s] = await tx.insert(suppliers).values(body).returning();
      await audit(tx, ctx, { action: 'supplier.created', entityType: 'supplier', entityId: s!.id, after: s });
      return s!;
    });
    return { supplier };
  });

  app.patch('/suppliers/:id', { preHandler: guard('suppliers.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parsePatch(supplierBody, req.body);
    const [before] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    if (!before) throw notFound('Supplier');
    const supplier = await db.transaction(async (tx) => {
      const [s] = await tx
        .update(suppliers)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(suppliers.id, id))
        .returning();
      await audit(tx, ctx, {
        action: 'supplier.updated',
        entityType: 'supplier',
        entityId: id,
        before,
        after: s,
      });
      return s!;
    });
    return { supplier };
  });

  app.post('/suppliers/:id/contacts', { preHandler: guard('suppliers.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        name: z.string().min(1),
        position: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        email: z.email().nullable().optional(),
      }),
      req.body,
    );
    const contact = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(supplierContacts)
        .values({ ...body, supplierId: id })
        .returning();
      await audit(tx, ctx, {
        action: 'supplier.contact_added',
        entityType: 'supplier',
        entityId: id,
        after: c,
      });
      return c!;
    });
    return { contact };
  });

  app.put('/suppliers/:id/products/:productId', { preHandler: guard('suppliers.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id, productId } = parse(z.object({ id: z.uuid(), productId: z.uuid() }), req.params);
    const body = parse(
      z.object({ supplierSku: z.string().nullable().optional(), notes: z.string().nullable().optional() }),
      req.body,
    );
    const link = await db.transaction(async (tx) => {
      const [l] = await tx
        .insert(supplierProducts)
        .values({ supplierId: id, productId, ...body })
        .onConflictDoUpdate({ target: [supplierProducts.supplierId, supplierProducts.productId], set: body })
        .returning();
      await audit(tx, ctx, {
        action: 'supplier.product_linked',
        entityType: 'supplier',
        entityId: id,
        after: l,
      });
      return l!;
    });
    return { link };
  });

  /* ----------------------------- quotations ----------------------------- */

  app.get('/quotations', { preHandler: guard('quotations.manage') }, async (req) => {
    const q = parse(
      z.object({
        productId: z.uuid().optional(),
        orderId: z.uuid().optional(),
        productRequestId: z.uuid().optional(),
        validOnly: qbool(false),
      }),
      req.query,
    );
    const conds = [];
    if (q.productId) conds.push(eq(supplierQuotations.productId, q.productId));
    if (q.orderId) conds.push(eq(supplierQuotations.orderId, q.orderId));
    if (q.productRequestId) conds.push(eq(supplierQuotations.productRequestId, q.productRequestId));
    const rows = await db
      .select({
        q: supplierQuotations,
        supplierName: suppliers.name,
        productName: products.nameEn,
        sku: products.sku,
        sellingUnit: products.sellingUnit,
        createdByName: users.name,
      })
      .from(supplierQuotations)
      .innerJoin(suppliers, eq(suppliers.id, supplierQuotations.supplierId))
      .innerJoin(products, eq(products.id, supplierQuotations.productId))
      .leftJoin(users, eq(users.id, supplierQuotations.createdBy))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(supplierQuotations.unitCost), desc(supplierQuotations.createdAt))
      .limit(200);
    const today = todayNepal();
    const items = rows
      .map((r) => ({
        ...r.q,
        supplierName: r.supplierName,
        productName: r.productName,
        sku: r.sku,
        sellingUnit: r.sellingUnit,
        createdByName: r.createdByName,
        expired: r.q.validUntil !== null && r.q.validUntil < today,
      }))
      .filter((r) => !q.validOnly || !r.expired);
    return { items };
  });

  app.post('/quotations', { preHandler: guard('quotations.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        supplierId: z.uuid(),
        productId: z.uuid(),
        orderId: z.uuid().nullable().optional(),
        productRequestId: z.uuid().nullable().optional(),
        unitCost: moneyStr,
        availableQty: qtyStr.nullable().optional(),
        availabilityNote: z.string().nullable().optional(),
        leadTimeDays: z.number().int().min(0).nullable().optional(),
        validUntil: z.iso.date().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
      req.body,
    );
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, body.supplierId));
    if (!s) throw notFound('Supplier');
    if (s.status !== 'active') throw badRequest('Supplier is not active');
    const quotation = await db.transaction(async (tx) => {
      const [q] = await tx
        .insert(supplierQuotations)
        .values({ ...body, createdBy: ctx.actor.id })
        .returning();
      await tx
        .insert(supplierProducts)
        .values({ supplierId: body.supplierId, productId: body.productId, lastUnitCost: body.unitCost })
        .onConflictDoUpdate({
          target: [supplierProducts.supplierId, supplierProducts.productId],
          set: { lastUnitCost: body.unitCost },
        });
      await audit(tx, ctx, {
        action: 'quotation.recorded',
        entityType: 'supplier_quotation',
        entityId: q!.id,
        after: q,
      });
      return q!;
    });
    return { quotation };
  });
}
