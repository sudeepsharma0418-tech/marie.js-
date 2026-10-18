import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  PAYMENT_METHODS,
  addMoney,
  cmpMoney,
  cmpQty,
  lineAmount,
  marginPercent,
  percentOf,
  subMoney,
  subQty,
  toPaisa,
  toPercentMilli,
} from '@hp/shared';
import type { DbOrTx } from '../db/client';
import {
  creditNoteLines,
  creditNotes,
  financialAdjustments,
  hotels,
  invoiceLines,
  invoices,
  ledgerEntries,
  orderLines,
  orders,
  paymentAllocations,
  payments,
  purchaseOrders,
  supplierBillLines,
  supplierBills,
  suppliers,
  users,
} from '../db/schema';
import { ctxOf, guard } from '../plugins/auth';
import { assertHotelAccess, can, hotelFilter, isInternal, type Ctx } from '../lib/context';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { addDays, idParam, parse, todayNepal, toCsv } from '../lib/http';
import { audit } from '../lib/audit';
import { nextDocumentNumber } from '../lib/numbering';
import { getSettings } from '../lib/settings';
import { notifyRoles } from '../lib/notify';
import { registerApprovalHandler, requestApproval } from './approvals';
import {
  billOutstanding,
  hotelBalance,
  hotelOverdue,
  invoiceOutstanding,
  openOrderExposure,
  supplierBalance,
} from './finance-core';
import { lineQuantities } from './orders-core';

const moneyStr = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount with up to 2 decimals');
const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Quantity with up to 3 decimals');
const rateStr = z.string().regex(/^\d+(\.\d{1,3})?$/);

type InvoiceRow = typeof invoices.$inferSelect;

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

function computeDocTotals(lines: { taxableAmount: string; taxAmount: string; taxRate: string }[]) {
  let taxable = '0.00';
  let exempt = '0.00';
  let tax = '0.00';
  for (const l of lines) {
    if (toPercentMilli(l.taxRate) === 0n) exempt = addMoney(exempt, l.taxableAmount);
    else taxable = addMoney(taxable, l.taxableAmount);
    tax = addMoney(tax, l.taxAmount);
  }
  return { taxableTotal: taxable, exemptTotal: exempt, taxTotal: tax, total: addMoney(taxable, exempt, tax) };
}

/**
 * Draft invoice for delivered quantities not yet on any (draft or issued) invoice.
 * Delivery and invoicing are separate records: an invoice is only ever generated
 * from confirmed delivered quantities, never from the order itself.
 */
export async function createDraftInvoiceForOrder(
  tx: DbOrTx,
  ctx: Ctx,
  orderId: string,
  opts: { quiet?: boolean } = {},
): Promise<InvoiceRow | null> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!o) throw notFound('Order');
  const lines = await tx
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId))
    .orderBy(asc(orderLines.lineNo));
  const q = await lineQuantities(tx, orderId);
  const toBill = lines
    .map((l) => ({ l, qty: subQty(q.get(l.id)!.delivered, q.get(l.id)!.invoiced) }))
    .filter((x) => cmpQty(x.qty, '0') > 0);
  if (!toBill.length) {
    if (opts.quiet) return null;
    throw unprocessable('There are no delivered, uninvoiced quantities on this order');
  }
  const invLines = toBill.map(({ l, qty }, i) => {
    const taxableAmount = lineAmount(qty, l.unitPrice);
    const taxAmount = percentOf(taxableAmount, l.taxRate);
    return {
      lineNo: i + 1,
      orderLineId: l.id,
      productId: l.productId,
      descriptionEn: l.nameEn,
      descriptionNe: l.nameNe,
      unit: l.unit,
      quantity: qty,
      unitPrice: l.unitPrice,
      taxCode: l.taxCode,
      taxRate: l.taxRate,
      taxableAmount,
      taxAmount,
      lineTotal: addMoney(taxableAmount, taxAmount),
    };
  });
  const totals = computeDocTotals(invLines);
  const [inv] = await tx
    .insert(invoices)
    .values({ hotelId: o.hotelId, orderId, createdBy: ctx.actor.id, ...totals })
    .returning();
  await tx.insert(invoiceLines).values(invLines.map((l) => ({ ...l, invoiceId: inv!.id })));
  await audit(tx, ctx, {
    action: 'invoice.draft_created',
    entityType: 'invoice',
    entityId: inv!.id,
    hotelId: o.hotelId,
    after: { orderId, total: totals.total, lines: invLines.length },
  });
  await notifyRoles(tx, ['procurement', 'owner'], {
    kind: 'invoice_draft',
    title: `Draft invoice ready for ${o.orderNumber}`,
    body: `NPR ${totals.total}`,
    link: `/invoices/${inv!.id}`,
  });
  return inv!;
}

async function postLedger(
  tx: DbOrTx,
  ctx: Ctx,
  e: {
    entryDate: string;
    account: 'accounts_receivable' | 'accounts_payable';
    partyId: string;
    sourceType: (typeof ledgerEntries.$inferInsert)['sourceType'];
    sourceId: string;
    reference?: string | null;
    debit?: string;
    credit?: string;
    memo?: string;
  },
) {
  await tx.insert(ledgerEntries).values({
    entryDate: e.entryDate,
    account: e.account,
    partyType: e.account === 'accounts_receivable' ? 'hotel' : 'supplier',
    partyId: e.partyId,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    reference: e.reference ?? null,
    debit: e.debit ?? '0.00',
    credit: e.credit ?? '0.00',
    memo: e.memo ?? null,
    createdBy: ctx.actor.id,
  });
}

function sellerSnapshot(s: Awaited<ReturnType<typeof getSettings>>) {
  return {
    legalName: s.legalName,
    tradeName: s.tradeName,
    pan: s.pan,
    vatNumber: s.vatNumber,
    vatRegistered: s.vatRegistered,
    address: s.address,
    phone: s.phone,
    email: s.email,
    footer: s.invoiceFooter,
  };
}
function customerSnapshot(h: typeof hotels.$inferSelect) {
  return {
    legalName: h.legalName,
    tradeName: h.tradeName,
    pan: h.pan,
    vatNumber: h.vatNumber,
    address: h.address,
    city: h.city,
    district: h.district,
    phone: h.phone,
    code: h.code,
  };
}

