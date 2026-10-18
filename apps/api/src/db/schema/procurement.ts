import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { PO_COMMITTED_STATUSES, PO_STATUSES } from '@hp/shared';
import { createdAt, inList, money, percent, pk, qty, ts, updatedAt } from './_helpers';
import { users } from './auth';
import { hotels } from './hotels';
import { products, suppliers, supplierQuotations } from './catalog';
import { orderLines } from './orders';
import { approvalRequests } from './system';

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: pk(),
    poNumber: text('po_number').notNull().unique(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    status: text('status', { enum: PO_STATUSES }).notNull().default('draft'),
    /** hub: goods come to our consolidation hub. direct: supplier delivers straight to a hotel. */
    fulfillment: text('fulfillment', { enum: ['hub', 'direct'] })
      .notNull()
      .default('hub'),
    directHotelId: uuid('direct_hotel_id').references(() => hotels.id),
    expectedDate: date('expected_date'),
    subtotal: money('subtotal').notNull().default('0.00'),
    taxTotal: money('tax_total').notNull().default('0.00'),
    total: money('total').notNull().default('0.00'),
    notes: text('notes'),
    supplierReference: text('supplier_reference'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    submittedAt: ts('submitted_at'),
    approvalId: uuid('approval_id').references((): any => approvalRequests.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: ts('approved_at'),
    sentAt: ts('sent_at'),
    confirmedAt: ts('confirmed_at'),
    cancelledReason: text('cancelled_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('purchase_orders_status_chk', inList(t.status, PO_STATUSES)),
    // A supplier commitment can never exist without an approval record.
    check(
      'purchase_orders_commit_needs_approval_chk',
      sql`not (${inList(t.status, PO_COMMITTED_STATUSES)}) or (${t.approvedAt} is not null and ${t.approvedBy} is not null)`,
    ),
    check(
      'purchase_orders_direct_chk',
      sql`(${t.fulfillment} = 'direct') = (${t.directHotelId} is not null)`,
    ),
    index('purchase_orders_supplier_idx').on(t.supplierId),
    index('purchase_orders_status_idx').on(t.status),
  ],
);

export const poLines = pgTable(
  'po_lines',
  {
    id: pk(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Customer order line this purchase fulfils. Null for stock purchases. */
    orderLineId: uuid('order_line_id').references(() => orderLines.id),
    quotationId: uuid('quotation_id').references(() => supplierQuotations.id),
    quantity: qty('quantity').notNull(),
    unitCost: money('unit_cost').notNull(),
    taxRate: percent('tax_rate').notNull().default('0.000'),
    lineSubtotal: money('line_subtotal').notNull(),
  },
  (t) => [
    uniqueIndex('po_lines_no_uq').on(t.poId, t.lineNo),
    index('po_lines_order_line_idx').on(t.orderLineId),
    check('po_lines_qty_chk', sql`${t.quantity} > 0`),
    check('po_lines_cost_chk', sql`${t.unitCost} >= 0`),
  ],
);

export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: pk(),
    receiptNumber: text('receipt_number').notNull().unique(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id),
    location: text('location', { enum: ['hub', 'hotel'] })
      .notNull()
      .default('hub'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    receivedBy: uuid('received_by')
      .notNull()
      .references(() => users.id),
    supplierDeliveryNote: text('supplier_delivery_note'),
    notes: text('notes'),
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: createdAt(),
  },
  (t) => [index('goods_receipts_po_idx').on(t.poId)],
);

export const goodsReceiptLines = pgTable(
  'goods_receipt_lines',
  {
    id: pk(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => goodsReceipts.id),
    poLineId: uuid('po_line_id')
      .notNull()
      .references(() => poLines.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Good quantity accepted into stock. */
    qtyAccepted: qty('qty_accepted').notNull(),
    /** Damaged or rejected on inspection; not added to usable stock. */
    qtyDamaged: qty('qty_damaged').notNull().default('0.000'),
    notes: text('notes'),
  },
  (t) => [
    index('goods_receipt_lines_po_line_idx').on(t.poLineId),
    check('goods_receipt_lines_qty_chk', sql`${t.qtyAccepted} >= 0 and ${t.qtyDamaged} >= 0`),
    check('goods_receipt_lines_nonzero_chk', sql`${t.qtyAccepted} + ${t.qtyDamaged} > 0`),
  ],
);
