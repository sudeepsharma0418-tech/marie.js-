import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  bigserial,
  time,
  date,
} from 'drizzle-orm/pg-core';
import { DELIVERY_STATUSES, HOTEL_MOVEMENT_TYPES, HUB_MOVEMENT_TYPES } from '@hp/shared';
import { createdAt, inList, pk, qty, ts, updatedAt } from './_helpers';
import { users } from './auth';
import { hotels } from './hotels';
import { products } from './catalog';
import { orderLines, orders } from './orders';
import { goodsReceiptLines, purchaseOrders } from './procurement';
import { approvalRequests, attachments } from './system';

/* ------------------------------------------------------------------ */
/* Hub (cross-docking / consolidation)                                 */
/* ------------------------------------------------------------------ */

/**
 * Append-only physical stock ledger for the hub. On-hand = SUM(quantity).
 * Supplier-reported availability is NOT stock; only receipts create stock.
 */
export const hubStockMovements = pgTable(
  'hub_stock_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    movementType: text('movement_type', { enum: HUB_MOVEMENT_TYPES }).notNull(),
    /** Signed quantity in selling units. */
    quantity: qty('quantity').notNull(),
    receiptLineId: uuid('receipt_line_id').references(() => goodsReceiptLines.id),
    deliveryLineId: uuid('delivery_line_id'),
    orderLineId: uuid('order_line_id').references(() => orderLines.id),
    bin: text('bin'),
    reason: text('reason'),
    approvalId: uuid('approval_id').references((): any => approvalRequests.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('hub_movements_type_chk', inList(t.movementType, HUB_MOVEMENT_TYPES)),
    check('hub_movements_nonzero_chk', sql`${t.quantity} <> 0`),
    check(
      'hub_movements_sign_chk',
      sql`(${t.movementType} in ('receipt', 'delivery_return') and ${t.quantity} > 0)
        or (${t.movementType} in ('dispatch', 'return_to_supplier', 'write_off') and ${t.quantity} < 0)
        or ${t.movementType} = 'adjustment'`,
    ),
    index('hub_movements_product_idx').on(t.productId, t.createdAt),
  ],
);

/**
 * Append-only reservation ledger: hub stock set aside for a customer order line.
 * Reserved for a line = SUM(quantity). Receipt against an order-linked PO line
 * reserves; dispatch and cancellation release.
 */
export const hubReservations = pgTable(
  'hub_reservations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => orderLines.id),
    quantity: qty('quantity').notNull(),
    reason: text('reason', {
      enum: ['receipt', 'manual', 'dispatch', 'release', 'delivery_return'],
    }).notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('hub_reservations_nonzero_chk', sql`${t.quantity} <> 0`),
    index('hub_reservations_line_idx').on(t.orderLineId),
    index('hub_reservations_product_idx').on(t.productId),
  ],
);

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

