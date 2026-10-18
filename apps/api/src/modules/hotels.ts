import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { cmpMoney } from '@hp/shared';
import { hotelContracts, hotels, attachments, users } from '../db/schema';
import { HOTEL_STATUSES, HOTEL_TYPES } from '../db/schema/hotels';
import { ctxOf, guard } from '../plugins/auth';
import { assertHotelAccess, can, hotelFilter, type Ctx } from '../lib/context';
import { badRequest, notFound } from '../lib/errors';
import { idParam, parse, parsePatch } from '../lib/http';
import { audit } from '../lib/audit';
import { requestApproval } from './approvals';
import type { DbOrTx } from '../db/client';

const moneyStr = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount with up to 2 decimals');

const hotelBody = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,20}$/, 'Uppercase letters, digits and dashes'),
  legalName: z.string().min(1).max(200),
  tradeName: z.string().max(200).nullable().optional(),
  hotelType: z.enum(HOTEL_TYPES).default('hotel'),
  pan: z
    .string()
    .regex(/^\d{9}$/, 'PAN is 9 digits')
    .nullable()
    .optional(),
  vatNumber: z.string().max(30).nullable().optional(),
  address: z.string().min(1),
  city: z.string().default('Butwal'),
  district: z.string().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.email().nullable().optional(),
  primaryContactName: z.string().nullable().optional(),
  primaryContactPhone: z.string().nullable().optional(),
  deliveryAddress: z.string().nullable().optional(),
  deliveryInstructions: z.string().nullable().optional(),
  deliveryDays: z.array(z.number().int().min(0).max(6)).default([]),
  status: z.enum(HOTEL_STATUSES).default('active'),
  accountManagerId: z.uuid().nullable().optional(),
  requireManagerApproval: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

/** Fields hotel managers may see about their own account. */
function hotelView(ctx: Ctx, h: typeof hotels.$inferSelect) {
  if (can(ctx, 'hotels.read_all')) return h;
  const { notes: _notes, accountManagerId: _a, isDemo: _d, ...rest } = h;
  return rest;
}

/** Apply a credit-term change. Called directly by the owner or when an approval is granted. */
export async function applyCreditTerms(
  tx: DbOrTx,
  ctx: Ctx,
  hotelId: string,
  change: { creditLimit: string; paymentTermsDays: number; reason: string },
  approvalId?: string,
) {
  const [before] = await tx.select().from(hotels).where(eq(hotels.id, hotelId)).for('update');
  if (!before) throw notFound('Hotel');
  const [after] = await tx
    .update(hotels)
    .set({
      creditLimit: change.creditLimit,
      paymentTermsDays: change.paymentTermsDays,
      updatedAt: new Date(),
    })
    .where(eq(hotels.id, hotelId))
    .returning();
  await audit(tx, ctx, {
    action: 'hotel.credit_terms_changed',
    entityType: 'hotel',
    entityId: hotelId,
    hotelId,
    reason: change.reason,
    before: { creditLimit: before.creditLimit, paymentTermsDays: before.paymentTermsDays },
    after: { creditLimit: after!.creditLimit, paymentTermsDays: after!.paymentTermsDays, approvalId },
  });
  return after!;
}

