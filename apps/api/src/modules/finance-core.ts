import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { ORDER_OPEN_STATUSES, addMoney, cmpMoney, fromPaisa, subMoney, toPaisa } from '@hp/shared';
import type { DbOrTx } from '../db/client';
import { hotels, invoices, ledgerEntries, orders, supplierBills } from '../db/schema';
import { addDays, todayNepal } from '../lib/http';
import { getSettings } from '../lib/settings';

/** Receivable balance from the ledger: invoices (debit) minus credit notes, payments and adjustments. */
export async function hotelBalance(db: DbOrTx, hotelId: string): Promise<string> {
  const [r] = await db
    .select({
      bal: sql<string>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)::numeric(14,2)::text`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, 'accounts_receivable'), eq(ledgerEntries.partyId, hotelId)));
  return r?.bal ?? '0.00';
}

export async function supplierBalance(db: DbOrTx, supplierId: string): Promise<string> {
  const [r] = await db
    .select({
      bal: sql<string>`coalesce(sum(${ledgerEntries.credit} - ${ledgerEntries.debit}), 0)::numeric(14,2)::text`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, 'accounts_payable'), eq(ledgerEntries.partyId, supplierId)));
  return r?.bal ?? '0.00';
}

/** Outstanding per issued invoice = total - active allocations - issued credit notes against it. */
export async function invoiceOutstanding(db: DbOrTx, invoiceIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!invoiceIds.length) return out;
  const rows = await db
    .select({
      id: invoices.id,
      total: invoices.total,
      allocated: sql<string>`coalesce((select sum(pa.amount) from payment_allocations pa where pa.invoice_id = invoices.id and pa.reversed_at is null), 0)::numeric(14,2)::text`,
      credited: sql<string>`coalesce((select sum(cn.total) from credit_notes cn where cn.invoice_id = invoices.id and cn.status = 'issued'), 0)::numeric(14,2)::text`,
    })
    .from(invoices)
    .where(inArray(invoices.id, invoiceIds));
  for (const r of rows) out.set(r.id, subMoney(subMoney(r.total, r.allocated), r.credited));
  return out;
}

export async function billOutstanding(db: DbOrTx, billIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!billIds.length) return out;
  const rows = await db
    .select({
      id: supplierBills.id,
      total: supplierBills.total,
      allocated: sql<string>`coalesce((select sum(pa.amount) from payment_allocations pa where pa.bill_id = supplier_bills.id and pa.reversed_at is null), 0)::numeric(14,2)::text`,
    })
    .from(supplierBills)
    .where(inArray(supplierBills.id, billIds));
  for (const r of rows) out.set(r.id, subMoney(r.total, r.allocated));
  return out;
}

export interface OverdueInfo {
  count: number;
  amount: string;
  oldestDueDate: string | null;
}

export async function hotelOverdue(
  db: DbOrTx,
  hotelId: string,
  graceDays: number,
  today = todayNepal(),
): Promise<OverdueInfo> {
  const cutoff = addDays(today, -graceDays);
  const issued = await db
    .select({ id: invoices.id, dueDate: invoices.dueDate })
    .from(invoices)
    .where(
      and(eq(invoices.hotelId, hotelId), eq(invoices.status, 'issued'), sql`${invoices.dueDate} < ${cutoff}`),
    );
  const outstanding = await invoiceOutstanding(
    db,
    issued.map((i) => i.id),
  );
  let count = 0;
  let amount = '0.00';
  let oldest: string | null = null;
  for (const inv of issued) {
    const o = outstanding.get(inv.id) ?? '0.00';
    if (cmpMoney(o, '0.00') > 0) {
      count++;
      amount = addMoney(amount, o);
      if (!oldest || inv.dueDate! < oldest) oldest = inv.dueDate;
    }
  }
  return { count, amount, oldestDueDate: oldest };
}

/** Value of open orders not yet invoiced (draft or issued invoices count as invoiced). */
export async function openOrderExposure(
  db: DbOrTx,
  hotelId: string,
  excludeOrderId?: string,
): Promise<string> {
  const rows = await db
    .select({
      total: orders.total,
      invoiced: sql<string>`coalesce((select sum(i.total) from invoices i where i.order_id = orders.id and i.status <> 'discarded'), 0)::numeric(14,2)::text`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.hotelId, hotelId),
        inArray(orders.status, [...ORDER_OPEN_STATUSES]),
        excludeOrderId ? ne(orders.id, excludeOrderId) : undefined,
      ),
    );
  let sum = 0n;
  for (const r of rows) {
    const remaining = toPaisa(r.total) - toPaisa(r.invoiced);
    if (remaining > 0n) sum += remaining;
  }
  return fromPaisa(sum);
}

export interface CreditCheck {
  hotelStatus: string;
  creditLimit: string;
  balance: string;
  openOrders: string;
  orderTotal: string;
  exposureAfter: string;
  availableCredit: string;
  overdue: OverdueInfo;
  reasons: string[];
  requiresApproval: boolean;
  blocked: boolean;
  checkedAt: string;
}

/**
 * Credit policy (documented in docs/BUSINESS_RULES.md):
 *   exposure = receivable balance + open orders not yet invoiced + this order
 * Owner approval is required when exposure exceeds the credit limit, the hotel
 * has invoices overdue beyond the grace period, or the account is on hold or
 * suspended. Closed accounts cannot order.
 */
export async function runCreditCheck(
  db: DbOrTx,
  hotelId: string,
  orderTotal: string,
  orderId?: string,
): Promise<CreditCheck> {
  const [hotel] = await db.select().from(hotels).where(eq(hotels.id, hotelId));
  if (!hotel) throw new Error('hotel not found');
  const settings = await getSettings(db);
  const balance = await hotelBalance(db, hotelId);
  const openOrders = await openOrderExposure(db, hotelId, orderId);
  const exposureAfter = addMoney(balance, openOrders, orderTotal);
  const overdue = await hotelOverdue(db, hotelId, settings.creditOverdueGraceDays);
  const reasons: string[] = [];
  if (hotel.status === 'on_hold') reasons.push('account_on_hold');
  if (hotel.status === 'suspended') reasons.push('account_suspended');
  if (overdue.count > 0) reasons.push('overdue_invoices');
  if (cmpMoney(exposureAfter, hotel.creditLimit) > 0) reasons.push('credit_limit_exceeded');
  return {
    hotelStatus: hotel.status,
    creditLimit: hotel.creditLimit,
    balance,
    openOrders,
    orderTotal,
    exposureAfter,
    availableCredit: subMoney(hotel.creditLimit, addMoney(balance, openOrders)),
    overdue,
    reasons,
    requiresApproval: reasons.length > 0,
    blocked: hotel.status === 'closed',
    checkedAt: new Date().toISOString(),
  };
}
