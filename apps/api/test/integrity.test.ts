/** Database-level invariants, concurrency, delivery exceptions, uploads and audit tamper detection. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { as, Client, EMAILS, expectDbError, setupTestEnv, type TestEnv } from './helpers';
import { fulfilOrder, placeOrder, staff, type Clients } from './flow';
import { hotels } from '../src/db/schema';
import { todayNepal } from '../src/lib/http';

let env: TestEnv;
let c: Clients;
let hills: Client, tinau: Client;
const P = (sku: string) => env.seed.productIds[sku]!;

beforeAll(async () => {
  env = await setupTestEnv();
  c = await staff(env);
  hills = await as(env, EMAILS.hillsManager);
  tinau = await as(env, EMAILS.tinauManager);
});
afterAll(async () => env.close());

describe('purchase order commitments', () => {
  it('the database refuses a supplier commitment without an approval', async () => {
    const { purchaseOrder } = await c.proc.ok(
      c.proc.post('/purchase-orders', {
        supplierId: env.seed.supplierIds[0],
        lines: [{ productId: P('CL-FLR-5L'), quantity: '4', unitCost: '600.00' }],
      }),
    );
    await expectDbError(
      env.db.execute(sql`update purchase_orders set status = 'sent' where id = ${purchaseOrder.id}`),
      /purchase_orders_commit_needs_approval_chk/,
    );
    expect((await c.proc.post(`/purchase-orders/${purchaseOrder.id}/send`)).statusCode).toBe(422);
    // receiving against an unsent PO is refused
    const po = await c.proc.ok(c.proc.get(`/purchase-orders/${purchaseOrder.id}`));
    expect(
      (
        await c.hub.post(`/purchase-orders/${purchaseOrder.id}/receipts`, {
          lines: [{ poLineId: po.lines[0].id, qtyAccepted: '1' }],
        })
      ).statusCode,
    ).toBe(422);
  });

  it('POs under the configured threshold are approved automatically; above it they wait', async () => {
    await c.owner.ok(c.owner.patch('/settings', { poApprovalThreshold: '5000.00' }));
    const small = await c.proc.ok(
      c.proc.post('/purchase-orders', {
        supplierId: env.seed.supplierIds[0],
        lines: [{ productId: P('CL-FLR-5L'), quantity: '2', unitCost: '600.00' }],
      }),
    );
    expect(
      (await c.proc.ok(c.proc.post(`/purchase-orders/${small.purchaseOrder.id}/submit`))).purchaseOrder
        .status,
    ).toBe('approved');
    const big = await c.proc.ok(
      c.proc.post('/purchase-orders', {
        supplierId: env.seed.supplierIds[0],
        lines: [{ productId: P('CL-FLR-5L'), quantity: '20', unitCost: '600.00' }],
      }),
    );
    expect(
      (await c.proc.ok(c.proc.post(`/purchase-orders/${big.purchaseOrder.id}/submit`))).purchaseOrder.status,
    ).toBe('pending_approval');
    await c.owner.ok(c.owner.patch('/settings', { poApprovalThreshold: '0.00' }));
  });
});

describe('hub stock', () => {
  it('stock adjustments: decreases need approval, reserved stock is protected, ledger is append-only', async () => {
    // put 10 units into hub stock as a found-stock adjustment (increase does not need approval)
    const inc = await c.hub.ok(
      c.hub.post('/hub/adjustments', {
        productId: P('EL-LED-9W'),
        quantity: '10',
        reason: 'Found during count',
      }),
    );
    expect(inc.applied).toBe(true);
    const dec = await c.hub.ok(
      c.hub.post('/hub/adjustments', {
        productId: P('EL-LED-9W'),
        quantity: '-3',
        movementType: 'write_off',
        reason: 'Broken bulbs',
      }),
    );
    expect(dec.applied).toBe(false);
    let stock = await c.hub.ok(c.hub.get('/hub/stock?q=EL-LED-9W'));
    expect(stock.items[0].onHand).toBe('10.000');
    await c.owner.ok(c.owner.post(`/approvals/${dec.approval.id}/decide`, { decision: 'approved' }));
    stock = await c.hub.ok(c.hub.get('/hub/stock?q=EL-LED-9W'));
    expect(stock.items[0].onHand).toBe('7.000');
    // cannot write off more than is available
    expect(
      (
        await c.owner.post('/hub/adjustments', {
          productId: P('EL-LED-9W'),
          quantity: '-8',
          movementType: 'write_off',
          reason: 'Too many',
        })
      ).statusCode,
    ).toBe(422);
    await expectDbError(env.db.execute(sql`update hub_stock_movements set quantity = 100`), /append-only/);
    await expectDbError(
      env.db.execute(
        sql`insert into hub_stock_movements (product_id, movement_type, quantity, actor_id) values (${P('EL-LED-9W')}, 'dispatch', 5, ${env.seed.ownerId})`,
      ),
      /hub_movements_sign_chk/,
    );
  });
});

describe('delivery exceptions', () => {
  it('a failed delivery returns goods to the hub, re-reserves them and can be rescheduled', async () => {
    const order = await placeOrder(hills, [{ productId: P('KT-FOIL-72'), quantity: '3' }]);
    const { order: o } = await c.proc.ok(c.proc.get(`/orders/${order.id}`));
    await c.proc.ok(
      c.proc.put(`/orders/${order.id}/lines/${o.lines[0].id}/sourcing`, {
        supplierId: env.seed.supplierIds[0],
        unitCost: '600.00',
      }),
    );
    const { purchaseOrders } = await c.proc.ok(c.proc.post(`/orders/${order.id}/purchase-orders`));
    const sub = await c.proc.ok(c.proc.post(`/purchase-orders/${purchaseOrders[0].id}/submit`));
    await c.owner.ok(c.owner.post(`/approvals/${sub.approval.id}/decide`, { decision: 'approved' }));
    await c.proc.ok(c.proc.post(`/purchase-orders/${purchaseOrders[0].id}/send`));
    const po = await c.hub.ok(c.hub.get(`/purchase-orders/${purchaseOrders[0].id}`));
    await c.hub.ok(
      c.hub.post(`/purchase-orders/${po.purchaseOrder.id}/receipts`, {
        lines: [{ poLineId: po.lines[0].id, qtyAccepted: '3' }],
      }),
    );

    const { run } = await c.proc.ok(
      c.proc.post('/delivery-runs', { scheduledDate: todayNepal(), driverId: env.seed.userIds.driver }),
    );
    const { delivery } = await c.proc.ok(c.proc.post('/deliveries', { orderId: order.id, runId: run.id }));
    // a driver who is not assigned cannot see or confirm the delivery
    const inv = await c.owner.ok(
      c.owner.post('/users/invitations', {
        email: 'driver2@demo.local',
        name: 'Second driver',
        role: 'driver',
      }),
    );
    await new Client(env.app).ok(
      new Client(env.app).post('/auth/invitations/accept', {
        token: new URL(inv.inviteUrl).searchParams.get('token'),
        password: 'driver-two-password',
      }),
    );
    const driver2 = await new Client(env.app).login('driver2@demo.local', 'driver-two-password');
    expect((await driver2.get(`/deliveries/${delivery.id}`)).statusCode).toBe(404);
    expect((await driver2.ok(driver2.get('/deliveries'))).items).toHaveLength(0);

    await c.hub.ok(c.hub.post(`/deliveries/${delivery.id}/dispatch`));
    expect((await c.hub.post(`/deliveries/${delivery.id}/dispatch`)).statusCode).toBe(409); // no double dispatch
    expect((await driver2.post(`/deliveries/${delivery.id}/fail`, { reason: 'not mine' })).statusCode).toBe(
      404,
    );
    await c.driver.ok(
      c.driver.post(`/deliveries/${delivery.id}/fail`, { reason: 'Hotel closed for a function' }),
    );

    const stock = await c.hub.ok(c.hub.get('/hub/stock?q=KT-FOIL-72'));
    expect(stock.items[0]).toMatchObject({ onHand: '3.000', reserved: '3.000' });
    const d = await hills.ok(hills.get(`/orders/${order.id}`));
    expect(d.order.status).toBe('ready_for_dispatch');
    expect(d.events.map((e: any) => e.event)).toContain('delivery_failed');
    const runs = await c.proc.ok(c.proc.get('/delivery-runs'));
    expect(runs.items.find((r: any) => r.id === run.id).status).toBe('completed');
    // reschedule
    const again = await c.proc.ok(c.proc.post('/deliveries', { orderId: order.id }));
    expect(again.delivery.status).toBe('scheduled');
  });

  it('supplier-direct delivery skips the hub and still produces delivery and invoice records', async () => {
    const order = await placeOrder(hills, [{ productId: P('LN-BED-SGL'), quantity: '10' }]);
    const { order: o } = await c.proc.ok(c.proc.get(`/orders/${order.id}`));
    await c.proc.ok(
      c.proc.put(`/orders/${order.id}/lines/${o.lines[0].id}/sourcing`, {
        supplierId: env.seed.supplierIds[2],
        unitCost: '700.00',
      }),
    );
    const { purchaseOrders } = await c.proc.ok(
      c.proc.post(`/orders/${order.id}/purchase-orders`, { fulfillment: 'direct' }),
    );
    expect(purchaseOrders[0]).toMatchObject({ fulfillment: 'direct', directHotelId: env.seed.hotelIds[2] });
    const sub = await c.proc.ok(c.proc.post(`/purchase-orders/${purchaseOrders[0].id}/submit`));
    await c.owner.ok(c.owner.post(`/approvals/${sub.approval.id}/decide`, { decision: 'approved' }));
    await c.proc.ok(c.proc.post(`/purchase-orders/${purchaseOrders[0].id}/send`));
    const po = await c.proc.ok(c.proc.get(`/purchase-orders/${purchaseOrders[0].id}`));
    expect(
      (
        await c.hub.post(`/purchase-orders/${po.purchaseOrder.id}/receipts`, {
          lines: [{ poLineId: po.lines[0].id, qtyAccepted: '10' }],
        })
      ).statusCode,
    ).toBe(400); // needs recipient
    await c.hub.ok(
      c.hub.post(`/purchase-orders/${po.purchaseOrder.id}/receipts`, {
        recipientName: 'Resort store keeper',
        lines: [{ poLineId: po.lines[0].id, qtyAccepted: '9', qtyDamaged: '1' }],
      }),
    );
    const d = await hills.ok(hills.get(`/orders/${order.id}`));
    expect(d.quantities[o.lines[0].id]).toMatchObject({ delivered: '9.000', reserved: '0.000' });
    expect(d.order.status).toBe('partially_delivered');
    const stock = await c.hub.ok(c.hub.get('/hub/stock?q=LN-BED-SGL&onlyNonZero=false'));
    expect(stock.items[0].onHand).toBe('0.000'); // never touched the hub
    const drafts = await c.proc.ok(c.proc.get(`/invoices?orderId=${order.id}&status=draft`));
    expect(drafts.items[0].taxableTotal).toBe('7257.60'); // 9 x 806.40 (720 + 12%)
  });
});

describe('concurrency', () => {
  it('parallel allocations cannot over-pay one invoice', async () => {
    const order = await placeOrder(hills, [{ productId: P('ST-PEN-BLU'), quantity: '1' }]);
    const f = await fulfilOrder(env, c, order.id, '300.00');
    const { invoice } = await c.proc.ok(c.proc.post(`/invoices/${f.draftInvoice.id}/issue`));
    // invoice total 404.99 (358.40 + 46.59 VAT); two clerks each try to allocate 300
    const attempts = await Promise.all(
      [1, 2].map((i) =>
        c.proc.post('/payments', {
          direction: 'inbound',
          hotelId: env.seed.hotelIds[2],
          amount: '300.00',
          method: 'cash',
          paymentDate: todayNepal(),
          allocations: [{ invoiceId: invoice.id, amount: '300.00' }],
          notes: `clerk ${i}`,
        }),
      ),
    );
    expect(attempts.map((r) => r.statusCode).sort()).toEqual([200, 422]);
    expect((await c.proc.ok(c.proc.get(`/invoices/${invoice.id}`))).outstanding).toBe('104.99');
  });

  it('parallel invoice issuing produces unique, gapless numbers', async () => {
    const drafts = [];
    for (let i = 0; i < 4; i++) {
      const order = await placeOrder(hills, [{ productId: P('ST-A4-500'), quantity: '1' }]);
      drafts.push((await fulfilOrder(env, c, order.id, '500.00')).draftInvoice.id);
    }
    const issued = await Promise.all(drafts.map((id) => c.proc.ok(c.proc.post(`/invoices/${id}/issue`))));
    const numbers = issued.map((r) => Number(r.invoice.invoiceNumber.split('-').pop())).sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i++) expect(numbers[i]).toBe(numbers[i - 1]! + 1);
  });
});

describe('updates and uploads', () => {
  it('a partial update never resets other fields to defaults', async () => {
    await env.db
      .update(hotels)
      .set({ status: 'on_hold', city: 'Tilottama' })
      .where(eq(hotels.id, env.seed.hotelIds[0]!));
    await c.owner.ok(c.owner.patch(`/hotels/${env.seed.hotelIds[0]}`, { phone: '071-555555' }));
    const { hotel } = await c.owner.ok(c.owner.get(`/hotels/${env.seed.hotelIds[0]}`));
    expect(hotel).toMatchObject({
      phone: '071-555555',
      status: 'on_hold',
      city: 'Tilottama',
      requireManagerApproval: true,
    });
    await env.db.update(hotels).set({ status: 'active' }).where(eq(hotels.id, env.seed.hotelIds[0]!));
  });

  it('accepts real images, rejects disguised files and enforces download permissions', async () => {
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
      'hex',
    );
    const upload = (client: Client, buf: Buffer, name: string, category: string) => {
      const boundary = '----hptest' + Math.random().toString(16).slice(2);
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n`,
        ),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        buf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return env.app.inject({
        method: 'POST',
        url: '/api/v1/attachments',
        payload: body,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-csrf-token': client.csrf },
        cookies: { hp_sid: client.cookie },
      });
    };
    const ok = await upload(tinau, png, 'shelf.png', 'request_photo');
    expect(ok.statusCode).toBe(200);
    const exe = await upload(
      tinau,
      Buffer.from('4d5a90000300000004000000ffff0000', 'hex'),
      'innocent.png',
      'request_photo',
    );
    expect(exe.statusCode).toBe(400);
    // hotel users cannot upload supplier bills
    expect((await upload(tinau, png, 'bill.png', 'supplier_bill')).statusCode).toBe(403);
    const internal = await upload(c.proc, png, 'bill.png', 'supplier_bill');
    const id = internal.json().attachment.id;
    expect((await tinau.get(`/attachments/${id}/download`)).statusCode).toBe(404);
    const dl = await c.owner.get(`/attachments/${id}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    const own = await tinau.get(`/attachments/${ok.json().attachment.id}/download`);
    expect(own.statusCode).toBe(200);
    expect((await hills.get(`/attachments/${ok.json().attachment.id}/download`)).statusCode).toBe(404);
  });
});

describe('audit trail', () => {
  it('is append-only and detects tampering through the hash chain', async () => {
    await expectDbError(env.db.execute(sql`update audit_logs set action = 'nothing'`), /append-only/);
    await expectDbError(env.db.execute(sql`delete from audit_logs`), /append-only/);
    expect((await c.owner.ok(c.owner.get('/audit/verify'))).ok).toBe(true);
    // simulate an attacker with superuser rights who bypasses the trigger
    await env.db.execute(sql`alter table audit_logs disable trigger audit_logs_append_only`);
    await env.db.execute(
      sql`update audit_logs set reason = 'edited' where id = (select min(id) + 3 from audit_logs)`,
    );
    await env.db.execute(sql`alter table audit_logs enable trigger audit_logs_append_only`);
    const v = await c.owner.ok(c.owner.get('/audit/verify'));
    expect(v.ok).toBe(false);
    expect(v.brokenAtId).toBeGreaterThan(0);
  });

  it('never stores password hashes or secrets', async () => {
    const [row] = (
      await env.db.execute(
        sql`select count(*)::int as n from audit_logs where before::text ~* 'passwordHash|mfaSecret|argon2' or after::text ~* 'passwordHash|mfaSecret|argon2'`,
      )
    ).rows as { n: number }[];
    expect(row!.n).toBe(0);
    expect((await tinau.get('/audit')).statusCode).toBe(403);
  });
});
