import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { addMoney, cmpMoney, marginPercent, subMoney } from '@hp/shared';
import { ctxOf, guard } from '../plugins/auth';
import { can, hotelFilter } from '../lib/context';
import { forbidden } from '../lib/errors';
import { parse, todayNepal, toCsv, addDays } from '../lib/http';
import { apAging, arAging } from './finance';

const range = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  hotelId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  productId: z.uuid().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

function send(
  reply: FastifyReply,
  name: string,
  format: 'json' | 'csv',
  rows: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  if (format === 'csv') {
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}-${todayNepal()}.csv"`)
      .send('﻿' + toCsv(rows));
  }
  return { rows, ...extra };
}

/**
 * Role-appropriate reports. Every query is parameterised; hotel users are forced
 * to their own hotel and only get reports that contain no costs or margins.
 */
export async function reportRoutes(app: FastifyInstance) {
  const db = app.db;
  const defaults = (q: z.infer<typeof range>) => ({
    from: q.from ?? addDays(todayNepal(), -30),
    to: q.to ?? todayNepal(),
  });
  const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    (await db.execute<T>(query)).rows;

  /* ----------------------------- business ----------------------------- */

  app.get(
    '/reports/sales',
    { preHandler: guard('reports.business', 'reports.own_hotel') },
    async (req, reply) => {
      const ctx = ctxOf(req);
      const q = parse(
        range.extend({ groupBy: z.enum(['hotel', 'month', 'day']).default('hotel') }),
        req.query,
      );
      const { from, to } = defaults(q);
      const hotelId = hotelFilter(ctx, q.hotelId);
      const key =
        q.groupBy === 'hotel'
          ? sql`h.legal_name`
          : q.groupBy === 'month'
            ? sql`to_char(i.invoice_date, 'YYYY-MM')`
            : sql`i.invoice_date::text`;
      const data = await rows(sql`
      select ${key} as "group",
        count(*)::int as invoices,
        sum(i.taxable_total + i.exempt_total)::numeric(14,2)::text as net_sales,
        sum(i.tax_total)::numeric(14,2)::text as tax,
        sum(i.total)::numeric(14,2)::text as gross_sales,
        coalesce(sum((select sum(cn.total) from credit_notes cn where cn.invoice_id = i.id and cn.status = 'issued')), 0)::numeric(14,2)::text as credit_notes
      from invoices i join hotels h on h.id = i.hotel_id
      where i.status = 'issued' and i.invoice_date between ${from} and ${to}
        ${hotelId ? sql`and i.hotel_id = ${hotelId}` : sql``}
      group by 1 order by 1`);
      return send(reply, 'sales', q.format, data, { from, to });
    },
  );

  app.get('/reports/purchases', { preHandler: guard('reports.business') }, async (req, reply) => {
    const q = parse(range, req.query);
    const { from, to } = defaults(q);
    const data = await rows(sql`
      select s.name as supplier,
        count(distinct po.id)::int as purchase_orders,
        coalesce(sum(po.total) filter (where po.status not in ('draft','pending_approval','rejected','cancelled')), 0)::numeric(14,2)::text as committed_po_value,
        coalesce((select sum(b.total) from supplier_bills b where b.supplier_id = s.id and b.status = 'posted' and b.bill_date between ${from} and ${to}), 0)::numeric(14,2)::text as billed
      from suppliers s left join purchase_orders po on po.supplier_id = s.id and po.created_at::date between ${from} and ${to}
      ${q.supplierId ? sql`where s.id = ${q.supplierId}` : sql``}
      group by s.id, s.name order by s.name`);
    return send(reply, 'purchases', q.format, data, { from, to });
  });

  /** Gross margin on issued invoices. Cost basis: average PO unit cost for the order line, else reference cost. */
  app.get('/reports/margin', { preHandler: guard('reports.business') }, async (req, reply) => {
    if (!can(ctxOf(req), 'costs.view')) throw forbidden();
    const q = parse(
      range.extend({ groupBy: z.enum(['product', 'category', 'hotel']).default('product') }),
      req.query,
    );
    const { from, to } = defaults(q);
    const key =
      q.groupBy === 'product'
        ? sql`p.name_en`
        : q.groupBy === 'category'
          ? sql`c.name_en`
          : sql`h.legal_name`;
    const data = await rows<{ group: string; revenue: string; cost: string }>(sql`
      with lines as (
        select il.quantity, il.taxable_amount, il.product_id, p.category_id, i.hotel_id,
          coalesce((select sum(pl.unit_cost * pl.quantity) / nullif(sum(pl.quantity), 0) from po_lines pl join purchase_orders po on po.id = pl.po_id
                    where pl.order_line_id = il.order_line_id and po.status not in ('cancelled','rejected')), p.reference_cost) as unit_cost
        from invoice_lines il join invoices i on i.id = il.invoice_id join products p on p.id = il.product_id
        where i.status = 'issued' and i.invoice_date between ${from} and ${to}
          ${q.hotelId ? sql`and i.hotel_id = ${q.hotelId}` : sql``}
      )
      select ${key} as "group",
        sum(l.taxable_amount)::numeric(14,2)::text as revenue,
        sum(round(l.quantity * l.unit_cost, 2))::numeric(14,2)::text as cost
      from lines l join products p on p.id = l.product_id join categories c on c.id = l.category_id join hotels h on h.id = l.hotel_id
      group by 1 order by 2 desc`);
    const out = data.map((r) => ({
      ...r,
      gross_margin: subMoney(r.revenue, r.cost),
      margin_percent: marginPercent(r.revenue, r.cost),
    }));
    return send(reply, 'margin', q.format, out, { from, to, costBasis: 'purchase_order_average_cost' });
  });

  app.get(
    '/reports/top-products',
    { preHandler: guard('reports.business', 'reports.own_hotel') },
    async (req, reply) => {
      const ctx = ctxOf(req);
      const q = parse(range, req.query);
      const { from, to } = defaults(q);
      const hotelId = hotelFilter(ctx, q.hotelId);
      const data = await rows(sql`
      select p.sku, p.name_en, p.name_ne, p.selling_unit as unit,
        sum(ol.quantity - ol.cancelled_qty)::numeric(14,3)::text as quantity,
        count(distinct o.id)::int as orders,
        count(distinct o.hotel_id)::int as hotels
      from order_lines ol join orders o on o.id = ol.order_id join products p on p.id = ol.product_id
      where o.status not in ('draft','cancelled','rejected','pending_hotel_approval') and o.submitted_at::date between ${from} and ${to}
        ${hotelId ? sql`and o.hotel_id = ${hotelId}` : sql``}
      group by p.id order by sum(ol.quantity - ol.cancelled_qty) desc limit 50`);
      const requested = await rows(sql`
      select lower(trim(description)) as description, count(*)::int as times, max(created_at) as last_requested
      from product_requests where created_at::date between ${from} and ${to} ${hotelId ? sql`and hotel_id = ${hotelId}` : sql``}
      group by 1 order by 2 desc limit 20`);
      return send(reply, 'top-products', q.format, data, { from, to, frequentlyRequested: requested });
    },
  );

  /* ----------------------------- financial ---------------------------- */

  app.get(
    '/reports/ar-aging',
    { preHandler: guard('reports.financial', 'reports.own_hotel') },
    async (req, reply) => {
      const ctx = ctxOf(req);
      const q = parse(range, req.query);
      const data = await arAging(db, hotelFilter(ctx, q.hotelId));
      return send(reply, 'ar-aging', q.format, data.rows, { asOf: data.asOf, totals: data.totals });
    },
  );

  app.get('/reports/ap-aging', { preHandler: guard('reports.financial') }, async (req, reply) => {
    const q = parse(range, req.query);
    const data = await apAging(db);
    return send(reply, 'ap-aging', q.format, data.rows, { asOf: data.asOf, totals: data.totals });
  });

  app.get('/reports/credit-utilization', { preHandler: guard('reports.financial') }, async (req, reply) => {
    const q = parse(range, req.query);
    const data = await rows<{
      hotel: string;
      credit_limit: string;
      balance: string;
      open_orders: string;
    }>(sql`
      select h.legal_name as hotel, h.status, h.credit_limit::text, h.payment_terms_days,
        coalesce((select sum(le.debit - le.credit) from ledger_entries le where le.account = 'accounts_receivable' and le.party_id = h.id), 0)::numeric(14,2)::text as balance,
        coalesce((select sum(greatest(o.total - coalesce((select sum(i.total) from invoices i where i.order_id = o.id and i.status <> 'discarded'), 0), 0))
                  from orders o where o.hotel_id = h.id and o.status in ('pending_approval','approved','procurement','consolidating','ready_for_dispatch','dispatched','partially_delivered','delivered')), 0)::numeric(14,2)::text as open_orders
      from hotels h order by h.legal_name`);
    const out = data.map((r) => {
      const exposure = addMoney(r.balance, r.open_orders);
      return {
        ...r,
        exposure,
        available: subMoney(r.credit_limit, exposure),
        over_limit: cmpMoney(exposure, r.credit_limit) > 0,
      };
    });
    return send(reply, 'credit-utilization', q.format, out);
  });

  app.get(
    '/reports/collections',
    { preHandler: guard('reports.financial', 'reports.own_hotel') },
    async (req, reply) => {
      const ctx = ctxOf(req);
      const q = parse(
        range.extend({ direction: z.enum(['inbound', 'outbound']).default('inbound') }),
        req.query,
      );
      if (q.direction === 'outbound' && !can(ctx, 'reports.financial')) throw forbidden();
      const { from, to } = defaults(q);
      const hotelId = hotelFilter(ctx, q.hotelId);
      const data = await rows(sql`
      select p.payment_date::text as date, p.payment_number, coalesce(h.legal_name, s.name) as party, p.method, p.reference, p.amount::text, p.status,
        coalesce((select sum(pa.amount) from payment_allocations pa where pa.payment_id = p.id and pa.reversed_at is null), 0)::numeric(14,2)::text as allocated
      from payments p left join hotels h on h.id = p.hotel_id left join suppliers s on s.id = p.supplier_id
      where p.direction = ${q.direction} and p.payment_date between ${from} and ${to}
        ${hotelId ? sql`and p.hotel_id = ${hotelId}` : sql``}
        ${q.supplierId ? sql`and p.supplier_id = ${q.supplierId}` : sql``}
      order by p.payment_date desc, p.payment_number desc`);
      const recorded = data.filter((r) => r.status === 'recorded').map((r) => r.amount as string);
      return send(reply, `payments-${q.direction}`, q.format, data, {
        from,
        to,
        total: addMoney('0', ...recorded),
      });
    },
  );

  /** Owner reconciliation: document totals vs. ledger, receivables, payables and margin in one place. */
  app.get('/reports/reconciliation', { preHandler: guard('reports.financial') }, async (req) => {
    if (!can(ctxOf(req), 'costs.view')) throw forbidden();
    const q = parse(range, req.query);
    const { from, to } = defaults(q);
    const [r] = await rows<Record<string, string>>(sql`
      select
        coalesce((select sum(total) from invoices where status = 'issued'), 0)::numeric(14,2)::text as invoices_issued,
        coalesce((select sum(total) from credit_notes where status = 'issued'), 0)::numeric(14,2)::text as credit_notes_issued,
        coalesce((select sum(amount) from payments where direction = 'inbound' and status = 'recorded'), 0)::numeric(14,2)::text as customer_payments,
        coalesce((select sum(amount) from financial_adjustments where account = 'accounts_receivable' and status = 'posted'), 0)::numeric(14,2)::text as ar_adjustments,
        coalesce((select sum(debit - credit) from ledger_entries where account = 'accounts_receivable'), 0)::numeric(14,2)::text as ar_ledger_balance,
        coalesce((select sum(total) from supplier_bills where status = 'posted'), 0)::numeric(14,2)::text as bills_posted,
        coalesce((select sum(amount) from payments where direction = 'outbound' and status = 'recorded'), 0)::numeric(14,2)::text as supplier_payments,
        coalesce((select sum(amount) from financial_adjustments where account = 'accounts_payable' and status = 'posted'), 0)::numeric(14,2)::text as ap_adjustments,
        coalesce((select sum(credit - debit) from ledger_entries where account = 'accounts_payable'), 0)::numeric(14,2)::text as ap_ledger_balance,
        coalesce((select sum(taxable_total + exempt_total) from invoices where status = 'issued' and invoice_date between ${from} and ${to}), 0)::numeric(14,2)::text as period_net_sales,
        coalesce((select sum(taxable_total) from credit_notes where status = 'issued' and note_date between ${from} and ${to}), 0)::numeric(14,2)::text as period_net_credits,
        coalesce((select sum(taxable_total) from supplier_bills where status = 'posted' and bill_date between ${from} and ${to}), 0)::numeric(14,2)::text as period_net_purchases,
        coalesce((select sum(tax_total) from invoices where status = 'issued' and invoice_date between ${from} and ${to}), 0)::numeric(14,2)::text as period_output_tax,
        coalesce((select sum(tax_total) from supplier_bills where status = 'posted' and bill_date between ${from} and ${to}), 0)::numeric(14,2)::text as period_input_tax
    `);
    const arFromDocs = addMoney(
      subMoney(subMoney(r!.invoices_issued!, r!.credit_notes_issued!), r!.customer_payments!),
      r!.ar_adjustments!,
    );
    const apFromDocs = addMoney(subMoney(r!.bills_posted!, r!.supplier_payments!), r!.ap_adjustments!);
    const periodNetRevenue = subMoney(r!.period_net_sales!, r!.period_net_credits!);
    return {
      from,
      to,
      receivables: {
        ...pick(r!, ['invoices_issued', 'credit_notes_issued', 'customer_payments', 'ar_adjustments']),
        fromDocuments: arFromDocs,
        ledgerBalance: r!.ar_ledger_balance,
        reconciled: arFromDocs === r!.ar_ledger_balance,
      },
      payables: {
        ...pick(r!, ['bills_posted', 'supplier_payments', 'ap_adjustments']),
        fromDocuments: apFromDocs,
        ledgerBalance: r!.ap_ledger_balance,
        reconciled: apFromDocs === r!.ap_ledger_balance,
      },
      period: {
        netRevenue: periodNetRevenue,
        netPurchases: r!.period_net_purchases,
        grossMarginOnBilledCost: subMoney(periodNetRevenue, r!.period_net_purchases!),
        outputTax: r!.period_output_tax,
        inputTax: r!.period_input_tax,
        note: 'Period margin compares invoiced revenue with supplier bills dated in the same period; use /reports/margin or the order margin view for matched margin.',
      },
    };
  });

  /* ----------------------------- inventory ---------------------------- */

  app.get(
    '/reports/hotel-usage',
    { preHandler: guard('reports.inventory', 'reports.own_hotel') },
    async (req, reply) => {
      const ctx = ctxOf(req);
      const q = parse(range, req.query);
      const { from, to } = defaults(q);
      const hotelId = hotelFilter(ctx, q.hotelId);
      const data = await rows(sql`
      select h.legal_name as hotel, p.name_en, p.name_ne, p.selling_unit as unit,
        (-sum(m.quantity) filter (where m.movement_type = 'usage'))::numeric(14,3)::text as used,
        (sum(m.quantity) filter (where m.movement_type = 'restock'))::numeric(14,3)::text as restocked,
        (sum(m.quantity) filter (where m.movement_type = 'correction'))::numeric(14,3)::text as corrections
      from hotel_stock_movements m join products p on p.id = m.product_id join hotels h on h.id = m.hotel_id
      where (m.occurred_at at time zone 'Asia/Kathmandu')::date between ${from} and ${to}
        ${hotelId ? sql`and m.hotel_id = ${hotelId}` : sql``}
      group by h.legal_name, p.id order by 1, 2`);
      return send(reply, 'hotel-usage', q.format, data, { from, to });
    },
  );

  app.get('/reports/stock-discrepancies', { preHandler: guard('reports.inventory') }, async (req, reply) => {
    const q = parse(range, req.query);
    const { from, to } = defaults(q);
    const data = await rows(sql`
      select * from (
        select m.created_at as at, 'hub_' || m.movement_type as kind, p.name_en as product, m.quantity::text, m.reason as detail
          from hub_stock_movements m join products p on p.id = m.product_id
          where m.movement_type in ('adjustment','write_off','return_to_supplier')
        union all
        select gr.received_at, 'receipt_damaged', p.name_en, grl.qty_damaged::text, gr.receipt_number
          from goods_receipt_lines grl join goods_receipts gr on gr.id = grl.receipt_id join products p on p.id = grl.product_id
          where grl.qty_damaged > 0
        union all
        select d.delivered_at, 'delivery_damaged_or_missing', p.name_en, (dl.qty_damaged + dl.qty_missing)::text, d.delivery_number
          from delivery_lines dl join deliveries d on d.id = dl.delivery_id join products p on p.id = dl.product_id
          where dl.qty_damaged > 0 or dl.qty_missing > 0
        union all
        select e.received_at, 'hotel_' || e.status || '_' || array_to_string(e.flags, '+'), p.name_en, coalesce(e.counted_qty, e.quantity)::text, h.legal_name || ': ' || coalesce(e.reason, '')
          from hotel_inventory_events e join products p on p.id = e.product_id join hotels h on h.id = e.hotel_id
          where e.action = 'correction' or e.status <> 'applied' or e.flags && array['negative_balance','possible_duplicate','stale_base']
      ) x where (at at time zone 'Asia/Kathmandu')::date between ${from} and ${to} order by at desc`);
    return send(reply, 'stock-discrepancies', q.format, data, { from, to });
  });

  /* ----------------------------- operations --------------------------- */

  app.get('/reports/operations', { preHandler: guard('reports.operations') }, async (req) => {
    const q = parse(range, req.query);
    const { from, to } = defaults(q);
    const [orderStats] = await rows(sql`
      select count(*)::int as orders,
        count(*) filter (where status = 'delivered' or status = 'closed')::int as delivered,
        count(*) filter (where status = 'cancelled')::int as cancelled,
        round(avg(extract(epoch from (
          (select min(d.delivered_at) from deliveries d where d.order_id = o.id and d.status = 'delivered') - o.submitted_at)) / 3600)::numeric, 1)::text as avg_hours_to_delivery
      from orders o where o.submitted_at::date between ${from} and ${to}`);
    const byStatus = await rows(
      sql`select status, count(*)::int as n from orders group by status order by status`,
    );
    const deliveriesStats = await rows(sql`
      select status, count(*)::int as n from deliveries where created_at::date between ${from} and ${to} group by status`);
    const leadTimes = await rows(sql`
      select s.name as supplier, count(*)::int as purchase_orders,
        round(avg(extract(epoch from ((select min(gr.received_at) from goods_receipts gr where gr.po_id = po.id) - po.sent_at)) / 86400)::numeric, 1)::text as avg_days_to_first_receipt
      from purchase_orders po join suppliers s on s.id = po.supplier_id
      where po.sent_at is not null and po.sent_at::date between ${from} and ${to}
      group by s.name order by s.name`);
    const [pending] = await rows(
      sql`select count(*)::int as n from approval_requests where status = 'pending'`,
    );
    const [syncIssues] = await rows(sql`
      select count(*) filter (where status = 'needs_review')::int as needs_review,
             count(*) filter (where status = 'rejected')::int as rejected,
             count(*) filter (where 'offline' = any(flags))::int as offline_events
      from hotel_inventory_events where received_at::date between ${from} and ${to}`);
    return {
      from,
      to,
      orders: orderStats,
      ordersByStatus: byStatus,
      deliveries: deliveriesStats,
      supplierLeadTimes: leadTimes,
      pendingApprovals: pending,
      offlineSync: syncIssues,
    };
  });

  app.get('/reports/price-history', { preHandler: guard('reports.business') }, async (req, reply) => {
    if (!can(ctxOf(req), 'costs.view')) throw forbidden();
    const q = parse(range, req.query);
    const data = await rows(sql`
      select ph.created_at, ph.entity, p.sku, p.name_en, h.legal_name as hotel, ph.old_value, ph.new_value, ph.reason, u.name as changed_by
      from price_history ph left join products p on p.id = ph.product_id left join hotels h on h.id = ph.hotel_id left join users u on u.id = ph.changed_by
      ${q.productId ? sql`where ph.product_id = ${q.productId}` : sql``}
      order by ph.created_at desc limit 500`);
    const quotes = await rows(sql`
      select q.created_at, s.name as supplier, p.name_en, q.unit_cost::text, q.valid_until
      from supplier_quotations q join suppliers s on s.id = q.supplier_id join products p on p.id = q.product_id
      ${q.productId ? sql`where q.product_id = ${q.productId}` : sql``}
      order by q.created_at desc limit 500`);
    return send(reply, 'price-history', q.format, data, { supplierQuotes: quotes });
  });
}

function pick(o: Record<string, string>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
