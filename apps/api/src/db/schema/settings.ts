import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { money, percent, ts, updatedAt, pk, createdAt } from './_helpers';

/** Single row (id = 1) of company wide configuration. */
export const companySettings = pgTable(
  'company_settings',
  {
    id: integer('id').primaryKey().default(1),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    pan: text('pan'),
    vatNumber: text('vat_number'),
    vatRegistered: boolean('vat_registered').notNull().default(false),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    currency: text('currency').notNull().default('NPR'),
    timezone: text('timezone').notNull().default('Asia/Kathmandu'),
    /** Label of the current Nepali fiscal year, e.g. "2083/84". Set by an administrator. */
    fiscalYearLabel: text('fiscal_year_label').notNull(),
    defaultMarkupPercent: percent('default_markup_percent').notNull().default('15.000'),
    defaultPaymentTermsDays: integer('default_payment_terms_days').notNull().default(15),
    /** Supplier POs with a total at or above this amount need owner approval. 0 = every PO. */
    poApprovalThreshold: money('po_approval_threshold').notNull().default('0.00'),
    /** Manual selling price changes deviating more than this % from the rule price need owner approval. */
    priceOverrideThresholdPercent: percent('price_override_threshold_percent').notNull().default('5.000'),
    /** Days after due date before an invoice counts as overdue for credit control. */
    creditOverdueGraceDays: integer('credit_overdue_grace_days').notNull().default(0),
    /** Hub stock adjustments decreasing value above this need owner approval (write off). */
    writeOffApprovalThreshold: money('write_off_approval_threshold').notNull().default('0.00'),
    /** on_delivery: a draft invoice is generated when a delivery is confirmed. manual: staff create invoices. */
    invoiceTrigger: text('invoice_trigger', { enum: ['on_delivery', 'manual'] })
      .notNull()
      .default('on_delivery'),
    allowOwnerSelfApproval: boolean('allow_owner_self_approval').notNull().default(true),
    mfaEnforced: boolean('mfa_enforced').notNull().default(false),
    sessionHours: integer('session_hours').notNull().default(12),
    offlineAccessHours: integer('offline_access_hours').notNull().default(72),
    invoiceFooter: text('invoice_footer'),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [check('company_settings_singleton', sql`${t.id} = 1`)],
);

export const taxRates = pgTable('tax_rates', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  ratePercent: percent('rate_percent').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  /** True until a qualified Nepal accountant has confirmed this rate and its use. */
  requiresVerification: boolean('requires_verification').notNull().default(true),
  notes: text('notes'),
  updatedAt: updatedAt(),
});

export const DOC_TYPES = [
  'order',
  'product_request',
  'purchase_order',
  'goods_receipt',
  'delivery_run',
  'delivery',
  'invoice',
  'credit_note',
  'payment_in',
  'payment_out',
  'supplier_bill',
] as const;

/** Gapless numbering per document type and fiscal year, allocated under a row lock. */
export const documentSeries = pgTable(
  'document_series',
  {
    id: pk(),
    docType: text('doc_type', { enum: DOC_TYPES }).notNull(),
    fiscalYear: text('fiscal_year').notNull(),
    prefix: text('prefix').notNull(),
    nextNumber: integer('next_number').notNull().default(1),
    padding: integer('padding').notNull().default(5),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('document_series_uq').on(t.docType, t.fiscalYear)],
);

export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
