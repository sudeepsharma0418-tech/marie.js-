/**
 * Roles and permissions. This file is the single source of truth for the
 * permission matrix. The API enforces it server side; the web app only uses it
 * to decide what to show. Hiding UI is never treated as security.
 */

export const INTERNAL_ROLES = ['owner', 'procurement', 'warehouse', 'driver'] as const;
export const HOTEL_ROLES = ['hotel_manager', 'hotel_purchaser', 'hotel_inventory'] as const;
export const ROLES = [...INTERNAL_ROLES, ...HOTEL_ROLES] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];
export type HotelRole = (typeof HOTEL_ROLES)[number];
export type Role = (typeof ROLES)[number];

export function isHotelRole(role: Role): role is HotelRole {
  return (HOTEL_ROLES as readonly string[]).includes(role);
}

/** Roles that must use multi factor authentication when MFA enforcement is on. */
export const PRIVILEGED_ROLES: readonly Role[] = ['owner', 'procurement'];

export const PERMISSIONS = [
  // users and organisation
  'users.manage_internal',
  'users.manage_own_hotel',
  'hotels.read_all',
  'hotels.read_own',
  'hotels.manage',
  /** Prepare credit limit / payment term changes (owner approval needed unless the owner does it). */
  'credit.request',
  'contracts.read_all',
  'contracts.read_own',
  'contracts.manage',
  // suppliers and confidential costs
  'suppliers.read',
  'suppliers.manage',
  'quotations.manage',
  'costs.view',
  // catalog and pricing
  'catalog.read',
  'catalog.manage',
  'pricing.manage',
  // orders and requests
  'orders.create',
  'orders.read_own_hotel',
  'orders.read_all',
  'orders.approve_hotel',
  'orders.manage',
  'orders.price_override',
  'requests.create',
  'requests.manage',
  // procurement
  'procurement.manage',
  // hub
  'hub.stock.view',
  'hub.receive',
  'hub.stock.adjust',
  'hub.dispatch',
  // delivery
  'delivery.manage',
  'delivery.view_assigned',
  'delivery.confirm',
  // hotel inventory
  'hotel_inventory.view',
  'hotel_inventory.record',
  'hotel_inventory.correct',
  'hotel_inventory.manage_locations',
  'hotel_inventory.review',
  // finance
  'finance.view_all',
  'finance.view_own_hotel',
  'invoices.manage',
  'bills.manage',
  'payments.record',
  'payments.reverse',
  // approvals
  'approvals.request',
  'approvals.decide',
  // reports
  'reports.business',
  'reports.financial',
  'reports.inventory',
  'reports.operations',
  'reports.own_hotel',
  // administration
  'audit.view',
  'settings.manage',
  'tax.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  procurement: [
    'hotels.read_all',
    'credit.request',
    'contracts.read_all',
    'suppliers.read',
    'suppliers.manage',
    'quotations.manage',
    'costs.view',
    'catalog.read',
    'catalog.manage',
    'pricing.manage',
    'orders.read_all',
    'orders.manage',
    'orders.price_override',
    'requests.manage',
    'procurement.manage',
    'hub.stock.view',
    'delivery.manage',
    'finance.view_all',
    'invoices.manage',
    'bills.manage',
    'payments.record',
    'approvals.request',
    'reports.business',
    'reports.inventory',
    'reports.operations',
  ],
  warehouse: [
    'catalog.read',
    'hub.stock.view',
    'hub.receive',
    'hub.stock.adjust',
    'hub.dispatch',
    'approvals.request',
    'reports.inventory',
  ],
  driver: ['delivery.view_assigned', 'delivery.confirm'],
  hotel_manager: [
    'users.manage_own_hotel',
    'hotels.read_own',
    'contracts.read_own',
    'catalog.read',
    'orders.create',
    'orders.read_own_hotel',
    'orders.approve_hotel',
    'requests.create',
    'hotel_inventory.view',
    'hotel_inventory.record',
    'hotel_inventory.correct',
    'hotel_inventory.manage_locations',
    'hotel_inventory.review',
    'finance.view_own_hotel',
    'reports.own_hotel',
  ],
  hotel_purchaser: [
    'catalog.read',
    'orders.create',
    'orders.read_own_hotel',
    'requests.create',
    'hotel_inventory.view',
  ],
  hotel_inventory: ['hotel_inventory.view', 'hotel_inventory.record'],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
