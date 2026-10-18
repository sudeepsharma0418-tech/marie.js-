import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUSES } from '@hp/shared';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, money, nameOf, qty } from '../lib/format';
import {
  Button,
  Card,
  DL,
  ErrorBox,
  Field,
  Input,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Textarea,
} from '../components/ui';

export function OrderListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const statuses = params.get('statuses') ?? '';
  const search = params.get('q') ?? '';
  const q = useQuery({
    queryKey: ['orders', statuses, search, page],
    queryFn: () => api.get(`/orders${qs({ statuses, q: search, page })}`),
  });
  return (
    <div>
      <PageHeader
        title={t('orders.title')}
        actions={
          can('orders.create') && (
            <Link to="/catalog">
              <Button>{t('dashboard.startOrder')}</Button>
            </Link>
          )
        }
      />
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          type="search"
          placeholder={t('orders.search')}
          defaultValue={search}
          onKeyDown={(e) =>
            e.key === 'Enter' && setParams({ statuses, q: (e.target as HTMLInputElement).value })
          }
          aria-label={t('orders.search')}
        />
        <Select
          value={statuses}
          onChange={(e) => {
            setPage(1);
            setParams({ statuses: e.target.value, q: search });
          }}
          aria-label={t('common.status')}
        >
          <option value="">{t('orders.allStatuses')}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} />
      {q.data && (
        <Card>
          <Table
            rows={q.data.items}
            rowKey={(r: any) => r.id}
            onRowClick={(r: any) => nav(`/orders/${r.id}`)}
            columns={[
              {
                key: 'n',
                header: t('orders.number'),
                render: (r: any) => <span className="font-medium">{r.orderNumber}</span>,
              },
              ...(can('orders.read_all')
                ? [{ key: 'h', header: t('common.hotel'), render: (r: any) => r.hotelName }]
                : []),
              { key: 's', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
              {
                key: 'l',
                header: t('orders.lines'),
                render: (r: any) => r.lineCount,
                align: 'right' as const,
              },
              {
                key: 't',
                header: t('common.total'),
                render: (r: any) => money(r.total),
                align: 'right' as const,
              },
              {
                key: 'd',
                header: t('orders.requestedDate'),
                render: (r: any) => date(r.requestedDeliveryDate),
              },
              { key: 'c', header: t('common.created'), render: (r: any) => dateTime(r.createdAt) },
            ]}
          />
          <Pagination page={page} pages={q.data.pages} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get(`/orders/${id}`) });
  const deliveries = useQuery({
    queryKey: ['order-deliveries', id],
    queryFn: () => api.get(`/deliveries${qs({ orderId: id })}`),
    enabled: can('delivery.manage', 'orders.read_own_hotel', 'hub.dispatch'),
  });
  const invoices = useQuery({
    queryKey: ['order-invoices', id],
    queryFn: () => api.get(`/invoices${qs({ orderId: id })}`),
    enabled: can('finance.view_all', 'finance.view_own_hotel'),
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['procurement', id] });
    void qc.invalidateQueries({ queryKey: ['order-deliveries', id] });
    void qc.invalidateQueries({ queryKey: ['order-invoices', id] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/orders/${id}/${path}`, body ?? {}),
    onSuccess: (r, v) => {
      if (v.path === 'reorder') nav(`/orders/${r.order.id}`);
      setCancelOpen(false);
      refresh();
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { order, hotel, quantities, events } = q.data;
  const internal = can('orders.read_all');
  const s = order.status as string;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t('orders.order')} {order.orderNumber} <StatusBadge status={s} />
          </span>
        }
        subtitle={hotel?.legalName}
        actions={
          <>
            {s === 'draft' && can('orders.create', 'orders.manage') && (
              <Button loading={act.isPending} onClick={() => act.mutate({ path: 'submit' })}>
                {t('orders.submit')}
              </Button>
            )}
            {s === 'pending_hotel_approval' && can('orders.approve_hotel') && (
              <>
                <Button loading={act.isPending} onClick={() => act.mutate({ path: 'hotel-approve' })}>
                  {t('orders.approve')}
                </Button>
                <Button variant="secondary" onClick={() => act.mutate({ path: 'hotel-return' })}>
                  {t('orders.returnToDraft')}
                </Button>
              </>
            )}
            {can('orders.create') && (
              <Button variant="secondary" onClick={() => act.mutate({ path: 'reorder' })}>
                {t('orders.reorder')}
              </Button>
            )}
            {[
              'draft',
              'pending_hotel_approval',
              'submitted',
              'pending_approval',
              'approved',
              ...(internal ? ['procurement'] : []),
            ].includes(s) &&
              can('orders.create', 'orders.manage') && (
                <Button variant="danger" onClick={() => setCancelOpen(true)}>
                  {t('orders.cancel')}
                </Button>
              )}
            {internal && can('invoices.manage') && ['partially_delivered', 'delivered'].includes(s) && (
              <Button
                variant="secondary"
                onClick={async () => {
                  await api.post(`/orders/${id}/invoices`).catch(() => undefined);
                  refresh();
                }}
              >
                {t('orders.createInvoice')}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={act.error} />
      {s === 'pending_approval' && <Notice tone="warn">{t('orders.pendingApprovalNote')}</Notice>}
      {s === 'rejected' && <Notice tone="error">{t('orders.rejectedNote')}</Notice>}
      {internal && order.creditCheck && (s === 'pending_approval' || s === 'rejected') && (
        <Card title={t('orders.creditCheck')}>
          <DL
            items={[
              [t('finance.creditLimit'), money(order.creditCheck.creditLimit)],
              [t('finance.balance'), money(order.creditCheck.balance)],
              [t('finance.openOrders'), money(order.creditCheck.openOrders)],
              [t('finance.exposureAfter'), money(order.creditCheck.exposureAfter)],
              [
                t('finance.overdue'),
                `${order.creditCheck.overdue.count} · ${money(order.creditCheck.overdue.amount)}`,
              ],
              [
                t('orders.reasons'),
                order.creditCheck.reasons.map((r: string) => t(`credit.${r}`)).join(', '),
              ],
            ]}
          />
        </Card>
      )}

      <Card title={t('orders.items')}>
        <Table
          rows={order.lines}
          rowKey={(l: any) => l.id}
          columns={[
            {
              key: 'p',
              header: t('common.product'),
              render: (l: any) => (
                <div>
                  <div className="font-medium">{nameOf(l)}</div>
                  {l.notes && <div className="text-xs text-slate-500">{l.notes}</div>}
                </div>
              ),
            },
            {
              key: 'q',
              header: t('orders.ordered'),
              render: (l: any) =>
                `${qty(quantities[l.id]?.needed)} ${t(`units.${l.unit}`, { defaultValue: l.unit })}`,
              align: 'right',
            },
            ...(internal
              ? [
                  {
                    key: 'pu',
                    header: t('orders.purchased'),
                    render: (l: any) => qty(quantities[l.id]?.purchased),
                    align: 'right' as const,
                  },
                  {
                    key: 'rc',
                    header: t('orders.received'),
                    render: (l: any) => qty(quantities[l.id]?.received),
                    align: 'right' as const,
                  },
                  {
                    key: 'rs',
                    header: t('orders.atHub'),
                    render: (l: any) => qty(quantities[l.id]?.reserved),
                    align: 'right' as const,
                  },
                ]
              : []),
            {
              key: 'dl',
              header: t('orders.delivered'),
              render: (l: any) => qty(quantities[l.id]?.delivered),
              align: 'right',
            },
            ...(internal
              ? [
                  {
                    key: 'iv',
                    header: t('orders.invoiced'),
                    render: (l: any) => qty(quantities[l.id]?.invoiced),
                    align: 'right' as const,
                  },
                ]
              : []),
            {
              key: 'up',
              header: t('common.unitPrice'),
              render: (l: any) => (
                <span>
                  {money(l.unitPrice)}
                  {internal && l.priceSource === 'override' && (
                    <span className="ml-1 text-xs text-amber-700">*</span>
                  )}
                </span>
              ),
              align: 'right',
            },
            {
              key: 'st',
              header: t('common.amount'),
              render: (l: any) => money(l.lineSubtotal),
              align: 'right',
            },
            ...(can('orders.price_override')
              ? [
                  {
                    key: 'po',
                    header: '',
                    render: (l: any) => <PriceOverride orderId={id!} line={l} onDone={refresh} />,
                  },
                ]
              : []),
          ]}
        />
        <div className="mt-3 ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span>{t('common.subtotal')}</span>
            <span className="tabular-nums">{money(order.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('common.tax')}</span>
            <span className="tabular-nums">{money(order.taxTotal)}</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <span>{t('common.total')}</span>
            <span className="tabular-nums">{money(order.total)}</span>
          </div>
          <p className="text-xs text-slate-500">{t('orders.totalsNote')}</p>
        </div>
      </Card>

      {internal && can('procurement.manage') && (
        <ProcurementPanel orderId={id!} status={s} onChange={refresh} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('orders.delivery')}>
          <DL
            items={[
              [t('orders.requestedDate'), date(order.requestedDeliveryDate)],
              [t('cart.window'), t(`cart.window_${order.deliveryWindow}`)],
              [t('cart.notes'), order.deliveryNotes],
            ]}
          />
          {deliveries.data?.items?.length > 0 && (
            <ul className="mt-3 divide-y text-sm">
              {deliveries.data.items.map((d: any) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <Link to={`/deliveries/${d.id}`} className="text-brand-700 hover:underline">
                    {d.deliveryNumber}
                  </Link>
                  <span className="text-slate-500">{date(d.scheduledDate)}</span>
                  <StatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
          {internal &&
            can('delivery.manage') &&
            ['consolidating', 'ready_for_dispatch', 'partially_delivered', 'dispatched'].includes(s) && (
              <ScheduleDelivery orderId={id!} onDone={refresh} />
            )}
        </Card>
        {invoices.data && (
          <Card title={t('nav.invoices')}>
            {invoices.data.items.length === 0 ? (
              <p className="text-sm text-slate-500">{t('orders.noInvoices')}</p>
            ) : (
              <ul className="divide-y text-sm">
                {invoices.data.items.map((i: any) => (
                  <li key={i.id} className="flex items-center justify-between py-2">
                    <Link to={`/invoices/${i.id}`} className="text-brand-700 hover:underline">
                      {i.invoiceNumber ?? t('status.draft')}
                    </Link>
                    <span className="tabular-nums">{money(i.total)}</span>
                    <StatusBadge status={i.paymentStatus ?? i.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Card title={t('orders.timeline')}>
        <ol className="space-y-2 text-sm">
          {events.map((e: any) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 border-l-2 border-brand-100 pl-3">
              <span className="text-slate-500">{dateTime(e.createdAt)}</span>
              <span className="font-medium">
                {t(`events.${e.event}`, { defaultValue: e.event.replace(/_/g, ' ') })}
              </span>
              {e.toStatus && <StatusBadge status={e.toStatus} />}
              {e.note && <span className="text-slate-600">{e.note}</span>}
              {e.actorName && <span className="text-slate-400">· {e.actorName}</span>}
              {e.visibleToHotel === false && (
                <span className="text-xs text-amber-700">({t('orders.internalNote')})</span>
              )}
            </li>
          ))}
        </ol>
      </Card>

      <Modal
        open={cancelOpen}
        title={t('orders.cancel')}
        onClose={() => setCancelOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              {t('common.back')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.length < 3}
              loading={act.isPending}
              onClick={() => act.mutate({ path: 'cancel', body: { reason } })}
            >
              {t('orders.confirmCancel')}
            </Button>
          </>
        }
      >
        <Field label={t('common.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

function PriceOverride({ orderId, line, onDone }: { orderId: string; line: any; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(line.unitPrice);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/lines/${line.id}/price`, { unitPrice: price, reason }),
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
  });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t('orders.changePrice')}
      </Button>
      <Modal
        open={open}
        title={t('orders.changePrice')}
        onClose={() => setOpen(false)}
        footer={
          <Button loading={m.isPending} disabled={reason.length < 3} onClick={() => m.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        <div className="space-y-3">
          <Notice>{t('orders.priceOverrideNote')}</Notice>
          <Field label={t('common.unitPrice')}>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={t('common.reason')} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {m.data && !m.data.applied && <Notice tone="warn">{t('approvals.sentForApproval')}</Notice>}
          <ErrorBox error={m.error} />
        </div>
      </Modal>
    </>
  );
}

