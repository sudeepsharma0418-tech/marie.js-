import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, inList, money, pk, qty, updatedAt } from './_helpers';
import { users } from './auth';
import { hotels } from './hotels';
import { taxRates } from './settings';
import { attachments, approvalRequests } from './system';

export const suppliers = pgTable(
  'suppliers',
  {
    id: pk(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    pan: text('pan'),
    vatNumber: text('vat_number'),
    address: text('address'),
    city: text('city'),
    phone: text('phone'),
    email: text('email'),
    contactName: text('contact_name'),
    leadTimeDays: integer('lead_time_days').notNull().default(1),
    paymentTermsDays: integer('payment_terms_days').notNull().default(0),
    termsNotes: text('terms_notes'),
    status: text('status', { enum: ['active', 'inactive', 'blocked'] })
      .notNull()
      .default('active'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('suppliers_name_idx').on(t.name)],
);

export const supplierContacts = pgTable('supplier_contacts', {
  id: pk(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  name: text('name').notNull(),
  position: text('position'),
  phone: text('phone'),
  email: text('email'),
  createdAt: createdAt(),
});

export const categories = pgTable(
  'categories',
  {
    id: pk(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
    code: text('code').notNull().unique(),
    nameEn: text('name_en').notNull(),
    nameNe: text('name_ne').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const units = pgTable('units', {
  code: text('code').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameNe: text('name_ne').notNull(),
});

export const products = pgTable(
  'products',
  {
    id: pk(),
    sku: text('sku').notNull().unique(),
    barcode: text('barcode'),
    nameEn: text('name_en').notNull(),
    nameNe: text('name_ne').notNull(),
    descriptionEn: text('description_en'),
    descriptionNe: text('description_ne'),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    brand: text('brand'),
    specifications: text('specifications'),
    imageAttachmentId: uuid('image_attachment_id').references((): AnyPgColumn => attachments.id),
    sellingUnit: text('selling_unit')
      .notNull()
      .references(() => units.code),
    purchaseUnit: text('purchase_unit')
      .notNull()
      .references(() => units.code),
    /** How many selling units are in one purchase unit (e.g. 1 carton = 24 pcs). */
    unitsPerPurchaseUnit: qty('units_per_purchase_unit').notNull().default('1.000'),
    /** Confidential reference cost per selling unit used by markup rules. Never shown to hotels. */
    referenceCost: money('reference_cost').notNull().default('0.00'),
    taxCode: text('tax_code')
      .notNull()
      .references(() => taxRates.code),
    minOrderQty: qty('min_order_qty').notNull().default('1.000'),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    index('products_name_en_idx').on(t.nameEn),
    check('products_cost_chk', sql`${t.referenceCost} >= 0`),
    check('products_upu_chk', sql`${t.unitsPerPurchaseUnit} > 0`),
    check('products_moq_chk', sql`${t.minOrderQty} > 0`),
  ],
);

export const supplierProducts = pgTable(
  'supplier_products',
  {
    id: pk(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    supplierSku: text('supplier_sku'),
    lastUnitCost: money('last_unit_cost'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('supplier_products_uq').on(t.supplierId, t.productId)],
);

/** Manually entered supplier quotes. Costs are per selling unit of the product. Confidential. */
export const supplierQuotations = pgTable(
  'supplier_quotations',
  {
    id: pk(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    orderId: uuid('order_id'),
    productRequestId: uuid('product_request_id'),
    unitCost: money('unit_cost').notNull(),
    /** Supplier reported availability. Unverified until goods are received. */
    availableQty: qty('available_qty'),
    availabilityNote: text('availability_note'),
    leadTimeDays: integer('lead_time_days'),
    validUntil: date('valid_until'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('supplier_quotations_product_idx').on(t.productId, t.createdAt),
    index('supplier_quotations_order_idx').on(t.orderId),
    check('supplier_quotations_cost_chk', sql`${t.unitCost} >= 0`),
  ],
);

export const PRICING_SCOPES = [
  'default',
  'category',
  'product',
  'hotel',
  'hotel_category',
  'hotel_product',
] as const;

export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: pk(),
    scope: text('scope', { enum: PRICING_SCOPES }).notNull(),
    hotelId: uuid('hotel_id').references(() => hotels.id),
    categoryId: uuid('category_id').references(() => categories.id),
    productId: uuid('product_id').references(() => products.id),
    ruleType: text('rule_type', { enum: ['markup_percent', 'fixed_price'] }).notNull(),
    /** Markup percent, or a fixed selling price per selling unit. */
    value: qty('value').notNull(),
    validFrom: date('valid_from')
      .notNull()
      .default(sql`current_date`),
    validTo: date('valid_to'),
    isActive: boolean('is_active').notNull().default(true),
    reason: text('reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    approvalId: uuid('approval_id').references((): AnyPgColumn => approvalRequests.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('pricing_rules_scope_chk', inList(t.scope, PRICING_SCOPES)),
    check('pricing_rules_value_chk', sql`${t.value} >= 0`),
    check(
      'pricing_rules_targets_chk',
      sql`(
        (${t.scope} = 'default' and ${t.hotelId} is null and ${t.categoryId} is null and ${t.productId} is null) or
        (${t.scope} = 'category' and ${t.hotelId} is null and ${t.categoryId} is not null and ${t.productId} is null) or
        (${t.scope} = 'product' and ${t.hotelId} is null and ${t.categoryId} is null and ${t.productId} is not null) or
        (${t.scope} = 'hotel' and ${t.hotelId} is not null and ${t.categoryId} is null and ${t.productId} is null) or
        (${t.scope} = 'hotel_category' and ${t.hotelId} is not null and ${t.categoryId} is not null and ${t.productId} is null) or
        (${t.scope} = 'hotel_product' and ${t.hotelId} is not null and ${t.categoryId} is null and ${t.productId} is not null)
      )`,
    ),
    check(
      'pricing_rules_fixed_needs_product_chk',
      sql`${t.ruleType} = 'markup_percent' or ${t.scope} in ('product', 'hotel_product')`,
    ),
    index('pricing_rules_lookup_idx').on(t.scope, t.hotelId, t.categoryId, t.productId),
  ],
);

/** Append-only history of price and cost changes. */
export const priceHistory = pgTable(
  'price_history',
  {
    id: pk(),
    entity: text('entity', { enum: ['pricing_rule', 'product_cost', 'order_line'] }).notNull(),
    entityId: uuid('entity_id').notNull(),
    productId: uuid('product_id'),
    hotelId: uuid('hotel_id'),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    reason: text('reason'),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id),
    approvalId: uuid('approval_id'),
    createdAt: createdAt(),
  },
  (t) => [index('price_history_product_idx').on(t.productId, t.createdAt)],
);
