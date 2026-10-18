import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHODS } from '@hp/shared';
import { api, newId, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, money, qty, todayNepal } from '../lib/format';
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
  Select,
  Spinner,
  Stat,
  StatusBadge,
  Table,
  Textarea,
} from '../components/ui';

export function InvoiceListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const internal = can('finance.view_all');
  const q = useQuery({
    queryKey: ['invoices', status],
    queryFn: () => api.get(`/invoices${qs({ status })}`),
  });
  return (
    <div>
      <PageHeader title={t('nav.invoices')} />
      {internal && (
        <Select
          value={status}
          onChange={(e) => setParams({ status: e.target.value })}
          className="mb-3 max-w-xs"
          aria-label={t('common.status')}
        >
          <option value="">{t('common.all')}</option>
          <option value="draft">{t('status.draft')}</option>
          <option value="issued">{t('status.issued')}</option>
          <option value="discarded">{t('status.discarded')}</option>
        </Select>
      )}
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} />
      {q.data && (
        <Card>
          <Table
            rows={q.data.items}
            rowKey={(r: any) => r.id}
            onRowClick={(r: any) => nav(`/invoices/${r.id}`)}
            columns={[
              {
                key: 'n',
                header: t('finance.invoiceNo'),
                render: (r: any) => (
                  <span className="font-medium">{r.invoiceNumber ?? t('status.draft')}</span>
                ),
              },
              ...(internal ? [{ key: 'h', header: t('common.hotel'), render: (r: any) => r.hotelName }] : []),
              { key: 'o', header: t('orders.order'), render: (r: any) => r.orderNumber },
              { key: 'd', header: t('common.date'), render: (r: any) => date(r.invoiceDate) },
              {
                key: 'du',
                header: t('finance.dueDate'),
                render: (r: any) => (
                  <span className={r.overdue ? 'font-semibold text-red-700' : ''}>{date(r.dueDate)}</span>
                ),
              },
              { key: 't', header: t('common.total'), render: (r: any) => money(r.total), align: 'right' },
              {
                key: 'b',
                header: t('finance.outstanding'),
                render: (r: any) => money(r.outstanding),
                align: 'right',
              },
              {
                key: 's',
                header: t('common.status'),
                render: (r: any) => (
                  <span className="flex gap-1">
                    <StatusBadge status={r.status === 'issued' ? r.paymentStatus : r.status} />
                    {r.overdue && <StatusBadge status="overdue" />}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get(`/invoices/${id}`) });
  const [discardOpen, setDiscardOpen] = useState(false);
  const [cnOpen, setCnOpen] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['invoice', id] });
  const issue = useMutation({ mutationFn: () => api.post(`/invoices/${id}/issue`), onSuccess: refresh });
  const discard = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/discard`, { reason }),
    onSuccess: () => {
      setDiscardOpen(false);
      refresh();
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const {
    invoice: inv,
    lines,
    seller,
    customer,
    allocations,
    creditNotes,
    outstanding,
    orderNumber,
  } = q.data;
  const ne = i18n.language === 'ne';
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {inv.invoiceNumber ?? t('finance.draftInvoice')} <StatusBadge status={inv.status} />
          </span>
        }
        actions={
          <>
            {inv.status === 'draft' && can('invoices.manage') && (
              <>
                <Button loading={issue.isPending} onClick={() => issue.mutate()}>
                  {t('finance.issueInvoice')}
                </Button>
                <Button variant="secondary" onClick={() => setDiscardOpen(true)}>
                  {t('finance.discard')}
                </Button>
              </>
            )}
            {inv.status === 'issued' && can('invoices.manage') && (
              <Button variant="secondary" onClick={() => setCnOpen(true)}>
                {t('finance.creditNote')}
              </Button>
            )}
            {inv.status === 'issued' && can('payments.record') && (
              <Link to={`/payments/new?hotelId=${inv.hotelId}&invoiceId=${inv.id}`}>
                <Button variant="secondary">{t('finance.recordPayment')}</Button>
              </Link>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              {t('common.print')}
            </Button>
          </>
        }
      />
      <ErrorBox error={issue.error} />
      {inv.status === 'draft' && <Notice tone="warn">{t('finance.draftNote')}</Notice>}
      <article className="print-page mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="flex flex-wrap justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-lg font-bold">{seller.legalName}</div>
            {seller.tradeName && <div className="text-sm">{seller.tradeName}</div>}
            <div className="text-sm">{seller.address}</div>
            <div className="text-sm">
              {seller.phone} {seller.email && `· ${seller.email}`}
            </div>
            <div className="text-sm">
              {t('finance.pan')}: {seller.pan ?? '—'}{' '}
              {seller.vatNumber && `· ${t('finance.vatNo')}: ${seller.vatNumber}`}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold">
              {inv.status === 'issued' ? t('finance.taxInvoice') : t('finance.draftInvoice')}
            </div>
            <div className="text-sm">
              {t('finance.invoiceNo')}: <b>{inv.invoiceNumber ?? '—'}</b>
            </div>
            <div className="text-sm">
              {t('common.date')}: {date(inv.invoiceDate)}
            </div>
            <div className="text-sm">
              {t('finance.dueDate')}: {date(inv.dueDate)}
            </div>
            <div className="text-sm">
              {t('finance.fiscalYear')}: {inv.fiscalYear ?? '—'}
            </div>
            {orderNumber && (
              <div className="text-sm">
                {t('orders.order')}: {orderNumber}
              </div>
            )}
          </div>
        </header>
        <section className="border-b py-3 text-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase">{t('finance.billTo')}</div>
          <div className="font-semibold">{customer.legalName}</div>
          <div>
            {customer.address}
            {customer.city ? `, ${customer.city}` : ''}
          </div>
          <div>
            {t('finance.pan')}: {customer.pan ?? '—'}{' '}
            {customer.vatNumber && `· ${t('finance.vatNo')}: ${customer.vatNumber}`}
          </div>
        </section>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">#</th>
              <th className="py-1">{t('common.description')}</th>
              <th className="py-1 text-right">{t('common.quantity')}</th>
              <th className="py-1">{t('common.unit')}</th>
              <th className="py-1 text-right">{t('common.unitPrice')}</th>
              <th className="py-1 text-right">{t('finance.taxable')}</th>
              <th className="py-1 text-right">{t('finance.vat')}</th>
              <th className="py-1 text-right">{t('common.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-1">{l.lineNo}</td>
                <td className="py-1">
                  {ne && l.descriptionNe ? l.descriptionNe : l.descriptionEn}
                  {l.taxCode !== 'VAT13' && (
                    <span className="ml-1 text-xs text-slate-500">({l.taxCode})</span>
                  )}
                </td>
                <td className="py-1 text-right tabular-nums">{qty(l.quantity)}</td>
                <td className="py-1">{t(`units.${l.unit}`, { defaultValue: l.unit })}</td>
                <td className="py-1 text-right tabular-nums">{money(l.unitPrice, false)}</td>
                <td className="py-1 text-right tabular-nums">{money(l.taxableAmount, false)}</td>
                <td className="py-1 text-right tabular-nums">{money(l.taxAmount, false)}</td>
                <td className="py-1 text-right tabular-nums">{money(l.lineTotal, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span>{t('finance.taxableTotal')}</span>
            <span className="tabular-nums">{money(inv.taxableTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('finance.exemptTotal')}</span>
            <span className="tabular-nums">{money(inv.exemptTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('finance.vat')}</span>
            <span className="tabular-nums">{money(inv.taxTotal)}</span>
          </div>
          <div className="flex justify-between border-t pt-1 text-base font-bold">
            <span>{t('common.total')}</span>
            <span className="tabular-nums">{money(inv.total)}</span>
          </div>
          {outstanding !== null && (
            <div className="flex justify-between text-slate-600">
              <span>{t('finance.outstanding')}</span>
              <span className="tabular-nums">{money(outstanding)}</span>
            </div>
          )}
        </div>
        {seller.footer && <p className="mt-6 border-t pt-2 text-xs text-slate-500">{seller.footer}</p>}
        <p className="mt-2 text-xs text-slate-400">{t('finance.complianceNote')}</p>
      </article>
      {(allocations.length > 0 || creditNotes.length > 0) && (
        <Card title={t('finance.paymentsAndCredits')} className="no-print">
          <ul className="divide-y text-sm">
            {allocations.map((a: any) => (
              <li key={a.id} className="flex justify-between py-2">
                <span>
                  {a.paymentNumber} · {t(`methods.${a.method}`)} {a.reference} · {date(a.paymentDate)}
                </span>
                <span className="tabular-nums">{money(a.amount)}</span>
              </li>
            ))}
            {creditNotes.map((c: any) => (
              <li key={c.id} className="flex justify-between py-2">
                <span>
                  {t('finance.creditNote')} {c.creditNoteNumber ?? t('status.draft')} · {c.reason}{' '}
                  <StatusBadge status={c.status} />
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  {money(c.total)}
                  {c.status === 'draft' && can('invoices.manage') && <IssueCn id={c.id} onDone={refresh} />}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal
        open={discardOpen}
        title={t('finance.discard')}
        onClose={() => setDiscardOpen(false)}
        footer={
          <Button
            variant="danger"
            disabled={reason.length < 3}
            loading={discard.isPending}
            onClick={() => discard.mutate()}
          >
            {t('finance.discard')}
          </Button>
        }
      >
        <Field label={t('common.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={discard.error} />
      </Modal>
      {cnOpen && (
        <CreditNoteModal
          invoiceId={id!}
          lines={lines}
          onClose={() => {
            setCnOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function IssueCn({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useTranslation();
  const m = useMutation({ mutationFn: () => api.post(`/credit-notes/${id}/issue`), onSuccess: onDone });
  return (
    <Button size="sm" loading={m.isPending} onClick={() => m.mutate()}>
      {t('finance.issue')}
    </Button>
  );
}

function CreditNoteModal({
  invoiceId,
  lines,
  onClose,
}: {
  invoiceId: string;
  lines: any[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [q, setQ] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () =>
      api.post('/credit-notes', {
        invoiceId,
        reason,
        lines: Object.entries(q)
          .filter(([, v]) => Number(v) > 0)
          .map(([invoiceLineId, quantity]) => ({ invoiceLineId, quantity })),
      }),
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      title={t('finance.creditNote')}
      onClose={onClose}
      footer={
        <Button
          disabled={reason.length < 3 || !Object.values(q).some((v) => Number(v) > 0)}
          loading={m.isPending}
          onClick={() => m.mutate()}
        >
          {t('finance.createDraft')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Notice>{t('finance.creditNoteNote')}</Notice>
        {lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {l.descriptionEn} (≤ {qty(l.quantity)})
            </span>
            <Input
              className="w-24"
              inputMode="decimal"
              value={q[l.id] ?? ''}
              onChange={(e) => setQ({ ...q, [l.id]: e.target.value })}
              aria-label={t('common.quantity')}
            />
          </div>
        ))}
        <Field label={t('common.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

/** Hotel account statement (hotel managers see their own; staff pass ?hotelId). */
export function StatementPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const hotelId = me?.user.hotelId ?? params.get('hotelId') ?? '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const summary = useQuery({
    queryKey: ['fin-summary', hotelId],
    queryFn: () => api.get(`/finance/hotels/${hotelId}/summary`),
    enabled: !!hotelId,
  });
  const st = useQuery({
    queryKey: ['statement', hotelId, from, to],
    queryFn: () => api.get(`/finance/hotels/${hotelId}/statement${qs({ from, to })}`),
    enabled: !!hotelId,
  });
  const s = summary.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.statement')}
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            {t('common.print')}
          </Button>
        }
      />
      <ErrorBox error={summary.error ?? st.error} />
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('finance.balance')} value={money(s.balance)} />
          <Stat label={t('finance.creditLimit')} value={money(s.creditLimit)} />
          <Stat
            label={t('finance.availableCredit')}
            value={money(s.availableCredit)}
            tone={Number(s.availableCredit) < 0 ? 'warn' : 'good'}
          />
          <Stat
            label={t('finance.overdue')}
            value={money(s.overdue.amount)}
            tone={s.overdue.count ? 'warn' : undefined}
          />
        </div>
      )}
      {s && <p className="text-sm text-slate-600">{t('finance.termsLine', { days: s.paymentTermsDays })}</p>}
      <div className="no-print flex flex-wrap gap-2">
        <Field label={t('common.from')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('common.to')}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {st.data && (
        <Card>
          <div className="mb-2 text-sm">
            {t('finance.opening')}: <b className="tabular-nums">{money(st.data.opening)}</b>
          </div>
          <Table
            rows={st.data.entries}
            rowKey={(r: any) => String(r.id)}
            columns={[
              { key: 'd', header: t('common.date'), render: (r: any) => date(r.date) },
              { key: 'k', header: t('common.type'), render: (r: any) => t(`ledger.${r.sourceType}`) },
              {
                key: 'r',
                header: t('finance.reference'),
                render: (r: any) =>
                  r.sourceType === 'invoice' ? (
                    <Link className="text-brand-700 hover:underline" to={`/invoices/${r.sourceId}`}>
                      {r.reference}
                    </Link>
                  ) : (
                    r.reference
                  ),
              },
              {
                key: 'dr',
                header: t('finance.debit'),
                render: (r: any) => (Number(r.debit) ? money(r.debit, false) : ''),
                align: 'right',
              },
              {
                key: 'cr',
                header: t('finance.credit'),
                render: (r: any) => (Number(r.credit) ? money(r.credit, false) : ''),
                align: 'right',
              },
              {
                key: 'b',
                header: t('finance.balance'),
                render: (r: any) => money(r.balance, false),
                align: 'right',
              },
            ]}
          />
          <div className="mt-2 text-right text-sm">
            {t('finance.closing')}: <b className="tabular-nums">{money(st.data.closing)}</b>
          </div>
        </Card>
      )}
    </div>
  );
}

export function PaymentsPage() {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['payments', direction],
    queryFn: () => api.get(`/payments${qs({ direction })}`),
  });
  const [reverse, setReverse] = useState<any>(null);
  const [reason, setReason] = useState('');
  const rev = useMutation({
    mutationFn: () => api.post(`/payments/${reverse.id}/reverse`, { reason }),
    onSuccess: () => {
      setReverse(null);
      void qc.invalidateQueries({ queryKey: ['payments'] });
    },
  });
  return (
    <div>
      <PageHeader
        title={t('nav.payments')}
        actions={
          <Link to={`/payments/new?direction=${direction}`}>
            <Button>{t('finance.recordPayment')}</Button>
          </Link>
        }
      />
      <Select
        value={direction}
        onChange={(e) => setDirection(e.target.value as never)}
        className="mb-3 max-w-xs"
        aria-label={t('finance.direction')}
      >
        <option value="inbound">{t('finance.fromHotels')}</option>
        <option value="outbound">{t('finance.toSuppliers')}</option>
      </Select>
      <ErrorBox error={q.error} />
      <Card>
        <Table
          rows={q.data?.items ?? []}
          rowKey={(r: any) => r.id}
          columns={[
            { key: 'n', header: t('finance.paymentNo'), render: (r: any) => r.paymentNumber },
            { key: 'd', header: t('common.date'), render: (r: any) => date(r.paymentDate) },
            { key: 'p', header: t('finance.party'), render: (r: any) => r.hotelName ?? r.supplierName },
            {
              key: 'm',
              header: t('finance.method'),
              render: (r: any) => `${t(`methods.${r.method}`)} ${r.reference ?? ''}`,
            },
            { key: 'a', header: t('common.amount'), render: (r: any) => money(r.amount), align: 'right' },
            {
              key: 'u',
              header: t('finance.unallocated'),
              render: (r: any) => money(r.unallocated),
              align: 'right',
            },
            { key: 's', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
            {
              key: 'x',
              header: '',
              render: (r: any) =>
                can('payments.reverse') &&
                r.status === 'recorded' && (
                  <Button size="sm" variant="ghost" onClick={() => setReverse(r)}>
                    {t('finance.reverse')}
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <Modal
        open={!!reverse}
        title={t('finance.reverse')}
        onClose={() => setReverse(null)}
        footer={
          <Button
            variant="danger"
            disabled={reason.length < 5}
            loading={rev.isPending}
            onClick={() => rev.mutate()}
          >
            {t('finance.reverse')}
          </Button>
        }
      >
        <Notice tone="warn">{t('finance.reverseNote')}</Notice>
        <Field label={t('common.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={rev.error} />
      </Modal>
    </div>
  );
}

export function RecordPaymentPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [direction, setDirection] = useState<'inbound' | 'outbound'>(
    (params.get('direction') as never) ?? 'inbound',
  );
  const [partyId, setPartyId] = useState(params.get('hotelId') ?? params.get('supplierId') ?? '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayNepal());
  const [notes, setNotes] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>(
    params.get('invoiceId') ? { [params.get('invoiceId')!]: '' } : {},
  );
  const [key] = useState(() => newId());
  const hotels = useQuery({
    queryKey: ['hotels'],
    queryFn: () => api.get('/hotels'),
    enabled: direction === 'inbound',
  });
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
    enabled: direction === 'outbound',
  });
  const docs = useQuery({
    queryKey: ['open-docs', direction, partyId],
    queryFn: () =>
      direction === 'inbound'
        ? api.get(`/invoices${qs({ hotelId: partyId, status: 'issued' })}`)
        : api.get(`/supplier-bills${qs({ supplierId: partyId, status: 'posted' })}`),
    enabled: !!partyId,
  });
  const open = (docs.data?.items ?? []).filter((d: any) => Number(d.outstanding) > 0);
  const allocated = Object.values(alloc).reduce((s, v) => s + Number(v || 0), 0);
  const m = useMutation({
    mutationFn: () =>
      api.post('/payments', {
        direction,
        ...(direction === 'inbound' ? { hotelId: partyId } : { supplierId: partyId }),
        amount,
        method,
        reference: reference || null,
        paymentDate,
        notes: notes || null,
        allocations: Object.entries(alloc)
          .filter(([, v]) => Number(v) > 0)
          .map(([docId, v]) =>
            direction === 'inbound' ? { invoiceId: docId, amount: v } : { billId: docId, amount: v },
          ),
        idempotencyKey: key,
      }),
    onSuccess: () => nav('/payments'),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t('finance.recordPayment')} subtitle={t('finance.recordPaymentNote')} />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('finance.direction')}>
            <Select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as never);
                setPartyId('');
                setAlloc({});
              }}
            >
              <option value="inbound">{t('finance.fromHotel')}</option>
              <option value="outbound">{t('finance.toSupplier')}</option>
            </Select>
          </Field>
          <Field label={direction === 'inbound' ? t('common.hotel') : t('common.supplier')} required>
            <Select
              value={partyId}
              onChange={(e) => {
                setPartyId(e.target.value);
                setAlloc({});
              }}
            >
              <option value="">—</option>
              {(direction === 'inbound' ? hotels.data?.items : suppliers.data?.items)?.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.legalName ?? p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.amount')} required>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('common.date')} required>
            <Input
              type="date"
              max={todayNepal()}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </Field>
          <Field label={t('finance.method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm} value={pm}>
                  {t(`methods.${pm}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('finance.reference')}
            required={method !== 'cash' && method !== 'other'}
            hint={t('finance.referenceHint')}
          >
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label={t('common.note')}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Card>
      {partyId && (
        <Card title={t('finance.allocate')}>
          {open.length === 0 ? (
            <p className="text-sm text-slate-500">{t('finance.nothingOpen')}</p>
          ) : (
            <ul className="divide-y text-sm">
              {open.map((d: any) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {d.invoiceNumber ?? d.supplierBillNumber} · {t('finance.dueDate')} {date(d.dueDate)} ·{' '}
                    {t('finance.outstanding')} <b>{money(d.outstanding)}</b>
                  </span>
                  <span className="flex gap-1">
                    <Input
                      className="w-28"
                      inputMode="decimal"
                      value={alloc[d.id] ?? ''}
                      onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })}
                      aria-label={t('common.amount')}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAlloc({ ...alloc, [d.id]: d.outstanding })}
                    >
                      {t('finance.full')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm">
            {t('finance.allocatedOf', { allocated: money(allocated), amount: money(amount || 0) })}
          </p>
          {allocated > Number(amount || 0) && <Notice tone="error">{t('finance.overAllocated')}</Notice>}
        </Card>
      )}
      <ErrorBox error={m.error} />
      <Button
        size="lg"
        disabled={!partyId || !(Number(amount) > 0) || allocated > Number(amount || 0)}
        loading={m.isPending}
        onClick={() => m.mutate()}
      >
        {t('finance.savePayment')}
      </Button>
    </div>
  );
}