async function issueInvoice(tx: DbOrTx, ctx: Ctx, id: string, invoiceDate?: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'draft') throw conflict(`Invoice is ${inv.status}`);
  const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
  if (!lines.length) throw unprocessable('Invoice has no lines');
  const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, inv.hotelId));
  const settings = await getSettings(tx);
  const date = invoiceDate ?? todayNepal();
  if (date > todayNepal()) throw badRequest('Invoice date cannot be in the future');
  const number = await nextDocumentNumber(tx, 'invoice');
  const [issued] = await tx
    .update(invoices)
    .set({
      status: 'issued',
      invoiceNumber: number,
      invoiceDate: date,
      dueDate: addDays(date, hotel!.paymentTermsDays),
      fiscalYear: settings.fiscalYearLabel,
      sellerSnapshot: sellerSnapshot(settings),
      customerSnapshot: customerSnapshot(hotel!),
      issuedBy: ctx.actor.id,
      issuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, id))
    .returning();
  await postLedger(tx, ctx, {
    entryDate: date,
    account: 'accounts_receivable',
    partyId: inv.hotelId,
    sourceType: 'invoice',
    sourceId: id,
    reference: number,
    debit: inv.total,
    memo: 'Tax invoice',
  });
  await audit(tx, ctx, {
    action: 'invoice.issued',
    entityType: 'invoice',
    entityId: id,
    hotelId: inv.hotelId,
    after: { invoiceNumber: number, total: inv.total, dueDate: issued!.dueDate },
  });
  await notifyRoles(
    tx,
    ['hotel_manager'],
    {
      kind: 'invoice_issued',
      title: `Invoice ${number}`,
      body: `NPR ${inv.total}, due ${issued!.dueDate}`,
      link: `/invoices/${id}`,
    },
    inv.hotelId,
  );
  return issued!;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