function ProcurementPanel({
  orderId,
  status,
  onChange,
}: {
  orderId: string;
  status: string;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const p = useQuery({
    queryKey: ['procurement', orderId],
    queryFn: () => api.get(`/orders/${orderId}/procurement`),
  });
  const suppliers = useQuery({
    queryKey: ['suppliers', 'active'],
    queryFn: () => api.get('/suppliers?status=active'),
  });
  const [fulfillment, setFulfillment] = useState('hub');
  const createPos = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/purchase-orders`, { fulfillment }),
    onSuccess: onChange,
  });
  const canSource = [
    'approved',
    'procurement',
    'consolidating',
    'ready_for_dispatch',
    'partially_delivered',
  ].includes(status);
  if (p.isLoading) return <Spinner />;
  if (!p.data) return <ErrorBox error={p.error} />;
  const e = p.data.expected;
  return (
    <Card
      title={t('procurement.title')}
      actions={
        canSource && (
          <>
            <Select
              value={fulfillment}
              onChange={(ev) => setFulfillment(ev.target.value)}
              className="w-auto"
              aria-label={t('procurement.fulfillment')}
            >
              <option value="hub">{t('procurement.viaHub')}</option>
              <option value="direct">{t('procurement.direct')}</option>
            </Select>
            <Button loading={createPos.isPending} onClick={() => createPos.mutate()}>
              {t('procurement.createPos')}
            </Button>
          </>
        )
      }
    >
      <ErrorBox error={createPos.error} />
      <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <div className="text-slate-500">{t('procurement.expectedRevenue')}</div>
          <div className="font-semibold tabular-nums">{money(e.revenue)}</div>
        </div>
        <div>
          <div className="text-slate-500">{t('procurement.expectedCost')}</div>
          <div className="font-semibold tabular-nums">{money(e.cost)}</div>
        </div>
        <div>
          <div className="text-slate-500">{t('procurement.expectedMargin')}</div>
          <div className="font-semibold tabular-nums">{money(e.grossMargin)}</div>
        </div>
        <div>
          <div className="text-slate-500">{t('procurement.marginPercent')}</div>
          <div className="font-semibold tabular-nums">{e.marginPercent ?? '—'}%</div>
        </div>
      </div>
      {!e.costComplete && <Notice tone="warn">{t('procurement.costIncomplete')}</Notice>}
      <div className="mt-3 space-y-3">
        {p.data.lines.map((l: any) => (
          <SourcingRow
            key={l.id}
            orderId={orderId}
            line={l}
            suppliers={suppliers.data?.items ?? []}
            disabled={!canSource}
            onDone={() => {
              void p.refetch();
              onChange();
            }}
          />
        ))}
      </div>
      {p.data.purchaseOrders.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">{t('nav.purchaseOrders')}</h3>
          <ul className="divide-y text-sm">
            {p.data.purchaseOrders.map((po: any) => (
              <li key={po.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link to={`/purchase-orders/${po.id}`} className="text-brand-700 hover:underline">
                  {po.poNumber}
                </Link>
                <span>{po.supplierName}</span>
                <span className="tabular-nums">{money(po.total)}</span>
                <StatusBadge status={po.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function SourcingRow({
  orderId,
  line,
  suppliers,
  disabled,
  onDone,
}: {
  orderId: string;
  line: any;
  suppliers: any[];
  disabled: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const quotes = useQuery({
    queryKey: ['quotes', line.productId],
    queryFn: () => api.get(`/quotations${qs({ productId: line.productId })}`),
  });
  const [supplierId, setSupplierId] = useState('');
  const [cost, setCost] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const record = useMutation({
    mutationFn: () =>
      api.post('/quotations', {
        supplierId,
        productId: line.productId,
        orderId,
        unitCost: cost,
        validUntil: validUntil || null,
      }),
    onSuccess: () => {
      setCost('');
      void quotes.refetch();
    },
  });
  const select = useMutation({
    mutationFn: (qt: any) =>
      api.put(`/orders/${orderId}/lines/${line.id}/sourcing`, {
        supplierId: qt.supplierId,
        quotationId: qt.id,
      }),
    onSuccess: onDone,
  });
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">{nameOf(line)}</div>
        <div className="text-xs text-slate-500">
          {t('procurement.needed')}: {qty(line.quantities.needed)} · {t('procurement.toPurchase')}:{' '}
          {qty(line.toPurchase)} · {t('common.unitPrice')}: {money(line.unitPrice)}
        </div>
      </div>
      <div className="mt-1 text-sm">
        {line.supplierName ? (
          <span className="text-emerald-700">
            ✓ {line.supplierName} @ {money(line.expectedUnitCost)}
          </span>
        ) : (
          <span className="text-amber-700">{t('procurement.noSupplier')}</span>
        )}
      </div>
      {quotes.data?.items?.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {quotes.data.items.slice(0, 6).map((qt: any) => (
              <tr key={qt.id} className="border-t border-slate-100">
                <td className="py-1">{qt.supplierName}</td>
                <td className="py-1 text-right tabular-nums">{money(qt.unitCost)}</td>
                <td className="py-1 text-xs text-slate-500">
                  {qt.validUntil ? `${t('procurement.validUntil')} ${date(qt.validUntil)}` : ''}
                  {qt.expired && <span className="ml-1 text-red-600">{t('procurement.expired')}</span>}
                </td>
                <td className="py-1 text-right">
                  {!disabled && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={qt.expired}
                      onClick={() => select.mutate(qt)}
                    >
                      {t('procurement.select')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!disabled && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            aria-label={t('common.supplier')}
          >
            <option value="">{t('procurement.chooseSupplier')}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            placeholder={t('procurement.unitCost')}
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            aria-label={t('procurement.unitCost')}
          />
          <Input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            aria-label={t('procurement.validUntil')}
          />
          <Button
            variant="secondary"
            disabled={!supplierId || !cost}
            loading={record.isPending}
            onClick={() => record.mutate()}
          >
            {t('procurement.recordQuote')}
          </Button>
        </div>
      )}
      <ErrorBox error={record.error ?? select.error} />
    </div>
  );
}

function ScheduleDelivery({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const runs = useQuery({ queryKey: ['runs-open'], queryFn: () => api.get('/delivery-runs') });
  const [runId, setRunId] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/deliveries', { orderId, runId: runId || null }),
    onSuccess: onDone,
  });
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
      <Field label={t('delivery.run')}>
        <Select value={runId} onChange={(e) => setRunId(e.target.value)}>
          <option value="">{t('delivery.noRun')}</option>
          {runs.data?.items
            .filter((r: any) => ['planned', 'in_progress'].includes(r.status))
            .map((r: any) => (
              <option key={r.id} value={r.id}>
                {r.runNumber} · {date(r.scheduledDate)} · {r.driverName ?? t('delivery.noDriver')}
              </option>
            ))}
        </Select>
      </Field>
      <Button loading={m.isPending} onClick={() => m.mutate()}>
        {t('delivery.scheduleReady')}
      </Button>
      <ErrorBox error={m.error} />
    </div>
  );
}
