import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addQty, cmpQty } from '@hp/shared';
import { api, newId, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, money, nameOf, qty, todayNepal } from '../lib/format';
import {
  Button,
  Card,
  cx,
  DL,
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

/* ------------------------------ purchase orders ------------------------------ */

export function PurchaseOrderListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = useQuery({
    queryKey: ['pos', status],
    queryFn: () => api.get(`/purchase-orders${qs({ status })}`),
  });
  const costs = can('costs.view');
  return (
    <div>
      <PageHeader
        title={t('nav.purchaseOrders')}
        subtitle={!costs ? t('procurement.hubListNote') : undefined}
      />
      {costs && (
        <Select
          value={status}
          onChange={(e) => setParams({ status: e.target.value })}
          className="mb-3 max-w-xs"
          aria-label={t('common.status')}
        >
          <option value="">{t('common.all')}</option>
          {[
            'draft',
            'pending_approval',
            'approved',
            'sent',
            'confirmed',
            'partially_received',
            'received',
            'closed',
            'cancelled',
          ].map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      )}
      <ErrorBox error={q.error} />
      <Card>
        <Table
          rows={q.data?.items ?? []}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => nav(`/purchase-orders/${r.id}`)}
          columns={[
            { key: 'n', header: 'PO', render: (r: any) => <span className="font-medium">{r.poNumber}</span> },
            { key: 's', header: t('common.supplier'), render: (r: any) => r.supplierName },
            {
              key: 'f',
              header: t('procurement.fulfillment'),
              render: (r: any) =>
                r.fulfillment === 'direct'
                  ? `${t('procurement.direct')} → ${r.hotelName}`
                  : t('procurement.viaHub'),
            },
            { key: 'e', header: t('procurement.expected'), render: (r: any) => date(r.expectedDate) },
            ...(costs
              ? [
                  {
                    key: 't',
                    header: t('common.total'),
                    render: (r: any) => money(r.total),
                    align: 'right' as const,
                  },
                ]
              : []),
            { key: 'st', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </div>
  );
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['po', id], queryFn: () => api.get(`/purchase-orders/${id}`) });
  const [receive, setReceive] = useState(false);
  const [ref, setRef] = useState('');
  const [reasonFor, setReasonFor] = useState<'cancel' | 'close' | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['po', id] });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/purchase-orders/${id}/${path}`, body ?? {}),
    onSuccess: () => {
      setReasonFor(null);
      refresh();
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { purchaseOrder: po, supplier, lines, receipts } = q.data;
  const manage = can('procurement.manage');
  const s = po.status as string;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {po.poNumber} <StatusBadge status={s} />
          </span>
        }
        subtitle={`${supplier.name}${po.fulfillment === 'direct' ? ` · ${t('procurement.direct')}` : ''}`}
        actions={
          <>
            {manage && s === 'draft' && (
              <Button loading={act.isPending} onClick={() => act.mutate({ path: 'submit' })}>
                {t('procurement.submitForApproval')}
              </Button>
            )}
            {manage && s === 'approved' && (
              <Button loading={act.isPending} onClick={() => act.mutate({ path: 'send' })}>
                {t('procurement.markSent')}
              </Button>
            )}
            {manage && s === 'sent' && (
              <span className="flex gap-1">
                <Input
                  placeholder={t('procurement.supplierRef')}
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  className="w-40"
                />
                <Button
                  variant="secondary"
                  onClick={() => act.mutate({ path: 'confirm', body: { supplierReference: ref || null } })}
                >
                  {t('procurement.markConfirmed')}
                </Button>
              </span>
            )}
            {can('hub.receive') && ['sent', 'confirmed', 'partially_received'].includes(s) && (
              <Button onClick={() => setReceive(true)}>{t('procurement.receiveGoods')}</Button>
            )}
            {manage && s === 'partially_received' && (
              <Button variant="secondary" onClick={() => setReasonFor('close')}>
                {t('procurement.closeShort')}
              </Button>
            )}
            {manage && ['draft', 'pending_approval', 'approved', 'sent', 'confirmed'].includes(s) && (
              <Button variant="danger" onClick={() => setReasonFor('cancel')}>
                {t('common.cancel')}
              </Button>
            )}
            {manage && ['partially_received', 'received', 'closed'].includes(s) && can('bills.manage') && (
              <Link to={`/bills/new?supplierId=${po.supplierId}&poId=${po.id}`}>
                <Button variant="secondary">{t('finance.newBill')}</Button>
              </Link>
            )}
          </>
        }
      />
      <ErrorBox error={act.error} />
      {s === 'pending_approval' && <Notice tone="warn">{t('procurement.awaitingOwner')}</Notice>}
      {s === 'approved' && <Notice>{t('procurement.approvedSendNote')}</Notice>}
      {manage && (
        <Card>
          <DL
            items={[
              [t('common.supplier'), supplier.name],
              [t('common.phone'), supplier.phone],
              [t('procurement.expected'), date(po.expectedDate)],
              [t('procurement.supplierRef'), po.supplierReference],
              [t('common.subtotal'), money(po.subtotal)],
              [t('common.tax'), money(po.taxTotal)],
              [t('common.total'), money(po.total)],
              [t('procurement.approvedAt'), dateTime(po.approvedAt)],
            ]}
          />
        </Card>
      )}
      <Card title={t('orders.items')}>
        <Table
          rows={lines}
          rowKey={(l: any) => l.id}
          columns={[
            {
              key: 'p',
              header: t('common.product'),
              render: (l: any) => (
                <div>
                  {nameOf(l)}
                  <div className="text-xs text-slate-500">
                    {l.sku}
                    {l.orderNumber && ` · ${l.orderNumber} (${l.hotelName})`}
                  </div>
                </div>
              ),
            },
            {
              key: 'q',
              header: t('procurement.ordered'),
              render: (l: any) => qty(l.quantity),
              align: 'right',
            },
            {
              key: 'a',
              header: t('procurement.accepted'),
              render: (l: any) => qty(l.accepted),
              align: 'right',
            },
            {
              key: 'd',
              header: t('procurement.damaged'),
              render: (l: any) => qty(l.damaged),
              align: 'right',
            },
            {
              key: 'r',
              header: t('procurement.remaining'),
              render: (l: any) => qty(l.remaining),
              align: 'right',
            },
            ...(manage
              ? [
                  {
                    key: 'c',
                    header: t('procurement.unitCost'),
                    render: (l: any) => money(l.unitCost),
                    align: 'right' as const,
                  },
                ]
              : []),
          ]}
        />
      </Card>
      {receipts.length > 0 && (
        <Card title={t('procurement.receipts')}>
          <ul className="divide-y text-sm">
            {receipts.map((r: any) => (
              <li key={r.id} className="flex justify-between py-2">
                <span>
                  {r.receiptNumber} · {r.receivedByName}
                  {r.notes ? ` · ${r.notes}` : ''}
                </span>
                <span>{dateTime(r.receivedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {receive && (
        <ReceiveModal
          po={po}
          lines={lines}
          onClose={() => {
            setReceive(false);
            refresh();
          }}
        />
      )}
      <Modal
        open={!!reasonFor}
        title={reasonFor === 'close' ? t('procurement.closeShort') : t('common.cancel')}
        onClose={() => setReasonFor(null)}
        footer={
          <Button
            variant="danger"
            disabled={reason.length < 3}
            onClick={() => act.mutate({ path: reasonFor!, body: { reason } })}
          >
            {t('common.confirm')}
          </Button>
        }
      >
        <Field label={t('common.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

function ReceiveModal({ po, lines, onClose }: { po: any; lines: any[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [vals, setVals] = useState<Record<string, { a: string; d: string; n: string }>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.id, { a: l.remaining.replace(/\.?0+$/, '') || '0', d: '0', n: '' }]),
    ),
  );
  const [note, setNote] = useState('');
  const [dn, setDn] = useState('');
  const [recipient, setRecipient] = useState('');
  const [key] = useState(() => newId());
  const m = useMutation({
    mutationFn: () =>
      api.post(`/purchase-orders/${po.id}/receipts`, {
        lines: Object.entries(vals)
          .filter(([, v]) => Number(v.a) > 0 || Number(v.d) > 0)
          .map(([poLineId, v]) => ({
            poLineId,
            qtyAccepted: v.a || '0',
            qtyDamaged: v.d || '0',
            notes: v.n || null,
          })),
        supplierDeliveryNote: dn || null,
        notes: note || null,
        recipientName: po.fulfillment === 'direct' ? recipient : undefined,
        idempotencyKey: key,
      }),
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      title={t('procurement.receiveGoods')}
      onClose={onClose}
      footer={
        <Button
          loading={m.isPending}
          disabled={po.fulfillment === 'direct' && !recipient}
          onClick={() => m.mutate()}
        >
          {t('procurement.recordReceipt')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Notice>{t('procurement.receiveNote')}</Notice>
        {lines.map((l) => (
          <div key={l.id} className="rounded-lg border p-2 text-sm">
            <div className="font-medium">
              {nameOf(l)}{' '}
              <span className="text-xs text-slate-500">
                ({t('procurement.remaining')} {qty(l.remaining)})
              </span>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <Field label={t('procurement.accepted')}>
                <Input
                  inputMode="decimal"
                  value={vals[l.id]!.a}
                  onChange={(e) => setVals({ ...vals, [l.id]: { ...vals[l.id]!, a: e.target.value } })}
                />
              </Field>
              <Field label={t('procurement.damaged')}>
                <Input
                  inputMode="decimal"
                  value={vals[l.id]!.d}
                  onChange={(e) => setVals({ ...vals, [l.id]: { ...vals[l.id]!, d: e.target.value } })}
                />
              </Field>
              <Field label={t('common.note')}>
                <Input
                  value={vals[l.id]!.n}
                  onChange={(e) => setVals({ ...vals, [l.id]: { ...vals[l.id]!, n: e.target.value } })}
                />
              </Field>
            </div>
          </div>
        ))}
        <Field label={t('procurement.deliveryNote')}>
          <Input value={dn} onChange={(e) => setDn(e.target.value)} />
        </Field>
        {po.fulfillment === 'direct' && (
          <Field label={t('delivery.recipient')} required>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </Field>
        )}
        <Field label={t('common.note')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

/* ------------------------------------ hub ------------------------------------ */

export function HubPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'stock';
  const [q, setQ] = useState('');
  const stock = useQuery({
    queryKey: ['hub-stock', q],
    queryFn: () => api.get(`/hub/stock${qs({ q })}`),
    enabled: tab === 'stock',
  });
  const cons = useQuery({
    queryKey: ['consolidation'],
    queryFn: () => api.get('/hub/consolidation'),
    enabled: tab === 'consolidation',
  });
  const moves = useQuery({
    queryKey: ['hub-moves'],
    queryFn: () => api.get('/hub/movements'),
    enabled: tab === 'movements',
  });
  const [adjust, setAdjust] = useState<any>(null);
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.hub')} subtitle={t('hub.subtitle')} />
      <div className="flex gap-1 border-b" role="tablist">
        {['stock', 'consolidation', 'movements'].map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams({ tab: k })}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k
                ? 'border-brand-700 font-semibold text-brand-800'
                : 'border-transparent text-slate-600',
            )}
          >
            {t(`hub.tab_${k}`)}
          </button>
        ))}
      </div>
      {tab === 'stock' && (
        <Card>
          <Input
            type="search"
            placeholder={t('catalog.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mb-3 max-w-sm"
          />
          <Notice>{t('hub.stockNote')}</Notice>
          <div className="mt-3">
            <Table
              rows={stock.data?.items ?? []}
              rowKey={(r: any) => r.id}
              empty={t('hub.noStock')}
              columns={[
                {
                  key: 'p',
                  header: t('common.product'),
                  render: (r: any) => (
                    <div>
                      {nameOf(r)}
                      <div className="text-xs text-slate-500">{r.sku}</div>
                    </div>
                  ),
                },
                { key: 'i', header: t('hub.incoming'), render: (r: any) => qty(r.incoming), align: 'right' },
                { key: 'o', header: t('hub.onHand'), render: (r: any) => qty(r.onHand), align: 'right' },
                { key: 'r', header: t('hub.reserved'), render: (r: any) => qty(r.reserved), align: 'right' },
                {
                  key: 'a',
                  header: t('hub.available'),
                  render: (r: any) => qty(r.available),
                  align: 'right',
                },
                ...(r0(stock.data)
                  ? [
                      {
                        key: 'v',
                        header: t('hub.value'),
                        render: (r: any) => money(r.stockValue),
                        align: 'right' as const,
                      },
                    ]
                  : []),
                ...(can('hub.stock.adjust')
                  ? [
                      {
                        key: 'x',
                        header: '',
                        render: (r: any) => (
                          <Button size="sm" variant="ghost" onClick={() => setAdjust(r)}>
                            {t('hub.adjust')}
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </Card>
      )}
      {tab === 'consolidation' && (
        <div className="space-y-3">
          {cons.data?.items.length === 0 && <Notice>{t('hub.nothingToConsolidate')}</Notice>}
          {cons.data?.items.map((o: any) => (
            <Card
              key={o.id}
              title={
                <Link to={`/orders/${o.id}`} className="text-brand-700 hover:underline">
                  {o.orderNumber} · {o.hotelName}
                </Link>
              }
              actions={<StatusBadge status={o.status} />}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th>{t('common.product')}</th>
                    <th className="text-right">{t('orders.ordered')}</th>
                    <th className="text-right">{t('orders.received')}</th>
                    <th className="text-right">{t('orders.atHub')}</th>
                    <th className="text-right">{t('orders.delivered')}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.lines.map((l: any) => {
                    const ready = cmpQty(addQty(l.reserved, l.delivered), l.needed) >= 0;
                    return (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="py-1">
                          {ready ? '✅ ' : '⏳ '}
                          {nameOf(l)}
                        </td>
                        <td className="text-right tabular-nums">{qty(l.needed)}</td>
                        <td className="text-right tabular-nums">{qty(l.received)}</td>
                        <td className="text-right tabular-nums">{qty(l.reserved)}</td>
                        <td className="text-right tabular-nums">{qty(l.delivered)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-slate-500">
                {t('orders.requestedDate')}: {date(o.requestedDeliveryDate)}
              </p>
            </Card>
          ))}
        </div>
      )}
      {tab === 'movements' && (
        <Card>
          <Table
            rows={moves.data?.items ?? []}
            rowKey={(r: any) => String(r.id)}
            columns={[
              { key: 't', header: t('common.date'), render: (r: any) => dateTime(r.createdAt) },
              { key: 'p', header: t('common.product'), render: (r: any) => r.nameEn },
              { key: 'k', header: t('common.type'), render: (r: any) => t(`hub.mv_${r.movementType}`) },
              { key: 'q', header: t('common.quantity'), render: (r: any) => qty(r.quantity), align: 'right' },
              { key: 'r', header: t('common.reason'), render: (r: any) => r.reason },
              { key: 'u', header: t('common.user'), render: (r: any) => r.actorName },
            ]}
          />
        </Card>
      )}
      {adjust && (
        <AdjustModal
          product={adjust}
          onClose={() => {
            setAdjust(null);
            void stock.refetch();
          }}
        />
      )}
    </div>
  );
}
const r0 = (d: any) => d?.items?.[0]?.stockValue !== undefined;

function AdjustModal({ product, onClose }: { product: any; onClose: () => void }) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState('');
  const [type, setType] = useState('adjustment');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api.post('/hub/adjustments', { productId: product.id, quantity, movementType: type, reason }),
  });
  return (
    <Modal
      open
      title={`${t('hub.adjust')}: ${nameOf(product)}`}
      onClose={onClose}
      footer={
        m.data ? (
          <Button onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <Button disabled={!quantity || reason.length < 3} loading={m.isPending} onClick={() => m.mutate()}>
            {t('common.save')}
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <Notice>{t('hub.adjustNote')}</Notice>
        <Field label={t('common.type')}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="adjustment">{t('hub.mv_adjustment')}</option>
            <option value="write_off">{t('hub.mv_write_off')}</option>
            <option value="return_to_supplier">{t('hub.mv_return_to_supplier')}</option>
          </Select>
        </Field>
        <Field label={t('hub.quantityChange')} hint={t('hub.quantityChangeHint')}>
          <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label={t('common.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {m.data && (
          <Notice tone={m.data.applied ? 'success' : 'warn'}>
            {m.data.applied ? t('hub.adjusted') : t('approvals.sentForApproval')}
          </Notice>
        )}
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

/* --------------------------------- deliveries -------------------------------- */

export function DeliveriesPage() {
  const { t } = useTranslation();
  const { can, me } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api.get('/delivery-runs') });
  const list = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api.get('/deliveries?status=scheduled,dispatched'),
  });
  const drivers = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get('/users?scope=internal'),
    enabled: can('users.manage_internal'),
  });
  const [newRun, setNewRun] = useState<{
    scheduledDate: string;
    windowStart: string;
    windowEnd: string;
    driverId: string;
    vehicle: string;
    routeNotes: string;
  } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.post('/delivery-runs', {
        ...newRun,
        driverId: newRun?.driverId || null,
        windowStart: newRun?.windowStart || null,
        windowEnd: newRun?.windowEnd || null,
      }),
    onSuccess: () => {
      setNewRun(null);
      void qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
  const driverOptions = (drivers.data?.items ?? []).filter((u: any) => u.role === 'driver' && u.isActive);
  return (
    <div className="space-y-4">
      <PageHeader
        title={me?.user.role === 'driver' ? t('delivery.myDeliveries') : t('nav.deliveries')}
        actions={
          can('delivery.manage') && (
            <Button
              onClick={() =>
                setNewRun({
                  scheduledDate: todayNepal(),
                  windowStart: '09:00',
                  windowEnd: '13:00',
                  driverId: '',
                  vehicle: '',
                  routeNotes: '',
                })
              }
            >
              {t('delivery.newRun')}
            </Button>
          )
        }
      />
      <Card title={t('delivery.openDeliveries')}>
        <Table
          rows={list.data?.items ?? []}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => nav(`/deliveries/${r.id}`)}
          empty={t('delivery.none')}
          columns={[
            {
              key: 'n',
              header: t('delivery.number'),
              render: (r: any) => <span className="font-medium">{r.deliveryNumber}</span>,
            },
            {
              key: 'h',
              header: t('common.hotel'),
              render: (r: any) => (
                <div>
                  {r.hotelName}
                  <div className="text-xs text-slate-500">{r.deliveryAddress}</div>
                </div>
              ),
            },
            { key: 'o', header: t('orders.order'), render: (r: any) => r.orderNumber },
            {
              key: 'd',
              header: t('common.date'),
              render: (r: any) =>
                `${date(r.scheduledDate)} ${r.windowStart ? `${r.windowStart.slice(0, 5)}–${r.windowEnd?.slice(0, 5) ?? ''}` : ''}`,
            },
            { key: 'dr', header: t('delivery.driver'), render: (r: any) => r.driverName ?? '—' },
            { key: 's', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <Card title={t('delivery.runs')}>
        <Table
          rows={runs.data?.items ?? []}
          rowKey={(r: any) => r.id}
          columns={[
            { key: 'n', header: t('delivery.run'), render: (r: any) => r.runNumber },
            {
              key: 'd',
              header: t('common.date'),
              render: (r: any) =>
                `${date(r.scheduledDate)} ${r.windowStart ? `${r.windowStart.slice(0, 5)}–${r.windowEnd?.slice(0, 5) ?? ''}` : ''}`,
            },
            { key: 'dr', header: t('delivery.driver'), render: (r: any) => r.driverName ?? '—' },
            { key: 'v', header: t('delivery.vehicle'), render: (r: any) => r.vehicle },
            { key: 'st', header: t('delivery.stops'), render: (r: any) => r.stops, align: 'right' },
            { key: 's', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <Modal
        open={!!newRun}
        title={t('delivery.newRun')}
        onClose={() => setNewRun(null)}
        footer={
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        {newRun && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.date')}>
              <Input
                type="date"
                value={newRun.scheduledDate}
                onChange={(e) => setNewRun({ ...newRun, scheduledDate: e.target.value })}
              />
            </Field>
            <Field label={t('delivery.driver')}>
              <Select
                value={newRun.driverId}
                onChange={(e) => setNewRun({ ...newRun, driverId: e.target.value })}
              >
                <option value="">—</option>
                {driverOptions.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('delivery.from')}>
              <Input
                type="time"
                value={newRun.windowStart}
                onChange={(e) => setNewRun({ ...newRun, windowStart: e.target.value })}
              />
            </Field>
            <Field label={t('delivery.until')}>
              <Input
                type="time"
                value={newRun.windowEnd}
                onChange={(e) => setNewRun({ ...newRun, windowEnd: e.target.value })}
              />
            </Field>
            <Field label={t('delivery.vehicle')}>
              <Input
                value={newRun.vehicle}
                onChange={(e) => setNewRun({ ...newRun, vehicle: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t('delivery.routeNotes')}>
                <Textarea
                  value={newRun.routeNotes}
                  onChange={(e) => setNewRun({ ...newRun, routeNotes: e.target.value })}
                />
              </Field>
            </div>
            <div className="col-span-2">
              <ErrorBox error={create.error} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function DeliveryDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['delivery', id], queryFn: () => api.get(`/deliveries/${id}`) });
  const [confirming, setConfirming] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['delivery', id] });
  const dispatch = useMutation({
    mutationFn: () => api.post(`/deliveries/${id}/dispatch`),
    onSuccess: refresh,
  });
  const fail = useMutation({
    mutationFn: () => api.post(`/deliveries/${id}/fail`, { reason }),
    onSuccess: () => {
      setFailing(false);
      refresh();
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { delivery: d, lines, hotel, order, run } = q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {d.deliveryNumber} <StatusBadge status={d.status} />
          </span>
        }
        subtitle={`${order.orderNumber} · ${hotel.legalName}`}
        actions={
          <>
            {d.status === 'scheduled' && can('hub.dispatch', 'delivery.manage') && (
              <Button loading={dispatch.isPending} onClick={() => dispatch.mutate()}>
                {t('delivery.dispatch')}
              </Button>
            )}
            {d.status === 'dispatched' && can('delivery.confirm', 'delivery.manage') && (
              <>
                <Button size="lg" onClick={() => setConfirming(true)}>
                  {t('delivery.confirm')}
                </Button>
                <Button variant="danger" onClick={() => setFailing(true)}>
                  {t('delivery.failed')}
                </Button>
              </>
            )}
          </>
        }
      />
      <ErrorBox error={dispatch.error} />
      <Card title={t('delivery.destination')}>
        <DL
          items={[
            [t('common.address'), hotel.deliveryAddress ?? hotel.address],
            [t('delivery.contact'), `${hotel.primaryContactName ?? ''} ${hotel.primaryContactPhone ?? ''}`],
            [t('delivery.instructions'), hotel.deliveryInstructions],
            [t('cart.notes'), order.deliveryNotes ?? d.instructions],
            [t('delivery.run'), run ? `${run.runNumber} · ${date(run.scheduledDate)}` : '—'],
          ]}
        />
        {hotel.primaryContactPhone && (
          <a href={`tel:${hotel.primaryContactPhone}`} className="mt-2 inline-block text-sm text-brand-700">
            📞 {t('delivery.call')}
          </a>
        )}
      </Card>
      <Card title={t('delivery.contents')}>
        <Table
          rows={lines}
          rowKey={(l: any) => l.id}
          columns={[
            { key: 'p', header: t('common.product'), render: (l: any) => nameOf(l) },
            {
              key: 'q',
              header: t('delivery.dispatched'),
              render: (l: any) => `${qty(l.qtyDispatched)} ${t(`units.${l.unit}`, { defaultValue: l.unit })}`,
              align: 'right',
            },
            {
              key: 'd',
              header: t('orders.delivered'),
              render: (l: any) => qty(l.qtyDelivered),
              align: 'right',
            },
            {
              key: 'x',
              header: t('delivery.exceptions'),
              render: (l: any) =>
                [
                  Number(l.qtyDamaged) && `${t('procurement.damaged')} ${qty(l.qtyDamaged)}`,
                  Number(l.qtyMissing) && `${t('delivery.missing')} ${qty(l.qtyMissing)}`,
                  Number(l.qtyReturned) && `${t('delivery.returned')} ${qty(l.qtyReturned)}`,
                ]
                  .filter(Boolean)
                  .join(', '),
            },
          ]}
        />
      </Card>
      {d.deliveredAt && (
        <Card title={t('delivery.proof')}>
          <DL
            items={[
              [t('delivery.recipient'), d.recipientName],
              [t('common.phone'), d.recipientPhone],
              [t('delivery.deliveredAt'), dateTime(d.deliveredAt)],
              [t('cart.notes'), d.notes],
            ]}
          />
          <div className="mt-2 flex gap-3">
            {d.photoAttachmentId && (
              <img
                src={`/api/v1/attachments/${d.photoAttachmentId}/download`}
                alt={t('delivery.photo')}
                className="h-40 rounded-lg border object-cover"
              />
            )}
            {d.signatureAttachmentId && (
              <img
                src={`/api/v1/attachments/${d.signatureAttachmentId}/download`}
                alt={t('delivery.signature')}
                className="h-40 rounded-lg border bg-white object-contain"
              />
            )}
          </div>
        </Card>
      )}
      {d.failureReason && (
        <Notice tone="error">{t('delivery.failedBecause', { reason: d.failureReason })}</Notice>
      )}
      {confirming && (
        <ConfirmDelivery
          delivery={d}
          lines={lines}
          onClose={() => {
            setConfirming(false);
            refresh();
          }}
        />
      )}
      <Modal
        open={failing}
        title={t('delivery.failed')}
        onClose={() => setFailing(false)}
        footer={
          <Button
            variant="danger"
            disabled={reason.length < 3}
            loading={fail.isPending}
            onClick={() => fail.mutate()}
          >
            {t('common.confirm')}
          </Button>
        }
      >
        <Notice tone="warn">{t('delivery.failNote')}</Notice>
        <Field label={t('common.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={fail.error} />
      </Modal>
    </div>
  );
}

function ConfirmDelivery({ delivery, lines, onClose }: { delivery: any; lines: any[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [recipient, setRecipient] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [vals, setVals] = useState<
    Record<string, { delivered: string; damaged: string; missing: string; returned: string }>
  >(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        { delivered: l.qtyDispatched.replace(/\.?0+$/, ''), damaged: '0', missing: '0', returned: '0' },
      ]),
    ),
  );
  const balanced = (l: any) => {
    const v = vals[l.id]!;
    return (
      Math.abs(
        Number(v.delivered || 0) +
          Number(v.damaged || 0) +
          Number(v.missing || 0) +
          Number(v.returned || 0) -
          Number(l.qtyDispatched),
      ) < 0.0005
    );
  };
  const m = useMutation({
    mutationFn: async () => {
      let photoAttachmentId: string | null = null;
      if (photo) {
        const f = new FormData();
        f.append('category', 'delivery_evidence');
        f.append('hotelId', delivery.hotelId);
        f.append('file', photo);
        photoAttachmentId = (await api.upload('/attachments', f)).attachment.id;
      }
      return api.post(`/deliveries/${delivery.id}/confirm`, {
        recipientName: recipient,
        recipientPhone: phone || null,
        notes: notes || null,
        photoAttachmentId,
        lines: lines.map((l) => ({
          deliveryLineId: l.id,
          qtyDelivered: vals[l.id]!.delivered || '0',
          qtyDamaged: vals[l.id]!.damaged || '0',
          qtyMissing: vals[l.id]!.missing || '0',
          qtyReturned: vals[l.id]!.returned || '0',
        })),
      });
    },
    onSuccess: onClose,
  });
  const set = (id: string, k: string, v: string) => setVals({ ...vals, [id]: { ...vals[id]!, [k]: v } });
  return (
    <Modal
      open
      title={t('delivery.confirm')}
      onClose={onClose}
      footer={
        <Button
          size="lg"
          disabled={!recipient || !lines.every(balanced)}
          loading={m.isPending}
          onClick={() => m.mutate()}
        >
          {t('delivery.confirm')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Notice>{t('delivery.confirmNote')}</Notice>
        {lines.map((l) => (
          <div key={l.id} className={cx('rounded-lg border p-2 text-sm', !balanced(l) && 'border-red-300')}>
            <div className="font-medium">
              {nameOf(l)} · {t('delivery.dispatched')} {qty(l.qtyDispatched)}
            </div>
            <div className="mt-1 grid grid-cols-4 gap-1">
              {(['delivered', 'damaged', 'missing', 'returned'] as const).map((k) => (
                <Field key={k} label={t(`delivery.${k}`)}>
                  <Input
                    inputMode="decimal"
                    value={vals[l.id]![k]}
                    onChange={(e) => set(l.id, k, e.target.value)}
                  />
                </Field>
              ))}
            </div>
            {!balanced(l) && <p className="mt-1 text-xs text-red-600">{t('delivery.mustBalance')}</p>}
          </div>
        ))}
        <Field label={t('delivery.recipient')} required>
          <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </Field>
        <Field label={t('common.phone')}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t('delivery.photo')} hint={t('delivery.photoHint')}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </Field>
        <Field label={t('cart.notes')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}
