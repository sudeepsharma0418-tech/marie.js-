import { sql } from 'drizzle-orm';
import {
  bigserial,
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
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { PAYMENT_METHODS } from '@hp/shared';
import { createdAt, inList, money, percent, pk, qty, ts, updatedAt } from './_helpers';
import { users } from './auth';
import { hotels } from './hotels';
import { products, suppliers } from './catalog';
import { orderLines, orders } from './orders';
import { poLines, purchaseOrders } from './procurement';
import { deliveryLines } from './inventory';
import { approvalRequests, attachments } from './system';

/* ------------------------------------------------------------------ */
/* Accounts receivable                                                 */
/* ------------------------------------------------------------------ */

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    /** Assigned from the gapless series only when the invoice is issued. */
    invoiceNumber: text('invoice_number').unique(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    orderId: uuid('order_id').references(() => orders.id),
    status: text('status', { enum: ['draft', 'issued', 'discarded'] })
      .notNull()
      .default('draft'),
    fiscalYear: text('fiscal_year'),
    invoiceDate: date('invoice_date'),
    dueDate: date('due_date'),
    taxableTotal: money('taxable_total').notNull().default('0.00'),
    exemptTotal: money('exempt_total').notNull().default('0.00'),
    taxTotal: money('tax_total').notNull().default('0.00'),
    total: money('total').notNull().default('0.00'),
    /** Frozen copies of seller and customer details at issue time. */
    sellerSnapshot: jsonb('seller_snapshot'),
    customerSnapshot: jsonb('customer_snapshot'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    issuedBy: uuid('issued_by').references(() => users.id),
    issuedAt: ts('issued_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'invoices_issued_fields_chk',
      sql`${t.status} <> 'issued' or (${t.invoiceNumber} is not null and ${t.invoiceDate} is not null and ${t.dueDate} is not null and ${t.issuedAt} is not null)`,
    ),
    check('invoices_total_chk', sql`${t.total} >= 0`),
    index('invoices_hotel_idx').on(t.hotelId, t.status),
    index('invoices_order_idx').on(t.orderId),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: pk(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    lineNo: integer('line_no').notNull(),
    orderLineId: uuid('order_line_id').references(() => orderLines.id),
    deliveryLineId: uuid('delivery_line_id').references(() => deliveryLines.id),
    productId: uuid('product_id').references(() => products.id),
    descriptionEn: text('description_en').notNull(),
    descriptionNe: text('description_ne'),
    unit: text('unit').notNull(),
    quantity: qty('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
    taxCode: text('tax_code').notNull(),
    taxRate: percent('tax_rate').notNull(),
    taxableAmount: money('taxable_amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    lineTotal: money('line_total').notNull(),
  },
  (t) => [
    uniqueIndex('invoice_lines_no_uq').on(t.invoiceId, t.lineNo),
    index('invoice_lines_order_line_idx').on(t.orderLineId),
    check('invoice_lines_qty_chk', sql`${t.quantity} > 0`),
  ],
);

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: pk(),
    creditNoteNumber: text('credit_note_number').unique(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    status: text('status', { enum: ['draft', 'issued', 'discarded'] })
      .notNull()
      .default('draft'),
    reason: text('reason').notNull(),
    noteDate: date('note_date'),
    fiscalYear: text('fiscal_year'),
    taxableTotal: money('taxable_total').notNull().default('0.00'),
    taxTotal: money('tax_total').notNull().default('0.00'),
    total: money('total').notNull().default('0.00'),
    sellerSnapshot: jsonb('seller_snapshot'),
    customerSnapshot: jsonb('customer_snapshot'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    issuedBy: uuid('issued_by').references(() => users.id),
    issuedAt: ts('issued_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'credit_notes_issued_chk',
      sql`${t.status} <> 'issued' or (${t.creditNoteNumber} is not null and ${t.noteDate} is not null)`,
    ),
    index('credit_notes_invoice_idx').on(t.invoiceId),
  ],
);

export const creditNoteLines = pgTable('credit_note_lines', {
  id: pk(),
  creditNoteId: uuid('credit_note_id')
    .notNull()
    .references(() => creditNotes.id),
  invoiceLineId: uuid('invoice_line_id').references(() => invoiceLines.id),
  descriptionEn: text('description_en').notNull(),
  quantity: qty('quantity').notNull(),
  unitPrice: money('unit_price').notNull(),
  taxRate: percent('tax_rate').notNull(),
  taxableAmount: money('taxable_amount').notNull(),
  taxAmount: money('tax_amount').notNull(),
  lineTotal: money('line_total').notNull(),
});

/* ------------------------------------------------------------------ */
/* Accounts payable                                                    */
/* ------------------------------------------------------------------ */

export const supplierBills = pgTable(
  'supplier_bills',
  {
    id: pk(),
    internalRef: text('internal_ref').notNull().unique(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    /** The supplier's own invoice/bill number. */
    supplierBillNumber: text('supplier_bill_number').notNull(),
    poId: uuid('po_id').references(() => purchaseOrders.id),
    status: text('status', { enum: ['draft', 'posted', 'discarded'] })
      .notNull()
      .default('draft'),
    billDate: date('bill_date').notNull(),
    dueDate: date('due_date').notNull(),
    taxableTotal: money('taxable_total').notNull().default('0.00'),
    taxTotal: money('tax_total').notNull().default('0.00'),
    total: money('total').notNull().default('0.00'),
    attachmentId: uuid('attachment_id').references((): AnyPgColumn => attachments.id),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    postedBy: uuid('posted_by').references(() => users.id),
    postedAt: ts('posted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('supplier_bills_number_uq').on(t.supplierId, t.supplierBillNumber),
    index('supplier_bills_supplier_idx').on(t.supplierId, t.status),
    check('supplier_bills_due_chk', sql`${t.dueDate} >= ${t.billDate}`),
  ],
);

export const supplierBillLines = pgTable('supplier_bill_lines', {
  id: pk(),
  billId: uuid('bill_id')
    .notNull()
    .references(() => supplierBills.id),
  lineNo: integer('line_no').notNull(),
  poLineId: uuid('po_line_id').references(() => poLines.id),
  productId: uuid('product_id').references(() => products.id),
  description: text('description').notNull(),
  quantity: qty('quantity').notNull(),
  unitCost: money('unit_cost').notNull(),
  taxRate: percent('tax_rate').notNull(),
  taxableAmount: money('taxable_amount').notNull(),
  taxAmount: money('tax_amount').notNull(),
  lineTotal: money('line_total').notNull(),
});

/* ------------------------------------------------------------------ */
/* Payments (recorded manually; money moves outside the platform)      */
/* ------------------------------------------------------------------ */

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    paymentNumber: text('payment_number').notNull().unique(),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    hotelId: uuid('hotel_id').references(() => hotels.id),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    amount: money('amount').notNull(),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    reference: text('reference'),
    paymentDate: date('payment_date').notNull(),
    notes: text('notes'),
    attachmentId: uuid('attachment_id').references((): AnyPgColumn => attachments.id),
    status: text('status', { enum: ['recorded', 'reversed'] })
      .notNull()
      .default('recorded'),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id),
    reversedBy: uuid('reversed_by').references(() => users.id),
    reversedAt: ts('reversed_at'),
    reversalReason: text('reversal_reason'),
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check('payments_amount_chk', sql`${t.amount} > 0`),
    check('payments_method_chk', inList(t.method, PAYMENT_METHODS)),
    check(
      'payments_party_chk',
      sql`(${t.direction} = 'inbound' and ${t.hotelId} is not null and ${t.supplierId} is null)
        or (${t.direction} = 'outbound' and ${t.supplierId} is not null and ${t.hotelId} is null)`,
    ),
    // the same bank/cheque reference cannot be recorded twice for one party
    uniqueIndex('payments_reference_uq')
      .on(t.direction, sql`coalesce(${t.hotelId}, ${t.supplierId})`, t.method, sql`lower(${t.reference})`)
      .where(sql`${t.reference} is not null and ${t.status} = 'recorded'`),
    index('payments_hotel_idx').on(t.hotelId),
    index('payments_supplier_idx').on(t.supplierId),
  ],
);

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: pk(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    billId: uuid('bill_id').references(() => supplierBills.id),
    amount: money('amount').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    reversedAt: ts('reversed_at'),
  },
  (t) => [
    check('payment_allocations_amount_chk', sql`${t.amount} > 0`),
    check('payment_allocations_target_chk', sql`(${t.invoiceId} is null) <> (${t.billId} is null)`),
    index('payment_allocations_invoice_idx').on(t.invoiceId),
    index('payment_allocations_bill_idx').on(t.billId),
    index('payment_allocations_payment_idx').on(t.paymentId),
  ],
);

/** Authorized write-offs and corrections that are not invoices, credit notes or payments. */
export const financialAdjustments = pgTable('financial_adjustments', {
  id: pk(),
  account: text('account', { enum: ['accounts_receivable', 'accounts_payable'] }).notNull(),
  hotelId: uuid('hotel_id').references(() => hotels.id),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  /** Positive increases the balance owed, negative decreases it. */
  amount: money('amount').notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['pending_approval', 'posted', 'rejected'] })
    .notNull()
    .default('pending_approval'),
  approvalId: uuid('approval_id').references((): AnyPgColumn => approvalRequests.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  postedAt: ts('posted_at'),
});

export const LEDGER_SOURCES = [
  'invoice',
  'credit_note',
  'payment',
  'payment_reversal',
  'supplier_bill',
  'adjustment',
] as const;

/**
 * Append-only subledger. Every posted financial document writes here in the same
 * transaction. AR balance = SUM(debit - credit); AP balance = SUM(credit - debit).
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entryDate: date('entry_date').notNull(),
    account: text('account', { enum: ['accounts_receivable', 'accounts_payable'] }).notNull(),
    partyType: text('party_type', { enum: ['hotel', 'supplier'] }).notNull(),
    partyId: uuid('party_id').notNull(),
    sourceType: text('source_type', { enum: LEDGER_SOURCES }).notNull(),
    sourceId: uuid('source_id').notNull(),
    reference: text('reference'),
    debit: money('debit').notNull().default('0.00'),
    credit: money('credit').notNull().default('0.00'),
    memo: text('memo'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'ledger_amounts_chk',
      sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} > 0) <> (${t.credit} > 0)`,
    ),
    check(
      'ledger_party_chk',
      sql`(${t.account} = 'accounts_receivable' and ${t.partyType} = 'hotel') or (${t.account} = 'accounts_payable' and ${t.partyType} = 'supplier')`,
    ),
    uniqueIndex('ledger_source_uq').on(t.sourceType, t.sourceId, t.account),
    index('ledger_party_idx').on(t.partyType, t.partyId, t.entryDate),
  ],
);