export const deliveryRuns = pgTable(
  'delivery_runs',
  {
    id: pk(),
    runNumber: text('run_number').notNull().unique(),
    scheduledDate: date('scheduled_date').notNull(),
    windowStart: time('window_start'),
    windowEnd: time('window_end'),
    driverId: uuid('driver_id').references(() => users.id),
    vehicle: text('vehicle'),
    routeNotes: text('route_notes'),
    status: text('status', { enum: ['planned', 'in_progress', 'completed', 'cancelled'] })
      .notNull()
      .default('planned'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('delivery_runs_date_idx').on(t.scheduledDate),
    index('delivery_runs_driver_idx').on(t.driverId),
  ],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: pk(),
    deliveryNumber: text('delivery_number').notNull().unique(),
    runId: uuid('run_id').references(() => deliveryRuns.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    /** Set for supplier-direct deliveries (no hub dispatch). */
    directPoId: uuid('direct_po_id').references(() => purchaseOrders.id),
    status: text('status', { enum: DELIVERY_STATUSES }).notNull().default('scheduled'),
    stopOrder: text('stop_order'),
    instructions: text('instructions'),
    dispatchedAt: ts('dispatched_at'),
    dispatchedBy: uuid('dispatched_by').references(() => users.id),
    deliveredAt: ts('delivered_at'),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    recipientName: text('recipient_name'),
    recipientPhone: text('recipient_phone'),
    signatureAttachmentId: uuid('signature_attachment_id').references((): any => attachments.id),
    photoAttachmentId: uuid('photo_attachment_id').references((): any => attachments.id),
    failureReason: text('failure_reason'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('deliveries_status_chk', inList(t.status, DELIVERY_STATUSES)),
    index('deliveries_order_idx').on(t.orderId),
    index('deliveries_run_idx').on(t.runId),
    index('deliveries_hotel_idx').on(t.hotelId),
  ],
);

export const deliveryLines = pgTable(
  'delivery_lines',
  {
    id: pk(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id),
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => orderLines.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    qtyDispatched: qty('qty_dispatched').notNull(),
    qtyDelivered: qty('qty_delivered'),
    qtyDamaged: qty('qty_damaged').notNull().default('0.000'),
    qtyMissing: qty('qty_missing').notNull().default('0.000'),
    /** Goods taken back to the hub (refused, failed delivery). */
    qtyReturned: qty('qty_returned').notNull().default('0.000'),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('delivery_lines_uq').on(t.deliveryId, t.orderLineId),
    check('delivery_lines_dispatched_chk', sql`${t.qtyDispatched} > 0`),
    check(
      'delivery_lines_balance_chk',
      sql`${t.qtyDelivered} is null or (${t.qtyDelivered} >= 0 and ${t.qtyDelivered} + ${t.qtyDamaged} + ${t.qtyMissing} + ${t.qtyReturned} = ${t.qtyDispatched})`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Hotel site inventory (shelf-level QR)                               */
/* ------------------------------------------------------------------ */

export const hotelLocations = pgTable(
  'hotel_locations',
  {
    id: pk(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    parentId: uuid('parent_id').references((): any => hotelLocations.id),
    kind: text('kind', { enum: ['area', 'shelf'] }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Random unguessable token encoded in the shelf QR code. Shelves only. */
    qrToken: text('qr_token').unique(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('hotel_locations_hotel_idx').on(t.hotelId),
    check('hotel_locations_qr_chk', sql`(${t.kind} = 'shelf') = (${t.qrToken} is not null)`),
  ],
);

export const shelfProducts = pgTable(
  'shelf_products',
  {
    id: pk(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => hotelLocations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    defaultUsageQty: qty('default_usage_qty').notNull().default('1.000'),
    minQty: qty('min_qty').notNull().default('0.000'),
    parQty: qty('par_qty'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('shelf_products_uq').on(t.locationId, t.productId),
    check('shelf_products_usage_chk', sql`${t.defaultUsageQty} > 0`),
  ],
);

export const HOTEL_EVENT_STATUSES = ['applied', 'needs_review', 'rejected'] as const;

/**
 * Raw inventory events as submitted by devices (online or offline).
 * The primary key is the client-generated event UUID, which makes sync idempotent.
 */
export const hotelInventoryEvents = pgTable(
  'hotel_inventory_events',
  {
    id: uuid('id').primaryKey(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => hotelLocations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    action: text('action', { enum: ['usage', 'restock', 'correction', 'transfer'] }).notNull(),
    /** Positive quantity for usage, restock and transfer. */
    quantity: qty('quantity'),
    /** For corrections: the physically counted quantity. */
    countedQty: qty('counted_qty'),
    /** Balance the device believed was on the shelf when the action was recorded. */
    baseQty: qty('base_qty'),
    toLocationId: uuid('to_location_id').references(() => hotelLocations.id),
    deliveryId: uuid('delivery_id').references(() => deliveries.id),
    reason: text('reason'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id'),
    source: text('source', { enum: ['online', 'offline_sync'] }).notNull(),
    clientRecordedAt: ts('client_recorded_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    payloadHash: text('payload_hash').notNull(),
    status: text('status', { enum: HOTEL_EVENT_STATUSES }).notNull(),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    reviewNote: text('review_note'),
  },
  (t) => [
    index('hotel_inventory_events_hotel_idx').on(t.hotelId, t.receivedAt),
    index('hotel_inventory_events_status_idx').on(t.hotelId, t.status),
  ],
);

/** Append-only hotel stock ledger. Balance per shelf and product = SUM(quantity). */
export const hotelStockMovements = pgTable(
  'hotel_stock_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => hotelLocations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    movementType: text('movement_type', { enum: HOTEL_MOVEMENT_TYPES }).notNull(),
    quantity: qty('quantity').notNull(),
    eventId: uuid('event_id').references(() => hotelInventoryEvents.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    occurredAt: ts('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('hotel_movements_type_chk', inList(t.movementType, HOTEL_MOVEMENT_TYPES)),
    index('hotel_movements_balance_idx').on(t.hotelId, t.locationId, t.productId),
  ],
);
