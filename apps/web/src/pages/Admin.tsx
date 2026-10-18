import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, money, nameOf } from '../lib/format';
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
  StatusBadge,
  Table,
  Textarea,
} from '../components/ui';

type Form = Record<string, any>;
const HOTEL_TYPES = ['hotel', 'guesthouse', 'resort', 'homestay', 'lodge', 'other'];

/** Small generic form for create/edit modals. */
function FormFields({
  fields,
  value,
  onChange,
}: {
  fields: {
    k: string;
    label: string;
    type?: string;
    options?: [string, string][];
    required?: boolean;
    full?: boolean;
  }[];
  value: Form;
  onChange: (v: Form) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.k} className={f.full ? 'sm:col-span-2' : ''}>
          <Field label={f.label} required={f.required}>
            {f.options ? (
              <Select
                value={value[f.k] ?? ''}
                onChange={(e) => onChange({ ...value, [f.k]: e.target.value })}
              >
                {f.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            ) : f.type === 'textarea' ? (
              <Textarea
                value={value[f.k] ?? ''}
                onChange={(e) => onChange({ ...value, [f.k]: e.target.value })}
              />
            ) : f.type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={!!value[f.k]}
                onChange={(e) => onChange({ ...value, [f.k]: e.target.checked })}
                className="h-5 w-5"
              />
            ) : (
              <Input
                type={f.type ?? 'text'}
                value={value[f.k] ?? ''}
                onChange={(e) =>
                  onChange({ ...value, [f.k]: f.type === 'number' ? Number(e.target.value) : e.target.value })
                }
              />
            )}
          </Field>
        </div>
      ))}
    </div>
  );
}

/** Drop empty strings so optional fields are sent as null rather than invalid values. */
const clean = (f: Form) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));

/* ---------------------------------- hotels ---------------------------------- */

