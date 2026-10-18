import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Offline storage for the shelf inventory workflow only.
 *  - snapshot: shelves, product names/units and balances for the user's own hotel
 *    (no prices, costs or financial data), with an expiry set by the server
 *  - outbox: inventory events recorded on this device, kept after sync for troubleshooting
 * Everything is deleted on logout or when the server reports the session has ended.
 */

export interface SnapshotProduct {
  productId: string;
  nameEn: string;
  nameNe: string;
  unit: string;
  defaultUsageQty: string;
  minQty: string;
  balance: string;
}
export interface SnapshotShelf {
  id: string;
  name: string;
  areaName: string | null;
  qrToken: string;
  products: SnapshotProduct[];
}
export interface Snapshot {
  userId: string;
  hotelId: string;
  generatedAt: string;
  expiresAt: string;
  canCorrect: boolean;
  shelves: SnapshotShelf[];
}

export type SyncState = 'pending' | 'syncing' | 'applied' | 'duplicate' | 'needs_review' | 'rejected';

export interface OutboxEvent {
  id: string;
  userId: string;
  locationId: string;
  productId: string;
  action: 'usage' | 'restock' | 'correction' | 'transfer';
  quantity?: string;
  countedQty?: string;
  baseQty?: string;
  toLocationId?: string;
  reason?: string;
  deviceId: string;
  clientRecordedAt: string;
  offline: boolean;
  state: SyncState;
  attempts: number;
  lastError?: string;
  serverBalance?: string;
  flags?: string[];
  syncedAt?: string;
}

interface HpDB extends DBSchema {
  meta: { key: string; value: unknown };
  outbox: { key: string; value: OutboxEvent; indexes: { byState: SyncState; byTime: string } };
}

const DB_NAME = 'hp-offline';
let dbp: Promise<IDBPDatabase<HpDB>> | null = null;

export function db() {
  dbp ??= openDB<HpDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('meta');
      const o = d.createObjectStore('outbox', { keyPath: 'id' });
      o.createIndex('byState', 'state');
      o.createIndex('byTime', 'clientRecordedAt');
    },
  });
  return dbp;
}

export async function getSnapshot(): Promise<Snapshot | null> {
  return ((await (await db()).get('meta', 'snapshot')) as Snapshot | undefined) ?? null;
}

export async function saveSnapshot(s: Snapshot) {
  const d = await db();
  const prev = await getSnapshot();
  // a different user on a shared device never sees the previous user's data
  if (prev && prev.userId !== s.userId) await d.clear('outbox');
  await d.put('meta', s, 'snapshot');
}

export function snapshotUsable(s: Snapshot | null, userId: string | undefined): s is Snapshot {
  return !!s && s.userId === userId && new Date(s.expiresAt).getTime() > Date.now();
}

export async function addEvent(e: OutboxEvent) {
  await (await db()).put('outbox', e);
}

export async function updateEvent(id: string, patch: Partial<OutboxEvent>) {
  const d = await db();
  const cur = await d.get('outbox', id);
  if (cur) await d.put('outbox', { ...cur, ...patch });
}

export async function listEvents(): Promise<OutboxEvent[]> {
  const all = await (await db()).getAllFromIndex('outbox', 'byTime');
  return all.reverse();
}

export async function pendingEvents(userId: string): Promise<OutboxEvent[]> {
  const d = await db();
  const rows = [
    ...(await d.getAllFromIndex('outbox', 'byState', 'pending')),
    ...(await d.getAllFromIndex('outbox', 'byState', 'syncing')),
  ];
  return rows
    .filter((r) => r.userId === userId)
    .sort((a, b) => a.clientRecordedAt.localeCompare(b.clientRecordedAt));
}

/** Keep the newest 300 synced events for troubleshooting; never drop unsynced ones. */
export async function pruneHistory() {
  const d = await db();
  const all = (await d.getAllFromIndex('outbox', 'byTime')).filter(
    (e) => e.state !== 'pending' && e.state !== 'syncing',
  );
  for (const e of all.slice(0, Math.max(0, all.length - 300))) await d.delete('outbox', e.id);
}

export async function clearOfflineData() {
  try {
    const d = await db();
    d.close();
  } catch {
    /* not opened */
  }
  dbp = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export function deviceId(): string {
  let id = localStorage.getItem('hp.deviceId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('hp.deviceId', id);
  }
  return id;
}
