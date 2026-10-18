/**
 * Explicit state machines. The API refuses any transition not listed here.
 * Keep these in sync with docs/BUSINESS_RULES.md.
 */

export const ORDER_STATUSES = [
  'draft',
  'pending_hotel_approval',
  'submitted',
  'pending_approval',
  'approved',
  'rejected',
  'procurement',
  'consolidating',
  'ready_for_dispatch',
  'dispatched',
  'partially_delivered',
  'delivered',
  'closed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['pending_hotel_approval', 'submitted', 'cancelled'],
  pending_hotel_approval: ['submitted', 'draft', 'cancelled'],
  // submitted is a transient state while the credit check runs
  submitted: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['procurement', 'cancelled'],
  rejected: [],
  procurement: [
    'consolidating',
    'ready_for_dispatch',
    'dispatched',
    'partially_delivered',
    'delivered',
    'cancelled',
  ],
  consolidating: ['ready_for_dispatch', 'dispatched', 'partially_delivered', 'procurement'],
  ready_for_dispatch: ['dispatched', 'consolidating', 'partially_delivered', 'delivered'],
  dispatched: ['partially_delivered', 'delivered', 'ready_for_dispatch', 'consolidating'],
  partially_delivered: ['dispatched', 'delivered', 'consolidating', 'ready_for_dispatch', 'closed'],
  delivered: ['closed'],
  closed: [],
  cancelled: [],
};

/** Statuses in which an order still counts towards credit exposure (not yet invoiced in full). */
export const ORDER_OPEN_STATUSES: readonly OrderStatus[] = [
  'pending_approval',
  'approved',
  'procurement',
  'consolidating',
  'ready_for_dispatch',
  'dispatched',
  'partially_delivered',
  'delivered',
];

export const PO_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'sent',
  'confirmed',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_TRANSITIONS: Record<PoStatus, readonly PoStatus[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['sent', 'cancelled'],
  rejected: ['draft'],
  sent: ['confirmed', 'partially_received', 'received', 'cancelled'],
  confirmed: ['partially_received', 'received', 'cancelled'],
  partially_received: ['partially_received', 'received', 'closed'],
  received: ['closed'],
  closed: [],
  cancelled: [],
};

/** A PO in one of these statuses is a commitment to the supplier and must have been approved. */
export const PO_COMMITTED_STATUSES: readonly PoStatus[] = [
  'sent',
  'confirmed',
  'partially_received',
  'received',
  'closed',
];

export const DELIVERY_STATUSES = [
  'scheduled',
  'dispatched',
  'delivered',
  'partially_delivered',
  'failed',
  'cancelled',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  scheduled: ['dispatched', 'cancelled'],
  dispatched: ['delivered', 'partially_delivered', 'failed'],
  delivered: [],
  partially_delivered: [],
  failed: [],
  cancelled: [],
};

export function canTransition<S extends string>(table: Record<S, readonly S[]>, from: S, to: S): boolean {
  return table[from]?.includes(to) ?? false;
}

export const APPROVAL_TYPES = [
  'purchase_order',
  'credit_order',
  'credit_limit_change',
  'price_override',
  'stock_write_off',
  'financial_adjustment',
  'payment_reversal',
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const HOTEL_MOVEMENT_TYPES = [
  'opening',
  'usage',
  'restock',
  'correction',
  'transfer_out',
  'transfer_in',
] as const;
export type HotelMovementType = (typeof HOTEL_MOVEMENT_TYPES)[number];

export const HUB_MOVEMENT_TYPES = [
  'receipt',
  'dispatch',
  'delivery_return',
  'return_to_supplier',
  'adjustment',
  'write_off',
] as const;
export type HubMovementType = (typeof HUB_MOVEMENT_TYPES)[number];

export const PAYMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'mobile_wallet', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
