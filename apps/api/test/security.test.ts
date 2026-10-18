/**
 * Authentication, role permissions and hotel (tenant) isolation.
 * Acceptance criterion 18: unauthorized users cannot access another hotel's data
 * or approve restricted transactions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ROLES, ROLE_PERMISSIONS, roleHas } from '@hp/shared';
import { as, Client, EMAILS, setupTestEnv, uuid, type TestEnv } from './helpers';
import { totp } from '../src/lib/crypto';
import { users, companySettings } from '../src/db/schema';

let env: TestEnv;
let tinau: Client, lumbini: Client, owner: Client, proc: Client;
const s: Record<string, any> = {};

beforeAll(async () => {
  env = await setupTestEnv();
  owner = await as(env, EMAILS.owner);
  proc = await as(env, EMAILS.procurement);
  tinau = await as(env, EMAILS.tinauManager);
  lumbini = await as(env, EMAILS.lumbiniManager);
  // Lumbini places an order so there is something to try to steal
  const { order } = await lumbini.ok(
    lumbini.post('/orders', {
      lines: [{ productId: env.seed.productIds['CL-FLR-5L'], quantity: '2' }],
      submit: true,
    }),
  );
  s.lumbiniOrder = order;
  s.lumbiniHotel = env.seed.hotelIds[1];
  s.tinauHotel = env.seed.hotelIds[0];
});
afterAll(async () => env.close());

describe('authentication', () => {
  it('rejects wrong passwords with a generic message and locks after 5 failures', async () => {
    const anon = new Client(env.app);
    for (let i = 0; i < 5; i++) {
      const r = await anon.post('/auth/login', { email: EMAILS.hillsManager, password: 'wrong-password' });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.message).toBe('Invalid email or password');
    }
    const locked = await anon.post('/auth/login', {
      email: EMAILS.hillsManager,
      password: 'Demo-Pass-2083!',
    });
    expect(locked.statusCode).toBe(429);
    await env.db.update(users).set({ lockedUntil: null }).where(eq(users.email, EMAILS.hillsManager));
  });

  it('unknown emails get the same response as wrong passwords', async () => {
    const r = await new Client(env.app).post('/auth/login', {
      email: 'nobody@example.com',
      password: 'whatever-123',
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toBe('Invalid email or password');
  });

  it('requires a session for protected routes', async () => {
    expect((await new Client(env.app).get('/orders')).statusCode).toBe(401);
  });

  it('requires the CSRF token for cookie-authenticated writes', async () => {
    const c = await as(env, EMAILS.tinauManager);
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/v1/product-requests',
      cookies: { hp_sid: c.cookie },
      payload: { description: 'test item', quantity: '1', unit: 'pcs' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf');
  });

  it('logout revokes the session server side', async () => {
    const c = await as(env, EMAILS.tinauPurchaser);
    await c.ok(c.post('/auth/logout'));
    expect((await c.get('/auth/me')).statusCode).toBe(401);
  });

  it('deactivating a user ends their sessions immediately', async () => {
    const c = await as(env, EMAILS.tinauInventory);
    expect((await c.get('/auth/me')).statusCode).toBe(200);
    await owner.ok(owner.patch(`/users/${env.seed.userIds.tinauInventory}`, { isActive: false }));
    expect((await c.get('/auth/me')).statusCode).toBe(401);
    expect(
      (
        await new Client(env.app).post('/auth/login', {
          email: EMAILS.tinauInventory,
          password: 'Demo-Pass-2083!',
        })
      ).statusCode,
    ).toBe(401);
    await owner.ok(owner.patch(`/users/${env.seed.userIds.tinauInventory}`, { isActive: true }));
  });

  it('enforces strong passwords on reset and invitation', async () => {
    const inv = await owner.ok(
      owner.post('/users/invitations', { email: 'weak@example.com', name: 'Weak', role: 'warehouse' }),
    );
    const token = new URL(inv.inviteUrl).searchParams.get('token');
    const r = await new Client(env.app).post('/auth/invitations/accept', { token, password: 'short' });
    expect(r.statusCode).toBe(400);
  });

  it('supports TOTP multi-factor authentication and enforces it for privileged users', async () => {
    const c = await as(env, EMAILS.procurement);
    const setup = await c.ok(c.post('/auth/mfa/setup'));
    expect((await c.post('/auth/mfa/enable', { code: '000000' })).statusCode).toBe(400);
    await c.ok(c.post('/auth/mfa/enable', { code: totp(setup.secret) }));

    // a fresh login now needs the second factor before anything else works
    const c2 = await as(env, EMAILS.procurement);
    const blocked = await c2.get('/orders');
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe('mfa_required');
    expect((await c2.post('/auth/mfa/verify', { code: '123456' })).statusCode).toBe(401);
    await c2.ok(c2.post('/auth/mfa/verify', { code: totp(setup.secret) }));
    expect((await c2.get('/orders')).statusCode).toBe(200);

    // with enforcement on, a privileged user without MFA must enrol first
    await env.db.update(companySettings).set({ mfaEnforced: true });
    const o = await as(env, EMAILS.owner);
    const r = await o.get('/orders');
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('mfa_enrolment_required');
    expect((await o.get('/auth/me')).json().mfaEnrolmentRequired).toBe(true);
    // hotel users are not privileged and are unaffected
    expect((await (await as(env, EMAILS.tinauManager)).get('/orders')).statusCode).toBe(200);
    await env.db.update(companySettings).set({ mfaEnforced: false });
    // the encrypted secret is never stored in plaintext
    const [u] = await env.db.select().from(users).where(eq(users.email, EMAILS.procurement));
    expect(u!.mfaSecretEnc).not.toContain(setup.secret);
    await owner.ok(owner.post(`/users/${u!.id}/reset-mfa`));
    proc = await as(env, EMAILS.procurement);
  });
});

describe('hotel isolation', () => {
  it('cannot read another hotel’s order by id, list it, or act on it', async () => {
    const id = s.lumbiniOrder.id;
    expect((await tinau.get(`/orders/${id}`)).statusCode).toBe(404);
    expect((await tinau.post(`/orders/${id}/cancel`, { reason: 'malicious' })).statusCode).toBe(404);
    expect((await tinau.post(`/orders/${id}/reorder`)).statusCode).toBe(404);
    // passing the other hotel's id as a filter is ignored for hotel users
    const list = await tinau.ok(tinau.get(`/orders?hotelId=${s.lumbiniHotel}`));
    expect(list.items.every((o: any) => o.hotelId === s.tinauHotel)).toBe(true);
    expect((await tinau.get(`/hotels/${s.lumbiniHotel}`)).statusCode).toBe(404);
    expect((await tinau.get(`/hotels/${s.lumbiniHotel}/contracts`)).statusCode).toBe(404);
  });

  it('cannot see another hotel’s finances', async () => {
    expect((await tinau.get(`/finance/hotels/${s.lumbiniHotel}/summary`)).statusCode).toBe(404);
    expect((await tinau.get(`/finance/hotels/${s.lumbiniHotel}/statement`)).statusCode).toBe(404);
    const aging = await tinau.ok(tinau.get(`/finance/ar-aging?hotelId=${s.lumbiniHotel}`));
    expect(aging.rows.every((r: any) => r.hotelId === s.tinauHotel)).toBe(true);
    const payments = await tinau.ok(tinau.get(`/payments?hotelId=${s.lumbiniHotel}`));
    expect(payments.items.every((p: any) => p.hotelId === s.tinauHotel)).toBe(true);
  });

  it('cannot scan another hotel’s shelf QR code or post events to its shelves', async () => {
    const token = env.seed.shelfTokens[0]!; // belongs to Tinau
    expect((await lumbini.get(`/hotel-inventory/scan/${token}`)).statusCode).toBe(404);
    const tinauShelf = (await tinau.ok(tinau.get(`/hotel-inventory/scan/${token}`))).shelf;
    const r = await lumbini.ok(
      lumbini.post('/hotel-inventory/events', {
        events: [
          {
            id: uuid(),
            locationId: tinauShelf.id,
            productId: env.seed.productIds['AM-SHP-30'],
            action: 'usage',
            quantity: '1',
            clientRecordedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    expect(r.results[0].status).toBe('rejected');
    expect(
      (await lumbini.get(`/hotel-inventory/locations?hotelId=${s.tinauHotel}`))
        .json()
        .items.every((l: any) => l.hotelId !== s.tinauHotel),
    ).toBe(true);
  });

  it('cannot manage users of another hotel or create internal users', async () => {
    expect(
      (
        await tinau.post('/users/invitations', {
          email: 'x@example.com',
          name: 'X',
          role: 'hotel_purchaser',
          hotelId: s.lumbiniHotel,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await tinau.post('/users/invitations', { email: 'y@example.com', name: 'Y', role: 'procurement' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await tinau.post('/users/invitations', { email: 'z@example.com', name: 'Z', role: 'hotel_manager' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await tinau.patch(`/users/${env.seed.userIds.lumbiniManager}`, { isActive: false })).statusCode,
    ).toBe(404);
    const ok = await tinau.ok(
      tinau.post('/users/invitations', {
        email: 'newstaff@tinau.example.com',
        name: 'New staff',
        role: 'hotel_inventory',
      }),
    );
    expect(ok.inviteUrl).toContain('token=');
  });
});

describe('confidential data and restricted actions', () => {
  it('hotel users never receive supplier costs or margins', async () => {
    const products = await tinau.ok(tinau.get('/products?pageSize=100'));
    const body = JSON.stringify(products);
    expect(body).not.toMatch(/referenceCost|marginPercent|priceSource/);
    const one = await tinau.ok(tinau.get(`/products/${env.seed.productIds['CL-FLR-5L']}`));
    expect(one.product).not.toHaveProperty('referenceCost');
    expect(one).not.toHaveProperty('suppliers');
    expect((await tinau.get('/suppliers')).statusCode).toBe(403);
    expect((await tinau.get('/quotations')).statusCode).toBe(403);
    expect((await tinau.get('/purchase-orders')).statusCode).toBe(403);
    expect((await tinau.get('/reports/margin')).statusCode).toBe(403);
  });

  it('internal staff can preview a hotel price including cost and margin', async () => {
    const products = await proc.ok(proc.get(`/products?hotelId=${s.tinauHotel}&q=PP-TIS-10`));
    expect(products.items[0]).toMatchObject({
      unitPrice: '425.00',
      referenceCost: '380.00',
      priceSource: 'hotel_product:fixed_price',
    });
  });

  it('hotel inventory staff cannot reach finance, ordering or settings', async () => {
    const inv = await as(env, EMAILS.tinauInventory);
    for (const url of [
      '/invoices',
      '/payments',
      `/finance/hotels/${s.tinauHotel}/summary`,
      '/orders',
      '/settings',
      '/users',
      '/audit',
    ]) {
      expect((await inv.get(url)).statusCode, url).toBe(403);
    }
    expect((await inv.post('/orders', { lines: [] })).statusCode).toBe(403);
  });

  it('drivers and hub staff cannot edit finances or see costs', async () => {
    const driver = await as(env, EMAILS.driver);
    const hub = await as(env, EMAILS.warehouse);
    for (const c of [driver, hub]) {
      expect((await c.get('/invoices')).statusCode).toBe(403);
      expect((await c.post('/payments', {})).statusCode).toBe(403);
      expect((await c.get('/suppliers')).statusCode).toBe(403);
      expect(
        (
          await c.post(`/hotels/${s.tinauHotel}/credit-terms`, {
            creditLimit: '1',
            paymentTermsDays: 1,
            reason: 'x',
          })
        ).statusCode,
      ).toBe(403);
    }
    const stock = await hub.ok(hub.get('/hub/stock?onlyNonZero=false'));
    expect(JSON.stringify(stock)).not.toMatch(/referenceCost|stockValue":"/);
  });

  it('only the owner decides approvals; staff changes to credit terms become approval requests', async () => {
    const r = await proc.ok(
      proc.post(`/hotels/${s.lumbiniHotel}/credit-terms`, {
        creditLimit: '999999.00',
        paymentTermsDays: 60,
        reason: 'Customer asked',
      }),
    );
    expect(r.applied).toBe(false);
    const hotel = await owner.ok(owner.get(`/hotels/${s.lumbiniHotel}`));
    expect(hotel.hotel.creditLimit).toBe('40000.00'); // unchanged until approved
    expect((await proc.post(`/approvals/${r.approval.id}/decide`, { decision: 'approved' })).statusCode).toBe(
      403,
    );
    expect(
      (await tinau.post(`/approvals/${r.approval.id}/decide`, { decision: 'approved' })).statusCode,
    ).toBe(403);
    await owner.ok(
      owner.post(`/approvals/${r.approval.id}/decide`, { decision: 'rejected', note: 'Too high' }),
    );
    expect(
      (await owner.post(`/approvals/${r.approval.id}/decide`, { decision: 'approved' })).statusCode,
    ).toBe(409);
    expect((await owner.ok(owner.get(`/hotels/${s.lumbiniHotel}`))).hotel.creditLimit).toBe('40000.00');
  });

  it('payment reversal is owner-only', async () => {
    expect((await proc.post(`/payments/${uuid()}/reverse`, { reason: 'mistake entry' })).statusCode).toBe(
      403,
    );
  });

  it('the permission matrix gives hotel roles no internal permissions', () => {
    const internalOnly = [
      'costs.view',
      'suppliers.read',
      'procurement.manage',
      'approvals.decide',
      'finance.view_all',
      'audit.view',
      'hub.receive',
      'pricing.manage',
    ] as const;
    for (const role of ROLES.filter((r) => r.startsWith('hotel_'))) {
      for (const p of internalOnly) expect(roleHas(role, p), `${role} ${p}`).toBe(false);
    }
    expect(ROLE_PERMISSIONS.owner.length).toBeGreaterThan(ROLE_PERMISSIONS.procurement.length);
    expect(ROLES.filter((r) => roleHas(r, 'approvals.decide'))).toEqual(['owner']);
  });

  it('rejects malformed ids and unknown fields gracefully', async () => {
    expect((await owner.get('/orders/not-a-uuid')).statusCode).toBe(400);
    expect((await owner.get(`/orders/${uuid()}`)).statusCode).toBe(404);
  });
});