export function BillsPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['bills'], queryFn: () => api.get('/supplier-bills') });
  return (
    <div>
      <PageHeader
        title={t('nav.bills')}
        actions={
          <Link to="/bills/new">
            <Button>{t('finance.newBill')}</Button>
          </Link>
        }
      />
      <ErrorBox error={q.error} />
      <Card>
        <Table
          rows={q.data?.items ?? []}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => nav(`/bills/${r.id}`)}
          columns={[
            { key: 'r', header: t('finance.internalRef'), render: (r: any) => r.internalRef },
            { key: 's', header: t('common.supplier'), render: (r: any) => r.supplierName },
            { key: 'n', header: t('finance.supplierBillNo'), render: (r: any) => r.supplierBillNumber },
            { key: 'p', header: 'PO', render: (r: any) => r.poNumber },
            {
              key: 'd',
              header: t('finance.dueDate'),
              render: (r: any) => (
                <span className={r.overdue ? 'font-semibold text-red-700' : ''}>{date(r.dueDate)}</span>
              ),
            },
            { key: 't', header: t('common.total'), render: (r: any) => money(r.total), align: 'right' },
            {
              key: 'o',
              header: t('finance.outstanding'),
              render: (r: any) => money(r.outstanding),
              align: 'right',
            },
            { key: 'st', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </div>
  );
}

export function NewBillPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [supplierId, setSupplierId] = useState(params.get('supplierId') ?? '');
  const [poId, setPoId] = useState(params.get('poId') ?? '');
  const [number, setNumber] = useState('');
  const [billDate, setBillDate] = useState(todayNepal());
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers') });
  const pos = useQuery({
    queryKey: ['pos', supplierId],
    queryFn: () => api.get(`/purchase-orders${qs({ supplierId })}`),
    enabled: !!supplierId,
  });
  const m = useMutation({
    mutationFn: () =>
      api.post('/supplier-bills', { supplierId, poId: poId || null, supplierBillNumber: number, billDate }),
    onSuccess: (r) => nav(`/bills/${r.bill.id}`),
  });
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={t('finance.newBill')} />
      <Card>
        <div className="space-y-3">
          <Field label={t('common.supplier')} required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.data?.items.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('nav.purchaseOrders')} hint={t('finance.billFromPoHint')} required>
            <Select value={poId} onChange={(e) => setPoId(e.target.value)}>
              <option value="">—</option>
              {pos.data?.items
                .filter((p: any) => ['partially_received', 'received', 'closed'].includes(p.status))
                .map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.poNumber} · {money(p.total)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('finance.supplierBillNo')} required>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field label={t('finance.billDate')} required>
            <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </Field>
          <ErrorBox error={m.error} />
          <Button disabled={!supplierId || !poId || !number} loading={m.isPending} onClick={() => m.mutate()}>
            {t('finance.createDraft')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function BillDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bill', id], queryFn: () => api.get(`/supplier-bills/${id}`) });
  const post = useMutation({
    mutationFn: () => api.post(`/supplier-bills/${id}/post`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bill', id] }),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { bill, lines, outstanding, allocations, supplierName } = q.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {bill.internalRef} <StatusBadge status={bill.status} />
          </span>
        }
        subtitle={`${supplierName} · ${bill.supplierBillNumber}`}
        actions={
          <>
            {bill.status === 'draft' && (
              <Button loading={post.isPending} onClick={() => post.mutate()}>
                {t('finance.postBill')}
              </Button>
            )}
            {bill.status === 'posted' && (
              <Link to={`/payments/new?direction=outbound&supplierId=${bill.supplierId}`}>
                <Button variant="secondary">{t('finance.recordPayment')}</Button>
              </Link>
            )}
          </>
        }
      />
      <ErrorBox error={post.error} />
      {bill.status === 'draft' && <Notice tone="warn">{t('finance.billDraftNote')}</Notice>}
      <Card>
        <DL
          items={[
            [t('finance.billDate'), date(bill.billDate)],
            [t('finance.dueDate'), date(bill.dueDate)],
            [t('finance.taxable'), money(bill.taxableTotal)],
            [t('finance.vat'), money(bill.taxTotal)],
            [t('common.total'), money(bill.total)],
            [t('finance.outstanding'), money(outstanding)],
          ]}
        />
      </Card>
      <Card title={t('orders.items')}>
        <Table
          rows={lines}
          rowKey={(l: any) => l.id}
          columns={[
            { key: 'd', header: t('common.description'), render: (l: any) => l.description },
            { key: 'q', header: t('common.quantity'), render: (l: any) => qty(l.quantity), align: 'right' },
            {
              key: 'c',
              header: t('procurement.unitCost'),
              render: (l: any) => money(l.unitCost),
              align: 'right',
            },
            { key: 't', header: t('common.amount'), render: (l: any) => money(l.lineTotal), align: 'right' },
          ]}
        />
      </Card>
      {allocations.length > 0 && (
        <Card title={t('nav.payments')}>
          <ul className="divide-y text-sm">
            {allocations.map((a: any) => (
              <li key={a.id} className="flex justify-between py-2">
                <span>
                  {a.paymentNumber} · {t(`methods.${a.method}`)} {a.reference}
                </span>
                <span className="tabular-nums">{money(a.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
