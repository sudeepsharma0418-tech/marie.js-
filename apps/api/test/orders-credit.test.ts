/** Pricing rules, order lifecycle, hotel-side approval and credit-limit enforcement. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { as, Client, EMAILS, setupTestEnv, type TestEnv } from './helpers';
import { fulfilOrder, staff, type Clients } from './flow';
import { hotels } from '../src/db/schema';
import { addDays, todayNepal } from '../src/lib/http';

let env: TestEnv;
let c: Clients;
let tinauMgr: Client, tinauBuyer: Client, lumbini: Client;
const P = (sku: string) => env.seed.productIds[sku]!;

beforeAll(async () => {
  env = await setupTestEnv();
  c = await staff(env);
  tinauMgr = await as(env, EMAILS.tinauManager);
  tinauBuyer = await as(env, EMAILS.tinauPurchaser);
  lumbini = await as(env, EMAILS.lumbiniManager);
});
afterAll(async () => env.close());

async function price(client: Client, sku: string) {
  return (await client.ok(client.get(`/products/${P(sku)}`))).product.unitPrice as string;
}

describe('pricing rules', () => {
  it('applies the most specific rule: hotel-product > hotel > product > category > default', async () => {
    expect(await price(lumbini, 'AM-SOP-20')).toBe('10.93'); // 9.50 + 15% default (10.925 rounds half up)
    expect(await price(lumbini, 'LN-TWL-BTH')).toBe('672.00'); // linen category 20%
    expect(await price(lumbini, 'FB-TEA-500')).toBe('334.80'); // F&B category 8%
    expect(await price(tinauMgr, 'PP-TIS-10')).toBe('425.00'); // Tinau contract fixed price
    expect(await price(lumbini, 'PP-TIS-10')).toBe('437.00'); // others: 380 + 15%
    const hills = await as(env, EMAILS.hillsManager);
    expect(await price(hills, 'LN-TWL-BTH')).toBe('627.20'); // hotel blanket 12% beats the linen category
  });

  it('records price history with a reason and replaces the previous rule', async () => {
    await c.proc.ok(
      c.proc.post('/pricing-rules', {
        scope: 'product',
        productId: P('AM-SOP-20'),
        ruleType: 'fixed_price',
        value: '12.50',
        reason: 'Market price increase',
      }),
    );
    expect(await price(lumbini, 'AM-SOP-20')).toBe('12.50');
    await c.proc.ok(
      c.proc.post('/pricing-rules', {
        scope: 'product',
        productId: P('AM-SOP-20'),
        ruleType: 'fixed_price',
        value: '12.00',
        reason: 'Corrected',
      }),
    );
    expect(await price(lumbini, 'AM-SOP-20')).toBe('12.00');
    const detail = await c.proc.ok(c.proc.get(`/products/${P('AM-SOP-20')}`));
    const ph = detail.priceHistory.filter((h: any) => h.entity === 'pricing_rule');
    expect(ph[0]).toMatchObject({
      oldValue: 'fixed_price:12.500',
      newValue: 'fixed_price:12.000',
      reason: 'Corrected',
    });
    // invalid targets are refused by the database constraint
    expect(
      (
        await c.proc.post('/pricing-rules', {
          scope: 'category',
          productId: P('AM-SOP-20'),
          ruleType: 'markup_percent',
          value: '5',
          reason: 'bad',
        })
      ).statusCode,
    ).toBe(422);
  });

  it('changing a product cost requires a reason and is recorded', async () => {
    expect((await c.proc.patch(`/products/${P('HK-BIN-BAG')}`, { referenceCost: '160.00' })).statusCode).toBe(
      400,
    );
    await c.proc.ok(
      c.proc.patch(`/products/${P('HK-BIN-BAG')}`, {
        referenceCost: '160.00',
        reason: 'Supplier price list Oct',
      }),
    );
    expect(await price(lumbini, 'HK-BIN-BAG')).toBe('184.00');
  });

  it('a product with no usable price cannot be ordered', async () => {
    await c.proc.ok(
      c.proc.post('/products', {
        sku: 'NOPRICE-1',
        nameEn: 'Unpriced item',
        nameNe: 'मूल्य नभएको',
        categoryId: env.seed.categoryIds.housekeeping,
        sellingUnit: 'pcs',
        purchaseUnit: 'pcs',
        taxCode: 'VAT13',
      }),
    );
    const list = await lumbini.ok(lumbini.get('/products?q=NOPRICE'));
    expect(list.items[0]).toMatchObject({ unitPrice: null, priceAvailable: false });
    const r = await lumbini.post('/orders', { lines: [{ productId: list.items[0].id, quantity: '1' }] });
    expect(r.statusCode).toBe(422);
  });

  it('large manual price overrides need owner approval', async () => {
    const { order } = await lumbini.ok(
      lumbini.post('/orders', { lines: [{ productId: P('CL-MOP-01'), quantity: '2' }], submit: true }),
    );
    const line = order.lines[0];
    expect(line.unitPrice).toBe('483.00');
    const small = await c.proc.ok(
      c.proc.post(`/orders/${order.id}/lines/${line.id}/price`, { unitPrice: '470.00', reason: 'Loyalty' }),
    );
    expect(small.applied).toBe(true); // 2.7% below rule price, under the 5% threshold
    const big = await c.proc.ok(
      c.proc.post(`/orders/${order.id}/lines/${line.id}/price`, { unitPrice: '300.00', reason: 'Clearance' }),
    );
    expect(big.applied).toBe(false);
    expect((await lumbini.ok(lumbini.get(`/orders/${order.id}`))).order.lines[0].unitPrice).toBe('470.00');
    await c.owner.ok(c.owner.post(`/approvals/${big.approval.id}/decide`, { decision: 'approved' }));
    const after = await lumbini.ok(lumbini.get(`/orders/${order.id}`));
    expect(after.order.lines[0].unitPrice).toBe('300.00');
    expect(after.order.subtotal).toBe('600.00');
    // hotel users cannot override prices
    expect(
      (
        await lumbini.post(`/orders/${order.id}/lines/${line.id}/price`, {
          unitPrice: '1.00',
          reason: 'please',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('order lifecycle', () => {
  it('purchasing staff orders wait for the hotel manager when the hotel requires it', async () => {
    const { order } = await tinauBuyer.ok(
      tinauBuyer.post('/orders', { lines: [{ productId: P('AM-SHP-30'), quantity: '100' }], submit: true }),
    );
    expect(order.status).toBe('pending_hotel_approval');
    // the purchaser cannot approve their own order
    expect((await tinauBuyer.post(`/orders/${order.id}/hotel-approve`)).statusCode).toBe(403);
    // procurement cannot start before the hotel approves
    expect((await c.proc.post(`/orders/${order.id}/purchase-orders`)).statusCode).toBe(409);
    const r = await tinauMgr.ok(tinauMgr.post(`/orders/${order.id}/hotel-approve`));
    expect(r.status).toBe('approved');
    const { events } = await tinauMgr.ok(tinauMgr.get(`/orders/${order.id}`));
    expect(events.map((e: any) => e.event)).toEqual(
      expect.arrayContaining(['created', 'sent_for_hotel_approval', 'hotel_approved', 'auto_approved']),
    );
    expect(events.some((e: any) => e.visibleToHotel === false)).toBe(false);
  });

  it('only drafts can be edited; invalid transitions are refused', async () => {
    const { order } = await tinauMgr.ok(
      tinauMgr.post('/orders', { lines: [{ productId: P('AM-SHP-30'), quantity: '10' }] }),
    );
    expect(order.status).toBe('draft');
    await tinauMgr.ok(
      tinauMgr.put(`/orders/${order.id}/lines`, {
        lines: [
          { productId: P('AM-SHP-30'), quantity: '5' },
          { productId: P('AM-SHP-30'), quantity: '5' },
          { productId: P('AM-SOP-20'), quantity: '20' },
        ],
      }),
    );
    const d = await tinauMgr.ok(tinauMgr.get(`/orders/${order.id}`));
    expect(d.order.lines).toHaveLength(2); // duplicate products merged
    expect(d.order.lines.find((l: any) => l.productId === P('AM-SHP-30')).quantity).toBe('10.000');
    await tinauMgr.ok(tinauMgr.post(`/orders/${order.id}/submit`));
    expect(
      (
        await tinauMgr.put(`/orders/${order.id}/lines`, {
          lines: [{ productId: P('AM-SHP-30'), quantity: '1' }],
        })
      ).statusCode,
    ).toBe(409);
    expect((await tinauMgr.post(`/orders/${order.id}/submit`)).statusCode).toBe(409);
    await tinauMgr.ok(tinauMgr.post(`/orders/${order.id}/cancel`, { reason: 'Ordered by mistake' }));
    expect((await tinauMgr.post(`/orders/${order.id}/cancel`, { reason: 'again' })).statusCode).toBe(409);
  });

  it('enforces minimum order quantities', async () => {
    await c.proc.ok(c.proc.patch(`/products/${P('AM-DKT-01')}`, { minOrderQty: '50' }));
    expect(
      (await lumbini.post('/orders', { lines: [{ productId: P('AM-DKT-01'), quantity: '10' }] })).statusCode,
    ).toBe(422);
  });
});

describe('credit control', () => {
  it('an order that would exceed the credit limit needs owner approval', async () => {
    // Lumbini: limit 40,000; this order is ~57,000
    const { order } = await lumbini.ok(
      lumbini.post('/orders', { lines: [{ productId: P('LN-BED-DBL'), quantity: '50' }], submit: true }),
    );
    expect(order.status).toBe('pending_approval');
    const internal = await c.proc.ok(c.proc.get(`/orders/${order.id}`));
    expect(internal.order.creditCheck.reasons).toContain('credit_limit_exceeded');
    expect(internal.order.creditCheck.creditLimit).toBe('40000.00');
    // the hotel does not see the internal credit assessment
    expect((await lumbini.ok(lumbini.get(`/orders/${order.id}`))).order.creditCheck).toBeUndefined();
    const approvals = await c.owner.ok(c.owner.get('/approvals?status=pending&type=credit_order'));
    const a = approvals.items.find((x: any) => x.targetId === order.id);
    await c.owner.ok(
      c.owner.post(`/approvals/${a.id}/decide`, {
        decision: 'rejected',
        note: 'Please pay outstanding first',
      }),
    );
    expect((await lumbini.ok(lumbini.get(`/orders/${order.id}`))).order.status).toBe('rejected');
  });

  it('open orders count towards exposure, so splitting an order does not bypass the limit', async () => {
    const o1 = await lumbini.ok(
      lumbini.post('/orders', { lines: [{ productId: P('LN-BED-DBL'), quantity: '25' }], submit: true }),
    ); // ~27,690
    expect(o1.order.status).toBe('approved');
    const o2 = await lumbini.ok(
      lumbini.post('/orders', { lines: [{ productId: P('LN-BED-DBL'), quantity: '25' }], submit: true }),
    );
    expect(o2.order.status).toBe('pending_approval');
    const ok2 = await c.owner.ok(c.owner.get('/approvals?status=pending&type=credit_order'));
    await c.owner.ok(
      c.owner.post(`/approvals/${ok2.items.find((x: any) => x.targetId === o2.order.id).id}/decide`, {
        decision: 'approved',
        note: 'Good customer',
      }),
    );
    expect((await lumbini.ok(lumbini.get(`/orders/${o2.order.id}`))).order.status).toBe('approved');
    await lumbini.ok(lumbini.post(`/orders/${o1.order.id}/cancel`, { reason: 'test cleanup' }));
    await c.proc.ok(c.proc.post(`/orders/${o2.order.id}/cancel`, { reason: 'test cleanup' }));
  });

  it('overdue invoices trigger approval even within the limit', async () => {
    const hills = await as(env, EMAILS.hillsManager);
    const { order } = await hills.ok(
      hills.post('/orders', { lines: [{ productId: P('ST-REG-01'), quantity: '2' }], submit: true }),
    );
    const f = await fulfilOrder(env, c, order.id, '200.00');
    const { invoice } = await c.proc.ok(
      c.proc.post(`/invoices/${f.draftInvoice.id}/issue`, { invoiceDate: addDays(todayNepal(), -40) }),
    );
    expect(invoice.dueDate < todayNepal()).toBe(true); // 30-day terms, issued 40 days ago
    const next = await hills.ok(
      hills.post('/orders', { lines: [{ productId: P('ST-REG-01'), quantity: '1' }], submit: true }),
    );
    expect(next.order.status).toBe('pending_approval');
    const internal = await c.proc.ok(c.proc.get(`/orders/${next.order.id}`));
    expect(internal.order.creditCheck.reasons).toEqual(['overdue_invoices']);
    expect(internal.order.creditCheck.overdue.count).toBe(1);
  });

  it('accounts on hold need approval and closed accounts cannot order', async () => {
    const lumbiniId = env.seed.hotelIds[1]!;
    await env.db.update(hotels).set({ status: 'on_hold' }).where(eq(hotels.id, lumbiniId));
    const held = await lumbini.ok(
      lumbini.post('/orders', { lines: [{ productId: P('AM-SHP-30'), quantity: '10' }], submit: true }),
    );
    expect(held.order.status).toBe('pending_approval');
    await env.db.update(hotels).set({ status: 'closed' }).where(eq(hotels.id, lumbiniId));
    expect(
      (await lumbini.post('/orders', { lines: [{ productId: P('AM-SHP-30'), quantity: '10' }] })).statusCode,
    ).toBe(422);
    await env.db.update(hotels).set({ status: 'active' }).where(eq(hotels.id, lumbiniId));
  });

  it('a limit of 0 means every order needs approval (cash customers)', async () => {
    await c.owner.ok(
      c.owner.post(`/hotels/${env.seed.hotelIds[1]}/credit-terms`, {
        creditLimit: '0',
        paymentTermsDays: 0,
        reason: 'Cash only',
      }),
    );
    const r = await lumbini.ok(
      lumbini.post('/orders', { lines: [{ productId: P('AM-SHP-30'), quantity: '1' }], submit: true }),
    );
    expect(r.order.status).toBe('pending_approval');
    const [row] = (
      await env.db.execute(
        sql`select count(*)::int as n from audit_logs where action = 'hotel.credit_terms_changed'`,
      )
    ).rows as { n: number }[];
    expect(row!.n).toBeGreaterThan(0);
  });
});

describe('unlisted product requests', () => {
  it('hotel requests an item, staff quote it, hotel accepts and gets a draft order at the quoted price', async () => {
    const { request } = await tinauMgr.ok(
      tinauMgr.post('/product-requests', {
        description: 'Mosquito repellent liquid refill',
        quantity: '24',
        unit: 'pcs',
        specifications: '45 night refill',
      }),
    );
    expect(request.requestNumber).toMatch(/^REQ-/);
    // a quote needs a product and a price
    expect((await c.proc.patch(`/product-requests/${request.id}`, { status: 'quoted' })).statusCode).toBe(
      400,
    );
    const { product } = await c.proc.ok(
      c.proc.post('/products', {
        sku: 'HK-MOSQ-RF',
        nameEn: 'Mosquito repellent refill',
        nameNe: 'लामखुट्टे भगाउने रिफिल',
        categoryId: env.seed.categoryIds.housekeeping,
        sellingUnit: 'pcs',
        purchaseUnit: 'carton',
        referenceCost: '95.00',
        taxCode: 'VAT13',
      }),
    );
    await c.proc.ok(
      c.proc.post('/quotations', {
        supplierId: env.seed.supplierIds[3],
        productId: product.id,
        productRequestId: request.id,
        unitCost: '92.00',
      }),
    );
    await c.proc.ok(
      c.proc.patch(`/product-requests/${request.id}`, {
        status: 'quoted',
        quotedProductId: product.id,
        quotedUnitPrice: '115.00',
        responseNote: 'Available in 2 days',
      }),
    );
    // another hotel cannot accept it
    expect((await lumbini.post(`/product-requests/${request.id}/accept`)).statusCode).toBe(404);
    const { order } = await tinauMgr.ok(tinauMgr.post(`/product-requests/${request.id}/accept`));
    const d = await tinauMgr.ok(tinauMgr.get(`/orders/${order.id}`));
    expect(d.order.status).toBe('draft');
    expect(d.order.lines[0]).toMatchObject({ unitPrice: '115.00', quantity: '24.000' });
    // the quoted price survives submission (no re-pricing to the rule price)
    await tinauMgr.ok(tinauMgr.post(`/orders/${order.id}/submit`));
    expect((await tinauMgr.ok(tinauMgr.get(`/orders/${order.id}`))).order.lines[0].unitPrice).toBe('115.00');
    expect((await tinauMgr.ok(tinauMgr.get(`/product-requests/${request.id}`))).request.status).toBe(
      'converted',
    );
  });
});