async function allocate(
  tx: DbOrTx,
  ctx: Ctx,
  payment: typeof payments.$inferSelect,
  allocations: { invoiceId?: string; billId?: string; amount: string }[],
) {
  const [{ used } = { used: '0' }] = await tx
    .select({ used: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)::numeric(14,2)::text` })
    .from(paymentAllocations)
    .where(and(eq(paymentAllocations.paymentId, payment.id), isNull(paymentAllocations.reversedAt)));
  let remaining = subMoney(payment.amount, used);
  const targets = new Set<string>();
  for (const a of allocations) {
    if (cmpMoney(a.amount, '0') <= 0) throw badRequest('Allocation amounts must be positive');
    const target = a.invoiceId ?? a.billId;
    if (!target || (a.invoiceId && a.billId)) throw badRequest('Allocate to exactly one invoice or bill');
    if (targets.has(target)) throw badRequest('Each document may appear once');
    targets.add(target);
    if (payment.direction === 'inbound') {
      if (!a.invoiceId) throw badRequest('Customer payments are allocated to invoices');
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, a.invoiceId)).for('update');
      if (!inv || inv.hotelId !== payment.hotelId || inv.status !== 'issued')
        throw badRequest('Invoice is not an issued invoice of this hotel');
      const outstanding = (await invoiceOutstanding(tx, [inv.id])).get(inv.id)!;
      if (cmpMoney(a.amount, outstanding) > 0)
        throw unprocessable(
          `Allocation exceeds the outstanding amount of ${inv.invoiceNumber} (${outstanding})`,
        );
    } else {
      if (!a.billId) throw badRequest('Supplier payments are allocated to bills');
      const [bill] = await tx
        .select()
        .from(supplierBills)
        .where(eq(supplierBills.id, a.billId))
        .for('update');
      if (!bill || bill.supplierId !== payment.supplierId || bill.status !== 'posted')
        throw badRequest('Bill is not a posted bill of this supplier');
      const outstanding = (await billOutstanding(tx, [bill.id])).get(bill.id)!;
      if (cmpMoney(a.amount, outstanding) > 0)
        throw unprocessable(
          `Allocation exceeds the outstanding amount of bill ${bill.supplierBillNumber} (${outstanding})`,
        );
    }
    remaining = subMoney(remaining, a.amount);
    if (cmpMoney(remaining, '0') < 0) throw unprocessable('Allocations exceed the payment amount');
    await tx
      .insert(paymentAllocations)
      .values({
        paymentId: payment.id,
        invoiceId: a.invoiceId ?? null,
        billId: a.billId ?? null,
        amount: a.amount,
        createdBy: ctx.actor.id,
      });
  }
  if (allocations.length) {
    await audit(tx, ctx, {
      action: 'payment.allocated',
      entityType: 'payment',
      entityId: payment.id,
      hotelId: payment.hotelId,
      after: { allocations, unallocated: remaining },
    });
  }
  return remaining;
}

async function postAdjustment(
  tx: DbOrTx,
  ctx: Ctx,
  adj: typeof financialAdjustments.$inferSelect,
  approvalId?: string,
) {
  const amount = adj.amount.replace('-', '');
  const increase = !adj.amount.startsWith('-');
  const isAr = adj.account === 'accounts_receivable';
  await postLedger(tx, ctx, {
    entryDate: todayNepal(),
    account: adj.account,
    partyId: (isAr ? adj.hotelId : adj.supplierId)!,
    sourceType: 'adjustment',
    sourceId: adj.id,
    reference: 'ADJ',
    debit: isAr === increase ? amount : undefined,
    credit: isAr === increase ? undefined : amount,
    memo: adj.reason,
  });
  await tx
    .update(financialAdjustments)
    .set({ status: 'posted', postedAt: new Date(), approvalId: approvalId ?? adj.approvalId })
    .where(eq(financialAdjustments.id, adj.id));
  await audit(tx, ctx, {
    action: 'financial_adjustment.posted',
    entityType: 'financial_adjustment',
    entityId: adj.id,
    hotelId: adj.hotelId,
    reason: adj.reason,
    after: { amount: adj.amount, account: adj.account, approvalId },
  });
}

/* ------------------------------------------------------------------ */
/* Aging                                                               */
/* ------------------------------------------------------------------ */

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
function bucketFor(dueDate: string, today: string): (typeof BUCKETS)[number] {
  const days = Math.floor((Date.parse(today) - Date.parse(dueDate)) / 86_400_000);
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

export async function arAging(db: DbOrTx, hotelId: string | null, today = todayNepal()) {
  const invs = await db
    .select({
      id: invoices.id,
      hotelId: invoices.hotelId,
      dueDate: invoices.dueDate,
      invoiceNumber: invoices.invoiceNumber,
      hotelName: hotels.legalName,
    })
    .from(invoices)
    .innerJoin(hotels, eq(hotels.id, invoices.hotelId))
    .where(and(eq(invoices.status, 'issued'), hotelId ? eq(invoices.hotelId, hotelId) : undefined));
  const outstanding = await invoiceOutstanding(
    db,
    invs.map((i) => i.id),
  );
  const byHotel = new Map<
    string,
    { hotelId: string; hotelName: string; total: string; unallocatedCredit: string } & Record<
      (typeof BUCKETS)[number],
      string
    >
  >();
  for (const i of invs) {
    const o = outstanding.get(i.id)!;
    if (cmpMoney(o, '0') === 0) continue;
    const row = byHotel.get(i.hotelId) ?? {
      hotelId: i.hotelId,
      hotelName: i.hotelName,
      total: '0.00',
      unallocatedCredit: '0.00',
      current: '0.00',
      d1_30: '0.00',
      d31_60: '0.00',
      d61_90: '0.00',
      d90_plus: '0.00',
    };
    const b = bucketFor(i.dueDate!, today);
    row[b] = addMoney(row[b], o);
    row.total = addMoney(row.total, o);
    byHotel.set(i.hotelId, row);
  }
  // Ledger balance minus invoice outstanding = unallocated payments, adjustments and credits.
  const hotelIds = hotelId
    ? [hotelId]
    : (await db.select({ id: hotels.id, name: hotels.legalName }).from(hotels)).map((h) => h.id);
  for (const hid of hotelIds) {
    const bal = await hotelBalance(db, hid);
    const row = byHotel.get(hid);
    const diff = subMoney(bal, row?.total ?? '0.00');
    if (cmpMoney(diff, '0') !== 0) {
      const [h] = await db.select({ name: hotels.legalName }).from(hotels).where(eq(hotels.id, hid));
      const r = row ?? {
        hotelId: hid,
        hotelName: h!.name,
        total: '0.00',
        unallocatedCredit: '0.00',
        current: '0.00',
        d1_30: '0.00',
        d31_60: '0.00',
        d61_90: '0.00',
        d90_plus: '0.00',
      };
      r.unallocatedCredit = diff;
      r.total = bal;
      byHotel.set(hid, r);
    }
  }
  const rows = [...byHotel.values()].sort((a, b) => a.hotelName.localeCompare(b.hotelName));
  const totals = Object.fromEntries(
    [...BUCKETS, 'unallocatedCredit', 'total'].map((k) => [
      k,
      addMoney('0', ...rows.map((r) => r[k as keyof typeof r] as string)),
    ]),
  );
  return { asOf: today, rows, totals };
}

export async function apAging(db: DbOrTx, today = todayNepal()) {
  const bills = await db
    .select({
      id: supplierBills.id,
      supplierId: supplierBills.supplierId,
      dueDate: supplierBills.dueDate,
      supplierName: suppliers.name,
    })
    .from(supplierBills)
    .innerJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .where(eq(supplierBills.status, 'posted'));
  const outstanding = await billOutstanding(
    db,
    bills.map((b) => b.id),
  );
  const bySupplier = new Map<
    string,
    { supplierId: string; supplierName: string; total: string } & Record<(typeof BUCKETS)[number], string>
  >();
  for (const b of bills) {
    const o = outstanding.get(b.id)!;
    if (cmpMoney(o, '0') === 0) continue;
    const row = bySupplier.get(b.supplierId) ?? {
      supplierId: b.supplierId,
      supplierName: b.supplierName,
      total: '0.00',
      current: '0.00',
      d1_30: '0.00',
      d31_60: '0.00',
      d61_90: '0.00',
      d90_plus: '0.00',
    };
    const k = bucketFor(b.dueDate, today);
    row[k] = addMoney(row[k], o);
    row.total = addMoney(row.total, o);
    bySupplier.set(b.supplierId, row);
  }
  const rows = [...bySupplier.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  const totals = Object.fromEntries(
    [...BUCKETS, 'total'].map((k) => [
      k,
      addMoney('0', ...rows.map((r) => r[k as keyof typeof r] as string)),
    ]),
  );
  return { asOf: today, rows, totals };
}

/** Expected vs realised margin for one order. */
export async function orderMargin(db: DbOrTx, orderId: string) {
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const q = await lineQuantities(db, orderId);
  let expectedRevenue = '0.00';
  let expectedCost = '0.00';
  for (const l of lines) {
    const needed = q.get(l.id)!.needed;
    expectedRevenue = addMoney(expectedRevenue, lineAmount(needed, l.unitPrice));
    if (l.expectedUnitCost) expectedCost = addMoney(expectedCost, lineAmount(needed, l.expectedUnitCost));
  }
  const [rev] = await db
    .execute<{ invoiced: string; credited: string }>(
      sql`
    select
      coalesce((select sum(i.taxable_total + i.exempt_total) from invoices i where i.order_id = ${orderId} and i.status = 'issued'), 0)::numeric(14,2)::text as invoiced,
      coalesce((select sum(cn.taxable_total) from credit_notes cn join invoices i on i.id = cn.invoice_id where i.order_id = ${orderId} and cn.status = 'issued'), 0)::numeric(14,2)::text as credited
  `,
    )
    .then((r) => r.rows);
  const [cost] = await db
    .execute<{ billed: string; received_at_po_cost: string }>(
      sql`
    select
      coalesce((select sum(bl.taxable_amount) from supplier_bill_lines bl join supplier_bills b on b.id = bl.bill_id
                join po_lines pl on pl.id = bl.po_line_id join order_lines ol on ol.id = pl.order_line_id
                where ol.order_id = ${orderId} and b.status = 'posted'), 0)::numeric(14,2)::text as billed,
      coalesce((select sum(round(g.qty_accepted * pl.unit_cost, 2)) from goods_receipt_lines g join po_lines pl on pl.id = g.po_line_id
                join order_lines ol on ol.id = pl.order_line_id where ol.order_id = ${orderId}), 0)::numeric(14,2)::text as received_at_po_cost
  `,
    )
    .then((r) => r.rows);
  const realizedRevenue = subMoney(rev!.invoiced, rev!.credited);
  return {
    expected: {
      revenue: expectedRevenue,
      cost: expectedCost,
      grossMargin: subMoney(expectedRevenue, expectedCost),
      marginPercent: marginPercent(expectedRevenue, expectedCost),
    },
    realized: {
      revenue: realizedRevenue,
      billedCost: cost!.billed,
      grossMargin: subMoney(realizedRevenue, cost!.billed),
      marginPercent: marginPercent(realizedRevenue, cost!.billed),
      receivedAtPoCost: cost!.received_at_po_cost,
      costFullyBilled: cmpMoney(cost!.billed, cost!.received_at_po_cost) >= 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export async function financeRoutes(app: FastifyInstance) {
  const db = app.db;
  const viewFinance = guard('finance.view_all', 'finance.view_own_hotel');

  /* ------------------------------ invoices ------------------------------ */

  app.get('/invoices', { preHandler: viewFinance }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({
        hotelId: z.uuid().optional(),
        status: z.enum(['draft', 'issued', 'discarded']).optional(),
        orderId: z.uuid().optional(),
      }),
      req.query,
    );
    const hotelId = hotelFilter(ctx, q.hotelId);
    const conds = [];
    if (hotelId) conds.push(eq(invoices.hotelId, hotelId));
    if (q.orderId) conds.push(eq(invoices.orderId, q.orderId));
    // hotels only ever see issued invoices
    if (!isInternal(ctx)) conds.push(eq(invoices.status, 'issued'));
    else if (q.status) conds.push(eq(invoices.status, q.status));
    const rows = await db
      .select({ inv: invoices, hotelName: hotels.legalName, orderNumber: orders.orderNumber })
      .from(invoices)
      .innerJoin(hotels, eq(hotels.id, invoices.hotelId))
      .leftJoin(orders, eq(orders.id, invoices.orderId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(invoices.createdAt))
      .limit(500);
    const outstanding = await invoiceOutstanding(
      db,
      rows.filter((r) => r.inv.status === 'issued').map((r) => r.inv.id),
    );
    const today = todayNepal();
    return {
      items: rows.map((r) => {
        const o = outstanding.get(r.inv.id) ?? null;
        return {
          ...r.inv,
          sellerSnapshot: undefined,
          customerSnapshot: undefined,
          hotelName: r.hotelName,
          orderNumber: r.orderNumber,
          outstanding: o,
          paymentStatus:
            r.inv.status !== 'issued'
              ? null
              : cmpMoney(o!, '0') <= 0
                ? 'paid'
                : cmpMoney(o!, r.inv.total) < 0
                  ? 'partially_paid'
                  : 'unpaid',
          overdue: r.inv.status === 'issued' && cmpMoney(o!, '0') > 0 && r.inv.dueDate! < today,
        };
      }),
    };
  });

  app.get('/invoices/:id', { preHandler: viewFinance }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!inv || (!isInternal(ctx) && inv.status !== 'issued')) throw notFound('Invoice');
    assertHotelAccess(ctx, inv.hotelId, 'Invoice');
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(asc(invoiceLines.lineNo));
    const allocations = await db
      .select({
        a: paymentAllocations,
        paymentNumber: payments.paymentNumber,
        paymentDate: payments.paymentDate,
        method: payments.method,
        reference: payments.reference,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(and(eq(paymentAllocations.invoiceId, id), isNull(paymentAllocations.reversedAt)));
    const cns = await db
      .select()
      .from(creditNotes)
      .where(
        and(eq(creditNotes.invoiceId, id), isInternal(ctx) ? undefined : eq(creditNotes.status, 'issued')),
      );
    const [hotel] = await db.select().from(hotels).where(eq(hotels.id, inv.hotelId));
    const settings = await getSettings(db);
    const [order] = inv.orderId
      ? await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, inv.orderId))
      : [];
    return {
      invoice: inv,
      lines,
      // drafts show live details; issued invoices always use their frozen snapshots
      seller: inv.sellerSnapshot ?? sellerSnapshot(settings),
      customer: inv.customerSnapshot ?? customerSnapshot(hotel!),
      orderNumber: order?.orderNumber ?? null,
      outstanding: inv.status === 'issued' ? (await invoiceOutstanding(db, [id])).get(id) : null,
      allocations: allocations.map((r) => ({
        ...r.a,
        paymentNumber: r.paymentNumber,
        paymentDate: r.paymentDate,
        method: r.method,
        reference: r.reference,
      })),
      creditNotes: cns,
    };
  });

  app.post('/orders/:id/invoices', { preHandler: guard('invoices.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const inv = await db.transaction((tx) => createDraftInvoiceForOrder(tx, ctx, id));
    return { invoice: inv };
  });

  app.post('/invoices/:id/issue', { preHandler: guard('invoices.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ invoiceDate: z.iso.date().optional() }), req.body);
    const inv = await db.transaction((tx) => issueInvoice(tx, ctx, id, body.invoiceDate));
    return { invoice: inv };
  });

  app.post('/invoices/:id/discard', { preHandler: guard('invoices.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
      if (!inv) throw notFound('Invoice');
      if (inv.status !== 'draft')
        throw conflict('Only draft invoices can be discarded. Use a credit note for issued invoices.');
      await tx
        .update(invoices)
        .set({ status: 'discarded', notes: reason, updatedAt: new Date() })
        .where(eq(invoices.id, id));
      await audit(tx, ctx, {
        action: 'invoice.discarded',
        entityType: 'invoice',
        entityId: id,
        hotelId: inv.hotelId,
        reason,
      });
    });
    return { ok: true };
  });

  /* ---------------------------- credit notes ---------------------------- */

  app.post('/credit-notes', { preHandler: guard('invoices.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        invoiceId: z.uuid(),
        reason: z.string().min(3),
        lines: z.array(z.object({ invoiceLineId: z.uuid(), quantity: qtyStr })).min(1),
      }),
      req.body,
    );
    const cn = await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, body.invoiceId)).for('update');
      if (!inv || inv.status !== 'issued')
        throw unprocessable('Credit notes can only be raised against issued invoices');
      const invLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
      const byId = new Map(invLines.map((l) => [l.id, l]));
      const credited = await tx
        .select({
          invoiceLineId: creditNoteLines.invoiceLineId,
          qty: sql<string>`sum(${creditNoteLines.quantity})::numeric(14,3)::text`,
        })
        .from(creditNoteLines)
        .innerJoin(creditNotes, eq(creditNotes.id, creditNoteLines.creditNoteId))
        .where(and(eq(creditNotes.invoiceId, inv.id), inArray(creditNotes.status, ['draft', 'issued'])))
        .groupBy(creditNoteLines.invoiceLineId);
      const creditedMap = new Map(credited.map((c) => [c.invoiceLineId!, c.qty]));
      const cnLines = body.lines.map((l) => {
        const il = byId.get(l.invoiceLineId);
        if (!il) throw badRequest('Line does not belong to this invoice');
        const available = subQty(il.quantity, creditedMap.get(il.id) ?? '0');
        if (cmpQty(l.quantity, '0') <= 0 || cmpQty(l.quantity, available) > 0)
          throw unprocessable(`Credit quantity for ${il.descriptionEn} must be between 0 and ${available}`);
        const taxableAmount = lineAmount(l.quantity, il.unitPrice);
        const taxAmount = percentOf(taxableAmount, il.taxRate);
        return {
          invoiceLineId: il.id,
          descriptionEn: il.descriptionEn,
          quantity: l.quantity,
          unitPrice: il.unitPrice,
          taxRate: il.taxRate,
          taxableAmount,
          taxAmount,
          lineTotal: addMoney(taxableAmount, taxAmount),
        };
      });
      const totals = computeDocTotals(cnLines);
      const [c] = await tx
        .insert(creditNotes)
        .values({
          hotelId: inv.hotelId,
          invoiceId: inv.id,
          reason: body.reason,
          taxableTotal: addMoney(totals.taxableTotal, totals.exemptTotal),
          taxTotal: totals.taxTotal,
          total: totals.total,
          createdBy: ctx.actor.id,
        })
        .returning();
      await tx.insert(creditNoteLines).values(cnLines.map((l) => ({ ...l, creditNoteId: c!.id })));
      await audit(tx, ctx, {
        action: 'credit_note.draft_created',
        entityType: 'credit_note',
        entityId: c!.id,
        hotelId: inv.hotelId,
        reason: body.reason,
        after: { invoiceId: inv.id, total: totals.total },
      });
      return c!;
    });
    return { creditNote: cn };
  });

  app.post('/credit-notes/:id/issue', { preHandler: guard('invoices.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const cn = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(creditNotes).where(eq(creditNotes.id, id)).for('update');
      if (!c) throw notFound('Credit note');
      if (c.status !== 'draft') throw conflict(`Credit note is ${c.status}`);
      const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, c.hotelId));
      const settings = await getSettings(tx);
      const number = await nextDocumentNumber(tx, 'credit_note');
      const date = todayNepal();
      const [u] = await tx
        .update(creditNotes)
        .set({
          status: 'issued',
          creditNoteNumber: number,
          noteDate: date,
          fiscalYear: settings.fiscalYearLabel,
          sellerSnapshot: sellerSnapshot(settings),
          customerSnapshot: customerSnapshot(hotel!),
          issuedBy: ctx.actor.id,
          issuedAt: new Date(),
        })
        .where(eq(creditNotes.id, id))
        .returning();
      await postLedger(tx, ctx, {
        entryDate: date,
        account: 'accounts_receivable',
        partyId: c.hotelId,
        sourceType: 'credit_note',
        sourceId: id,
        reference: number,
        credit: c.total,
        memo: c.reason,
      });
      await audit(tx, ctx, {
        action: 'credit_note.issued',
        entityType: 'credit_note',
        entityId: id,
        hotelId: c.hotelId,
        reason: c.reason,
        after: { creditNoteNumber: number, total: c.total },
      });
      return u!;
    });
    return { creditNote: cn };
  });

  app.get('/credit-notes', { preHandler: viewFinance }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(z.object({ hotelId: z.uuid().optional() }), req.query);
    const hotelId = hotelFilter(ctx, q.hotelId);
    const conds = [];
    if (hotelId) conds.push(eq(creditNotes.hotelId, hotelId));
    if (!isInternal(ctx)) conds.push(eq(creditNotes.status, 'issued'));
    const rows = await db
      .select({ c: creditNotes, invoiceNumber: invoices.invoiceNumber, hotelName: hotels.legalName })
      .from(creditNotes)
      .innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
      .innerJoin(hotels, eq(hotels.id, creditNotes.hotelId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(creditNotes.createdAt));
    return {
      items: rows.map((r) => ({
        ...r.c,
        sellerSnapshot: undefined,
        customerSnapshot: undefined,
        invoiceNumber: r.invoiceNumber,
        hotelName: r.hotelName,
      })),
    };
  });

  app.get('/credit-notes/:id', { preHandler: viewFinance }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const [c] = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
    if (!c || (!isInternal(ctx) && c.status !== 'issued')) throw notFound('Credit note');
    assertHotelAccess(ctx, c.hotelId, 'Credit note');
    const lines = await db.select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, id));
    const [inv] = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(eq(invoices.id, c.invoiceId));
    return { creditNote: c, lines, invoiceNumber: inv?.invoiceNumber };
  });

  /* ---------------------------- supplier bills --------------------------- */

  app.get('/supplier-bills', { preHandler: guard('bills.manage', 'finance.view_all') }, async (req) => {
    const q = parse(
      z.object({
        supplierId: z.uuid().optional(),
        status: z.enum(['draft', 'posted', 'discarded']).optional(),
      }),
      req.query,
    );
    const conds = [];
    if (q.supplierId) conds.push(eq(supplierBills.supplierId, q.supplierId));
    if (q.status) conds.push(eq(supplierBills.status, q.status));
    const rows = await db
      .select({ b: supplierBills, supplierName: suppliers.name, poNumber: purchaseOrders.poNumber })
      .from(supplierBills)
      .innerJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, supplierBills.poId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(supplierBills.createdAt))
      .limit(500);
    const out = await billOutstanding(
      db,
      rows.filter((r) => r.b.status === 'posted').map((r) => r.b.id),
    );
    const today = todayNepal();
    return {
      items: rows.map((r) => {
        const o = out.get(r.b.id) ?? null;
        return {
          ...r.b,
          supplierName: r.supplierName,
          poNumber: r.poNumber,
          outstanding: o,
          overdue: r.b.status === 'posted' && o !== null && cmpMoney(o, '0') > 0 && r.b.dueDate < today,
        };
      }),
    };
  });

  app.get('/supplier-bills/:id', { preHandler: guard('bills.manage', 'finance.view_all') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [b] = await db.select().from(supplierBills).where(eq(supplierBills.id, id));
    if (!b) throw notFound('Bill');
    const lines = await db
      .select()
      .from(supplierBillLines)
      .where(eq(supplierBillLines.billId, id))
      .orderBy(asc(supplierBillLines.lineNo));
    const allocations = await db
      .select({
        a: paymentAllocations,
        paymentNumber: payments.paymentNumber,
        paymentDate: payments.paymentDate,
        method: payments.method,
        reference: payments.reference,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(and(eq(paymentAllocations.billId, id), isNull(paymentAllocations.reversedAt)));
    const [s] = await db
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.id, b.supplierId));
    return {
      bill: b,
      supplierName: s?.name,
      lines,
      outstanding: b.status === 'posted' ? (await billOutstanding(db, [id])).get(id) : null,
      allocations: allocations.map((r) => ({
        ...r.a,
        paymentNumber: r.paymentNumber,
        paymentDate: r.paymentDate,
        method: r.method,
        reference: r.reference,
      })),
    };
  });

  app.post('/supplier-bills', { preHandler: guard('bills.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        supplierId: z.uuid(),
        supplierBillNumber: z.string().min(1).max(60),
        poId: z.uuid().nullable().optional(),
        billDate: z.iso.date(),
        dueDate: z.iso.date().optional(),
        attachmentId: z.uuid().nullable().optional(),
        notes: z.string().nullable().optional(),
        /** If omitted and poId is given, lines are copied from received quantities at PO cost. */
        lines: z
          .array(
            z.object({
              poLineId: z.uuid().nullable().optional(),
              productId: z.uuid().nullable().optional(),
              description: z.string().min(1),
              quantity: qtyStr,
              unitCost: moneyStr,
              taxRate: rateStr.default('0'),
            }),
          )
          .optional(),
      }),
      req.body,
    );
    const bill = await db.transaction(async (tx) => {
      const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, body.supplierId));
      if (!s) throw notFound('Supplier');
      let lines = body.lines;
      if (body.poId) {
        const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, body.poId));
        if (!po || po.supplierId !== body.supplierId)
          throw badRequest('Purchase order does not belong to this supplier');
        if (!lines) {
          const rows = await tx.execute<{
            id: string;
            product_id: string;
            name_en: string;
            unit_cost: string;
            tax_rate: string;
            accepted: string;
          }>(sql`
            select pl.id, pl.product_id, p.name_en, pl.unit_cost::text, pl.tax_rate::text,
              coalesce((select sum(g.qty_accepted) from goods_receipt_lines g where g.po_line_id = pl.id), 0)::numeric(14,3)::text as accepted
            from po_lines pl join products p on p.id = pl.product_id where pl.po_id = ${po.id} order by pl.line_no`);
          lines = rows.rows
            .filter((r) => cmpQty(r.accepted, '0') > 0)
            .map((r) => ({
              poLineId: r.id,
              productId: r.product_id,
              description: r.name_en,
              quantity: r.accepted,
              unitCost: r.unit_cost,
              taxRate: r.tax_rate,
            }));
        }
      }
      if (!lines?.length) throw badRequest('A bill needs at least one line');
      const billLines = lines.map((l, i) => {
        const taxableAmount = lineAmount(l.quantity, l.unitCost);
        const taxAmount = percentOf(taxableAmount, l.taxRate);
        return {
          lineNo: i + 1,
          poLineId: l.poLineId ?? null,
          productId: l.productId ?? null,
          description: l.description,
          quantity: l.quantity,
          unitCost: l.unitCost,
          taxRate: l.taxRate,
          taxableAmount,
          taxAmount,
          lineTotal: addMoney(taxableAmount, taxAmount),
        };
      });
      const totals = computeDocTotals(billLines);
      const internalRef = await nextDocumentNumber(tx, 'supplier_bill');
      const [b] = await tx
        .insert(supplierBills)
        .values({
          internalRef,
          supplierId: body.supplierId,
          supplierBillNumber: body.supplierBillNumber,
          poId: body.poId ?? null,
          billDate: body.billDate,
          dueDate: body.dueDate ?? addDays(body.billDate, s.paymentTermsDays),
          attachmentId: body.attachmentId ?? null,
          notes: body.notes ?? null,
          taxableTotal: addMoney(totals.taxableTotal, totals.exemptTotal),
          taxTotal: totals.taxTotal,
          total: totals.total,
          createdBy: ctx.actor.id,
        })
        .returning();
      await tx.insert(supplierBillLines).values(billLines.map((l) => ({ ...l, billId: b!.id })));
      await audit(tx, ctx, {
        action: 'supplier_bill.draft_created',
        entityType: 'supplier_bill',
        entityId: b!.id,
        after: { internalRef, supplierBillNumber: b!.supplierBillNumber, total: b!.total },
      });
      return b!;
    });
    return { bill };
  });

  app.post('/supplier-bills/:id/post', { preHandler: guard('bills.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const bill = await db.transaction(async (tx) => {
      const [b] = await tx.select().from(supplierBills).where(eq(supplierBills.id, id)).for('update');
      if (!b) throw notFound('Bill');
      if (b.status !== 'draft') throw conflict(`Bill is ${b.status}`);
      const [u] = await tx
        .update(supplierBills)
        .set({ status: 'posted', postedBy: ctx.actor.id, postedAt: new Date(), updatedAt: new Date() })
        .where(eq(supplierBills.id, id))
        .returning();
      await postLedger(tx, ctx, {
        entryDate: b.billDate,
        account: 'accounts_payable',
        partyId: b.supplierId,
        sourceType: 'supplier_bill',
        sourceId: id,
        reference: b.supplierBillNumber,
        credit: b.total,
        memo: `Supplier bill ${b.supplierBillNumber}`,
      });
      await audit(tx, ctx, {
        action: 'supplier_bill.posted',
        entityType: 'supplier_bill',
        entityId: id,
        after: { total: b.total },
      });
      return u!;
    });
    return { bill };
  });

  app.post('/supplier-bills/:id/discard', { preHandler: guard('bills.manage') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(supplierBills).where(eq(supplierBills.id, id)).for('update');
      if (!b) throw notFound('Bill');
      if (b.status !== 'draft') throw conflict('Only draft bills can be discarded');
      await tx
        .update(supplierBills)
        .set({ status: 'discarded', notes: reason })
        .where(eq(supplierBills.id, id));
      await audit(tx, ctx, {
        action: 'supplier_bill.discarded',
        entityType: 'supplier_bill',
        entityId: id,
        reason,
      });
    });
    return { ok: true };
  });

  /* ------------------------------ payments ------------------------------ */

  app.get('/payments', { preHandler: viewFinance }, async (req) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({
        direction: z.enum(['inbound', 'outbound']).optional(),
        hotelId: z.uuid().optional(),
        supplierId: z.uuid().optional(),
      }),
      req.query,
    );
    const conds = [];
    if (!isInternal(ctx)) {
      conds.push(eq(payments.hotelId, ctx.actor.hotelId!));
    } else {
      if (q.direction) conds.push(eq(payments.direction, q.direction));
      if (q.hotelId) conds.push(eq(payments.hotelId, q.hotelId));
      if (q.supplierId) conds.push(eq(payments.supplierId, q.supplierId));
    }
    const rows = await db
      .select({
        p: payments,
        hotelName: hotels.legalName,
        supplierName: suppliers.name,
        recordedByName: users.name,
        allocated: sql<string>`coalesce((select sum(pa.amount) from payment_allocations pa where pa.payment_id = payments.id and pa.reversed_at is null), 0)::numeric(14,2)::text`,
      })
      .from(payments)
      .leftJoin(hotels, eq(hotels.id, payments.hotelId))
      .leftJoin(suppliers, eq(suppliers.id, payments.supplierId))
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
      .limit(500);
    return {
      items: rows.map((r) => ({
        ...r.p,
        hotelName: r.hotelName,
        supplierName: isInternal(ctx) ? r.supplierName : undefined,
        recordedByName: isInternal(ctx) ? r.recordedByName : undefined,
        allocated: r.allocated,
        unallocated: r.p.status === 'recorded' ? subMoney(r.p.amount, r.allocated) : '0.00',
      })),
    };
  });

  /** Record money that moved outside the platform (bank transfer, cash, cheque, wallet). */
  app.post('/payments', { preHandler: guard('payments.record') }, async (req) => {
    const ctx = ctxOf(req);
    const body = parse(
      z.object({
        direction: z.enum(['inbound', 'outbound']),
        hotelId: z.uuid().optional(),
        supplierId: z.uuid().optional(),
        amount: moneyStr,
        method: z.enum(PAYMENT_METHODS),
        reference: z.string().max(100).nullable().optional(),
        paymentDate: z.iso.date(),
        notes: z.string().max(1000).nullable().optional(),
        attachmentId: z.uuid().nullable().optional(),
        allocations: z
          .array(z.object({ invoiceId: z.uuid().optional(), billId: z.uuid().optional(), amount: moneyStr }))
          .default([]),
        idempotencyKey: z.string().min(8).max(100).optional(),
      }),
      req.body,
    );
    if (cmpMoney(body.amount, '0') <= 0) throw badRequest('Amount must be positive');
    if (body.paymentDate > todayNepal()) throw badRequest('Payment date cannot be in the future');
    if (body.direction === 'inbound' && (!body.hotelId || body.supplierId))
      throw badRequest('Customer payments need a hotel');
    if (body.direction === 'outbound' && (!body.supplierId || body.hotelId))
      throw badRequest('Supplier payments need a supplier');
    if (['bank_transfer', 'cheque', 'mobile_wallet'].includes(body.method) && !body.reference)
      throw badRequest('A transaction reference is required for this payment method');
    if (body.idempotencyKey) {
      const [dup] = await db.select().from(payments).where(eq(payments.idempotencyKey, body.idempotencyKey));
      if (dup) return { payment: dup, duplicate: true };
    }
    const result = await db.transaction(async (tx) => {
      const paymentNumber = await nextDocumentNumber(
        tx,
        body.direction === 'inbound' ? 'payment_in' : 'payment_out',
      );
      const [p] = await tx
        .insert(payments)
        .values({
          paymentNumber,
          direction: body.direction,
          hotelId: body.hotelId ?? null,
          supplierId: body.supplierId ?? null,
          amount: body.amount,
          method: body.method,
          reference: body.reference ?? null,
          paymentDate: body.paymentDate,
          notes: body.notes ?? null,
          attachmentId: body.attachmentId ?? null,
          recordedBy: ctx.actor.id,
          idempotencyKey: body.idempotencyKey ?? null,
        })
        .returning();
      if (body.direction === 'inbound') {
        await postLedger(tx, ctx, {
          entryDate: body.paymentDate,
          account: 'accounts_receivable',
          partyId: body.hotelId!,
          sourceType: 'payment',
          sourceId: p!.id,
          reference: paymentNumber,
          credit: body.amount,
          memo: `${body.method} ${body.reference ?? ''}`.trim(),
        });
      } else {
        await postLedger(tx, ctx, {
          entryDate: body.paymentDate,
          account: 'accounts_payable',
          partyId: body.supplierId!,
          sourceType: 'payment',
          sourceId: p!.id,
          reference: paymentNumber,
          debit: body.amount,
          memo: `${body.method} ${body.reference ?? ''}`.trim(),
        });
      }
      await audit(tx, ctx, {
        action: 'payment.recorded',
        entityType: 'payment',
        entityId: p!.id,
        hotelId: p!.hotelId,
        after: {
          paymentNumber,
          direction: p!.direction,
          amount: p!.amount,
          method: p!.method,
          reference: p!.reference,
        },
      });
      const unallocated = await allocate(tx, ctx, p!, body.allocations);
      return { payment: p!, unallocated };
    });
    return result;
  });

  app.post('/payments/:id/allocations', { preHandler: guard('payments.record') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        allocations: z
          .array(z.object({ invoiceId: z.uuid().optional(), billId: z.uuid().optional(), amount: moneyStr }))
          .min(1),
      }),
      req.body,
    );
    const unallocated = await db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
      if (!p) throw notFound('Payment');
      if (p.status !== 'recorded') throw conflict('Payment has been reversed');
      return allocate(tx, ctx, p, body.allocations);
    });
    return { unallocated };
  });

  /** Reverse a mistaken payment record. The original stays; a reversing ledger entry is added. */
  app.post('/payments/:id/reverse', { preHandler: guard('payments.reverse') }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(5) }), req.body);
    const p = await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
      if (!cur) throw notFound('Payment');
      if (cur.status === 'reversed') throw conflict('Payment is already reversed');
      await tx
        .update(paymentAllocations)
        .set({ reversedAt: new Date() })
        .where(and(eq(paymentAllocations.paymentId, id), isNull(paymentAllocations.reversedAt)));
      const [u] = await tx
        .update(payments)
        .set({ status: 'reversed', reversedBy: ctx.actor.id, reversedAt: new Date(), reversalReason: reason })
        .where(eq(payments.id, id))
        .returning();
      const inbound = cur.direction === 'inbound';
      await postLedger(tx, ctx, {
        entryDate: todayNepal(),
        account: inbound ? 'accounts_receivable' : 'accounts_payable',
        partyId: (inbound ? cur.hotelId : cur.supplierId)!,
        sourceType: 'payment_reversal',
        sourceId: id,
        reference: cur.paymentNumber,
        debit: inbound ? cur.amount : undefined,
        credit: inbound ? undefined : cur.amount,
        memo: `Reversal: ${reason}`,
      });
      await audit(tx, ctx, {
        action: 'payment.reversed',
        entityType: 'payment',
        entityId: id,
        hotelId: cur.hotelId,
        reason,
        before: { status: 'recorded' },
        after: { status: 'reversed' },
      });
      return u!;
    });
    return { payment: p };
  });

  /* ---------------------- adjustments (write-offs) ---------------------- */

  app.post(
    '/financial-adjustments',
    { preHandler: guard('invoices.manage', 'bills.manage') },
    async (req) => {
      const ctx = ctxOf(req);
      const body = parse(
        z.object({
          account: z.enum(['accounts_receivable', 'accounts_payable']),
          hotelId: z.uuid().optional(),
          supplierId: z.uuid().optional(),
          amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
          reason: z.string().min(5),
        }),
        req.body,
      );
      if (toPaisa(body.amount) === 0n) throw badRequest('Amount cannot be zero');
      if (
        (body.account === 'accounts_receivable') !== Boolean(body.hotelId) ||
        (body.account === 'accounts_payable') !== Boolean(body.supplierId)
      ) {
        throw badRequest('Receivable adjustments need a hotel; payable adjustments need a supplier');
      }
      return db.transaction(async (tx) => {
        const [adj] = await tx
          .insert(financialAdjustments)
          .values({
            account: body.account,
            hotelId: body.hotelId ?? null,
            supplierId: body.supplierId ?? null,
            amount: body.amount,
            reason: body.reason,
            createdBy: ctx.actor.id,
          })
          .returning();
        // Every financial adjustment needs the owner's approval; the owner's own is posted directly (audited).
        if (can(ctx, 'approvals.decide')) {
          await postAdjustment(tx, ctx, adj!);
          return { applied: true, adjustment: adj };
        }
        const approval = await requestApproval(tx, ctx, {
          type: 'financial_adjustment',
          targetType: 'financial_adjustment',
          targetId: adj!.id,
          hotelId: body.hotelId ?? null,
          amount: body.amount.replace('-', ''),
          summary: `${body.account === 'accounts_receivable' ? 'Receivable' : 'Payable'} adjustment of NPR ${body.amount}: ${body.reason}`,
          details: body,
        });
        await tx
          .update(financialAdjustments)
          .set({ approvalId: approval.id })
          .where(eq(financialAdjustments.id, adj!.id));
        return { applied: false, approval };
      });
    },
  );

  /* --------------------------- statements etc --------------------------- */

  app.get('/finance/hotels/:id/summary', { preHandler: viewFinance }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    assertHotelAccess(ctx, id, 'Hotel');
    const [h] = await db.select().from(hotels).where(eq(hotels.id, id));
    if (!h) throw notFound('Hotel');
    const settings = await getSettings(db);
    const balance = await hotelBalance(db, id);
    const openOrders = await openOrderExposure(db, id);
    const overdue = await hotelOverdue(db, id, settings.creditOverdueGraceDays);
    const exposure = addMoney(balance, openOrders);
    return {
      hotelId: id,
      balance,
      creditLimit: h.creditLimit,
      paymentTermsDays: h.paymentTermsDays,
      openOrders,
      exposure,
      availableCredit: subMoney(h.creditLimit, exposure),
      utilizationPercent:
        cmpMoney(h.creditLimit, '0') === 0 ? null : marginPercentOf(exposure, h.creditLimit),
      overdue,
      accountStatus: h.status,
    };
  });

  app.get('/finance/hotels/:id/statement', { preHandler: viewFinance }, async (req) => {
    const ctx = ctxOf(req);
    const { id } = parse(idParam, req.params);
    assertHotelAccess(ctx, id, 'Hotel');
    const q = parse(
      z.object({
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        format: z.enum(['json', 'csv']).default('json'),
      }),
      req.query,
    );
    return statement(db, 'accounts_receivable', id, q.from, q.to);
  });

  app.get('/finance/suppliers/:id/statement', { preHandler: guard('finance.view_all') }, async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
    const result = await statement(db, 'accounts_payable', id, q.from, q.to);
    return { ...result, balance: await supplierBalance(db, id) };
  });

  app.get('/finance/ar-aging', { preHandler: viewFinance }, async (req, reply) => {
    const ctx = ctxOf(req);
    const q = parse(
      z.object({ hotelId: z.uuid().optional(), format: z.enum(['json', 'csv']).default('json') }),
      req.query,
    );
    const data = await arAging(db, hotelFilter(ctx, q.hotelId));
    if (q.format === 'csv')
      return reply
        .type('text/csv')
        .header('content-disposition', 'attachment; filename="ar-aging.csv"')
        .send(toCsv(data.rows));
    return data;
  });

  app.get('/finance/ap-aging', { preHandler: guard('finance.view_all') }, async (req, reply) => {
    const q = parse(z.object({ format: z.enum(['json', 'csv']).default('json') }), req.query);
    const data = await apAging(db);
    if (q.format === 'csv')
      return reply
        .type('text/csv')
        .header('content-disposition', 'attachment; filename="ap-aging.csv"')
        .send(toCsv(data.rows));
    return data;
  });

  app.get('/finance/orders/:id/margin', { preHandler: guard('costs.view') }, async (req) => {
    const { id } = parse(idParam, req.params);
    return orderMargin(db, id);
  });
}

/** exposure as a percentage of the limit, 2 decimals. */
function marginPercentOf(part: string, whole: string): string {
  const w = toPaisa(whole);
  const v = (toPaisa(part) * 10_000n + w / 2n) / w;
  const str = v.toString().padStart(3, '0');
  return `${str.slice(0, -2)}.${str.slice(-2)}`;
}

async function statement(
  db: DbOrTx,
  account: 'accounts_receivable' | 'accounts_payable',
  partyId: string,
  from?: string,
  to?: string,
) {
  const sign = (r: { debit: string; credit: string }) =>
    account === 'accounts_receivable' ? subMoney(r.debit, r.credit) : subMoney(r.credit, r.debit);
  let opening = '0.00';
  if (from) {
    const [o] = await db
      .select({
        d: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)::numeric(14,2)::text`,
        c: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)::numeric(14,2)::text`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.account, account),
          eq(ledgerEntries.partyId, partyId),
          sql`${ledgerEntries.entryDate} < ${from}`,
        ),
      );
    opening = sign({ debit: o!.d, credit: o!.c });
  }
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.account, account),
        eq(ledgerEntries.partyId, partyId),
        from ? sql`${ledgerEntries.entryDate} >= ${from}` : undefined,
        to ? sql`${ledgerEntries.entryDate} <= ${to}` : undefined,
      ),
    )
    .orderBy(asc(ledgerEntries.entryDate), asc(ledgerEntries.id));
  let running = opening;
  const entries = rows.map((r) => {
    running = addMoney(running, sign(r));
    return {
      id: r.id,
      date: r.entryDate,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      reference: r.reference,
      memo: r.memo,
      debit: r.debit,
      credit: r.credit,
      balance: running,
    };
  });
  return { account, partyId, from: from ?? null, to: to ?? null, opening, closing: running, entries };
}

registerApprovalHandler('financial_adjustment', {
  async onApprove(tx, ctx, req) {
    const [adj] = await tx
      .select()
      .from(financialAdjustments)
      .where(eq(financialAdjustments.id, req.targetId))
      .for('update');
    if (!adj || adj.status !== 'pending_approval') return;
    await postAdjustment(tx, ctx, adj, req.id);
  },
  async onReject(tx, _ctx, req) {
    await tx
      .update(financialAdjustments)
      .set({ status: 'rejected' })
      .where(eq(financialAdjustments.id, req.targetId));
  },
});
