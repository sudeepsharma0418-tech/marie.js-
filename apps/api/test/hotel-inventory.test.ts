/**
 * Shelf-level QR inventory and offline synchronisation (spec modules 8 & 9,
 * acceptance criteria 16 & 17).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { as, Client, EMAILS, expectDbError, setupTestEnv, uuid, type TestEnv } from './helpers';

let env: TestEnv;
let store: Client, manager: Client, purchaser: Client;
let shelf: { id: string; name: string };
let shampoo: string, soap: string;

const ev = (over: Record<string, unknown>) => ({
  id: uuid(),
  locationId: shelf.id,
  productId: shampoo,
  action: 'usage',
  quantity: '2',
  clientRecordedAt: new Date().toISOString(),
  ...over,
});

beforeAll(async () => {
  env = await setupTestEnv();
  store = await as(env, EMAILS.tinauInventory);
  manager = await as(env, EMAILS.tinauManager);
  purchaser = await as(env, EMAILS.tinauPurchaser);
  shampoo = env.seed.productIds['AM-SHP-30']!;
  soap = env.seed.productIds['AM-SOP-20']!;
  const scan = await store.ok(store.get(`/hotel-inventory/scan/${env.seed.shelfTokens[0]}`));
  shelf = scan.shelf;
});
afterAll(async () => env.close());

async function balance(productId = shampoo) {
  const scan = await store.ok(store.get(`/hotel-inventory/scan/${env.seed.shelfTokens[0]}`));
  return scan.products.find((p: any) => p.productId === productId).balance as string;
}

describe('scanning a shelf', () => {
  it('shows the shelf, its products, quantities and default usage, without prices', async () => {
    const scan = await store.ok(store.get(`/hotel-inventory/scan/${env.seed.shelfTokens[0]}`));
    expect(scan.shelf.name).toBe('HK shelf A – toiletries');
    expect(scan.shelf.areaName).toBe('Housekeeping room');
    const p = scan.products.find((x: any) => x.productId === shampoo);
    expect(p).toMatchObject({
      balance: '120.000',
      unit: 'pcs',
      defaultUsageQty: '2.000',
      nameNe: 'पाहुना स्याम्पु ३० मिलि',
    });
    expect(JSON.stringify(scan)).not.toMatch(/price|cost/i);
  });

  it('an unknown or deactivated code is not found', async () => {
    expect((await store.get('/hotel-inventory/scan/this-is-not-a-real-token')).statusCode).toBe(404);
  });
});

describe('recording usage and restocking', () => {
  it('records usage and restock and computes balance from movements', async () => {
    const r = await store.ok(
      store.post('/hotel-inventory/events', {
        events: [ev({ quantity: '2' }), ev({ action: 'restock', quantity: '10' })],
      }),
    );
    expect(r.results.map((x: any) => x.status)).toEqual(['applied', 'applied']);
    expect(await balance()).toBe('128.000');
  });

  it('re-sending the same event id never deducts twice (idempotent sync)', async () => {
    const e = ev({ quantity: '5', offline: true });
    const first = await store.ok(store.post('/hotel-inventory/events', { events: [e] }));
    const retry = await store.ok(store.post('/hotel-inventory/events', { events: [e, e] }));
    expect(first.results[0].status).toBe('applied');
    expect(retry.results.map((x: any) => x.status)).toEqual(['duplicate', 'duplicate']);
    expect(await balance()).toBe('123.000');
    const [row] = (
      await env.db.execute(sql`select count(*)::int as n from hotel_stock_movements where event_id = ${e.id}`)
    ).rows as { n: number }[];
    expect(row!.n).toBe(1);
  });

  it('rejects reuse of an event id for a different action', async () => {
    const e = ev({ quantity: '1' });
    await store.ok(store.post('/hotel-inventory/events', { events: [e] }));
    const r = await store.ok(store.post('/hotel-inventory/events', { events: [{ ...e, quantity: '50' }] }));
    expect(r.results[0]).toMatchObject({ status: 'rejected', flags: ['id_reuse'] });
    expect(await balance()).toBe('122.000');
  });

  it('applies concurrent taps from several devices exactly once each', async () => {
    const before = Number(await balance(soap));
    const events = Array.from({ length: 20 }, () =>
      ev({
        productId: soap,
        quantity: '1',
        clientRecordedAt: new Date(Date.now() - Math.random() * 60_000).toISOString(),
      }),
    );
    // 20 events sent in parallel, half of them twice (simulated retries)
    await Promise.all(
      [...events, ...events.slice(0, 10)].map((e) => store.post('/hotel-inventory/events', { events: [e] })),
    );
    expect(Number(await balance(soap))).toBe(before - 20);
  });

  it('flags a quick identical double tap as a possible duplicate (still applied, for review)', async () => {
    const t = Date.now();
    const r = await store.ok(
      store.post('/hotel-inventory/events', {
        events: [
          ev({ quantity: '3', clientRecordedAt: new Date(t).toISOString() }),
          ev({ quantity: '3', clientRecordedAt: new Date(t + 2000).toISOString() }),
        ],
      }),
    );
    expect(r.results[1].flags).toContain('possible_duplicate');
  });

  it('flags usage that would make stock negative instead of silently clamping', async () => {
    const tea = env.seed.productIds['FB-TEA-500']!;
    const scan = await store.ok(store.get(`/hotel-inventory/scan/${env.seed.shelfTokens[2]}`));
    const r = await store.ok(
      store.post('/hotel-inventory/events', {
        events: [ev({ locationId: scan.shelf.id, productId: tea, quantity: '6' })],
      }),
    );
    expect(r.results[0]).toMatchObject({ status: 'applied', balance: '-2.000' });
    expect(r.results[0].flags).toContain('negative_balance');
    const flagged = await manager.ok(manager.get('/hotel-inventory/events?flagged=true'));
    expect(flagged.items.some((e: any) => e.flags.includes('negative_balance'))).toBe(true);
  });

  it('rejects products that are not on the scanned shelf and zero quantities', async () => {
    const r = await store.ok(
      store.post('/hotel-inventory/events', {
        events: [
          ev({ productId: env.seed.productIds['LN-BED-DBL'] }),
          ev({ quantity: '0' }),
          { id: 'garbage' },
        ],
      }),
    );
    expect(r.results.map((x: any) => x.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });
});

describe('corrections', () => {
  it('inventory staff cannot correct quantities', async () => {
    const r = await store.ok(
      store.post('/hotel-inventory/events', {
        events: [ev({ action: 'correction', countedQty: '100', reason: 'count', quantity: undefined })],
      }),
    );
    expect(r.results[0].status).toBe('rejected');
  });

  it('a correction needs a reason and sets an absolute count', async () => {
    const current = await balance();
    const noReason = await manager.ok(
      manager.post('/hotel-inventory/events', {
        events: [ev({ action: 'correction', countedQty: '90', quantity: undefined, baseQty: current })],
      }),
    );
    expect(noReason.results[0].status).toBe('rejected');
    const r = await manager.ok(
      manager.post('/hotel-inventory/events', {
        events: [
          ev({
            action: 'correction',
            countedQty: '90',
            quantity: undefined,
            baseQty: current,
            reason: 'Monthly stock count',
          }),
        ],
      }),
    );
    expect(r.results[0]).toMatchObject({ status: 'applied', balance: '90.000' });
    const owner = await as(env, EMAILS.owner);
    const audit = await owner.ok(owner.get('/audit?action=hotel_inventory.corrected'));
    expect(audit.items.length).toBeGreaterThan(0);
  });

  it('an offline correction based on stale data is held for review, not applied', async () => {
    // device A synced when the shelf had 90, then went offline and counted 80
    const stale = ev({
      action: 'correction',
      countedQty: '80',
      quantity: undefined,
      baseQty: '90.000',
      reason: 'Counted while offline',
      offline: true,
    });
    // meanwhile device B recorded usage online
    await store.ok(store.post('/hotel-inventory/events', { events: [ev({ quantity: '4' })] }));
    expect(await balance()).toBe('86.000');
    const r = await manager.ok(manager.post('/hotel-inventory/events', { events: [stale] }));
    expect(r.results[0].status).toBe('needs_review');
    expect(r.results[0].flags).toEqual(expect.arrayContaining(['stale_base', 'offline']));
    expect(await balance()).toBe('86.000'); // history not overwritten

    const queue = await manager.ok(manager.get('/hotel-inventory/events?status=needs_review'));
    expect(queue.items.map((e: any) => e.id)).toContain(stale.id);
    // purchasing staff cannot review
    expect(
      (await purchaser.post(`/hotel-inventory/events/${stale.id}/review`, { decision: 'accept', note: 'ok' }))
        .statusCode,
    ).toBe(403);
    const reviewed = await manager.ok(
      manager.post(`/hotel-inventory/events/${stale.id}/review`, {
        decision: 'accept',
        note: 'Recount confirms 80',
      }),
    );
    expect(reviewed.balance).toBe('80.000');
    // a decided event cannot be decided again
    expect(
      (
        await manager.post(`/hotel-inventory/events/${stale.id}/review`, {
          decision: 'reject',
          note: 'again',
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('locations, transfers and offline snapshot', () => {
  it('managers create shelves with unique QR tokens and assign products', async () => {
    const { location: area } = await manager.ok(
      manager.post('/hotel-inventory/locations', { kind: 'area', name: 'Floor 2 store' }),
    );
    const { location: s1 } = await manager.ok(
      manager.post('/hotel-inventory/locations', { kind: 'shelf', name: 'F2 shelf', parentId: area.id }),
    );
    expect(s1.qrToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    await manager.ok(
      manager.put(`/hotel-inventory/locations/${s1.id}/products/${shampoo}`, {
        defaultUsageQty: '2',
        minQty: '10',
        openingQty: '0',
      }),
    );
    // inventory staff cannot create locations
    expect((await store.post('/hotel-inventory/locations', { kind: 'shelf', name: 'x' })).statusCode).toBe(
      403,
    );

    // transfer 30 from shelf A to the new shelf
    const r = await store.ok(
      store.post('/hotel-inventory/events', {
        events: [ev({ action: 'transfer', quantity: '30', toLocationId: s1.id })],
      }),
    );
    expect(r.results[0]).toMatchObject({ status: 'applied', balance: '50.000', toBalance: '30.000' });
    const low = await manager.ok(manager.get('/hotel-inventory/low-stock'));
    expect(low.items.some((i: any) => i.productId === env.seed.productIds['FB-TEA-500'])).toBe(true);
  });

  it('offline snapshot contains only the minimum inventory data and an expiry', async () => {
    const snap = await store.ok(store.get('/hotel-inventory/offline-snapshot'));
    expect(snap.hotelId).toBe(env.seed.hotelIds[0]);
    expect(new Date(snap.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(snap.canCorrect).toBe(false);
    expect(snap.shelves.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(snap)).not.toMatch(/price|cost|credit|invoice/i);
    // internal users do not get offline snapshots
    expect(
      (await (await as(env, EMAILS.procurement)).get('/hotel-inventory/offline-snapshot')).statusCode,
    ).toBe(403);
  });

  it('the stock ledger is append-only at the database level', async () => {
    await expectDbError(env.db.execute(sql`update hotel_stock_movements set quantity = 999`), /append-only/);
    await expectDbError(env.db.execute(sql`delete from hotel_stock_movements`), /append-only/);
  });
});
