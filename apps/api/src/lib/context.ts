import type { Permission, Role } from '@hp/shared';
import { roleHas } from '@hp/shared';
import { forbidden, notFound } from './errors';

export interface Actor {
  id: string;
  role: Role;
  hotelId: string | null;
  name: string;
  email: string;
}

/** Everything a service needs to know about who is acting. */
export interface Ctx {
  actor: Actor;
  ip?: string;
  requestId?: string;
}

export function can(ctx: Ctx, perm: Permission): boolean {
  return roleHas(ctx.actor.role, perm);
}

export function requirePerm(ctx: Ctx, ...perms: Permission[]): void {
  if (!perms.some((p) => can(ctx, p))) throw forbidden();
}

export const isInternal = (ctx: Ctx) => ctx.actor.hotelId === null;

/**
 * Tenant isolation. Hotel users may only touch their own hotel; anything else
 * looks like "not found" so record ids cannot be probed across hotels.
 */
export function assertHotelAccess(ctx: Ctx, hotelId: string, what = 'Record'): void {
  if (ctx.actor.hotelId !== null && ctx.actor.hotelId !== hotelId) throw notFound(what);
}

/** Resolve which hotel a list query is limited to: hotel users are forced to their own. */
export function hotelFilter(ctx: Ctx, requested?: string | null): string | null {
  if (ctx.actor.hotelId !== null) return ctx.actor.hotelId;
  return requested ?? null;
}

/** Hotel users must never see supplier costs or margins. */
export const canSeeCosts = (ctx: Ctx) => can(ctx, 'costs.view');
