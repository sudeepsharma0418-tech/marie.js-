/** Accounts receivable/payable, allocation rules, credit notes, reversals and ledger integrity. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { as, Client, EMAILS, expectDbError, setupTestEnv, type TestEnv } from './helpers';
import { fulfilOrder, placeOrder, staff, type Clients } from './flow';
import { todayNepal } from '../src/lib/http';

let env: TestEnv;
let c: Clients;
let hills: Client;
const s: Record<string, any> = {};
const today = todayNepal();

beforeAll(async () => {
  env = await setupTestEnv();
  c = await staff(env);
  hills = await as(env, EMAILS.hillsManager);
  // Hills resort: 12% blanket markup. Glass cleaner cost 180 -> 201.60; LED bulb 115 -> 128.80
  const o1 = await placeOrder(hills, [{ productId: env.seed.productIds['CL-GLS-500']!, quantity: '10' }]);
  const o2 = await placeOrder(hills, [{ productId: env.seed.productIds['EL-LED-9W']!, quantity: '5' }]);
  // Hills requires manager approval only for purchasers; manager orders go straight to credit check
  expect(o1.status).toBe('approved');
  const f1 = await fulfilOrder(env, c, o1.id, '150.00');
  const f2 = await fulfilOrder(env, c, o2.id, '100.00');
  s.inv1 = (await c.proc.ok(c.proc.post(`/invoices/${f1.draftInvoice.id}/issue`))).invoice;
  s.inv2 = (await c.proc.ok(c.proc.post(`/invoices/${f2.draftInvoice.id}/issue`))).invoice;
  s.hotelId = env.seed.hotelIds[2];
  s.po1 = f1.purchaseOrders[0];
});
afterAll(async () => env.close());

describe('invoices', () => {
  it('computes VAT per line and snapshots seller and customer details', async () => {
    expect(s.inv1).toMatchObject({
      taxableTotal: '2016.00',
      taxTotal: '262.08',
      total: '2278.08',
      status: 'issued',
    });
    expect(s.inv2).toMatchObject({ taxableTotal: '644.00', taxTotal: '83.72', total: '727.72' });
    expect(s.inv1.customerSnapshot.legalName).toBe('Butwal Hills Resort Pvt. Ltd. (Demo)');
    expect(s.inv1.sellerSnapshot.legalName).toBe('Butwal Hotel Supply Pvt. Ltd. (Demo)');
    expect(s.inv1.dueDate > s.inv1.invoiceDate).toBe(true);
  });

  it('historic invoices do not change when customer details change later', async () => {
    await c.owner.ok(c.owner.patch(`/hotels/${s.hotelId}`, { legalName: 'Renamed Resort Ltd.' }));
    const inv = await hills.ok(hills.get(`/invoices/${s.inv1.id}`));
    expect(inv.customer.legalName).toBe('Butwal Hills Resort Pvt. Ltd. (Demo)');
  });

  it('issued invoices are immutable at the database level', async () => {
    await expectDbError(
      env.db.execute(sql`update invoices set total = 1 where id = ${s.inv1.id}`),
      /finalized/,
    );
    await expectDbError(env.db.execute(sql`delete from invoices where id = ${s.inv1.id}`), /finalized/);
    await expectDbError(
      env.db.execute(sql`update invoice_lines set quantity = 1 where invoice_id = ${s.inv1.id}`),
      /finalized/,
    );
    expect(
      (await c.proc.post(`/invoices/${s.inv1.id}/discard`, { reason: 'try to hide it' })).statusCode,
    ).toBe(409);
  });
});

describe('payments and allocation', () => {
  it('rejects allocations above the invoice outstanding or above the payment', async () => {
    const over = await c.proc.post('/payments', {
      direction: 'inbound',
      hotelId: s.hotelId,
      amount: '5000.00',
      method: 'cash',
      paymentDate: today,
      allocations: [{ invoiceId: s.inv2.id, amount: '800.00' }],
    });
    expect(over.statusCode).toBe(422);
    const tooMuch = await c.proc.post('/payments', {
      direction: 'inbound',
      hotelId: s.hotelId,
      amount: '100.00',
      method: 'cash',
      paymentDate: today,
      allocations: [{ invoiceId: s.inv1.id, amount: '200.00' }],
    });
    expect(tooMuch.statusCode).toBe(422);
    // the failed attempts left no trace in the ledger
    const sum = await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/summary`));
    expect(sum.balance).toBe('3005.80');
  });

  it('rejects future dates, missing references and wrong parties', async () => {
    expect(
      (
        await c.proc.post('/payments', {
          direction: 'inbound',
          hotelId: s.hotelId,
          amount: '1.00',
          method: 'cash',
          paymentDate: '2099-01-01',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await c.proc.post('/payments', {
          direction: 'inbound',
          hotelId: s.hotelId,
          amount: '1.00',
          method: 'bank_transfer',
          paymentDate: today,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await c.proc.post('/payments', {
          direction: 'inbound',
          supplierId: env.seed.supplierIds[0],
          amount: '1.00',
          method: 'cash',
          paymentDate: today,
        })
      ).statusCode,
    ).toBe(400);
    // another hotel's invoice cannot be paid with this hotel's money
    const other = await c.proc.post('/payments', {
      direction: 'inbound',
      hotelId: env.seed.hotelIds[1],
      amount: '10.00',
      method: 'cash',
      paymentDate: today,
      allocations: [{ invoiceId: s.inv1.id, amount: '10.00' }],
    });
    expect(other.statusCode).toBe(400);
  });

  it('splits one payment across invoices and keeps the remainder as unallocated credit', async () => {
    const r = await c.proc.ok(
      c.proc.post('/payments', {
        direction: 'inbound',
        hotelId: s.hotelId,
        amount: '1500.00',
        method: 'bank_transfer',
        reference: 'GIBL-778899',
        paymentDate: today,
        allocations: [
          { invoiceId: s.inv1.id, amount: '700.00' },
          { invoiceId: s.inv2.id, amount: '727.72' },
        ],
        idempotencyKey: 'pay-hills-0001',
      }),
    );
    expect(r.unallocated).toBe('72.28');
    s.pay1 = r.payment;
    // a retried request with the same idempotency key does not record a second payment
    const retry = await c.proc.ok(
      c.proc.post('/payments', {
        direction: 'inbound',
        hotelId: s.hotelId,
        amount: '1500.00',
        method: 'bank_transfer',
        reference: 'GIBL-778899',
        paymentDate: today,
        idempotencyKey: 'pay-hills-0001',
      }),
    );
    expect(retry.duplicate).toBe(true);

    const list = await hills.ok(hills.get('/invoices'));
    const byId = Object.fromEntries(list.items.map((i: any) => [i.id, i]));
    expect(byId[s.inv1.id]).toMatchObject({ outstanding: '1578.08', paymentStatus: 'partially_paid' });
    expect(byId[s.inv2.id]).toMatchObject({ outstanding: '0.00', paymentStatus: 'paid' });
    const summary = await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/summary`));
    expect(summary.balance).toBe('1505.80'); // 3005.80 - 1500.00

    const aging = await c.owner.ok(c.owner.get(`/finance/ar-aging?hotelId=${s.hotelId}`));
    expect(aging.rows[0]).toMatchObject({
      current: '1578.08',
      unallocatedCredit: '-72.28',
      total: '1505.80',
    });
  });

  it('allocates the unallocated remainder later', async () => {
    const r = await c.proc.ok(
      c.proc.post(`/payments/${s.pay1.id}/allocations`, {
        allocations: [{ invoiceId: s.inv1.id, amount: '72.28' }],
      }),
    );
    expect(r.unallocated).toBe('0.00');
    expect(
      (
        await c.proc.post(`/payments/${s.pay1.id}/allocations`, {
          allocations: [{ invoiceId: s.inv1.id, amount: '0.01' }],
        })
      ).statusCode,
    ).toBe(422);
  });

  it('credit notes reduce what is owed and cannot exceed the invoiced quantity', async () => {
    const inv = await c.proc.ok(c.proc.get(`/invoices/${s.inv1.id}`));
    const line = inv.lines[0];
    expect(
      (
        await c.proc.post('/credit-notes', {
          invoiceId: s.inv1.id,
          reason: 'Too many',
          lines: [{ invoiceLineId: line.id, quantity: '11' }],
        })
      ).statusCode,
    ).toBe(422);
    const { creditNote } = await c.proc.ok(
      c.proc.post('/credit-notes', {
        invoiceId: s.inv1.id,
        reason: 'Two bottles returned damaged',
        lines: [{ invoiceLineId: line.id, quantity: '2' }],
      }),
    );
    expect(creditNote).toMatchObject({
      taxableTotal: '403.20',
      taxTotal: '52.42',
      total: '455.62',
      status: 'draft',
    });
    // a draft credit note has no financial effect
    expect((await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/summary`))).balance).toBe('1505.80');
    const issued = await c.proc.ok(c.proc.post(`/credit-notes/${creditNote.id}/issue`));
    expect(issued.creditNote.creditNoteNumber).toBe('CN-208384-00001');
    const after = await hills.ok(hills.get(`/invoices/${s.inv1.id}`));
    expect(after.outstanding).toBe('1050.18'); // 2278.08 - 772.28 - 455.62
    expect((await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/summary`))).balance).toBe('1050.18');
  });

  it('reversing a payment restores the balance without deleting history', async () => {
    const { payment } = await c.proc.ok(
      c.proc.post('/payments', {
        direction: 'inbound',
        hotelId: s.hotelId,
        amount: '50.00',
        method: 'cash',
        paymentDate: today,
        allocations: [{ invoiceId: s.inv1.id, amount: '50.00' }],
      }),
    );
    expect((await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/summary`))).balance).toBe('1000.18');
    await c.owner.ok(
      c.owner.post(`/payments/${payment.id}/reverse`, { reason: 'Recorded against the wrong hotel' }),
    );
    expect((await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/summary`))).balance).toBe('1050.18');
    expect((await hills.ok(hills.get(`/invoices/${s.inv1.id}`))).outstanding).toBe('1050.18');
    expect(
      (await c.owner.post(`/payments/${payment.id}/reverse`, { reason: 'again please' })).statusCode,
    ).toBe(409);
    const st = await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/statement`));
    expect(st.entries.filter((e: any) => e.sourceId === payment.id)).toHaveLength(2);
    await expectDbError(
      env.db.execute(sql`update payments set amount = 1 where id = ${payment.id}`),
      /immutable|Reversed/,
    );
  });

  it('the AR ledger is append-only and matches document totals', async () => {
    await expectDbError(env.db.execute(sql`update ledger_entries set debit = 0`), /append-only/);
    await expectDbError(env.db.execute(sql`delete from ledger_entries`), /append-only/);
    const rec = await c.owner.ok(c.owner.get('/reports/reconciliation'));
    expect(rec.receivables.reconciled).toBe(true);
    expect(rec.receivables.ledgerBalance).toBe('1050.18');
  });
});

describe('accounts payable', () => {
  it('posts supplier bills, tracks partial payments and supplier aging', async () => {
    const supplierId = env.seed.supplierIds[3]!;
    const { bill } = await c.proc.ok(
      c.proc.post('/supplier-bills', {
        supplierId,
        supplierBillNumber: 'LGW-5001',
        poId: s.po1.id,
        billDate: today,
      }),
    );
    expect(bill).toMatchObject({
      taxableTotal: '1500.00',
      taxTotal: '195.00',
      total: '1695.00',
      status: 'draft',
    });
    // paying a draft bill is impossible
    expect(
      (
        await c.proc.post('/payments', {
          direction: 'outbound',
          supplierId,
          amount: '10.00',
          method: 'cash',
          paymentDate: today,
          allocations: [{ billId: bill.id, amount: '10.00' }],
        })
      ).statusCode,
    ).toBe(400);
    await c.proc.ok(c.proc.post(`/supplier-bills/${bill.id}/post`));
    await expectDbError(
      env.db.execute(sql`update supplier_bills set total = 1 where id = ${bill.id}`),
      /finalized/,
    );
    await c.proc.ok(
      c.proc.post('/payments', {
        direction: 'outbound',
        supplierId,
        amount: '695.00',
        method: 'cash',
        paymentDate: today,
        allocations: [{ billId: bill.id, amount: '695.00' }],
      }),
    );
    const b = await c.proc.ok(c.proc.get(`/supplier-bills/${bill.id}`));
    expect(b.outstanding).toBe('1000.00');
    const aging = await c.owner.ok(c.owner.get('/finance/ap-aging'));
    expect(aging.rows.find((r: any) => r.supplierId === supplierId)).toMatchObject({
      total: '1000.00',
      current: '1000.00',
    });
    const rec = await c.owner.ok(c.owner.get('/reports/reconciliation'));
    expect(rec.payables).toMatchObject({ ledgerBalance: '1000.00', reconciled: true });
  });

  it('write-offs need owner approval; the owner can post directly', async () => {
    const r = await c.proc.ok(
      c.proc.post('/financial-adjustments', {
        account: 'accounts_receivable',
        hotelId: s.hotelId,
        amount: '-0.18',
        reason: 'Rounding write-off agreed with customer',
      }),
    );
    expect(r.applied).toBe(false);
    expect((await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/summary`))).balance).toBe('1050.18');
    await c.owner.ok(c.owner.post(`/approvals/${r.approval.id}/decide`, { decision: 'approved' }));
    expect((await hills.ok(hills.get(`/finance/hotels/${s.hotelId}/summary`))).balance).toBe('1050.00');
    const rec = await c.owner.ok(c.owner.get('/reports/reconciliation'));
    expect(rec.receivables.reconciled).toBe(true);
  });

  it('report totals equal the underlying records', async () => {
    const sales = await c.owner.ok(c.owner.get('/reports/sales?groupBy=hotel'));
    const hillsRow = sales.rows.find((r: any) => r.group === 'Renamed Resort Ltd.');
    expect(hillsRow).toMatchObject({
      invoices: 2,
      net_sales: '2660.00',
      tax: '345.80',
      gross_sales: '3005.80',
      credit_notes: '455.62',
    });
    const csv = await c.owner.get('/reports/sales?groupBy=hotel&format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('2660.00');
    // hotel users can run their own sales (purchase) report but only see themselves
    const own = await hills.ok(hills.get('/reports/sales'));
    expect(own.rows).toHaveLength(1);
  });
});
