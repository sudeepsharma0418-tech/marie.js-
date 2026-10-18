/** Offline inventory logic: QR parsing, local balances, device storage and the sync engine. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localBalance, tokenFromQr } from '../src/pages/Scan';
import {
  addEvent,
  clearOfflineData,
  getSnapshot,
  listEvents,
  pendingEvents,
  saveSnapshot,
  snapshotUsable,
  type OutboxEvent,
  type Snapshot,
} from '../src/offline/db';

const snap = (userId: string, expiresInMs = 3_600_000): Snapshot => ({
  userId,
  hotelId: 'h1',
  generatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  canCorrect: false,
  shelves: [
    {
      id: 'shelf-1',
      name: 'A',
      areaName: null,
      qrToken: 'tok_abcdefghijklmnop',
      products: [
        {
          productId: 'p1',
          nameEn: 'Soap',
          nameNe: 'साबुन',
          unit: 'pcs',
          defaultUsageQty: '2.000',
          minQty: '5.000',
          balance: '10.000',
        },
      ],
    },
  ],
});

const ev = (over: Partial<OutboxEvent> = {}): OutboxEvent => ({
  id: crypto.randomUUID(),
  userId: 'u1',
  locationId: 'shelf-1',
  productId: 'p1',
  action: 'usage',
  quantity: '2',
  deviceId: 'd1',
  clientRecordedAt: new Date().toISOString(),
  offline: true,
  state: 'pending',
  attempts: 0,
  ...over,
});

describe('QR codes', () => {
  it('accepts shelf URLs and bare tokens, rejects anything else', () => {
    expect(tokenFromQr('https://app.example.com/scan/AbC_def-1234567890')).toBe('AbC_def-1234567890');
    expect(tokenFromQr('  AbC_def-1234567890 ')).toBe('AbC_def-1234567890');
    expect(tokenFromQr('https://evil.example.com/?x=<script>')).toBeNull();
    expect(tokenFromQr('short')).toBeNull();
  });
});

describe('local balance', () => {
  it('applies unsynced usage, restock, corrections and transfers on top of the last server balance', () => {
    const pending = [
      ev({ quantity: '2' }),
      ev({ action: 'restock', quantity: '5' }),
      ev({ action: 'usage', quantity: '1.5' }),
      ev({ productId: 'other', quantity: '100' }),
      ev({ action: 'transfer', quantity: '3', toLocationId: 'shelf-2' }),
    ];
    expect(localBalance('10.000', pending, 'shelf-1', 'p1')).toBe('8.500');
    expect(localBalance('0.000', pending, 'shelf-2', 'p1')).toBe('3.000');
    expect(
      localBalance(
        '10.000',
        [ev({ action: 'correction', quantity: undefined, countedQty: '7' })],
        'shelf-1',
        'p1',
      ),
    ).toBe('7');
  });
});

describe('device storage', () => {
  beforeEach(async () => clearOfflineData());

  it('keeps events pending until the server answers', async () => {
    await addEvent(ev());
    await addEvent(ev({ state: 'applied' }));
    expect(await pendingEvents('u1')).toHaveLength(1);
    expect(await listEvents()).toHaveLength(2);
  });

  it('a different user on the same device never sees the previous user’s data', async () => {
    await saveSnapshot(snap('u1'));
    await addEvent(ev());
    await saveSnapshot(snap('u2'));
    expect(await listEvents()).toHaveLength(0);
    expect((await getSnapshot())?.userId).toBe('u2');
  });

  it('expired snapshots and other users’ snapshots are not usable offline', () => {
    expect(snapshotUsable(snap('u1'), 'u1')).toBe(true);
    expect(snapshotUsable(snap('u1', -1000), 'u1')).toBe(false);
    expect(snapshotUsable(snap('u1'), 'u2')).toBe(false);
  });

  it('logout wipes everything', async () => {
    await saveSnapshot(snap('u1'));
    await addEvent(ev());
    await clearOfflineData();
    expect(await getSnapshot()).toBeNull();
    expect(await listEvents()).toHaveLength(0);
  });
});

describe('sync engine', () => {
  beforeEach(async () => {
    await clearOfflineData();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps events pending when the network fails, then marks them from the server result', async () => {
    const e1 = ev();
    await addEvent(e1);
    const sync = await import('../src/offline/sync');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network down'));
    const stop = sync.startSync('u1');
    await vi.waitFor(async () => expect(fetchMock).toHaveBeenCalled());
    await vi.waitFor(async () => expect((await listEvents())[0]?.state).toBe('pending'));

    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/hotel-inventory/events')) {
        return new Response(
          JSON.stringify({
            results: [{ id: e1.id, status: 'applied', flags: ['offline'], balance: '8.000' }],
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(snap('u1')), { headers: { 'content-type': 'application/json' } });
    });
    await sync.syncNow();
    const [after] = await listEvents();
    expect(after).toMatchObject({ state: 'applied', serverBalance: '8.000' });
    // the same event id is sent on every retry, so the server can de-duplicate
    const bodies = fetchMock.mock.calls
      .filter((c) => String(c[0]).includes('/events'))
      .map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies.every((b) => b.events[0].id === e1.id)).toBe(true);
    stop();
  });
});