export function HotelListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['hotels', q], queryFn: () => api.get(`/hotels${qs({ q })}`) });
  const [form, setForm] = useState<Form | null>(null);
  const create = useMutation({
    mutationFn: () => api.post('/hotels', clean(form!)),
    onSuccess: (r) => {
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['hotels'] });
      nav(`/hotels/${r.hotel.id}`);
    },
  });
  return (
    <div>
      <PageHeader
        title={t('nav.hotels')}
        actions={
          can('hotels.manage') && (
            <Button
              onClick={() =>
                setForm({
                  hotelType: 'hotel',
                  city: 'Butwal',
                  requireManagerApproval: true,
                  creditLimit: '0',
                })
              }
            >
              {t('hotels.new')}
            </Button>
          )
        }
      />
      <Input
        type="search"
        placeholder={t('common.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3 max-w-sm"
      />
      <ErrorBox error={list.error} />
      <Card>
        <Table
          rows={list.data?.items ?? []}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => nav(`/hotels/${r.id}`)}
          columns={[
            { key: 'c', header: t('common.code'), render: (r: any) => r.code },
            {
              key: 'n',
              header: t('common.name'),
              render: (r: any) => (
                <div className="font-medium">
                  {r.legalName}
                  <div className="text-xs text-slate-500">
                    {t(`hotels.type_${r.hotelType}`)} · {r.city}
                  </div>
                </div>
              ),
            },
            {
              key: 'l',
              header: t('finance.creditLimit'),
              render: (r: any) => money(r.creditLimit),
              align: 'right',
            },
            {
              key: 't',
              header: t('hotels.terms'),
              render: (r: any) => t('hotels.days', { count: r.paymentTermsDays }),
              align: 'right',
            },
            { key: 's', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <Modal
        open={!!form}
        title={t('hotels.new')}
        onClose={() => setForm(null)}
        footer={
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        {form && (
          <>
            <FormFields
              value={form}
              onChange={setForm}
              fields={[
                { k: 'code', label: t('common.code'), required: true },
                {
                  k: 'hotelType',
                  label: t('hotels.type'),
                  options: HOTEL_TYPES.map((h) => [h, t(`hotels.type_${h}`)]),
                },
                { k: 'legalName', label: t('hotels.legalName'), required: true, full: true },
                { k: 'tradeName', label: t('hotels.tradeName'), full: true },
                { k: 'pan', label: t('finance.pan') },
                { k: 'vatNumber', label: t('finance.vatNo') },
                { k: 'address', label: t('common.address'), required: true, full: true },
                { k: 'city', label: t('hotels.city') },
                { k: 'phone', label: t('common.phone') },
                { k: 'primaryContactName', label: t('hotels.contactName') },
                { k: 'primaryContactPhone', label: t('hotels.contactPhone') },
                { k: 'deliveryAddress', label: t('hotels.deliveryAddress'), full: true },
                {
                  k: 'deliveryInstructions',
                  label: t('delivery.instructions'),
                  type: 'textarea',
                  full: true,
                },
                { k: 'creditLimit', label: t('finance.creditLimit') },
                { k: 'paymentTermsDays', label: t('hotels.terms'), type: 'number' },
                {
                  k: 'requireManagerApproval',
                  label: t('hotels.requireManagerApproval'),
                  type: 'checkbox',
                  full: true,
                },
              ]}
            />
            <ErrorBox error={create.error} />
          </>
        )}
      </Modal>
    </div>
  );
}

export function HotelDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hotel', id], queryFn: () => api.get(`/hotels/${id}`) });
  const fin = useQuery({
    queryKey: ['fin-summary', id],
    queryFn: () => api.get(`/finance/hotels/${id}/summary`),
    enabled: can('finance.view_all'),
  });
  const contracts = useQuery({
    queryKey: ['contracts', id],
    queryFn: () => api.get(`/hotels/${id}/contracts`),
  });
  const [edit, setEdit] = useState<Form | null>(null);
  const [credit, setCredit] = useState<Form | null>(null);
  const [contract, setContract] = useState<Form | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invite, setInvite] = useState<Form | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hotel', id] });
  const save = useMutation({
    mutationFn: () => api.patch(`/hotels/${id}`, clean(edit!)),
    onSuccess: () => {
      setEdit(null);
      refresh();
    },
  });
  const creditM = useMutation({
    mutationFn: () => api.post(`/hotels/${id}/credit-terms`, credit),
    onSuccess: (r) => {
      if (r.applied) setCredit(null);
      refresh();
      void fin.refetch();
    },
  });
  const inviteM = useMutation({
    mutationFn: () => api.post('/users/invitations', { ...invite, hotelId: id }),
    onSuccess: (r) => setInviteUrl(r.inviteUrl),
  });
  const contractM = useMutation({
    mutationFn: async () => {
      let attachmentId: string | null = null;
      if (file) {
        const f = new FormData();
        f.append('category', 'contract');
        f.append('hotelId', id!);
        f.append('file', file);
        attachmentId = (await api.upload('/attachments', f)).attachment.id;
      }
      return api.post(`/hotels/${id}/contracts`, { ...clean(contract!), attachmentId });
    },
    onSuccess: () => {
      setContract(null);
      setFile(null);
      void contracts.refetch();
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { hotel: h, users } = q.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {h.legalName} <StatusBadge status={h.status} />
          </span>
        }
        subtitle={`${h.code} · ${t(`hotels.type_${h.hotelType}`)}`}
        actions={
          <>
            {can('hotels.manage') && (
              <Button
                variant="secondary"
                onClick={() =>
                  setEdit({
                    legalName: h.legalName,
                    tradeName: h.tradeName,
                    address: h.address,
                    phone: h.phone,
                    pan: h.pan,
                    vatNumber: h.vatNumber,
                    status: h.status,
                    deliveryAddress: h.deliveryAddress,
                    deliveryInstructions: h.deliveryInstructions,
                    primaryContactName: h.primaryContactName,
                    primaryContactPhone: h.primaryContactPhone,
                    requireManagerApproval: h.requireManagerApproval,
                    notes: h.notes,
                  })
                }
              >
                {t('common.edit')}
              </Button>
            )}
            {can('credit.request') && (
              <Button
                variant="secondary"
                onClick={() =>
                  setCredit({ creditLimit: h.creditLimit, paymentTermsDays: h.paymentTermsDays, reason: '' })
                }
              >
                {t('hotels.creditTerms')}
              </Button>
            )}
            {can('finance.view_all') && (
              <Link to={`/statement?hotelId=${id}`}>
                <Button variant="secondary">{t('nav.statement')}</Button>
              </Link>
            )}
            <Link to={`/pricing?hotelId=${id}`}>
              <Button variant="secondary">{t('nav.pricing')}</Button>
            </Link>
          </>
        }
      />
      {fin.data && (
        <Card title={t('hotels.account')}>
          <DL
            items={[
              [t('finance.balance'), money(fin.data.balance)],
              [t('finance.creditLimit'), money(fin.data.creditLimit)],
              [t('finance.openOrders'), money(fin.data.openOrders)],
              [t('finance.availableCredit'), money(fin.data.availableCredit)],
              [t('finance.overdue'), `${fin.data.overdue.count} · ${money(fin.data.overdue.amount)}`],
              [t('hotels.terms'), t('hotels.days', { count: fin.data.paymentTermsDays })],
            ]}
          />
        </Card>
      )}
      <Card title={t('hotels.profile')}>
        <DL
          items={[
            [t('finance.pan'), h.pan],
            [t('finance.vatNo'), h.vatNumber],
            [t('common.address'), `${h.address}, ${h.city}`],
            [t('common.phone'), h.phone],
            [t('hotels.contactName'), `${h.primaryContactName ?? ''} ${h.primaryContactPhone ?? ''}`],
            [t('hotels.deliveryAddress'), h.deliveryAddress],
            [t('delivery.instructions'), h.deliveryInstructions],
            [t('hotels.requireManagerApproval'), h.requireManagerApproval ? t('common.yes') : t('common.no')],
          ]}
        />
      </Card>
      <Card
        title={t('nav.users')}
        actions={
          can('users.manage_internal') && (
            <Button
              size="sm"
              onClick={() => {
                setInvite({ role: 'hotel_manager', email: '', name: '' });
                setInviteUrl('');
              }}
            >
              {t('users.invite')}
            </Button>
          )
        }
      >
        <Table
          rows={users}
          rowKey={(u: any) => u.id}
          columns={[
            { key: 'n', header: t('common.name'), render: (u: any) => u.name },
            { key: 'e', header: t('auth.email'), render: (u: any) => u.email },
            { key: 'r', header: t('users.role'), render: (u: any) => t(`roles.${u.role}`) },
            {
              key: 's',
              header: t('common.status'),
              render: (u: any) => <StatusBadge status={u.isActive ? 'active' : 'cancelled'} />,
            },
          ]}
        />
      </Card>
      <Card
        title={t('hotels.contracts')}
        actions={
          can('contracts.manage') && (
            <Button
              size="sm"
              onClick={() =>
                setContract({
                  title: '',
                  effectiveFrom: '',
                  effectiveTo: '',
                  termsSummary: '',
                  status: 'active',
                })
              }
            >
              {t('hotels.addContract')}
            </Button>
          )
        }
      >
        <Table
          rows={contracts.data?.items ?? []}
          rowKey={(c: any) => c.id}
          columns={[
            { key: 't', header: t('common.title'), render: (c: any) => `${c.title} v${c.version}` },
            {
              key: 'd',
              header: t('hotels.effective'),
              render: (c: any) => `${date(c.effectiveFrom)} – ${date(c.effectiveTo)}`,
            },
            {
              key: 'f',
              header: t('hotels.file'),
              render: (c: any) =>
                c.attachmentId ? (
                  <a
                    className="text-brand-700 hover:underline"
                    href={`/api/v1/attachments/${c.attachmentId}/download`}
                  >
                    {c.fileName}
                  </a>
                ) : (
                  '—'
                ),
            },
            {
              key: 'u',
              header: t('hotels.uploadedBy'),
              render: (c: any) => `${c.uploadedByName} · ${dateTime(c.createdAt)}`,
            },
            { key: 's', header: t('common.status'), render: (c: any) => <StatusBadge status={c.status} /> },
          ]}
        />
        <p className="mt-2 text-xs text-slate-500">{t('hotels.contractNote')}</p>
      </Card>

      <Modal
        open={!!edit}
        title={t('common.edit')}
        onClose={() => setEdit(null)}
        footer={
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        {edit && (
          <>
            <FormFields
              value={edit}
              onChange={setEdit}
              fields={[
                { k: 'legalName', label: t('hotels.legalName'), full: true },
                { k: 'tradeName', label: t('hotels.tradeName'), full: true },
                { k: 'pan', label: t('finance.pan') },
                { k: 'vatNumber', label: t('finance.vatNo') },
                { k: 'address', label: t('common.address'), full: true },
                { k: 'phone', label: t('common.phone') },
                {
                  k: 'status',
                  label: t('common.status'),
                  options: ['active', 'on_hold', 'suspended', 'closed'].map((s) => [s, t(`status.${s}`)]),
                },
                { k: 'primaryContactName', label: t('hotels.contactName') },
                { k: 'primaryContactPhone', label: t('hotels.contactPhone') },
                { k: 'deliveryAddress', label: t('hotels.deliveryAddress'), full: true },
                {
                  k: 'deliveryInstructions',
                  label: t('delivery.instructions'),
                  type: 'textarea',
                  full: true,
                },
                {
                  k: 'requireManagerApproval',
                  label: t('hotels.requireManagerApproval'),
                  type: 'checkbox',
                  full: true,
                },
                { k: 'notes', label: t('hotels.internalNotes'), type: 'textarea', full: true },
              ]}
            />
            <ErrorBox error={save.error} />
          </>
        )}
      </Modal>
      <Modal
        open={!!credit}
        title={t('hotels.creditTerms')}
        onClose={() => setCredit(null)}
        footer={
          <Button
            disabled={(credit?.reason ?? '').length < 3}
            loading={creditM.isPending}
            onClick={() => creditM.mutate()}
          >
            {can('approvals.decide') ? t('common.save') : t('approvals.request')}
          </Button>
        }
      >
        {credit && (
          <div className="space-y-3">
            {!can('approvals.decide') && <Notice>{t('hotels.creditApprovalNote')}</Notice>}
            <FormFields
              value={credit}
              onChange={setCredit}
              fields={[
                { k: 'creditLimit', label: t('finance.creditLimit') },
                { k: 'paymentTermsDays', label: t('hotels.terms'), type: 'number' },
                { k: 'reason', label: t('common.reason'), type: 'textarea', required: true, full: true },
              ]}
            />
            {creditM.data && !creditM.data.applied && (
              <Notice tone="warn">{t('approvals.sentForApproval')}</Notice>
            )}
            <ErrorBox error={creditM.error} />
          </div>
        )}
      </Modal>
      <Modal
        open={!!contract}
        title={t('hotels.addContract')}
        onClose={() => setContract(null)}
        footer={
          <Button
            disabled={!contract?.title || !contract?.effectiveFrom}
            loading={contractM.isPending}
            onClick={() => contractM.mutate()}
          >
            {t('common.save')}
          </Button>
        }
      >
        {contract && (
          <div className="space-y-3">
            <FormFields
              value={contract}
              onChange={setContract}
              fields={[
                { k: 'title', label: t('common.title'), required: true, full: true },
                { k: 'effectiveFrom', label: t('hotels.from'), type: 'date', required: true },
                { k: 'effectiveTo', label: t('hotels.to'), type: 'date' },
                {
                  k: 'status',
                  label: t('common.status'),
                  options: [
                    ['active', t('status.active')],
                    ['draft', t('status.draft')],
                  ],
                },
                { k: 'termsSummary', label: t('hotels.termsSummary'), type: 'textarea', full: true },
              ]}
            />
            <Field label={t('hotels.file')} hint={t('hotels.fileHint')}>
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </Field>
            <ErrorBox error={contractM.error} />
          </div>
        )}
      </Modal>
      <Modal
        open={!!invite}
        title={t('users.invite')}
        onClose={() => setInvite(null)}
        footer={
          !inviteUrl && (
            <Button loading={inviteM.isPending} onClick={() => inviteM.mutate()}>
              {t('users.sendInvite')}
            </Button>
          )
        }
      >
        {invite &&
          (inviteUrl ? (
            <InviteLink url={inviteUrl} />
          ) : (
            <div className="space-y-3">
              <FormFields
                value={invite}
                onChange={setInvite}
                fields={[
                  { k: 'name', label: t('common.name'), required: true },
                  { k: 'email', label: t('auth.email'), type: 'email', required: true },
                  {
                    k: 'role',
                    label: t('users.role'),
                    options: ['hotel_manager', 'hotel_purchaser', 'hotel_inventory'].map((r) => [
                      r,
                      t(`roles.${r}`),
                    ]),
                  },
                ]}
              />
              <ErrorBox error={inviteM.error} />
            </div>
          ))}
      </Modal>
    </div>
  );
}

export function InviteLink({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Notice tone="success">{t('users.inviteCreated')}</Notice>
      <Input readOnly value={url} onFocus={(e) => e.target.select()} />
      <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(url)}>
        {t('common.copy')}
      </Button>
      <p className="text-xs text-slate-500">{t('users.inviteShareNote')}</p>
    </div>
  );
}

/* --------------------------------- suppliers -------------------------------- */

export function SupplierListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['suppliers', q], queryFn: () => api.get(`/suppliers${qs({ q })}`) });
  const [form, setForm] = useState<Form | null>(null);
  const create = useMutation({
    mutationFn: () => api.post('/suppliers', clean(form!)),
    onSuccess: (r) => nav(`/suppliers/${r.supplier.id}`),
  });
  return (
    <div>
      <PageHeader
        title={t('nav.suppliers')}
        subtitle={t('suppliers.confidential')}
        actions={
          can('suppliers.manage') && (
            <Button onClick={() => setForm({ leadTimeDays: 1, paymentTermsDays: 0 })}>
              {t('suppliers.new')}
            </Button>
          )
        }
      />
      <Input
        type="search"
        placeholder={t('common.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3 max-w-sm"
      />
      <Card>
        <Table
          rows={list.data?.items ?? []}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => nav(`/suppliers/${r.id}`)}
          columns={[
            { key: 'c', header: t('common.code'), render: (r: any) => r.code },
            {
              key: 'n',
              header: t('common.name'),
              render: (r: any) => <span className="font-medium">{r.name}</span>,
            },
            { key: 'p', header: t('common.phone'), render: (r: any) => r.phone },
            {
              key: 'l',
              header: t('suppliers.leadTime'),
              render: (r: any) => t('hotels.days', { count: r.leadTimeDays }),
              align: 'right',
            },
            { key: 's', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <Modal
        open={!!form}
        title={t('suppliers.new')}
        onClose={() => setForm(null)}
        footer={
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        {form && (
          <>
            <FormFields
              value={form}
              onChange={setForm}
              fields={[
                { k: 'code', label: t('common.code'), required: true },
                { k: 'name', label: t('common.name'), required: true },
                { k: 'pan', label: t('finance.pan') },
                { k: 'vatNumber', label: t('finance.vatNo') },
                { k: 'address', label: t('common.address'), full: true },
                { k: 'city', label: t('hotels.city') },
                { k: 'phone', label: t('common.phone') },
                { k: 'email', label: t('auth.email') },
                { k: 'contactName', label: t('hotels.contactName') },
                { k: 'leadTimeDays', label: t('suppliers.leadTime'), type: 'number' },
                { k: 'paymentTermsDays', label: t('hotels.terms'), type: 'number' },
                { k: 'termsNotes', label: t('suppliers.termsNotes'), type: 'textarea', full: true },
              ]}
            />
            <ErrorBox error={create.error} />
          </>
        )}
      </Modal>
    </div>
  );
}

export function SupplierDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['supplier', id], queryFn: () => api.get(`/suppliers/${id}`) });
  const st = useQuery({
    queryKey: ['supplier-statement', id],
    queryFn: () => api.get(`/finance/suppliers/${id}/statement`),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { supplier: s, contacts, products, quotations } = q.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {s.name} <StatusBadge status={s.status} />
          </span>
        }
        subtitle={s.code}
        actions={
          <Link to={`/payments/new?direction=outbound&supplierId=${id}`}>
            <Button variant="secondary">{t('finance.recordPayment')}</Button>
          </Link>
        }
      />
      <Card>
        <DL
          items={[
            [t('finance.pan'), s.pan],
            [t('finance.vatNo'), s.vatNumber],
            [t('common.address'), s.address],
            [t('common.phone'), s.phone],
            [t('auth.email'), s.email],
            [t('hotels.contactName'), s.contactName],
            [t('suppliers.leadTime'), t('hotels.days', { count: s.leadTimeDays })],
            [t('hotels.terms'), t('hotels.days', { count: s.paymentTermsDays })],
            [t('finance.payable'), money(st.data?.balance)],
          ]}
        />
        {contacts.length > 0 && (
          <ul className="mt-3 text-sm">
            {contacts.map((c: any) => (
              <li key={c.id}>
                {c.name} {c.position && `(${c.position})`} {c.phone} {c.email}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('suppliers.products')}>
        <Table
          rows={products}
          rowKey={(p: any) => p.id}
          columns={[
            { key: 's', header: 'SKU', render: (p: any) => p.sku },
            { key: 'n', header: t('common.product'), render: (p: any) => p.nameEn },
            {
              key: 'c',
              header: t('suppliers.lastCost'),
              render: (p: any) => money(p.lastUnitCost),
              align: 'right',
            },
          ]}
        />
      </Card>
      <Card title={t('suppliers.quotations')}>
        <Table
          rows={quotations}
          rowKey={(p: any) => p.id}
          columns={[
            { key: 'd', header: t('common.date'), render: (r: any) => date(r.createdAt) },
            { key: 'n', header: t('common.product'), render: (r: any) => r.nameEn },
            {
              key: 'c',
              header: t('procurement.unitCost'),
              render: (r: any) => money(r.unitCost),
              align: 'right',
            },
            { key: 'v', header: t('procurement.validUntil'), render: (r: any) => date(r.validUntil) },
            { key: 'a', header: t('suppliers.availability'), render: (r: any) => r.availabilityNote },
          ]}
        />
      </Card>
    </div>
  );
}

/* ---------------------------------- products --------------------------------- */

export function ProductAdminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['products-admin', q],
    queryFn: () => api.get(`/products${qs({ q, includeInactive: true, pageSize: 100 })}`),
  });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const units = useQuery({ queryKey: ['units'], queryFn: () => api.get('/units') });
  const taxes = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get('/tax-rates') });
  const [form, setForm] = useState<Form | null>(null);
  const [catForm, setCatForm] = useState<Form | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const { id, ...rest } = form!;
      return id ? api.patch(`/products/${id}`, clean(rest)) : api.post('/products', clean(rest));
    },
    onSuccess: () => {
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['products-admin'] });
    },
  });
  const saveCat = useMutation({
    mutationFn: () => api.post('/categories', clean(catForm!)),
    onSuccess: () => {
      setCatForm(null);
      void cats.refetch();
    },
  });
  const unitOpts: [string, string][] = (units.data?.items ?? []).map((u: any) => [u.code, nameOf(u)]);
  return (
    <div>
      <PageHeader
        title={t('nav.products')}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setCatForm({ code: '', nameEn: '', nameNe: '', parentId: '' })}
            >
              {t('products.newCategory')}
            </Button>
            <Button
              onClick={() =>
                setForm({
                  sellingUnit: 'pcs',
                  purchaseUnit: 'pcs',
                  unitsPerPurchaseUnit: '1',
                  taxCode: 'VAT13',
                  minOrderQty: '1',
                  referenceCost: '0',
                  categoryId: cats.data?.items[0]?.id,
                })
              }
            >
              {t('products.new')}
            </Button>
          </>
        }
      />
      <Input
        type="search"
        placeholder={t('catalog.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3 max-w-sm"
      />
      <Card>
        <Table
          rows={list.data?.items ?? []}
          rowKey={(r: any) => r.id}
          onRowClick={(p: any) =>
            setForm({
              id: p.id,
              sku: p.sku,
              nameEn: p.nameEn,
              nameNe: p.nameNe,
              categoryId: p.categoryId,
              brand: p.brand,
              sellingUnit: p.sellingUnit,
              purchaseUnit: p.purchaseUnit,
              unitsPerPurchaseUnit: p.unitsPerPurchaseUnit,
              referenceCost: p.referenceCost,
              taxCode: p.taxCode,
              minOrderQty: p.minOrderQty,
              isActive: p.isActive,
              descriptionEn: p.descriptionEn,
              descriptionNe: p.descriptionNe,
              specifications: p.specifications,
              reason: '',
            })
          }
          columns={[
            { key: 's', header: 'SKU', render: (p: any) => p.sku },
            {
              key: 'n',
              header: t('common.product'),
              render: (p: any) => (
                <div>
                  {p.nameEn}
                  <div className="text-xs text-slate-500">{p.nameNe}</div>
                </div>
              ),
            },
            {
              key: 'c',
              header: t('catalog.category'),
              render: (p: any) => nameOf({ nameEn: p.categoryNameEn, nameNe: p.categoryNameNe }),
            },
            {
              key: 'rc',
              header: t('products.referenceCost'),
              render: (p: any) => money(p.referenceCost),
              align: 'right',
            },
            {
              key: 'up',
              header: t('products.defaultPrice'),
              render: (p: any) => money(p.unitPrice),
              align: 'right',
            },
            {
              key: 'm',
              header: t('procurement.marginPercent'),
              render: (p: any) => (p.marginPercent ? `${p.marginPercent}%` : '—'),
              align: 'right',
            },
            {
              key: 'st',
              header: t('common.status'),
              render: (p: any) => <StatusBadge status={p.isActive ? 'active' : 'cancelled'} />,
            },
          ]}
        />
      </Card>
      <Modal
        open={!!form}
        title={form?.id ? t('common.edit') : t('products.new')}
        onClose={() => setForm(null)}
        footer={
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        {form && (
          <>
            <FormFields
              value={form}
              onChange={setForm}
              fields={[
                { k: 'sku', label: 'SKU', required: true },
                {
                  k: 'categoryId',
                  label: t('catalog.category'),
                  options: (cats.data?.items ?? []).map((c: any) => [c.id, nameOf(c)]),
                },
                { k: 'nameEn', label: t('products.nameEn'), required: true },
                { k: 'nameNe', label: t('products.nameNe'), required: true },
                { k: 'brand', label: t('products.brand') },
                {
                  k: 'taxCode',
                  label: t('products.taxCode'),
                  options: (taxes.data?.items ?? []).map((x: any) => [
                    x.code,
                    `${x.name}${x.requiresVerification ? ' ⚠' : ''}`,
                  ]),
                },
                { k: 'sellingUnit', label: t('products.sellingUnit'), options: unitOpts },
                { k: 'purchaseUnit', label: t('products.purchaseUnit'), options: unitOpts },
                { k: 'unitsPerPurchaseUnit', label: t('products.unitsPerPurchase') },
                { k: 'minOrderQty', label: t('products.moq') },
                { k: 'referenceCost', label: t('products.referenceCost') },
                ...(form.id ? [{ k: 'reason', label: t('products.costChangeReason') }] : []),
                { k: 'descriptionEn', label: t('products.descEn'), type: 'textarea', full: true },
                { k: 'descriptionNe', label: t('products.descNe'), type: 'textarea', full: true },
                { k: 'specifications', label: t('products.specs'), type: 'textarea', full: true },
                { k: 'isActive', label: t('status.active'), type: 'checkbox' },
              ]}
            />
            <ErrorBox error={save.error} />
          </>
        )}
      </Modal>
      <Modal
        open={!!catForm}
        title={t('products.newCategory')}
        onClose={() => setCatForm(null)}
        footer={
          <Button loading={saveCat.isPending} onClick={() => saveCat.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        {catForm && (
          <>
            <FormFields
              value={catForm}
              onChange={setCatForm}
              fields={[
                { k: 'code', label: t('common.code'), required: true },
                {
                  k: 'parentId',
                  label: t('products.parentCategory'),
                  options: [
                    ['', '—'],
                    ...(cats.data?.items ?? [])
                      .filter((c: any) => !c.parentId)
                      .map((c: any) => [c.id, nameOf(c)] as [string, string]),
                  ],
                },
                { k: 'nameEn', label: t('products.nameEn'), required: true },
                { k: 'nameNe', label: t('products.nameNe'), required: true },
              ]}
            />
            <ErrorBox error={saveCat.error} />
          </>
        )}
      </Modal>
    </div>
  );
}

export function PricingPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const [hotelId, setHotelId] = useState(params.get('hotelId') ?? '');
  const rules = useQuery({
    queryKey: ['rules', hotelId],
    queryFn: () => api.get(`/pricing-rules${qs({ hotelId })}`),
  });
  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => api.get('/hotels') });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const products = useQuery({
    queryKey: ['products-pick'],
    queryFn: () => api.get('/products?pageSize=200'),
  });
  const [form, setForm] = useState<Form | null>(null);
  const [deact, setDeact] = useState<any>(null);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api.post('/pricing-rules', clean(form!)),
    onSuccess: () => {
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });
  const off = useMutation({
    mutationFn: () => api.post(`/pricing-rules/${deact.id}/deactivate`, { reason }),
    onSuccess: () => {
      setDeact(null);
      void rules.refetch();
    },
  });
  const scope = form?.scope as string | undefined;
  return (
    <div>
      <PageHeader
        title={t('nav.pricing')}
        subtitle={t('pricing.precedence')}
        actions={
          <Button
            onClick={() =>
              setForm({
                scope: 'category',
                ruleType: 'markup_percent',
                value: '',
                reason: '',
                hotelId: hotelId || '',
              })
            }
          >
            {t('pricing.newRule')}
          </Button>
        }
      />
      <Select
        value={hotelId}
        onChange={(e) => setHotelId(e.target.value)}
        className="mb-3 max-w-sm"
        aria-label={t('common.hotel')}
      >
        <option value="">{t('pricing.allRules')}</option>
        {hotels.data?.items.map((h: any) => (
          <option key={h.id} value={h.id}>
            {h.legalName}
          </option>
        ))}
      </Select>
      <Card>
        <Table
          rows={rules.data?.items ?? []}
          rowKey={(r: any) => r.id}
          columns={[
            { key: 's', header: t('pricing.scope'), render: (r: any) => t(`pricing.scope_${r.scope}`) },
            {
              key: 'tg',
              header: t('pricing.target'),
              render: (r: any) =>
                [r.hotelName, r.categoryName, r.productName && `${r.productName} (${r.productSku})`]
                  .filter(Boolean)
                  .join(' · ') || t('pricing.everything'),
            },
            {
              key: 'v',
              header: t('pricing.value'),
              render: (r: any) => (r.ruleType === 'markup_percent' ? `+${Number(r.value)}%` : money(r.value)),
              align: 'right',
            },
            {
              key: 'f',
              header: t('pricing.valid'),
              render: (r: any) => `${date(r.validFrom)} – ${date(r.validTo)}`,
            },
            { key: 'r', header: t('common.reason'), render: (r: any) => r.reason },
            {
              key: 'x',
              header: '',
              render: (r: any) => (
                <Button size="sm" variant="ghost" onClick={() => setDeact(r)}>
                  {t('pricing.deactivate')}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        open={!!form}
        title={t('pricing.newRule')}
        onClose={() => setForm(null)}
        footer={
          <Button
            disabled={!form?.value || (form?.reason ?? '').length < 3}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        }
      >
        {form && (
          <div className="space-y-3">
            <FormFields
              value={form}
              onChange={setForm}
              fields={[
                {
                  k: 'scope',
                  label: t('pricing.scope'),
                  options: ['default', 'category', 'product', 'hotel', 'hotel_category', 'hotel_product'].map(
                    (s) => [s, t(`pricing.scope_${s}`)],
                  ),
                },
                {
                  k: 'ruleType',
                  label: t('pricing.type'),
                  options: [
                    ['markup_percent', t('pricing.markup')],
                    ...(scope?.includes('product')
                      ? [['fixed_price', t('pricing.fixedPrice')] as [string, string]]
                      : []),
                  ],
                },
                ...(scope?.startsWith('hotel')
                  ? [
                      {
                        k: 'hotelId',
                        label: t('common.hotel'),
                        options: [
                          ['', '—'],
                          ...(hotels.data?.items ?? []).map(
                            (h: any) => [h.id, h.legalName] as [string, string],
                          ),
                        ],
                      },
                    ]
                  : []),
                ...(scope?.includes('category')
                  ? [
                      {
                        k: 'categoryId',
                        label: t('catalog.category'),
                        options: [
                          ['', '—'],
                          ...(cats.data?.items ?? []).map((c: any) => [c.id, nameOf(c)] as [string, string]),
                        ],
                      },
                    ]
                  : []),
                ...(scope?.includes('product')
                  ? [
                      {
                        k: 'productId',
                        label: t('common.product'),
                        options: [
                          ['', '—'],
                          ...(products.data?.items ?? []).map(
                            (p: any) => [p.id, `${p.sku} ${p.nameEn}`] as [string, string],
                          ),
                        ],
                      },
                    ]
                  : []),
                {
                  k: 'value',
                  label:
                    form.ruleType === 'fixed_price' ? t('pricing.fixedPrice') : t('pricing.markupPercent'),
                  required: true,
                },
                { k: 'validFrom', label: t('hotels.from'), type: 'date' },
                { k: 'validTo', label: t('hotels.to'), type: 'date' },
                { k: 'reason', label: t('common.reason'), type: 'textarea', required: true, full: true },
              ]}
            />
            <ErrorBox error={save.error} />
          </div>
        )}
      </Modal>
      <Modal
        open={!!deact}
        title={t('pricing.deactivate')}
        onClose={() => setDeact(null)}
        footer={
          <Button variant="danger" disabled={reason.length < 3} onClick={() => off.mutate()}>
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

/* --------------------------------- approvals --------------------------------- */

export function ApprovalsPage() {
  const { t } = useTranslation();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const q = useQuery({
    queryKey: ['approvals', status],
    queryFn: () => api.get(`/approvals${qs({ status })}`),
  });
  const [target, setTarget] = useState<any>(null);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      api.post(`/approvals/${target.id}/decide`, { decision, note: note || undefined }),
    onSuccess: () => {
      setTarget(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/approvals/${id}/cancel`),
    onSuccess: () => void q.refetch(),
  });
  const link = (a: any) =>
    a.targetType === 'order'
      ? `/orders/${a.targetId}`
      : a.targetType === 'purchase_order'
        ? `/purchase-orders/${a.targetId}`
        : a.targetType === 'hotel'
          ? `/hotels/${a.targetId}`
          : a.targetType === 'order_line'
            ? `/orders/${a.details?.orderId}`
            : null;
  return (
    <div>
      <PageHeader
        title={t('nav.approvals')}
        subtitle={can('approvals.decide') ? t('approvals.ownerNote') : t('approvals.requesterNote')}
      />
      <Select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="mb-3 max-w-xs"
        aria-label={t('common.status')}
      >
        {['pending', 'approved', 'rejected', 'cancelled'].map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </Select>
      <ErrorBox error={q.error} />
      <Card>
        <Table
          rows={q.data?.items ?? []}
          rowKey={(r: any) => r.id}
          empty={t('approvals.none')}
          columns={[
            { key: 'd', header: t('common.date'), render: (r: any) => dateTime(r.requestedAt) },
            { key: 'ty', header: t('common.type'), render: (r: any) => t(`approvals.type_${r.type}`) },
            {
              key: 's',
              header: t('approvals.summary'),
              render: (r: any) => {
                const l = link(r);
                return l ? (
                  <Link className="text-brand-700 hover:underline" to={l}>
                    {r.summary}
                  </Link>
                ) : (
                  r.summary
                );
              },
            },
            { key: 'a', header: t('common.amount'), render: (r: any) => money(r.amount), align: 'right' },
            { key: 'r', header: t('approvals.requestedBy'), render: (r: any) => r.requestedByName },
            { key: 'st', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
            {
              key: 'x',
              header: '',
              render: (r: any) =>
                r.status === 'pending' &&
                (can('approvals.decide') ? (
                  <Button size="sm" onClick={() => setTarget(r)}>
                    {t('approvals.decide')}
                  </Button>
                ) : (
                  r.requestedBy === me?.user.id && (
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>
                      {t('common.cancel')}
                    </Button>
                  )
                )),
            },
          ]}
        />
      </Card>
      <Modal
        open={!!target}
        title={t('approvals.decide')}
        onClose={() => setTarget(null)}
        footer={
          <>
            <Button variant="danger" loading={decide.isPending} onClick={() => decide.mutate('rejected')}>
              {t('approvals.reject')}
            </Button>
            <Button loading={decide.isPending} onClick={() => decide.mutate('approved')}>
              {t('approvals.approve')}
            </Button>
          </>
        }
      >
        {target && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{target.summary}</p>
            {target.requestedBy === me?.user.id && <Notice tone="warn">{t('approvals.selfApproval')}</Notice>}
            {target.type === 'credit_order' && target.details && (
              <DL
                items={[
                  [t('finance.creditLimit'), money(target.details.creditLimit)],
                  [t('finance.balance'), money(target.details.balance)],
                  [t('finance.openOrders'), money(target.details.openOrders)],
                  [t('finance.exposureAfter'), money(target.details.exposureAfter)],
                  [t('finance.overdue'), money(target.details.overdue?.amount)],
                ]}
              />
            )}
            <Field label={t('common.note')}>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <ErrorBox error={decide.error} />
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ----------------------------- product requests ----------------------------- */

export function RequestListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['requests'], queryFn: () => api.get('/product-requests') });
  return (
    <div>
      <PageHeader
        title={t('nav.requests')}
        actions={
          can('requests.create') && (
            <Link to="/requests/new">
              <Button>{t('requests.new')}</Button>
            </Link>
          )
        }
      />
      <Card>
        <Table
          rows={q.data?.items ?? []}
          rowKey={(r: any) => r.id}
          onRowClick={(r: any) => nav(`/requests/${r.id}`)}
          columns={[
            { key: 'n', header: t('requests.number'), render: (r: any) => r.requestNumber },
            ...(can('requests.manage')
              ? [{ key: 'h', header: t('common.hotel'), render: (r: any) => r.hotelName }]
              : []),
            { key: 'd', header: t('common.description'), render: (r: any) => r.description },
            {
              key: 'q',
              header: t('common.quantity'),
              render: (r: any) => `${Number(r.quantity)} ${r.unit}`,
              align: 'right',
            },
            { key: 'c', header: t('common.created'), render: (r: any) => date(r.createdAt) },
            { key: 's', header: t('common.status'), render: (r: any) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </div>
  );
}

export function NewRequestPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [form, setForm] = useState<Form>({ description: '', quantity: '1', unit: 'pcs', specifications: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      let attachmentId: string | null = null;
      if (photo) {
        const f = new FormData();
        f.append('category', 'request_photo');
        f.append('file', photo);
        attachmentId = (await api.upload('/attachments', f)).attachment.id;
      }
      return api.post('/product-requests', { ...clean(form), attachmentId });
    },
    onSuccess: (r) => nav(`/requests/${r.request.id}`),
  });
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t('requests.new')} subtitle={t('requests.intro')} />
      <Card>
        <div className="space-y-3">
          <Field label={t('common.description')} required>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.quantity')} required>
              <Input
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </Field>
            <Field label={t('common.unit')} required>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </Field>
          </div>
          <Field label={t('products.specs')}>
            <Textarea
              value={form.specifications}
              onChange={(e) => setForm({ ...form, specifications: e.target.value })}
            />
          </Field>
          <Field label={t('requests.photo')}>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </Field>
          <ErrorBox error={m.error} />
          <Button disabled={form.description.length < 3} loading={m.isPending} onClick={() => m.mutate()}>
            {t('requests.submit')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function RequestDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['request', id], queryFn: () => api.get(`/product-requests/${id}`) });
  const products = useQuery({
    queryKey: ['products-pick'],
    queryFn: () => api.get('/products?pageSize=200'),
    enabled: can('requests.manage'),
  });
  const [quote, setQuote] = useState<Form>({ quotedProductId: '', quotedUnitPrice: '', responseNote: '' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['request', id] });
  const update = useMutation({
    mutationFn: (body: Form) => api.patch(`/product-requests/${id}`, body),
    onSuccess: refresh,
  });
  const accept = useMutation({
    mutationFn: () => api.post(`/product-requests/${id}/accept`),
    onSuccess: (r) => nav(`/orders/${r.order.id}`),
  });
  const withdraw = useMutation({
    mutationFn: () => api.post(`/product-requests/${id}/withdraw`),
    onSuccess: refresh,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { request: r, quotedProduct } = q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {r.requestNumber} <StatusBadge status={r.status} />
          </span>
        }
      />
      <Card>
        <DL
          items={[
            [t('common.description'), r.description],
            [t('common.quantity'), `${Number(r.quantity)} ${r.unit}`],
            [t('products.specs'), r.specifications],
            [t('common.created'), dateTime(r.createdAt)],
          ]}
        />
        {r.attachmentId && (
          <a
            className="mt-2 inline-block text-sm text-brand-700"
            href={`/api/v1/attachments/${r.attachmentId}/download`}
          >
            {t('requests.viewAttachment')}
          </a>
        )}
      </Card>
      {r.status === 'quoted' && (
        <Card title={t('requests.quote')}>
          <DL
            items={[
              [t('common.product'), nameOf(quotedProduct)],
              [t('common.unitPrice'), money(r.quotedUnitPrice)],
              [t('common.note'), r.responseNote],
            ]}
          />
          {can('requests.create') && (
            <div className="mt-3 flex gap-2">
              <Button loading={accept.isPending} onClick={() => accept.mutate()}>
                {t('requests.accept')}
              </Button>
              <Button variant="secondary" onClick={() => withdraw.mutate()}>
                {t('requests.withdraw')}
              </Button>
            </div>
          )}
          <ErrorBox error={accept.error} />
        </Card>
      )}
      {r.status === 'declined' && <Notice tone="error">{r.responseNote ?? t('requests.declined')}</Notice>}
      {can('requests.manage') && ['open', 'investigating', 'quoted'].includes(r.status) && (
        <Card title={t('requests.respond')}>
          <Notice>{t('requests.staffNote')}</Notice>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('common.product')}>
              <Select
                value={quote.quotedProductId}
                onChange={(e) => setQuote({ ...quote, quotedProductId: e.target.value })}
              >
                <option value="">—</option>
                {products.data?.items.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} {p.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.unitPrice')}>
              <Input
                inputMode="decimal"
                value={quote.quotedUnitPrice}
                onChange={(e) => setQuote({ ...quote, quotedUnitPrice: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('common.note')}>
                <Textarea
                  value={quote.responseNote}
                  onChange={(e) => setQuote({ ...quote, responseNote: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => update.mutate({ status: 'investigating' })}>
              {t('requests.markInvestigating')}
            </Button>
            <Button
              disabled={!quote.quotedProductId || !quote.quotedUnitPrice}
              onClick={() => update.mutate({ status: 'quoted', ...clean(quote) })}
            >
              {t('requests.sendQuote')}
            </Button>
            <Button
              variant="danger"
              onClick={() => update.mutate({ status: 'declined', responseNote: quote.responseNote || null })}
            >
              {t('requests.decline')}
            </Button>
            <Link to="/products">
              <Button variant="ghost">{t('products.new')}</Button>
            </Link>
          </div>
          <ErrorBox error={update.error} />
        </Card>
      )}
    </div>
  );
}
