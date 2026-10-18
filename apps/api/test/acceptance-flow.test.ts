/**
 * End-to-end acceptance scenario (master spec §14, steps 1-15 and 19):
 * hotel onboarding → order → quotations → POs with owner approval → hub receipt
 * with discrepancies → consolidation → partial delivery → invoicing → partial and
 * full payment → supplier bills and payments → reconciliation → audit trail.
 * Every money figure is asserted exactly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, Client, EMAILS, setupTestEnv, type TestEnv } from './helpers';
import { addDays, todayNepal } from '../src/lib/http';

let env: TestEnv;
let owner: Client, proc: Client, hub: Client, driver: Client, manager: Client;
const s: Record<string, any> = {};

beforeAll(async () => {
  env = await setupTestEnv();
  owner = await as(env, EMAILS.owner);
  proc = await as(env, EMAILS.procurement);
  hub = await as(env, EMAILS.warehouse);
  driver = await as(env, EMAILS.driver);
});
afterAll(async () => env.close());

describe('acceptance scenario: hotel order to cash and supplier payables', () => {
  it('1. owner creates a hotel, invites a manager, sets pricing and credit terms', async () => {
    const { hotel } = await owner.ok(
      owner.post('/hotels', {
        code: 'NEWH',
        legalName: 'Acceptance Test Hotel',
        address: 'Butwal-9',
        pan: '123456789',
        hotelType: 'guesthouse',
        requireManagerApproval: false,
      }),
    );
    s.hotelId = hotel.id;
    const credit = await owner.ok(
      owner.post(`/hotels/${hotel.id}/credit-terms`, {
        creditLimit: '50000.00',
        paymentTermsDays: 15,
        reason: 'Initial terms per contract',
      }),
    );
    expect(credit.applied).toBe(true);
    expect(credit.hotel.creditLimit).toBe('50000.00');

    const inv = await owner.ok(
      owner.post('/users/invitations', {
        email: 'gm@acceptance.test',
        name: 'GM Acceptance',
        role: 'hotel_manager',
        hotelId: hotel.id,
      }),
    );
    const token = new URL(inv.inviteUrl).searchParams.get('token');
    const anon = new Client(env.app);
    const acc = await anon.ok(
      anon.post('/auth/invitations/accept', { token, password: 'a-strong-password-1' }),
    );
    expect(acc.user.hotelId).toBe(hotel.id);
    manager = await new Client(env.app).login('gm@acceptance.test', 'a-strong-password-1');
    // the invitation can only be used once
    expect(
      (await anon.post('/auth/invitations/accept', { token, password: 'a-strong-password-1' })).statusCode,
    ).toBe(400);
  });

  it('2. staff add a supplier and a product; owner sets a hotel-category markup', async () => {
    const { supplier } = await proc.ok(
      proc.post('/suppliers', {
        code: 'SUP-TEST',
        name: 'Acceptance Supplier',
        pan: '987654321',
        paymentTermsDays: 30,
      }),
    );
    s.supplierA = supplier.id;
    s.supplierB = env.seed.supplierIds[2]; // linen & amenities supplier from seed
    const { product } = await proc.ok(
      proc.post('/products', {
        sku: 'TEST-SOAP-BAR',
        nameEn: 'Hand soap bar 100 g',
        nameNe: 'हात धुने साबुन १०० ग्राम',
        categoryId: env.seed.categoryIds.cleaning,
        sellingUnit: 'pcs',
        purchaseUnit: 'carton',
        unitsPerPurchaseUnit: '48',
        referenceCost: '100.00',
        taxCode: 'VAT13',
      }),
    );
    s.productId = product.id;
    s.shampooId = env.seed.productIds['AM-SHP-30'];
    await owner.ok(
      owner.post('/pricing-rules', {
        scope: 'hotel_category',
        hotelId: s.hotelId,
        categoryId: env.seed.categoryIds.cleaning,
        ruleType: 'markup_percent',
        value: '10',
        reason: 'Agreed in contract',
      }),
    );
  });

  it('3. the hotel manager browses the catalog without seeing costs and submits an order', async () => {
    const list = await manager.ok(manager.get('/products?q=soap%20bar'));
    const item = list.items.find((p: any) => p.id === s.productId);
    expect(item.unitPrice).toBe('110.00'); // 100.00 cost + 10% hotel-category markup
    expect(item).not.toHaveProperty('referenceCost');
    expect(item).not.toHaveProperty('marginPercent');

    const { order } = await manager.ok(
      manager.post('/orders', {
        lines: [
          { productId: s.productId, quantity: '10' },
          { productId: s.shampooId, quantity: '20' },
        ],
        requestedDeliveryDate: '2026-10-25',
        submit: true,
        idempotencyKey: 'acceptance-order-0001',
      }),
    );
    s.orderId = order.id;
    expect(order.status).toBe('approved'); // within the 50,000 credit limit
    expect(order.subtotal).toBe('1422.00'); // 10 x 110.00 + 20 x 16.10
    const shampoo = order.lines.find((l: any) => l.productId === s.shampooId);
    expect(shampoo.unitPrice).toBe('16.10'); // 14.00 + 15% default markup
    expect(shampoo).not.toHaveProperty('expectedUnitCost');
    expect(shampoo).not.toHaveProperty('selectedSupplierId');
    // a double-submit with the same key returns the same order
    const again = await manager.ok(
      manager.post('/orders', {
        lines: [{ productId: s.productId, quantity: '10' }],
        idempotencyKey: 'acceptance-order-0001',
      }),
    );
    expect(again.order.id).toBe(order.id);
    expect(again.duplicate).toBe(true);
  });

  it('4-5. procurement records quotations, selects suppliers and sees expected margin', async () => {
    const { order } = await proc.ok(proc.get(`/orders/${s.orderId}`));
    s.lineSoap = order.lines.find((l: any) => l.productId === s.productId).id;
    s.lineShampoo = order.lines.find((l: any) => l.productId === s.shampooId).id;
    const q1 = await proc.ok(
      proc.post('/quotations', {
        supplierId: s.supplierA,
        productId: s.productId,
        orderId: s.orderId,
        unitCost: '95.00',
        validUntil: '2026-11-30',
      }),
    );
    await proc.ok(
      proc.post('/quotations', {
        supplierId: env.seed.supplierIds[0],
        productId: s.productId,
        orderId: s.orderId,
        unitCost: '99.00',
      }),
    );
    const q2 = await proc.ok(
      proc.post('/quotations', {
        supplierId: s.supplierB,
        productId: s.shampooId,
        orderId: s.orderId,
        unitCost: '13.00',
      }),
    );
    const quotes = await proc.ok(proc.get(`/quotations?productId=${s.productId}`));
    expect(quotes.items[0].unitCost).toBe('95.00'); // cheapest first for comparison

    await proc.ok(
      proc.put(`/orders/${s.orderId}/lines/${s.lineSoap}/sourcing`, {
        supplierId: s.supplierA,
        quotationId: q1.quotation.id,
      }),
    );
    await proc.ok(
      proc.put(`/orders/${s.orderId}/lines/${s.lineShampoo}/sourcing`, {
        supplierId: s.supplierB,
        quotationId: q2.quotation.id,
      }),
    );
    const p = await proc.ok(proc.get(`/orders/${s.orderId}/procurement`));
    expect(p.expected).toMatchObject({
      revenue: '1422.00',
      cost: '1210.00',
      grossMargin: '212.00',
      marginPercent: '14.91',
      costComplete: true,
    });
    // hotel users can never reach the procurement view
    expect((await manager.get(`/orders/${s.orderId}/procurement`)).statusCode).toBe(403);
  });

  it('6. purchase orders need owner approval before they can be sent', async () => {
    const { purchaseOrders } = await proc.ok(
      proc.post(`/orders/${s.orderId}/purchase-orders`, { fulfillment: 'hub' }),
    );
    expect(purchaseOrders).toHaveLength(2);
    s.poSoap = purchaseOrders.find((p: any) => p.supplierId === s.supplierA);
    s.poShampoo = purchaseOrders.find((p: any) => p.supplierId === s.supplierB);
    expect(s.poSoap.total).toBe('1073.50'); // 950.00 + 13% VAT

    // cannot send a draft
    expect((await proc.post(`/purchase-orders/${s.poSoap.id}/send`)).statusCode).toBe(422);
    for (const po of [s.poSoap, s.poShampoo]) {
      const r = await proc.ok(proc.post(`/purchase-orders/${po.id}/submit`));
      expect(r.purchaseOrder.status).toBe('pending_approval');
      po.approvalId = r.approval.id;
      // staff cannot approve, even their own request
      expect(
        (await proc.post(`/approvals/${r.approval.id}/decide`, { decision: 'approved' })).statusCode,
      ).toBe(403);
      expect((await proc.post(`/purchase-orders/${po.id}/send`)).statusCode).toBe(422);
      await owner.ok(owner.post(`/approvals/${r.approval.id}/decide`, { decision: 'approved', note: 'OK' }));
      await proc.ok(proc.post(`/purchase-orders/${po.id}/send`));
      await proc.ok(
        proc.post(`/purchase-orders/${po.id}/confirm`, { supplierReference: `SUP-${po.poNumber}` }),
      );
    }
    const { order } = await proc.ok(proc.get(`/orders/${s.orderId}`));
    expect(order.status).toBe('procurement');
  });

  it('7-8. hub receives goods, records damage, and blocks over-receipt', async () => {
    const po = await hub.ok(hub.get(`/purchase-orders/${s.poSoap.id}`));
    expect(po.purchaseOrder).not.toHaveProperty('total'); // hub staff never see costs
    expect(po.lines[0]).not.toHaveProperty('unitCost');
    const soapLine = po.lines[0].id;

    const r1 = await hub.ok(
      hub.post(`/purchase-orders/${s.poSoap.id}/receipts`, {
        lines: [{ poLineId: soapLine, qtyAccepted: '8', qtyDamaged: '1', notes: 'One carton crushed' }],
        idempotencyKey: 'grn-soap-0001',
      }),
    );
    // retrying the same receipt does not double count stock
    const dup = await hub.ok(
      hub.post(`/purchase-orders/${s.poSoap.id}/receipts`, {
        lines: [{ poLineId: soapLine, qtyAccepted: '8', qtyDamaged: '1' }],
        idempotencyKey: 'grn-soap-0001',
      }),
    );
    expect(dup.duplicate).toBe(true);
    expect(dup.receipt.id).toBe(r1.receipt.id);
    expect(
      (
        await hub.post(`/purchase-orders/${s.poSoap.id}/receipts`, {
          lines: [{ poLineId: soapLine, qtyAccepted: '3' }],
        })
      ).statusCode,
    ).toBe(422);

    let { order } = await proc.ok(proc.get(`/orders/${s.orderId}`));
    expect(order.status).toBe('consolidating');
    await hub.ok(
      hub.post(`/purchase-orders/${s.poSoap.id}/receipts`, {
        lines: [{ poLineId: soapLine, qtyAccepted: '2' }],
      }),
    );
    const shampooPo = await hub.ok(hub.get(`/purchase-orders/${s.poShampoo.id}`));
    await hub.ok(
      hub.post(`/purchase-orders/${s.poShampoo.id}/receipts`, {
        lines: [{ poLineId: shampooPo.lines[0].id, qtyAccepted: '20' }],
      }),
    );

    const soapPo = await proc.ok(proc.get(`/purchase-orders/${s.poSoap.id}`));
    expect(soapPo.purchaseOrder.status).toBe('received');
    expect(soapPo.lines[0]).toMatchObject({ accepted: '10.000', damaged: '1.000', remaining: '0.000' });
    ({ order } = await proc.ok(proc.get(`/orders/${s.orderId}`)));
    expect(order.status).toBe('ready_for_dispatch');

    const stock = await hub.ok(hub.get('/hub/stock?q=TEST-SOAP'));
    expect(stock.items[0]).toMatchObject({ onHand: '10.000', reserved: '10.000', available: '0.000' });
  });

  it('9-10. delivery is scheduled, dispatched and confirmed with a partial-delivery exception', async () => {
    const { run } = await proc.ok(
      proc.post('/delivery-runs', {
        scheduledDate: '2026-10-25',
        windowStart: '09:00',
        windowEnd: '12:00',
        driverId: env.seed.userIds.driver,
      }),
    );
    const { delivery } = await proc.ok(proc.post('/deliveries', { orderId: s.orderId, runId: run.id }));
    s.delivery1 = delivery.id;
    // nothing left to schedule twice
    expect((await proc.post('/deliveries', { orderId: s.orderId })).statusCode).toBe(422);

    await hub.ok(hub.post(`/deliveries/${delivery.id}/dispatch`));
    let stock = await hub.ok(hub.get('/hub/stock?q=AM-SHP-30&onlyNonZero=false'));
    expect(stock.items[0]).toMatchObject({ onHand: '0.000', reserved: '0.000' });
    expect((await proc.get(`/orders/${s.orderId}`)).json().order.status).toBe('dispatched');

    const mine = await driver.ok(driver.get('/deliveries'));
    expect(mine.items.map((d: any) => d.id)).toContain(delivery.id);
    const detail = await driver.ok(driver.get(`/deliveries/${delivery.id}`));
    expect(JSON.stringify(detail)).not.toMatch(/unitPrice|unitCost|total/);
    const soapDl = detail.lines.find((l: any) => l.productId === s.productId);
    const shampooDl = detail.lines.find((l: any) => l.productId === s.shampooId);

    // the quantities must add up to what was dispatched
    const bad = await driver.post(`/deliveries/${delivery.id}/confirm`, {
      recipientName: 'Store keeper',
      lines: [
        { deliveryLineId: soapDl.id, qtyDelivered: '10' },
        { deliveryLineId: shampooDl.id, qtyDelivered: '17' },
      ],
    });
    expect(bad.statusCode).toBe(422);
    await driver.ok(
      driver.post(`/deliveries/${delivery.id}/confirm`, {
        recipientName: 'Store keeper',
        lines: [
          { deliveryLineId: soapDl.id, qtyDelivered: '10' },
          {
            deliveryLineId: shampooDl.id,
            qtyDelivered: '18',
            qtyReturned: '2',
            notes: 'Two refused: leaking',
          },
        ],
      }),
    );
    const { order, quantities } = await manager.ok(manager.get(`/orders/${s.orderId}`));
    expect(order.status).toBe('partially_delivered');
    expect(quantities[s.lineShampoo]).toMatchObject({
      dispatched: '20.000',
      delivered: '18.000',
      reserved: '2.000',
    });
    stock = await hub.ok(hub.get('/hub/stock?q=AM-SHP-30'));
    expect(stock.items[0]).toMatchObject({ onHand: '2.000', reserved: '2.000' }); // returned goods back at the hub
  });

  it('11-12. a draft invoice is generated for delivered goods; after issue the hotel sees it', async () => {
    // hotels never see drafts
    expect((await manager.ok(manager.get('/invoices'))).items).toHaveLength(0);
    const drafts = await proc.ok(proc.get(`/invoices?orderId=${s.orderId}&status=draft`));
    expect(drafts.items).toHaveLength(1);
    const draft = drafts.items[0];
    expect(draft).toMatchObject({ taxableTotal: '1389.80', taxTotal: '180.67', total: '1570.47' });

    const { invoice } = await proc.ok(proc.post(`/invoices/${draft.id}/issue`, {}));
    s.invoice1 = invoice;
    expect(invoice.invoiceNumber).toBe('INV-208384-00001');
    expect(invoice.dueDate).toBe(addDays(todayNepal(), 15)); // 15-day terms
    // invoices cannot be dated in the future
    expect(invoice.invoiceDate).toBe(todayNepal());

    const seen = await manager.ok(manager.get(`/invoices/${invoice.id}`));
    expect(seen.outstanding).toBe('1570.47');
    expect(seen.customer.legalName).toBe('Acceptance Test Hotel');
    const summary = await manager.ok(manager.get(`/finance/hotels/${s.hotelId}/summary`));
    expect(summary.balance).toBe('1570.47');
  });

  it('13. a partial payment reduces the outstanding balance', async () => {
    const { payment, unallocated } = await proc.ok(
      proc.post('/payments', {
        direction: 'inbound',
        hotelId: s.hotelId,
        amount: '1000.00',
        method: 'bank_transfer',
        reference: 'NIBL-TXN-0001',
        paymentDate: todayNepal(),
        allocations: [{ invoiceId: s.invoice1.id, amount: '1000.00' }],
      }),
    );
    expect(unallocated).toBe('0.00');
    s.payment1 = payment.id;
    // the same bank reference cannot be recorded twice
    const dup = await proc.post('/payments', {
      direction: 'inbound',
      hotelId: s.hotelId,
      amount: '1000.00',
      method: 'bank_transfer',
      reference: 'nibl-txn-0001',
      paymentDate: todayNepal(),
    });
    expect(dup.statusCode).toBe(409);

    const inv = await manager.ok(manager.get(`/invoices/${s.invoice1.id}`));
    expect(inv.outstanding).toBe('570.47');
    const list = await manager.ok(manager.get('/invoices'));
    expect(list.items[0].paymentStatus).toBe('partially_paid');
    expect((await manager.ok(manager.get(`/finance/hotels/${s.hotelId}/summary`))).balance).toBe('570.47');
  });

  it('remaining goods are re-delivered, invoiced and paid in full', async () => {
    const { delivery } = await proc.ok(proc.post('/deliveries', { orderId: s.orderId }));
    await hub.ok(hub.post(`/deliveries/${delivery.id}/dispatch`));
    const d = await proc.ok(proc.get(`/deliveries/${delivery.id}`));
    await proc.ok(
      proc.post(`/deliveries/${delivery.id}/confirm`, {
        recipientName: 'Store keeper',
        lines: [{ deliveryLineId: d.lines[0].id, qtyDelivered: '2' }],
      }),
    );
    expect((await manager.ok(manager.get(`/orders/${s.orderId}`))).order.status).toBe('delivered');

    const drafts = await proc.ok(proc.get(`/invoices?orderId=${s.orderId}&status=draft`));
    expect(drafts.items[0]).toMatchObject({ taxableTotal: '32.20', taxTotal: '4.19', total: '36.39' });
    const { invoice } = await proc.ok(proc.post(`/invoices/${drafts.items[0].id}/issue`, {}));
    expect(invoice.invoiceNumber).toBe('INV-208384-00002'); // gapless series
    // nothing more to invoice
    expect((await proc.post(`/orders/${s.orderId}/invoices`)).statusCode).toBe(422);

    const { unallocated } = await proc.ok(
      proc.post('/payments', {
        direction: 'inbound',
        hotelId: s.hotelId,
        amount: '606.86',
        method: 'cash',
        paymentDate: todayNepal(),
        allocations: [
          { invoiceId: s.invoice1.id, amount: '570.47' },
          { invoiceId: invoice.id, amount: '36.39' },
        ],
      }),
    );
    expect(unallocated).toBe('0.00');
    const summary = await manager.ok(manager.get(`/finance/hotels/${s.hotelId}/summary`));
    expect(summary.balance).toBe('0.00');
    const statement = await manager.ok(manager.get(`/finance/hotels/${s.hotelId}/statement`));
    expect(statement.entries.map((e: any) => e.balance)).toEqual(['1570.47', '570.47', '606.86', '0.00']);
    expect(statement.closing).toBe('0.00');
  });

  it('14. supplier bills and supplier payments are tracked separately', async () => {
    const soapPo = await proc.ok(proc.get(`/purchase-orders/${s.poSoap.id}`));
    const b1 = await proc.ok(
      proc.post('/supplier-bills', {
        supplierId: s.supplierA,
        supplierBillNumber: 'AS-1001',
        poId: s.poSoap.id,
        billDate: todayNepal(),
      }),
    );
    expect(b1.bill).toMatchObject({
      taxableTotal: '950.00',
      taxTotal: '123.50',
      total: '1073.50',
      dueDate: addDays(todayNepal(), 30),
    });
    expect(soapPo.lines[0].damaged).toBe('1.000'); // damaged goods are not billed by default
    await proc.ok(proc.post(`/supplier-bills/${b1.bill.id}/post`));
    // supplier bill numbers are unique per supplier
    expect(
      (
        await proc.post('/supplier-bills', {
          supplierId: s.supplierA,
          supplierBillNumber: 'AS-1001',
          poId: s.poSoap.id,
          billDate: todayNepal(),
        })
      ).statusCode,
    ).toBe(409);
    const b2 = await proc.ok(
      proc.post('/supplier-bills', {
        supplierId: s.supplierB,
        supplierBillNumber: 'BL-77',
        poId: s.poShampoo.id,
        billDate: todayNepal(),
      }),
    );
    await proc.ok(proc.post(`/supplier-bills/${b2.bill.id}/post`));
    expect(b2.bill.total).toBe('293.80');

    await proc.ok(
      proc.post('/payments', {
        direction: 'outbound',
        supplierId: s.supplierA,
        amount: '500.00',
        method: 'cheque',
        reference: 'CHQ-000123',
        paymentDate: todayNepal(),
        allocations: [{ billId: b1.bill.id, amount: '500.00' }],
      }),
    );
    const aging = await proc.ok(proc.get('/finance/ap-aging'));
    expect(aging.totals.total).toBe('867.30'); // 1073.50 + 293.80 - 500.00
    const st = await owner.ok(owner.get(`/finance/suppliers/${s.supplierA}/statement`));
    expect(st.balance).toBe('573.50');
  });

  it('15. the owner reconciles sales, costs, receivables, payables and margin', async () => {
    const rec = await owner.ok(owner.get('/reports/reconciliation'));
    expect(rec.receivables).toMatchObject({
      invoices_issued: '1606.86',
      customer_payments: '1606.86',
      ledgerBalance: '0.00',
      reconciled: true,
    });
    expect(rec.payables).toMatchObject({
      bills_posted: '1367.30',
      supplier_payments: '500.00',
      ledgerBalance: '867.30',
      reconciled: true,
    });
    const margin = await owner.ok(owner.get(`/finance/orders/${s.orderId}/margin`));
    expect(margin.expected.grossMargin).toBe('212.00');
    expect(margin.realized).toMatchObject({
      revenue: '1422.00',
      billedCost: '1210.00',
      grossMargin: '212.00',
      costFullyBilled: true,
    });
    // hotels cannot see company-wide reconciliation or margins
    expect((await manager.get('/reports/reconciliation')).statusCode).toBe(403);
    expect((await manager.get(`/finance/orders/${s.orderId}/margin`)).statusCode).toBe(403);
  });

  it('19. important changes are in a verifiable audit trail', async () => {
    const audit = await owner.ok(owner.get('/audit?limit=500'));
    const actions = new Set(audit.items.map((a: any) => a.action));
    for (const a of [
      'hotel.created',
      'hotel.credit_terms_changed',
      'pricing_rule.created',
      'order.supplier_selected',
      'approval.requested',
      'approval.approved',
      'purchase_order.approved',
      'goods_receipt.recorded',
      'delivery.partially_delivered',
      'invoice.issued',
      'payment.recorded',
      'payment.allocated',
      'supplier_bill.posted',
    ]) {
      expect(actions, a).toContain(a);
    }
    const v = await owner.ok(owner.get('/audit/verify'));
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(20);
  });
});
