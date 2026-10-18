import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { companySettings, documentSeries, taxRates, units } from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { notFound } from '../lib/errors';
import { parse } from '../lib/http';
import { audit } from '../lib/audit';
import { getSettings } from '../lib/settings';

const decimal = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Must be a non-negative number');
const moneyStr = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be an amount with up to 2 decimals');

export async function settingsRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/settings', { preHandler: guard('settings.manage') }, async () => ({
    settings: await getSettings(db),
  }));

  app.patch('/settings', { preHandler: guard('settings.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z
        .object({
          legalName: z.string().min(1),
          tradeName: z.string().nullable(),
          pan: z.string().nullable(),
          vatNumber: z.string().nullable(),
          vatRegistered: z.boolean(),
          address: z.string().nullable(),
          phone: z.string().nullable(),
          email: z.string().nullable(),
          fiscalYearLabel: z.string().regex(/^\d{4}\/\d{2}$/, 'Use the form 2083/84'),
          defaultMarkupPercent: decimal,
          defaultPaymentTermsDays: z.number().int().min(0).max(365),
          poApprovalThreshold: moneyStr,
          priceOverrideThresholdPercent: decimal,
          creditOverdueGraceDays: z.number().int().min(0).max(365),
          writeOffApprovalThreshold: moneyStr,
          invoiceTrigger: z.enum(['on_delivery', 'manual']),
          allowOwnerSelfApproval: z.boolean(),
          mfaEnforced: z.boolean(),
          sessionHours: z.number().int().min(1).max(168),
          offlineAccessHours: z.number().int().min(1).max(720),
          invoiceFooter: z.string().nullable(),
        })
        .partial(),
      req.body,
    );
    const before = await getSettings(db);
    const after = await db.transaction(async (tx) => {
      const [s] = await tx
        .update(companySettings)
        .set({ ...body, updatedAt: new Date(), updatedBy: ctx.actor.id })
        .where(eq(companySettings.id, 1))
        .returning();
      await audit(tx, ctx, {
        action: 'settings.updated',
        entityType: 'company_settings',
        entityId: 1,
        before,
        after: s,
      });
      return s!;
    });
    return { settings: after };
  });

  app.get('/tax-rates', { preHandler: guard() }, async () => ({
    items: await db.select().from(taxRates).orderBy(asc(taxRates.code)),
  }));

  app.put('/tax-rates/:code', { preHandler: guard('tax.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { code } = parse(z.object({ code: z.string().regex(/^[A-Z0-9_]{2,20}$/) }), req.params);
    const body = parse(
      z.object({
        name: z.string().min(1),
        ratePercent: decimal,
        isActive: z.boolean().default(true),
        requiresVerification: z.boolean().default(true),
        notes: z.string().nullable().optional(),
      }),
      req.body,
    );
    const [before] = await db.select().from(taxRates).where(eq(taxRates.code, code));
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(taxRates)
        .values({ code, ...body })
        .onConflictDoUpdate({ target: taxRates.code, set: { ...body, updatedAt: new Date() } })
        .returning();
      await audit(tx, ctx, {
        action: before ? 'tax_rate.updated' : 'tax_rate.created',
        entityType: 'tax_rate',
        entityId: code,
        before,
        after: r,
      });
      return r!;
    });
    return { taxRate: row };
  });

  app.get('/units', { preHandler: guard() }, async () => ({
    items: await db.select().from(units).orderBy(asc(units.code)),
  }));

  app.get('/document-series', { preHandler: guard('settings.manage') }, async () => ({
    items: await db.select().from(documentSeries).orderBy(asc(documentSeries.docType)),
  }));

  app.patch('/document-series/:id', { preHandler: guard('settings.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(
      z.object({
        prefix: z
          .string()
          .regex(/^[A-Z]{1,8}$/)
          .optional(),
        padding: z.number().int().min(3).max(10).optional(),
      }),
      req.body,
    );
    const [before] = await db.select().from(documentSeries).where(eq(documentSeries.id, id));
    if (!before) throw notFound('Series');
    const [after] = await db.transaction(async (tx) => {
      const r = await tx.update(documentSeries).set(body).where(eq(documentSeries.id, id)).returning();
      await audit(tx, ctx, {
        action: 'document_series.updated',
        entityType: 'document_series',
        entityId: id,
        before,
        after: r[0],
      });
      return r;
    });
    return { series: after };
  });
}