export async function hotelRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/hotels', { preHandler: guard('hotels.read_all', 'hotels.read_own') }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({ q: z.string().optional(), status: z.enum(HOTEL_STATUSES).optional() }),
      req.query,
    );
    const conds = [];
    const own = hotelFilter(ctx);
    if (own) conds.push(eq(hotels.id, own));
    if (q.status) conds.push(eq(hotels.status, q.status));
    if (q.q)
      conds.push(
        or(
          ilike(hotels.legalName, `%${q.q}%`),
          ilike(hotels.tradeName, `%${q.q}%`),
          ilike(hotels.code, `%${q.q}%`),
        ),
      );
    const rows = await db
      .select()
      .from(hotels)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(hotels.legalName));
    return { items: rows.map((h) => hotelView(ctx, h)) };
  });

  app.get('/hotels/:id', { preHandler: guard('hotels.read_all', 'hotels.read_own') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    assertHotelAccess(ctx, id, 'Hotel');
    const [h] = await db.select().from(hotels).where(eq(hotels.id, id));
    if (!h) throw notFound('Hotel');
    const hotelUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.hotelId, id))
      .orderBy(asc(users.name));
    return { hotel: hotelView(ctx, h), users: hotelUsers };
  });

  app.post('/hotels', { preHandler: guard('hotels.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      hotelBody.extend({
        creditLimit: moneyStr.default('0.00'),
        paymentTermsDays: z.number().int().min(0).max(365).optional(),
      }),
      req.body,
    );
    const hotel = await db.transaction(async (tx) => {
      const [h] = await tx
        .insert(hotels)
        .values({ ...body, paymentTermsDays: body.paymentTermsDays ?? 15 })
        .returning();
      await audit(tx, ctx, {
        action: 'hotel.created',
        entityType: 'hotel',
        entityId: h!.id,
        hotelId: h!.id,
        after: h,
      });
      return h!;
    });
    return { hotel };
  });

  app.patch('/hotels/:id', { preHandler: guard('hotels.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parsePatch(hotelBody, req.body);
    const [before] = await db.select().from(hotels).where(eq(hotels.id, id));
    if (!before) throw notFound('Hotel');
    const hotel = await db.transaction(async (tx) => {
      const [h] = await tx
        .update(hotels)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(hotels.id, id))
        .returning();
      await audit(tx, ctx, {
        action: 'hotel.updated',
        entityType: 'hotel',
        entityId: id,
        hotelId: id,
        before,
        after: h,
      });
      return h!;
    });
    return { hotel };
  });

  /**
   * Credit limit and payment terms. The owner's change applies immediately (audited);
   * anyone else with the permission to prepare it creates an approval request.
   */
  app.post('/hotels/:id/credit-terms', { preHandler: guard('credit.request') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        creditLimit: moneyStr,
        paymentTermsDays: z.number().int().min(0).max(365),
        reason: z.string().min(3),
      }),
      req.body,
    );
    const [h] = await db.select().from(hotels).where(eq(hotels.id, id));
    if (!h) throw notFound('Hotel');
    if (ctx.actor.hotelId) throw notFound('Hotel');
    return db.transaction(async (tx) => {
      if (can(ctx, 'approvals.decide')) {
        const hotel = await applyCreditTerms(tx, ctx, id, body);
        return { applied: true, hotel };
      }
      const approval = await requestApproval(tx, ctx, {
        type: 'credit_limit_change',
        targetType: 'hotel',
        targetId: id,
        hotelId: id,
        amount: body.creditLimit,
        summary: `Change credit terms for ${h.legalName}: limit ${h.creditLimit} → ${body.creditLimit}, terms ${h.paymentTermsDays} → ${body.paymentTermsDays} days`,
        details: { ...body, increase: cmpMoney(body.creditLimit, h.creditLimit) > 0 },
      });
      return { applied: false, approval };
    });
  });

  /* ------------------------------ contracts ------------------------------ */

  app.get(
    '/hotels/:id/contracts',
    { preHandler: guard('contracts.read_all', 'contracts.read_own') },
    async (req) => {
      const ctx = ctxOf(req);
      const { id } = parse(idParam, req.params);
      assertHotelAccess(ctx, id, 'Hotel');
      const items = await db
        .select({
          contract: hotelContracts,
          fileName: attachments.fileName,
          uploadedByName: users.name,
        })
        .from(hotelContracts)
        .leftJoin(attachments, eq(attachments.id, hotelContracts.attachmentId))
        .leftJoin(users, eq(users.id, hotelContracts.uploadedBy))
        .where(
          ctx.actor.hotelId
            ? and(eq(hotelContracts.hotelId, id), sql`${hotelContracts.status} <> 'draft'`)
            : eq(hotelContracts.hotelId, id),
        )
        .orderBy(asc(hotelContracts.title), desc(hotelContracts.version));
      return {
        items: items.map((r) => ({ ...r.contract, fileName: r.fileName, uploadedByName: r.uploadedByName })),
      };
    },
  );

  app.post('/hotels/:id/contracts', { preHandler: guard('contracts.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        title: z.string().min(1).max(200),
        effectiveFrom: z.iso.date(),
        effectiveTo: z.iso.date().nullable().optional(),
        termsSummary: z.string().nullable().optional(),
        attachmentId: z.uuid().nullable().optional(),
        status: z.enum(['draft', 'active']).default('active'),
      }),
      req.body,
    );
    if (body.effectiveTo && body.effectiveTo < body.effectiveFrom)
      throw badRequest('End date is before start date');
    const contract = await db.transaction(async (tx) => {
      const [h] = await tx.select({ id: hotels.id }).from(hotels).where(eq(hotels.id, id));
      if (!h) throw notFound('Hotel');
      if (body.attachmentId) {
        const [a] = await tx.select().from(attachments).where(eq(attachments.id, body.attachmentId));
        if (!a || a.category !== 'contract' || (a.hotelId && a.hotelId !== id))
          throw badRequest('Invalid contract file');
        // Contract files of active contracts are visible to the hotel's managers.
        await tx
          .update(attachments)
          .set({ hotelId: id, internalOnly: body.status === 'draft' })
          .where(eq(attachments.id, a.id));
      }
      const [prev] = await tx
        .select({ v: sql<number>`coalesce(max(${hotelContracts.version}), 0)` })
        .from(hotelContracts)
        .where(and(eq(hotelContracts.hotelId, id), eq(hotelContracts.title, body.title)));
      const version = Number(prev?.v ?? 0) + 1;
      if (body.status === 'active') {
        await tx
          .update(hotelContracts)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(hotelContracts.hotelId, id),
              eq(hotelContracts.title, body.title),
              eq(hotelContracts.status, 'active'),
            ),
          );
      }
      const [c] = await tx
        .insert(hotelContracts)
        .values({ ...body, hotelId: id, version, uploadedBy: ctx.actor.id })
        .returning();
      await audit(tx, ctx, {
        action: 'contract.created',
        entityType: 'hotel_contract',
        entityId: c!.id,
        hotelId: id,
        after: c,
      });
      return c!;
    });
    return { contract };
  });
}
