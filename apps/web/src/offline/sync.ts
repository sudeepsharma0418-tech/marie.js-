import { useSyncExternalStore } from 'react';
import { api, ApiError } from '../lib/api';
import { getSnapshot, pendingEvents, pruneHistory, saveSnapshot, updateEvent, type Snapshot } from './db';

/**
 * Sync engine for offline inventory events.
 * A local save is NOT a server confirmation: events stay "pending" until the
 * server answers for that exact event id. Retries are safe because the server
 * treats the event id as an idempotency key.
 */

interface SyncStatus {
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  sessionExpired: boolean;
}

let status: SyncStatus = {
  pending: 0,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  sessionExpired: false,
};
const listeners = new Set<() => void>();
const set = (p: Partial<SyncStatus>) => {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
};

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

let currentUser: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let backoff = 5_000;

export async function refreshPendingCount() {
  if (!currentUser) return;
  set({ pending: (await pendingEvents(currentUser)).length });
}

export async function syncNow(): Promise<void> {
  if (!currentUser || status.syncing) return;
  if (!navigator.onLine) {
    await refreshPendingCount();
    return;
  }
  const events = await pendingEvents(currentUser);
  set({ pending: events.length });
  if (!events.length) {
    await refreshSnapshot();
    return;
  }
  set({ syncing: true, lastError: null });
  try {
    for (let i = 0; i < events.length; i += 50) {
      const batch = events.slice(i, i + 50);
      for (const e of batch) await updateEvent(e.id, { state: 'syncing', attempts: e.attempts + 1 });
      const payload = batch.map(
        ({
          state: _s,
          attempts: _a,
          lastError: _l,
          serverBalance: _b,
          flags: _f,
          syncedAt: _t,
          userId: _u,
          ...ev
        }) => ev,
      );
      const res = await api.post<{
        results: { id: string; status: string; flags: string[]; message?: string; balance?: string }[];
      }>('/hotel-inventory/events', { events: payload });
      for (const r of res.results) {
        await updateEvent(r.id, {
          state: r.status as never,
          flags: r.flags,
          lastError: r.message,
          serverBalance: r.balance,
          syncedAt: new Date().toISOString(),
        });
      }
    }
    backoff = 5_000;
    set({ lastSyncAt: new Date().toISOString(), sessionExpired: false });
    await refreshSnapshot();
    await pruneHistory();
  } catch (e) {
    // put everything back to pending; nothing is lost
    for (const ev of await pendingEvents(currentUser)) await updateEvent(ev.id, { state: 'pending' });
    if (e instanceof ApiError && e.status === 401) set({ sessionExpired: true, lastError: 'session' });
    else set({ lastError: e instanceof ApiError ? e.code : 'error' });
    schedule(backoff);
    backoff = Math.min(backoff * 2, 5 * 60_000);
  } finally {
    set({ syncing: false });
    await refreshPendingCount();
  }
}

export async function refreshSnapshot(): Promise<Snapshot | null> {
  if (!navigator.onLine) return getSnapshot();
  try {
    const snap = await api.get<Snapshot>('/hotel-inventory/offline-snapshot');
    await saveSnapshot(snap);
    return snap;
  } catch {
    return getSnapshot();
  }
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

/** Start background sync for a hotel inventory user. */
export function startSync(userId: string) {
  currentUser = userId;
  void syncNow();
  window.addEventListener('online', onOnline);
  const interval = setInterval(() => status.pending > 0 && void syncNow(), 30_000);
  return () => {
    window.removeEventListener('online', onOnline);
    clearInterval(interval);
    currentUser = null;
  };
}

function onOnline() {
  backoff = 5_000;
  void syncNow();
}
