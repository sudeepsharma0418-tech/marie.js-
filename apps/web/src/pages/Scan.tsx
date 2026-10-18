import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { addQty, cmpQty, subQty } from '@hp/shared';
import { api, ApiError, newId } from '../lib/api';
import { useAuth } from '../lib/auth';
import { nameOf, qty, dateTime } from '../lib/format';
import {
  addEvent,
  deviceId,
  getSnapshot,
  listEvents,
  snapshotUsable,
  type OutboxEvent,
  type Snapshot,
  type SnapshotShelf,
} from '../offline/db';
import { refreshPendingCount, refreshSnapshot, syncNow, useSyncStatus } from '../offline/sync';
import {
  Button,
  cx,
  Empty,
  ErrorBox,
  Field,
  Input,
  Notice,
  PageHeader,
  Spinner,
  StatusBadge,
  Textarea,
} from '../components/ui';

/** Extract the shelf token from a scanned QR value (a URL like https://host/scan/<token>, or the bare token). */
export function tokenFromQr(raw: string): string | null {
  const v = raw.trim();
  const m = /\/scan\/([A-Za-z0-9_-]{10,64})\/?$/.exec(v);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{10,64}$/.test(v) ? v : null;
}

/** Balance shown on the device: last known server balance plus this device's unsynced changes. */
export function localBalance(
  base: string,
  pending: OutboxEvent[],
  locationId: string,
  productId: string,
): string {
  let b = base;
  for (const e of pending) {
    if (e.productId !== productId) continue;
    if (e.locationId === locationId) {
      if (e.action === 'usage' || e.action === 'transfer') b = subQty(b, e.quantity ?? '0');
      else if (e.action === 'restock') b = addQty(b, e.quantity ?? '0');
      else if (e.action === 'correction' && e.countedQty) b = e.countedQty;
    } else if (e.action === 'transfer' && e.toLocationId === locationId) {
      b = addQty(b, e.quantity ?? '0');
    }
  }
  return b;
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function ScanHomePage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const nav = useNavigate();
  const online = useOnline();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    void (online ? refreshSnapshot() : getSnapshot()).then(setSnap);
  }, [online]);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const codes = await detector.detect(v);
          const token = codes.length ? tokenFromQr(codes[0].rawValue) : null;
          if (token) {
            nav(`/scan/${token}`);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setCamError(t('scan.cameraError'));
        setScanning(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [scanning, nav, t]);

  const usable = snapshotUsable(snap, me?.user.id);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title={t('scan.title')} subtitle={t('scan.subtitle')} />
      {!online && !usable && <Notice tone="error">{t('scan.noOfflineData')}</Notice>}
      {hasDetector ? (
        scanning ? (
          <div className="space-y-2">
            <video
              ref={videoRef}
              className="aspect-square w-full rounded-xl bg-black object-cover"
              muted
              playsInline
            />
            <Button variant="secondary" className="w-full" onClick={() => setScanning(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <Button size="lg" className="w-full py-6 text-lg" onClick={() => setScanning(true)}>
            📷 {t('scan.scanQr')}
          </Button>
        )
      ) : (
        <Notice>{t('scan.useCameraApp')}</Notice>
      )}
      {camError && <Notice tone="warn">{camError}</Notice>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const token = tokenFromQr(manual);
          if (token) nav(`/scan/${token}`);
        }}
      >
        <Input
          placeholder={t('scan.enterCode')}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-label={t('scan.enterCode')}
        />
        <Button type="submit" variant="secondary">
          {t('scan.open')}
        </Button>
      </form>
      {usable && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-600">{t('scan.orChooseShelf')}</h2>
          <div className="grid grid-cols-1 gap-2">
            {snap.shelves.map((s) => (
              <Link
                key={s.id}
                to={`/scan/${s.qrToken}`}
                className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-brand-600"
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-slate-500">
                  {s.areaName} · {t('scan.productCount', { count: s.products.length })}
                </div>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t('scan.dataAsOf', { time: dateTime(snap.generatedAt) })}
          </p>
        </div>
      )}
      <Link to="/scan/history" className="block text-center text-sm text-brand-700 hover:underline">
        {t('scan.history')}
      </Link>
    </div>
  );
}

type Action = 'usage' | 'restock' | 'correction';

export function ScanShelfPage() {
  const { token } = useParams();
  const { t } = useTranslation();
  const { me } = useAuth();
  const online = useOnline();
  const sync = useSyncStatus();
  const [shelf, setShelf] = useState<SnapshotShelf | null>(null);
  const [canCorrect, setCanCorrect] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<OutboxEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<Action>('usage');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'warn' | 'error'; text: string } | null>(null);

  const loadPending = useCallback(async () => {
    const all = await listEvents();
    setPending(
      all.filter((e) => e.userId === me?.user.id && (e.state === 'pending' || e.state === 'syncing')),
    );
  }, [me?.user.id]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (navigator.onLine) {
        const r = await api.get(`/hotel-inventory/scan/${token}`);
        setShelf({
          id: r.shelf.id,
          name: r.shelf.name,
          areaName: r.shelf.areaName,
          qrToken: token!,
          products: r.products,
        });
        setStale(null);
        const snap = await refreshSnapshot();
        setCanCorrect(!!snap?.canCorrect);
      } else throw new ApiError(0, 'network', 'offline');
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        const snap = await getSnapshot();
        if (!snapshotUsable(snap, me?.user.id)) {
          setError(new Error(t('scan.noOfflineData')));
        } else {
          const s = snap.shelves.find((x) => x.qrToken === token);
          if (!s) setError(new Error(t('scan.unknownShelf')));
          else {
            setShelf(s);
            setCanCorrect(snap.canCorrect);
            setStale(snap.generatedAt);
          }
        }
      } else setError(e);
    } finally {
      await loadPending();
      setLoading(false);
    }
  }, [token, me?.user.id, t, loadPending]);

  useEffect(() => {
    void load();
  }, [load, online]);

  useEffect(() => {
    void loadPending();
  }, [sync.pending, loadPending]);

  const product = shelf?.products.find((p) => p.productId === selected);
  const choose = (pid: string) => {
    const p = shelf!.products.find((x) => x.productId === pid)!;
    setSelected(pid);
    setAction('usage');
    setAmount(String(Number(p.defaultUsageQty)));
    setReason('');
    setResult(null);
  };

  const save = async () => {
    // Accidental double taps cannot save twice: the button is disabled while saving and
    // disappears afterwards (a new save needs the product to be chosen again).
    if (!shelf || !product || !me || busy) return;
    const current = localBalance(product.balance, pending, shelf.id, product.productId);
    const ev: OutboxEvent = {
      id: newId(),
      userId: me.user.id,
      locationId: shelf.id,
      productId: product.productId,
      action,
      ...(action === 'correction' ? { countedQty: amount, reason } : { quantity: amount }),
      baseQty: current,
      deviceId: deviceId(),
      clientRecordedAt: new Date().toISOString(),
      offline: !navigator.onLine,
      state: 'pending',
      attempts: 0,
    };
    setBusy(true);
    try {
      // saved locally first so nothing is lost if the network drops mid-request
      await addEvent(ev);
      await refreshPendingCount();
      if (navigator.onLine) {
        await syncNow();
        const after = (await listEvents()).find((e) => e.id === ev.id);
        if (after?.state === 'applied' || after?.state === 'duplicate') {
          setResult({
            tone: after.flags?.includes('negative_balance') ? 'warn' : 'success',
            text:
              t('scan.savedServer', { balance: qty(after.serverBalance) }) +
              (after.flags?.includes('negative_balance') ? ` ${t('scan.negativeFlag')}` : ''),
          });
          await load();
        } else if (after?.state === 'needs_review') {
          setResult({ tone: 'warn', text: t('scan.needsReview') });
        } else if (after?.state === 'rejected') {
          setResult({ tone: 'error', text: after.lastError ?? t('scan.rejected') });
        } else {
          setResult({ tone: 'warn', text: t('scan.savedLocal') });
        }
      } else {
        setResult({ tone: 'warn', text: t('scan.savedLocal') });
      }
      await loadPending();
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  if (error)
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <ErrorBox error={error} />
        <Link to="/scan">
          <Button variant="secondary">{t('scan.back')}</Button>
        </Link>
      </div>
    );
  if (!shelf) return null;

  const step = (d: number) =>
    setAmount((a) => String(Math.max(0, Math.round((Number(a || 0) + d) * 1000) / 1000)));
  const valid =
    action === 'correction'
      ? amount !== '' && Number(amount) >= 0 && reason.trim().length >= 3
      : Number(amount) > 0;

  return (
    <div className="mx-auto max-w-lg space-y-3">
      <div className="flex items-center justify-between">
        <Link to="/scan" className="text-sm text-brand-700">
          ← {t('scan.back')}
        </Link>
        {!online && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            {t('sync.offline')}
          </span>
        )}
      </div>
      <div>
        <h1 className="text-xl font-semibold">{shelf.name}</h1>
        {shelf.areaName && <p className="text-sm text-slate-500">{shelf.areaName}</p>}
      </div>
      {stale && <Notice tone="warn">{t('scan.staleData', { time: dateTime(stale) })}</Notice>}
      {pending.length > 0 && (
        <Notice tone="warn">{t('scan.pendingNotice', { count: pending.length })}</Notice>
      )}
      {result && <Notice tone={result.tone}>{result.text}</Notice>}

      {!product ? (
        shelf.products.length === 0 ? (
          <Empty title={t('scan.noProducts')} />
        ) : (
          <ul className="space-y-2">
            {shelf.products.map((p) => {
              const bal = localBalance(p.balance, pending, shelf.id, p.productId);
              const low = cmpQty(bal, p.minQty) <= 0;
              const hasPending = pending.some(
                (e) =>
                  e.productId === p.productId && (e.locationId === shelf.id || e.toLocationId === shelf.id),
              );
              return (
                <li key={p.productId}>
                  <button
                    onClick={() => choose(p.productId)}
                    className={cx(
                      'flex w-full items-center justify-between gap-3 rounded-xl border bg-white p-4 text-left shadow-sm hover:border-brand-600',
                      low ? 'border-amber-300' : 'border-slate-200',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-base font-medium">{nameOf(p)}</span>
                      {low && <span className="text-xs font-medium text-amber-700">{t('scan.low')}</span>}
                    </span>
                    <span className="text-right">
                      <span
                        className={cx(
                          'block text-2xl font-semibold tabular-nums',
                          cmpQty(bal, '0') < 0 && 'text-red-700',
                        )}
                      >
                        {qty(bal)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {t(`units.${p.unit}`, { defaultValue: p.unit })}
                        {hasPending ? ` · ${t('scan.unsynced')}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-lg font-semibold">{nameOf(product)}</div>
              <div className="text-sm text-slate-500">
                {t('scan.onShelf')}:{' '}
                <span className="font-medium tabular-nums">
                  {qty(localBalance(product.balance, pending, shelf.id, product.productId))}
                </span>{' '}
                {t(`units.${product.unit}`, { defaultValue: product.unit })}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              {t('common.cancel')}
            </Button>
          </div>
          <div
            className={cx('grid gap-2', canCorrect ? 'grid-cols-3' : 'grid-cols-2')}
            role="radiogroup"
            aria-label={t('scan.action')}
          >
            {(['usage', 'restock', ...(canCorrect ? ['correction'] : [])] as Action[]).map((a) => (
              <button
                key={a}
                role="radio"
                aria-checked={action === a}
                onClick={() => {
                  setAction(a);
                  setAmount(
                    a === 'usage'
                      ? String(Number(product.defaultUsageQty))
                      : a === 'correction'
                        ? localBalance(product.balance, pending, shelf.id, product.productId).replace(
                            /\.?0+$/,
                            '',
                          )
                        : '1',
                  );
                }}
                className={cx(
                  'rounded-xl border-2 px-2 py-4 text-base font-semibold',
                  action === a
                    ? 'border-brand-700 bg-brand-50 text-brand-800'
                    : 'border-slate-200 text-slate-700',
                )}
              >
                {t(`scan.${a}`)}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">
              {action === 'correction' ? t('scan.countedQty') : t('common.quantity')}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="h-14 w-14 rounded-xl border-2 border-slate-200 text-2xl"
                onClick={() => step(-1)}
                aria-label={t('scan.decrease')}
              >
                −
              </button>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-14 flex-1 rounded-xl border-2 border-slate-200 text-center text-2xl font-semibold tabular-nums"
                aria-label={t('common.quantity')}
              />
              <button
                className="h-14 w-14 rounded-xl border-2 border-slate-200 text-2xl"
                onClick={() => step(1)}
                aria-label={t('scan.increase')}
              >
                +
              </button>
            </div>
          </div>
          {action === 'correction' && (
            <Field label={t('common.reason')} required>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('scan.reasonPlaceholder')}
              />
            </Field>
          )}
          <Button size="lg" className="w-full py-4 text-lg" disabled={!valid} loading={busy} onClick={save}>
            {t('scan.confirm', { action: t(`scan.${action}`) })}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ScanHistoryPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const sync = useSyncStatus();
  useEffect(() => {
    void listEvents().then((e) => setEvents(e.filter((x) => x.userId === me?.user.id)));
    void getSnapshot().then(setSnap);
  }, [sync.pending, sync.lastSyncAt, me?.user.id]);
  const names = new Map(snap?.shelves.flatMap((s) => s.products.map((p) => [p.productId, nameOf(p)])) ?? []);
  const shelves = new Map(snap?.shelves.map((s) => [s.id, s.name]) ?? []);
  return (
    <div className="mx-auto max-w-lg space-y-3">
      <PageHeader
        title={t('scan.history')}
        actions={
          <Button variant="secondary" onClick={() => void syncNow()} disabled={!navigator.onLine}>
            {t('sync.syncNow')}
          </Button>
        }
      />
      <Notice>{t('scan.historyNote')}</Notice>
      {events.length === 0 ? (
        <Empty title={t('common.noRecords')} />
      ) : (
        <ul className="divide-y rounded-xl border bg-white">
          {events.map((e) => (
            <li key={e.id} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {t(`scan.${e.action}`)} · {qty(e.quantity ?? e.countedQty)} ·{' '}
                  {names.get(e.productId) ?? e.productId.slice(0, 8)}
                </span>
                <StatusBadge status={e.state} />
              </div>
              <div className="text-xs text-slate-500">
                {shelves.get(e.locationId)} · {dateTime(e.clientRecordedAt)}
                {e.offline ? ` · ${t('sync.recordedOffline')}` : ''}
                {e.lastError ? ` · ${e.lastError}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
