import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, nameOf, qty } from '../lib/format';
import {
  Button,
  Card,
  cx,
  Empty,
  ErrorBox,
  Field,
  Input,
  Modal,
  Notice,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Textarea,
} from '../components/ui';

function QrImage({ token, size = 160 }: { token: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(`${window.location.origin}/scan/${token}`, {
      margin: 1,
      width: size,
      errorCorrectionLevel: 'M',
    }).then(setSrc);
  }, [token, size]);
  return src ? <img src={src} alt="QR" width={size} height={size} /> : null;
}

export function InventoryPage() {
  const { t } = useTranslation();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [hotelId, setHotelId] = useState(me?.user.hotelId ?? '');
  const [tab, setTab] = useState<'shelves' | 'review' | 'movements' | 'low'>('shelves');
  const hotels = useQuery({
    queryKey: ['hotels'],
    queryFn: () => api.get('/hotels'),
    enabled: !me?.user.hotelId,
  });
  const locs = useQuery({
    queryKey: ['locations', hotelId],
    queryFn: () => api.get(`/hotel-inventory/locations${qs({ hotelId })}`),
    enabled: !!hotelId,
  });
  const manage = can('hotel_inventory.manage_locations') && !!me?.user.hotelId;
  const [newLoc, setNewLoc] = useState<{ kind: 'area' | 'shelf'; name: string; parentId: string } | null>(
    null,
  );
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['locations', hotelId] });
  const create = useMutation({
    mutationFn: () =>
      api.post('/hotel-inventory/locations', { ...newLoc, parentId: newLoc?.parentId || null }),
    onSuccess: () => {
      setNewLoc(null);
      refresh();
    },
  });

  const areas = locs.data?.items.filter((l: any) => l.kind === 'area') ?? [];
  const shelves = locs.data?.items.filter((l: any) => l.kind === 'shelf') ?? [];
  const groups = [
    ...areas.map((a: any) => ({ area: a, shelves: shelves.filter((s: any) => s.parentId === a.id) })),
    { area: null, shelves: shelves.filter((s: any) => !s.parentId) },
  ].filter((g) => g.area || g.shelves.length);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('inventory.title')}
        actions={
          manage && (
            <>
              <Button variant="secondary" onClick={() => setNewLoc({ kind: 'area', name: '', parentId: '' })}>
                {t('inventory.newArea')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setNewLoc({ kind: 'shelf', name: '', parentId: areas[0]?.id ?? '' })}
              >
                {t('inventory.newShelf')}
              </Button>
              <Button onClick={() => setPrinting(true)} disabled={!shelves.length}>
                {t('inventory.printLabels')}
              </Button>
            </>
          )
        }
      />
      {!me?.user.hotelId && (
        <Select
          value={hotelId}
          onChange={(e) => setHotelId(e.target.value)}
          className="max-w-sm"
          aria-label={t('common.hotel')}
        >
          <option value="">{t('inventory.chooseHotel')}</option>
          {hotels.data?.items.map((h: any) => (
            <option key={h.id} value={h.id}>
              {h.legalName}
            </option>
          ))}
        </Select>
      )}
      <div className="no-print flex gap-1 border-b" role="tablist">
        {(
          [
            'shelves',
            'low',
            ...(can('hotel_inventory.review') || !me?.user.hotelId ? ['review'] : []),
            'movements',
          ] as const
        ).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k as never)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k
                ? 'border-brand-700 font-semibold text-brand-800'
                : 'border-transparent text-slate-600',
            )}
          >
            {t(`inventory.tab_${k}`)}
          </button>
        ))}
      </div>
      {!hotelId ? null : tab === 'shelves' ? (
        <>
          {locs.isLoading && <Spinner />}
          <ErrorBox error={locs.error} />
          {locs.data && groups.length === 0 && (
            <Empty title={t('inventory.noLocations')}>{manage && t('inventory.noLocationsHint')}</Empty>
          )}
          {groups.map((g, gi) => (
            <Card key={g.area?.id ?? gi} title={g.area?.name ?? t('inventory.unassigned')}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {g.shelves.map((s: any) => (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{s.name}</div>
                        {!s.isActive && <StatusBadge status="cancelled" />}
                      </div>
                      {manage && (
                        <Button size="sm" variant="secondary" onClick={() => setAssignTo(s.id)}>
                          {t('inventory.addProduct')}
                        </Button>
                      )}
                    </div>
                    {s.products.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">{t('inventory.emptyShelf')}</p>
                    ) : (
                      <table className="mt-2 w-full text-sm">
                        <tbody>
                          {s.products.map((p: any) => (
                            <tr key={p.id} className="border-t border-slate-100">
                              <td className="py-1">{nameOf(p)}</td>
                              <td
                                className={cx(
                                  'py-1 text-right tabular-nums',
                                  p.low && 'font-semibold text-amber-700',
                                  Number(p.balance) < 0 && 'text-red-700',
                                )}
                              >
                                {qty(p.balance)} {t(`units.${p.unit}`, { defaultValue: p.unit })}
                              </td>
                              <td className="py-1 text-right text-xs text-slate-500">
                                {t('inventory.min')} {qty(p.minQty)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </>
      ) : tab === 'review' ? (
        <ReviewQueue hotelId={hotelId} canReview={can('hotel_inventory.review')} onDone={refresh} />
      ) : tab === 'low' ? (
        <LowStock hotelId={hotelId} />
      ) : (
        <Movements hotelId={hotelId} />
      )}

      <Modal
        open={!!newLoc}
        title={newLoc?.kind === 'area' ? t('inventory.newArea') : t('inventory.newShelf')}
        onClose={() => setNewLoc(null)}
        footer={
          <Button disabled={!newLoc?.name} loading={create.isPending} onClick={() => create.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        {newLoc && (
          <div className="space-y-3">
            <Field label={t('common.name')} required>
              <Input
                value={newLoc.name}
                onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })}
                placeholder={
                  newLoc.kind === 'area' ? t('inventory.areaExample') : t('inventory.shelfExample')
                }
              />
            </Field>
            {newLoc.kind === 'shelf' && (
              <Field label={t('inventory.area')}>
                <Select
                  value={newLoc.parentId}
                  onChange={(e) => setNewLoc({ ...newLoc, parentId: e.target.value })}
                >
                  <option value="">—</option>
                  {areas.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <ErrorBox error={create.error} />
          </div>
        )}
      </Modal>
      {assignTo && (
        <AssignProduct
          shelfId={assignTo}
          onClose={() => {
            setAssignTo(null);
            refresh();
          }}
        />
      )}
      {printing && (
        <div className="fixed inset-0 z-50 overflow-auto bg-white p-6">
          <div className="no-print mb-4 flex gap-2">
            <Button onClick={() => window.print()}>{t('common.print')}</Button>
            <Button variant="secondary" onClick={() => setPrinting(false)}>
              {t('common.close')}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {shelves
              .filter((s: any) => s.isActive && s.qrToken)
              .map((s: any) => (
                <div
                  key={s.id}
                  className="flex break-inside-avoid flex-col items-center rounded-lg border-2 border-dashed border-slate-300 p-3 text-center"
                >
                  <QrImage token={s.qrToken} />
                  <div className="mt-2 font-semibold">{s.name}</div>
                  <div className="text-xs text-slate-500">
                    {areas.find((a: any) => a.id === s.parentId)?.name}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">{t('inventory.scanToRecord')}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignProduct({ shelfId, onClose }: { shelfId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [productId, setProductId] = useState('');
  const [usage, setUsage] = useState('1');
  const [min, setMin] = useState('0');
  const [opening, setOpening] = useState('');
  const products = useQuery({
    queryKey: ['catalog-assign', q],
    queryFn: () => api.get(`/products${qs({ q, pageSize: 20 })}`),
  });
  const m = useMutation({
    mutationFn: () =>
      api.put(`/hotel-inventory/locations/${shelfId}/products/${productId}`, {
        defaultUsageQty: usage,
        minQty: min,
        ...(opening ? { openingQty: opening } : {}),
      }),
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      title={t('inventory.addProduct')}
      onClose={onClose}
      footer={
        <Button disabled={!productId} loading={m.isPending} onClick={() => m.mutate()}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Input
          type="search"
          placeholder={t('catalog.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select value={productId} onChange={(e) => setProductId(e.target.value)} size={6}>
          {products.data?.items.map((p: any) => (
            <option key={p.id} value={p.id}>
              {nameOf(p)} ({p.sku})
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-3 gap-2">
          <Field label={t('inventory.defaultUsage')}>
            <Input inputMode="decimal" value={usage} onChange={(e) => setUsage(e.target.value)} />
          </Field>
          <Field label={t('inventory.minQty')}>
            <Input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label={t('inventory.openingQty')}>
            <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </Field>
        </div>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function ReviewQueue({
  hotelId,
  canReview,
  onDone,
}: {
  hotelId: string;
  canReview: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['inv-review', hotelId],
    queryFn: () => api.get(`/hotel-inventory/events${qs({ hotelId, flagged: true })}`),
  });
  const [target, setTarget] = useState<any>(null);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: (decision: 'accept' | 'reject') =>
      api.post(`/hotel-inventory/events/${target.id}/review`, { decision, note }),
    onSuccess: () => {
      setTarget(null);
      setNote('');
      void q.refetch();
      onDone();
    },
  });
  if (q.isLoading) return <Spinner />;
  return (
    <Card>
      <Notice>{t('inventory.reviewIntro')}</Notice>
      <div className="mt-3">
        <Table
          rows={q.data?.items ?? []}
          rowKey={(r: any) => r.id}
          columns={[
            { key: 't', header: t('common.date'), render: (r: any) => dateTime(r.clientRecordedAt) },
            {
              key: 'p',
              header: t('common.product'),
              render: (r: any) => (
                <div>
                  {nameOf(r)}
                  <div className="text-xs text-slate-500">{r.shelfName}</div>
                </div>
              ),
            },
            {
              key: 'a',
              header: t('scan.action'),
              render: (r: any) => `${t(`scan.${r.action}`)} ${qty(r.quantity ?? r.countedQty)}`,
            },
            {
              key: 'f',
              header: t('inventory.flags'),
              render: (r: any) =>
                r.flags
                  .filter((f: string) => f !== 'offline')
                  .map((f: string) => t(`inventory.flag_${f}`, { defaultValue: f }))
                  .join(', '),
            },
            { key: 's', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
            { key: 'u', header: t('common.user'), render: (r: any) => r.actorName },
            {
              key: 'x',
              header: '',
              render: (r: any) =>
                canReview &&
                r.status === 'needs_review' && (
                  <Button size="sm" onClick={() => setTarget(r)}>
                    {t('inventory.review')}
                  </Button>
                ),
            },
          ]}
        />
      </div>
      <Modal
        open={!!target}
        title={t('inventory.review')}
        onClose={() => setTarget(null)}
        footer={
          <>
            <Button variant="danger" disabled={note.length < 3} onClick={() => m.mutate('reject')}>
              {t('inventory.rejectCorrection')}
            </Button>
            <Button disabled={note.length < 3} onClick={() => m.mutate('accept')}>
              {t('inventory.acceptCorrection')}
            </Button>
          </>
        }
      >
        {target && (
          <div className="space-y-3 text-sm">
            <p>
              {t('inventory.reviewExplain', { counted: qty(target.countedQty), base: qty(target.baseQty) })}
            </p>
            <Field label={t('common.note')} required>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <ErrorBox error={m.error} />
          </div>
        )}
      </Modal>
    </Card>
  );
}

function LowStock({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['low', hotelId],
    queryFn: () => api.get(`/hotel-inventory/low-stock${qs({ hotelId })}`),
  });
  return (
    <Card>
      <Table
        rows={q.data?.items ?? []}
        rowKey={(r: any) => `${r.locationId}${r.productId}`}
        empty={t('inventory.noLowStock')}
        columns={[
          { key: 'p', header: t('common.product'), render: (r: any) => nameOf(r) },
          { key: 's', header: t('inventory.shelf'), render: (r: any) => r.shelfName },
          { key: 'b', header: t('inventory.balance'), render: (r: any) => qty(r.balance), align: 'right' },
          { key: 'm', header: t('inventory.minQty'), render: (r: any) => qty(r.minQty), align: 'right' },
        ]}
      />
    </Card>
  );
}

function Movements({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['movements', hotelId],
    queryFn: () => api.get(`/hotel-inventory/movements${qs({ hotelId, limit: 200 })}`),
  });
  return (
    <Card>
      <Table
        rows={q.data?.items ?? []}
        rowKey={(r: any) => String(r.id)}
        columns={[
          { key: 't', header: t('common.date'), render: (r: any) => dateTime(r.occurredAt) },
          { key: 'p', header: t('common.product'), render: (r: any) => nameOf(r) },
          { key: 's', header: t('inventory.shelf'), render: (r: any) => r.shelfName },
          { key: 'k', header: t('common.type'), render: (r: any) => t(`inventory.mv_${r.movementType}`) },
          {
            key: 'q',
            header: t('common.quantity'),
            render: (r: any) => (
              <span className={Number(r.quantity) < 0 ? 'text-red-700' : 'text-emerald-700'}>
                {Number(r.quantity) > 0 ? '+' : ''}
                {qty(r.quantity)}
              </span>
            ),
            align: 'right',
          },
          { key: 'u', header: t('common.user'), render: (r: any) => r.actorName },
        ]}
      />
    </Card>
  );
}
