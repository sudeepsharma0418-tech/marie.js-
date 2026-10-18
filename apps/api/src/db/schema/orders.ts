import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ORDER_STATUSES } from '@hp/shared';
import { createdAt, inList, money, percent, pk, qty, ts, updatedAt } from './_helpers';
import { users } from './auth';
import { hotels } from './hotels';
import { products, suppliers, supplierQuotations, units } from './catalog';
import { attachments } from './system';

/** The hotel's customer order. Separate from supplier POs, receipts, deliveries and invoices. */
export const orders = pgTable(
  'orders',
  {
    id: pk(),
    orderNumber: text('order_number').notNull().unique(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('draft'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    submittedBy: uuid('submitted_by').references(() => users.id),
    submittedAt: ts('submitted_at'),
    hotelApprovedBy: uuid('hotel_approved_by').references(() => users.id),
    hotelApprovedAt: ts('hotel_approved_at'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: ts('approved_at'),
    requestedDeliveryDate: date('requested_delivery_date'),
    deliveryWindow: text('delivery_window', { enum: ['morning', 'afternoon', 'any'] })
      .notNull()
      .default('any'),
    deliveryNotes: text('delivery_notes'),
    /** Estimated totals at agreed selling prices, before invoicing. */
    subtotal: money('subtotal').notNull().default('0.00'),
    taxTotal: money('tax_total').notNull().default('0.00'),
    total: money('total').notNull().default('0.00'),
    /** Snapshot of the credit check made when the order was submitted. */
    creditCheck: jsonb('credit_check'),
    cancelledReason: text('cancelled_reason'),
    sourceRequestId: uuid('source_request_id'),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('orders_status_chk', inList(t.status, ORDER_STATUSES)),
    index('orders_hotel_idx').on(t.hotelId, t.createdAt),
    index('orders_status_idx').on(t.status),
    uniqueIndex('orders_idempotency_uq').on(t.hotelId, t.idempotencyKey),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: pk(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    nameEn: text('name_en').notNull(),
    nameNe: text('name_ne').notNull(),
    unit: text('unit')
      .notNull()
      .references(() => units.code),
    quantity: qty('quantity').notNull(),
    /** Selling price per unit agreed for this line (tax exclusive). */
    unitPrice: money('unit_price').notNull(),
    /** Which pricing rule produced the price, or "override". */
    priceSource: text('price_source').notNull(),
    taxCode: text('tax_code').notNull(),
    taxRate: percent('tax_rate').notNull(),
    lineSubtotal: money('line_subtotal').notNull(),
    cancelledQty: qty('cancelled_qty').notNull().default('0.000'),
    /** Internal only: supplier selected by procurement staff and the expected cost. */
    selectedSupplierId: uuid('selected_supplier_id').references(() => suppliers.id),
    selectedQuotationId: uuid('selected_quotation_id').references(() => supplierQuotations.id),
    expectedUnitCost: money('expected_unit_cost'),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('order_lines_no_uq').on(t.orderId, t.lineNo),
    index('order_lines_product_idx').on(t.productId),
    check('order_lines_qty_chk', sql`${t.quantity} > 0`),
    check('order_lines_price_chk', sql`${t.unitPrice} >= 0`),
    check('order_lines_cancel_chk', sql`${t.cancelledQty} >= 0 and ${t.cancelledQty} <= ${t.quantity}`),
  ],
);

/** Order timeline. Events with visibleToHotel = false are internal notes. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: pk(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    event: text('event').notNull(),
    note: text('note'),
    visibleToHotel: boolean('visible_to_hotel').notNull().default(true),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);

export const PRODUCT_REQUEST_STATUSES = [
  'open',
  'investigating',
  'quoted',
  'converted',
  'declined',
  'withdrawn',
] as const;

/** Requests from hotels for items not in the catalog. */
export const productRequests = pgTable(
  'product_requests',
  {
    id: pk(),
    requestNumber: text('request_number').notNull().unique(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    description: text('description').notNull(),
    quantity: qty('quantity').notNull(),
    unit: text('unit').notNull(),
    specifications: text('specifications'),
    attachmentId: uuid('attachment_id').references((): any => attachments.id),
    status: text('status', { enum: PRODUCT_REQUEST_STATUSES }).notNull().default('open'),
    quotedProductId: uuid('quoted_product_id').references(() => products.id),
    quotedUnitPrice: money('quoted_unit_price'),
    responseNote: text('response_note'),
    convertedOrderId: uuid('converted_order_id').references(() => orders.id),
    handledBy: uuid('handled_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('product_requests_status_chk', inList(t.status, PRODUCT_REQUEST_STATUSES)),
    check('product_requests_qty_chk', sql`${t.quantity} > 0`),
    index('product_requests_hotel_idx').on(t.hotelId, t.createdAt),
  ],
);
