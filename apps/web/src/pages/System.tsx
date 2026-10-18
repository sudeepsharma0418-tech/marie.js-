import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ROLES, isHotelRole } from '@hp/shared';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, money } from '../lib/format';
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
import { LanguageSwitch } from '../components/Layout';
import { InviteLink } from './Admin';

/* ----------------------------------- users ---------------------------------- */

export function UsersPage() {
  const { t } = useTranslation();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const internalAdmin = can('users.manage_internal');
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api.get('/users/invitations') });
  const hotels = useQuery({
    queryKey: ['hotels'],
    queryFn: () => api.get('/hotels'),
    enabled: internalAdmin,
  });
  const [inv, setInv] = useState<{ name: string; email: string; role: string; hotelId: string } | null>(null);
  const [url, setUrl] = useState('');
  const roles = internalAdmin ? ROLES : (['hotel_purchaser', 'hotel_inventory'] as const);
  const send = useMutation({
    mutationFn: () =>
      api.post('/users/invitations', {
        ...inv,
        hotelId: inv && isHotelRole(inv.role as never) ? inv.hotelId || null : null,
      }),
    onSuccess: (r) => {
      setUrl(r.inviteUrl);
      void invites.refetch();
    },
  });
  const toggle = useMutation({
    mutationFn: (u: any) => api.patch(`/users/${u.id}`, { isActive: !u.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.users')}
        actions={
          <Button
            onClick={() => {
              setInv({ name: '', email: '', role: roles[0]!, hotelId: '' });
              setUrl('');
            }}
          >
            {t('users.invite')}
          </Button>
        }
      />
      <ErrorBox error={users.error ?? toggle.error} />
      <Card>
        <Table
          rows={users.data?.items ?? []}
          rowKey={(u: any) => u.id}
          columns={[
            {
              key: 'n',
              header: t('common.name'),
              render: (u: any) => (
                <div>
                  {u.name}
                  <div className="text-xs text-slate-500">{u.email}</div>
                </div>
              ),
            },
            { key: 'r', header: t('users.role'), render: (u: any) => t(`roles.${u.role}`) },
            ...(internalAdmin
              ? [
                  {
                    key: 'h',
                    header: t('common.hotel'),
                    render: (u: any) => u.hotelName ?? t('users.internal'),
                  },
                ]
              : []),
            { key: 'm', header: 'MFA', render: (u: any) => (u.mfaEnabled ? '✓' : '—') },
            { key: 'l', header: t('users.lastLogin'), render: (u: any) => dateTime(u.lastLoginAt) },
            {
              key: 's',
              header: t('common.status'),
              render: (u: any) => <StatusBadge status={u.isActive ? 'active' : 'cancelled'} />,
            },
            {
              key: 'x',
              header: '',
              render: (u: any) =>
                u.id !== me?.user.id && (
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(u)}>
                    {u.isActive ? t('users.deactivate') : t('users.activate')}
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      {invites.data?.items.length > 0 && (
        <Card title={t('users.pendingInvites')}>
          <ul className="divide-y text-sm">
            {invites.data.items.map((i: any) => (
              <li key={i.id} className="flex justify-between py-2">
                <span>
                  {i.name} · {i.email} · {t(`roles.${i.role}`)}
                </span>
                <span className="text-slate-500">
                  {t('users.expires')} {date(i.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal
        open={!!inv}
        title={t('users.invite')}
        onClose={() => setInv(null)}
        footer={
          !url && (
            <Button
              disabled={!inv?.name || !inv?.email}
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              {t('users.sendInvite')}
            </Button>
          )
        }
      >
        {inv &&
          (url ? (
            <InviteLink url={url} />
          ) : (
            <div className="space-y-3">
              <Field label={t('common.name')} required>
                <Input value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} />
              </Field>
              <Field label={t('auth.email')} required>
                <Input
                  type="email"
                  value={inv.email}
                  onChange={(e) => setInv({ ...inv, email: e.target.value })}
                />
              </Field>
              <Field label={t('users.role')}>
                <Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {internalAdmin && isHotelRole(inv.role as never) && (
                <Field label={t('common.hotel')} required>
                  <Select value={inv.hotelId} onChange={(e) => setInv({ ...inv, hotelId: e.target.value })}>
                    <option value="">—</option>
                    {hotels.data?.items.map((h: any) => (
                      <option key={h.id} value={h.id}>
                        {h.legalName}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <ErrorBox error={send.error} />
            </div>
          ))}
      </Modal>
    </div>
  );
}

/* --------------------------------- settings --------------------------------- */

export function SettingsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  const taxes = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get('/tax-rates') });
  const series = useQuery({ queryKey: ['series'], queryFn: () => api.get('/document-series') });
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [tax, setTax] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (q.data && !form) setForm(q.data.settings);
  }, [q.data, form]);
  const save = useMutation({
    mutationFn: () => {
      const { id: _i, updatedAt: _u, updatedBy: _b, currency: _c, timezone: _z, ...rest } = form!;
      return api.patch('/settings', rest);
    },
    onSuccess: (r) => setForm(r.settings),
  });
  const saveTax = useMutation({
    mutationFn: () =>
      api.put(`/tax-rates/${tax!.code}`, {
        name: tax!.name,
        ratePercent: tax!.ratePercent,
        isActive: tax!.isActive,
        requiresVerification: tax!.requiresVerification,
        notes: tax!.notes,
      }),
    onSuccess: () => {
      setTax(null);
      void taxes.refetch();
    },
  });
  if (q.isLoading || !form) return <Spinner />;
  const f = (k: string, label: string, type = 'text', hint?: string) => (
    <Field label={label} hint={hint}>
      {type === 'checkbox' ? (
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={!!form[k]}
          onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
        />
      ) : (
        <Input
          type={type}
          value={form[k] ?? ''}
          onChange={(e) =>
            setForm({ ...form, [k]: type === 'number' ? Number(e.target.value) : e.target.value })
          }
        />
      )}
    </Field>
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.settings')}
        actions={
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        }
      />
      <ErrorBox error={save.error} />
      {save.isSuccess && <Notice tone="success">{t('settings.saved')}</Notice>}
      <Card title={t('settings.company')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f('legalName', t('hotels.legalName'))}
          {f('tradeName', t('hotels.tradeName'))}
          {f('pan', t('finance.pan'))}
          {f('vatNumber', t('finance.vatNo'))}
          {f('vatRegistered', t('settings.vatRegistered'), 'checkbox')}
          {f('address', t('common.address'))}
          {f('phone', t('common.phone'))}
          {f('email', t('auth.email'))}
          {f('fiscalYearLabel', t('finance.fiscalYear'), 'text', t('settings.fiscalYearHint'))}
          <div className="sm:col-span-2">
            <Field label={t('settings.invoiceFooter')}>
              <Textarea
                value={form.invoiceFooter ?? ''}
                onChange={(e) => setForm({ ...form, invoiceFooter: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Card>
      <Card title={t('settings.controls')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f('defaultMarkupPercent', t('settings.defaultMarkup'))}
          {f('defaultPaymentTermsDays', t('settings.defaultTerms'), 'number')}
          {f('poApprovalThreshold', t('settings.poThreshold'), 'text', t('settings.zeroMeansAll'))}
          {f('priceOverrideThresholdPercent', t('settings.priceOverrideThreshold'))}
          {f(
            'writeOffApprovalThreshold',
            t('settings.writeOffThreshold'),
            'text',
            t('settings.zeroMeansAll'),
          )}
          {f('creditOverdueGraceDays', t('settings.graceDays'), 'number')}
          <Field label={t('settings.invoiceTrigger')}>
            <Select
              value={form.invoiceTrigger}
              onChange={(e) => setForm({ ...form, invoiceTrigger: e.target.value })}
            >
              <option value="on_delivery">{t('settings.onDelivery')}</option>
              <option value="manual">{t('settings.manual')}</option>
            </Select>
          </Field>
          {f('allowOwnerSelfApproval', t('settings.ownerSelfApproval'), 'checkbox')}
        </div>
      </Card>
      <Card title={t('settings.security')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f('mfaEnforced', t('settings.mfaEnforced'), 'checkbox')}
          {f('sessionHours', t('settings.sessionHours'), 'number')}
          {f('offlineAccessHours', t('settings.offlineHours'), 'number', t('settings.offlineHoursHint'))}
        </div>
      </Card>
      <Card
        title={t('settings.taxRates')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setTax({
                code: '',
                name: '',
                ratePercent: '0',
                isActive: true,
                requiresVerification: true,
                notes: '',
              })
            }
          >
            {t('common.add')}
          </Button>
        }
      >
        <Notice tone="warn">{t('settings.taxWarning')}</Notice>
        <div className="mt-3">
          <Table
            rows={taxes.data?.items ?? []}
            rowKey={(r: any) => r.code}
            onRowClick={(r: any) => setTax(r)}
            columns={[
              { key: 'c', header: t('common.code'), render: (r: any) => r.code },
              { key: 'n', header: t('common.name'), render: (r: any) => r.name },
              { key: 'r', header: '%', render: (r: any) => Number(r.ratePercent), align: 'right' },
              {
                key: 'v',
                header: t('settings.verified'),
                render: (r: any) =>
                  r.requiresVerification ? (
                    <span className="text-amber-700">⚠ {t('settings.needsVerification')}</span>
                  ) : (
                    '✓'
                  ),
              },
              {
                key: 'a',
                header: t('common.status'),
                render: (r: any) => <StatusBadge status={r.isActive ? 'active' : 'cancelled'} />,
              },
            ]}
          />
        </div>
      </Card>
      <Card title={t('settings.numbering')}>
        <Table
          rows={series.data?.items ?? []}
          rowKey={(r: any) => r.id}
          columns={[
            { key: 't', header: t('common.type'), render: (r: any) => r.docType },
            { key: 'f', header: t('finance.fiscalYear'), render: (r: any) => r.fiscalYear },
            { key: 'p', header: t('settings.prefix'), render: (r: any) => r.prefix },
            { key: 'n', header: t('settings.nextNumber'), render: (r: any) => r.nextNumber, align: 'right' },
          ]}
        />
        <p className="mt-2 text-xs text-slate-500">{t('settings.numberingNote')}</p>
      </Card>
      <Modal
        open={!!tax}
        title={t('settings.taxRates')}
        onClose={() => setTax(null)}
        footer={
          <Button loading={saveTax.isPending} onClick={() => saveTax.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        {tax && (
          <div className="space-y-3">
            <Field label={t('common.code')}>
              <Input
                value={tax.code}
                onChange={(e) => setTax({ ...tax, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t('common.name')}>
              <Input value={tax.name} onChange={(e) => setTax({ ...tax, name: e.target.value })} />
            </Field>
            <Field label="%">
              <Input
                value={tax.ratePercent}
                onChange={(e) => setTax({ ...tax, ratePercent: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tax.requiresVerification}
                onChange={(e) => setTax({ ...tax, requiresVerification: e.target.checked })}
              />{' '}
              {t('settings.needsVerification')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tax.isActive}
                onChange={(e) => setTax({ ...tax, isActive: e.target.checked })}
              />{' '}
              {t('status.active')}
            </label>
            <Field label={t('common.note')}>
              <Textarea value={tax.notes ?? ''} onChange={(e) => setTax({ ...tax, notes: e.target.value })} />
            </Field>
            <ErrorBox error={saveTax.error} />
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ----------------------------------- audit ---------------------------------- */

export function AuditPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ entityType: '', action: '', from: '', to: '' });
  const q = useQuery({
    queryKey: ['audit', filters],
    queryFn: () => api.get(`/audit${qs({ ...filters, limit: 200 })}`),
  });
  const verify = useMutation({ mutationFn: () => api.get('/audit/verify') });
  const [detail, setDetail] = useState<any>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.audit')}
        subtitle={t('audit.subtitle')}
        actions={
          <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
            {t('audit.verify')}
          </Button>
        }
      />
      {verify.data && (
        <Notice tone={verify.data.ok ? 'success' : 'error'}>
          {verify.data.ok
            ? t('audit.chainOk', { count: verify.data.checked })
            : t('audit.chainBroken', { id: verify.data.brokenAtId })}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input
          placeholder={t('audit.entityType')}
          value={filters.entityType}
          onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
        />
        <Input
          placeholder={t('audit.action')}
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        />
        <Input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          aria-label={t('common.from')}
        />
        <Input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          aria-label={t('common.to')}
        />
      </div>
      <Card>
        <Table
          rows={q.data?.items ?? []}
          rowKey={(r: any) => String(r.id)}
          onRowClick={setDetail}
          columns={[
            { key: 't', header: t('common.date'), render: (r: any) => dateTime(r.occurredAt) },
            {
              key: 'a',
              header: t('audit.action'),
              render: (r: any) => <code className="text-xs">{r.action}</code>,
            },
            {
              key: 'e',
              header: t('audit.entity'),
              render: (r: any) => `${r.entityType} ${r.entityId?.slice(0, 8) ?? ''}`,
            },
            { key: 'u', header: t('common.user'), render: (r: any) => r.actorName ?? t('audit.system') },
            { key: 'r', header: t('common.reason'), render: (r: any) => r.reason },
          ]}
        />
      </Card>
      <Modal open={!!detail} title={detail?.action ?? ''} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-2 text-xs">
            <DL
              items={[
                [t('common.date'), dateTime(detail.occurredAt)],
                [t('common.user'), detail.actorName],
                ['IP', detail.ip],
                [t('audit.entity'), `${detail.entityType} ${detail.entityId}`],
                [
                  'hash',
                  <code key="h" className="break-all">
                    {detail.hash.slice(0, 24)}…
                  </code>,
                ],
              ]}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <pre className="overflow-auto rounded bg-slate-50 p-2">
                {JSON.stringify(detail.before, null, 2)}
              </pre>
              <pre className="overflow-auto rounded bg-slate-50 p-2">
                {JSON.stringify(detail.after, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------------------------------- reports --------------------------------- */

const REPORTS: {
  key: string;
  path: string;
  perms: string[];
  csv?: boolean;
  params?: Record<string, string>;
}[] = [
  { key: 'sales', path: '/reports/sales', perms: ['reports.business', 'reports.own_hotel'], csv: true },
  {
    key: 'salesMonthly',
    path: '/reports/sales',
    perms: ['reports.business'],
    csv: true,
    params: { groupBy: 'month' },
  },
  { key: 'purchases', path: '/reports/purchases', perms: ['reports.business'], csv: true },
  {
    key: 'marginProduct',
    path: '/reports/margin',
    perms: ['reports.business'],
    csv: true,
    params: { groupBy: 'product' },
  },
  {
    key: 'marginCategory',
    path: '/reports/margin',
    perms: ['reports.business'],
    csv: true,
    params: { groupBy: 'category' },
  },
  {
    key: 'marginHotel',
    path: '/reports/margin',
    perms: ['reports.business'],
    csv: true,
    params: { groupBy: 'hotel' },
  },
  {
    key: 'topProducts',
    path: '/reports/top-products',
    perms: ['reports.business', 'reports.own_hotel'],
    csv: true,
  },
  { key: 'ar', path: '/reports/ar-aging', perms: ['reports.financial', 'reports.own_hotel'], csv: true },
  { key: 'ap', path: '/reports/ap-aging', perms: ['reports.financial'], csv: true },
  { key: 'credit', path: '/reports/credit-utilization', perms: ['reports.financial'], csv: true },
  {
    key: 'collections',
    path: '/reports/collections',
    perms: ['reports.financial', 'reports.own_hotel'],
    csv: true,
  },
  {
    key: 'supplierPayments',
    path: '/reports/collections',
    perms: ['reports.financial'],
    csv: true,
    params: { direction: 'outbound' },
  },
  { key: 'reconciliation', path: '/reports/reconciliation', perms: ['reports.financial'] },
  {
    key: 'usage',
    path: '/reports/hotel-usage',
    perms: ['reports.inventory', 'reports.own_hotel'],
    csv: true,
  },
  { key: 'discrepancies', path: '/reports/stock-discrepancies', perms: ['reports.inventory'], csv: true },
  { key: 'operations', path: '/reports/operations', perms: ['reports.operations'] },
  { key: 'priceHistory', path: '/reports/price-history', perms: ['reports.business'], csv: true },
];

export function ReportsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const available = REPORTS.filter((r) => can(...(r.perms as never[])));
  const initial = new URLSearchParams(window.location.search).get('tab');
  const [key, setKey] = useState(available.find((r) => r.key === initial)?.key ?? available[0]?.key ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const r = available.find((x) => x.key === key);
  const url = r ? `${r.path}${qs({ ...r.params, from, to })}` : '';
  const q = useQuery({ queryKey: ['report', url], queryFn: () => api.get(url), enabled: !!r });
  const rows: Record<string, unknown>[] = q.data?.rows ?? [];
  const cols = rows[0] ? Object.keys(rows[0]).filter((c) => !c.endsWith('Id')) : [];
  const isMoneyCol = (c: string) =>
    /total|sales|tax|credit|balance|revenue|cost|margin|amount|value|billed|exposure|available|allocated|current|d\d|open_orders|limit/i.test(
      c,
    ) && !/percent|invoices|orders|times|hotels/i.test(c);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.reports')}
        actions={
          r?.csv && (
            <a href={`/api/v1${r.path}${qs({ ...r.params, from, to, format: 'csv' })}`}>
              <Button variant="secondary">{t('reports.exportCsv')}</Button>
            </a>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('reports.report')}>
          <Select value={key} onChange={(e) => setKey(e.target.value)}>
            {available.map((x) => (
              <option key={x.key} value={x.key}>
                {t(`reports.${x.key}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.from')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('common.to')}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {q.isLoading && <Spinner />}
      <ErrorBox error={q.error} />
      {q.data && key === 'reconciliation' && <Reconciliation data={q.data} />}
      {q.data && key === 'operations' && <OperationsReport data={q.data} />}
      {q.data && rows && key !== 'reconciliation' && key !== 'operations' && (
        <Card>
          {(q.data.from || q.data.asOf) && (
            <p className="mb-2 text-xs text-slate-500">
              {q.data.asOf
                ? `${t('reports.asOf')} ${date(q.data.asOf)}`
                : `${date(q.data.from)} – ${date(q.data.to)}`}
            </p>
          )}
          <Table
            rows={rows}
            rowKey={(row) => JSON.stringify(row).slice(0, 200)}
            columns={cols.map((c) => ({
              key: c,
              header: t(`reports.col_${c}`, { defaultValue: c.replace(/_/g, ' ') }),
              render: (row: any) =>
                isMoneyCol(c) && row[c] !== null && !isNaN(Number(row[c]))
                  ? money(row[c], false)
                  : typeof row[c] === 'boolean'
                    ? row[c]
                      ? '⚠'
                      : ''
                    : String(row[c] ?? '—'),
              align: isMoneyCol(c) ? 'right' : undefined,
            }))}
          />
          {q.data.totals && (
            <DL
              items={Object.entries(q.data.totals).map(([k, v]) => [
                t(`reports.col_${k}`, { defaultValue: k }),
                money(v as string),
              ])}
            />
          )}
          {q.data.total !== undefined && (
            <p className="mt-2 text-right text-sm font-semibold">
              {t('common.total')}: {money(q.data.total)}
            </p>
          )}
          {q.data.frequentlyRequested?.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold">{t('reports.frequentlyRequested')}</h3>
              <ul className="text-sm">
                {q.data.frequentlyRequested.map((x: any) => (
                  <li key={x.description}>
                    {x.description} × {x.times}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Reconciliation({ data }: { data: any }) {
  const { t } = useTranslation();
  const block = (title: string, o: any) => (
    <Card
      title={
        <span className="flex items-center gap-2">
          {title}{' '}
          {o.reconciled ? (
            <span className="text-sm text-emerald-700">✓ {t('reports.reconciled')}</span>
          ) : (
            <span className="text-sm text-red-700">✗ {t('reports.notReconciled')}</span>
          )}
        </span>
      }
    >
      <DL
        items={Object.entries(o)
          .filter(([k]) => k !== 'reconciled')
          .map(([k, v]) => [t(`reports.col_${k}`, { defaultValue: k }), money(v as string)])}
      />
    </Card>
  );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {block(t('reports.receivables'), data.receivables)}
      {block(t('reports.payables'), data.payables)}
      <Card title={t('reports.period')}>
        <DL
          items={Object.entries(data.period)
            .filter(([k]) => k !== 'note')
            .map(([k, v]) => [t(`reports.col_${k}`, { defaultValue: k }), money(v as string)])}
        />
        <p className="mt-2 text-xs text-slate-500">{t('reports.periodNote')}</p>
      </Card>
    </div>
  );
}

function OperationsReport({ data }: { data: any }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t('nav.orders')}>
        <DL
          items={[
            [t('reports.col_orders'), data.orders.orders],
            [t('status.delivered'), data.orders.delivered],
            [t('status.cancelled'), data.orders.cancelled],
            [t('reports.avgHours'), data.orders.avg_hours_to_delivery ?? '—'],
          ]}
        />
        <DL items={data.ordersByStatus.map((s: any) => [t(`status.${s.status}`), s.n])} />
      </Card>
      <Card title={t('nav.deliveries')}>
        <DL items={data.deliveries.map((s: any) => [t(`status.${s.status}`), s.n])} />
      </Card>
      <Card title={t('reports.leadTimes')}>
        <DL
          items={data.supplierLeadTimes.map((s: any) => [
            s.supplier,
            `${s.avg_days_to_first_receipt ?? '—'} ${t('reports.days')} (${s.purchase_orders})`,
          ])}
        />
      </Card>
      <Card title={t('reports.syncAndApprovals')}>
        <DL
          items={[
            [t('dashboard.pendingApprovals'), data.pendingApprovals.n],
            [t('status.needs_review'), data.offlineSync.needs_review],
            [t('status.rejected'), data.offlineSync.rejected],
            [t('reports.offlineEvents'), data.offlineSync.offline_events],
          ]}
        />
      </Card>
    </div>
  );
}

/* ---------------------------------- profile --------------------------------- */

export function ProfilePage() {
  const { t } = useTranslation();
  const { me, refresh } = useAuth();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [mfa, setMfa] = useState<{ secret: string; otpauthUrl: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get('/auth/sessions') });
  const change = useMutation({
    mutationFn: () => api.post('/auth/password/change', { currentPassword: cur, newPassword: pw }),
    onSuccess: () => {
      setCur('');
      setPw('');
    },
  });
  const setup = useMutation({
    mutationFn: () => api.post('/auth/mfa/setup'),
    onSuccess: async (r) =>
      setMfa({ ...r, qr: await QRCode.toDataURL(r.otpauthUrl, { width: 200, margin: 1 }) }),
  });
  const enable = useMutation({
    mutationFn: () => api.post('/auth/mfa/enable', { code }),
    onSuccess: () => {
      setMfa(null);
      void refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/auth/sessions/${id}/revoke`),
    onSuccess: () => void sessions.refetch(),
  });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={t('profile.title')}
        subtitle={`${me?.user.name} · ${me?.user.email} · ${t(`roles.${me?.user.role}`)}`}
      />
      <Card title={t('common.language')}>
        <LanguageSwitch />
      </Card>
      <Card title={t('profile.mfa')}>
        {me?.user.mfaEnabled ? (
          <Notice tone="success">{t('profile.mfaOn')}</Notice>
        ) : mfa ? (
          <div className="space-y-3">
            <p className="text-sm">{t('profile.mfaScan')}</p>
            <img src={mfa.qr} alt="MFA QR" className="h-48 w-48" />
            <p className="text-xs break-all text-slate-500">{mfa.secret}</p>
            <Field label={t('auth.mfaCode')}>
              <Input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Button loading={enable.isPending} onClick={() => enable.mutate()}>
              {t('profile.mfaEnable')}
            </Button>
            <ErrorBox error={enable.error} />
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-600">{t('profile.mfaIntro')}</p>
            <Button loading={setup.isPending} onClick={() => setup.mutate()}>
              {t('profile.mfaSetup')}
            </Button>
          </>
        )}
      </Card>
      <Card title={t('profile.password')}>
        <div className="space-y-3">
          <Field label={t('profile.currentPassword')}>
            <Input
              type="password"
              autoComplete="current-password"
              value={cur}
              onChange={(e) => setCur(e.target.value)}
            />
          </Field>
          <Field label={t('auth.newPassword')} hint={t('auth.passwordRule')}>
            <Input
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </Field>
          {change.isSuccess && <Notice tone="success">{t('profile.passwordChanged')}</Notice>}
          <ErrorBox error={change.error} />
          <Button
            disabled={pw.length < 10 || !cur}
            loading={change.isPending}
            onClick={() => change.mutate()}
          >
            {t('profile.changePassword')}
          </Button>
        </div>
      </Card>
      <Card title={t('profile.sessions')}>
        <ul className="divide-y text-sm">
          {sessions.data?.items.map((s: any) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">
                {s.userAgent?.slice(0, 60)} · {s.ip} · {dateTime(s.lastSeenAt)}{' '}
                {s.current && <b>({t('profile.thisDevice')})</b>}
              </span>
              {!s.current && (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  {t('profile.signOut')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/notifications') });
  const read = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const all = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t('nav.notifications')}
        actions={
          <Button variant="secondary" onClick={() => all.mutate()}>
            {t('notifications.markAll')}
          </Button>
        }
      />
      {q.data?.items.length === 0 && <Notice>{t('notifications.none')}</Notice>}
      <ul className="space-y-2">
        {q.data?.items.map((n: any) => (
          <li key={n.id}>
            <button
              onClick={() => {
                read.mutate(n.id);
                if (n.link) nav(n.link);
              }}
              className={cx(
                'w-full rounded-xl border bg-white p-3 text-left shadow-sm',
                !n.readAt && 'border-brand-600',
              )}
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium">{n.title}</span>
                <span className="text-xs text-slate-500">{dateTime(n.createdAt)}</span>
              </div>
              {n.body && <div className="text-sm text-slate-600">{n.body}</div>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">{t('errors.pageNotFound')}</h1>
      <Link to="/" className="mt-4 inline-block text-brand-700 hover:underline">
        {t('nav.dashboard')}
      </Link>
    </div>
  );
}
