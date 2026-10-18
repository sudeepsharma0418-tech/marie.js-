import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { addMoney, lineAmount, percentOf } from '@hp/shared';
import {
  attachments,
  hotels,
  orderLines,
  orders,
  productRequests,
  products,
  taxRates,
  users,
} from '../db/schema';
import { PRODUCT_REQUEST_STATUSES } from '../db/schema/orders';
import { ctxOf, guard } from '../plugins/auth';
import { assertHotelAccess, hotelFilter } from '../lib/context';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { idParam, parse } from '../lib/http';
import { audit } from '../lib/audit';
import { nextDocumentNumber } from '../lib/numbering';
import { notifyRoles } from '../lib/notify';
import { addOrderEvent } from './orders-core';

const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/);
const moneyStr = z.string().regex(/^\d+(\.\d{1,2})?$/);

/** Requests for products that are not in the catalog. */
export async function requestRoutes(app: FastifyInstance) {
  const db = app.db;
  const read = guard('requests.create', 'requests.manage');

  app.get('/product-requests', { preHandler: read }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({ status: z.enum(PRODUCT_REQUEST_STATUSES).optional(), hotelId: z.uuid().optional() }),
      req.query,
    );
    const hotelId = hotelFilter(ctx, q.hotelId);
    const conds = [];
    if (hotelId) conds.push(eq(productRequests.hotelId, hotelId));
    if (q.status) conds.push(eq(productRequests.status, q.status));
    const rows = await db
      .select({ r: productRequests, hotelName: hotels.legalName, requestedByName: users.name })
      .from(productRequests)
      .innerJoin(hotels, eq(hotels.id, productRequests.hotelId))
      .leftJoin(users, eq(users.id, productRequests.requestedBy))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(productRequests.createdAt))
      .limit(200);
    return {
      items: rows.map((r) => ({ ...r.r, hotelName: r.hotelName, requestedByName: r.requestedByName })),
    };
  });

  app.get('/product-requests/:id', { preHandler: read }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const [r] = await db.select().from(productRequests).where(eq(productRequests.id, id));
    if (!r) throw notFound('Request');
    assertHotelAccess(ctx, r.hotelId, 'Request');
    const product = r.quotedProductId
      ? (
          await db
            .select({ id: products.id, nameEn: products.nameEn, nameNe: products.nameNe, sku: products.sku })
            .from(products)
            .where(eq(products.id, r.quotedProductId))
        )[0]
      : null;
    return { request: r, quotedProduct: product };
  });

  app.post('/product-requests', { preHandler: guard('requests.create') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        description: z.string().min(3).max(2000),
        quantity: qtyStr,
        unit: z.string().min(1).max(30),
        specifications: z.string().max(2000).nullable().optional(),
        attachmentId: z.uuid().nullable().optional(),
      }),
      req.body,
    );
    const hotelId = ctx.actor.hotelId!;
    if (body.attachmentId) {
      const [a] = await db.select().from(attachments).where(eq(attachments.id, body.attachmentId));
      if (!a || a.hotelId !== hotelId || a.category !== 'request_photo')
        throw badRequest('Invalid attachment');
    }
    const request = await db.transaction(async (tx) => {
      const requestNumber = await nextDocumentNumber(tx, 'product_request');
      const [r] = await tx
        .insert(productRequests)
        .values({ ...body, requestNumber, hotelId, requestedBy: ctx.actor.id })
        .returning();
      await audit(tx, ctx, {
        action: 'product_request.created',
        entityType: 'product_request',
        entityId: r!.id,
        hotelId,
        after: { requestNumber, description: body.description },
      });
      await notifyRoles(tx, ['procurement', 'owner'], {
        kind: 'product_request',
        title: `New product request ${requestNumber}`,
        body: body.description.slice(0, 120),
        link: `/requests/${r!.id}`,
      });
      return r!;
    });
    return { request };
  });

  /** Staff investigate, link a catalog product (create it first if needed) and quote a price. */
  app.patch('/product-requests/:id', { preHandler: guard('requests.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        status: z.enum(['investigating', 'quoted', 'declined']).optional(),
        quotedProductId: z.uuid().nullable().optional(),
        quotedUnitPrice: moneyStr.nullable().optional(),
        responseNote: z.string().max(2000).nullable().optional(),
      }),
      req.body,
    );
    const [before] = await db.select().from(productRequests).where(eq(productRequests.id, id));
    if (!before) throw notFound('Request');
    if (['converted', 'withdrawn'].includes(before.status)) throw conflict(`Request is ${before.status}`);
    const next = { ...before, ...body };
    if (body.status === 'quoted' && (!next.quotedProductId || !next.quotedUnitPrice))
      throw badRequest('A quote needs a product and a unit price');
    const request = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(productRequests)
        .set({ ...body, handledBy: ctx.actor.id, updatedAt: new Date() })
        .where(eq(productRequests.id, id))
        .returning();
      await audit(tx, ctx, {
        action: 'product_request.updated',
        entityType: 'product_request',
        entityId: id,
        hotelId: before.hotelId,
        before,
        after: r,
      });
      if (body.status === 'quoted' || body.status === 'declined') {
        await notifyRoles(
          tx,
          ['hotel_manager', 'hotel_purchaser'],
          {
            kind: `product_request_${body.status}`,
            title: `Request ${before.requestNumber} ${body.status}`,
            link: `/requests/${id}`,
          },
          before.hotelId,
        );
      }
      return r!;
    });
    return { request };
  });

  /** The hotel accepts a quote: a draft order is created at the quoted price, ready to submit. */
  app.post(
    '/product-requests/:id/accept',
    { preHandler: guard('requests.create', 'requests.manage') },
    async (req) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParam, req.params);
      const order = await db.transaction(async (tx) => {
        const [r] = await tx.select().from(productRequests).where(eq(productRequests.id, id)).for('update');
        if (!r) throw notFound('Request');
        assertHotelAccess(ctx, r.hotelId, 'Request');
        if (r.status !== 'quoted' || !r.quotedProductId || !r.quotedUnitPrice)
          throw unprocessable('This request has not been quoted yet');
        const [p] = await tx.select().from(products).where(eq(products.id, r.quotedProductId));
        const [tax] = await tx.select().from(taxRates).where(eq(taxRates.code, p!.taxCode));
        const subtotal = lineAmount(r.quantity, r.quotedUnitPrice);
        const taxTotal = percentOf(subtotal, tax!.ratePercent);
        const orderNumber = await nextDocumentNumber(tx, 'order');
        const [o] = await tx
          .insert(orders)
          .values({
            orderNumber,
            hotelId: r.hotelId,
            createdBy: ctx.actor.id,
            sourceRequestId: r.id,
            subtotal,
            taxTotal,
            total: addMoney(subtotal, taxTotal),
          })
          .returning();
        await tx.insert(orderLines).values({
          orderId: o!.id,
          lineNo: 1,
          productId: p!.id,
          nameEn: p!.nameEn,
          nameNe: p!.nameNe,
          unit: p!.sellingUnit,
          quantity: r.quantity,
          unitPrice: r.quotedUnitPrice,
          priceSource: 'request_quote',
          taxCode: tax!.code,
          taxRate: tax!.ratePercent,
          lineSubtotal: subtotal,
        });
        await tx
          .update(productRequests)
          .set({ status: 'converted', convertedOrderId: o!.id, updatedAt: new Date() })
          .where(eq(productRequests.id, id));
        await addOrderEvent(tx, ctx, o!.id, {
          to: 'draft',
          event: 'created',
          note: `From request ${r.requestNumber}`,
        });
        await audit(tx, ctx, {
          action: 'product_request.converted',
          entityType: 'product_request',
          entityId: id,
          hotelId: r.hotelId,
          after: { orderId: o!.id, orderNumber },
        });
        return o!;
      });
      return { order };
    },
  );

  app.post('/product-requests/:id/withdraw', { preHandler: guard('requests.create') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(productRequests).where(eq(productRequests.id, id)).for('update');
      if (!r) throw notFound('Request');
      assertHotelAccess(ctx, r.hotelId, 'Request');
      if (['converted', 'declined', 'withdrawn'].includes(r.status)) throw conflict(`Request is ${r.status}`);
      await tx
        .update(productRequests)
        .set({ status: 'withdrawn', updatedAt: new Date() })
        .where(eq(productRequests.id, id));
      await audit(tx, ctx, {
        action: 'product_request.withdrawn',
        entityType: 'product_request',
        entityId: id,
        hotelId: r.hotelId,
      });
    });
    return { ok: true };
  });
}
