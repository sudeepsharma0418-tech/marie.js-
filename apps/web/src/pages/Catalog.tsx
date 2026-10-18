import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, newId, qs } from '../lib/api';
import { useCart } from '../lib/cart';
import { money, nameOf, qty, todayNepal } from '../lib/format';
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';

export function CatalogPage() {
  const { t } = useTranslation();
  const cart = useCart();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const h = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [q]);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const products = useQuery({
    queryKey: ['catalog', debounced, categoryId, page],
    queryFn: () => api.get(`/products${qs({ q: debounced, categoryId, page, pageSize: 24 })}`),
  });
  const inCart = (id: string) => cart.lines.find((l) => l.productId === id);

  return (
    <div>
      <PageHeader
        title={t('catalog.title')}
        subtitle={t('catalog.subtitle')}
        actions={
          <>
            <Link to="/requests/new">
              <Button variant="secondary">{t('catalog.cantFind')}</Button>
            </Link>
            <Link to="/cart">
              <Button>{t('catalog.viewCart', { count: cart.lines.length })}</Button>
            </Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          type="search"
          placeholder={t('catalog.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="sm:col-span-2"
          aria-label={t('catalog.search')}
        />
        <Select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          aria-label={t('catalog.category')}
        >
          <option value="">{t('catalog.allCategories')}</option>
          {cats.data?.items
            .filter((c: any) => c.isActive)
            .map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? '— ' : ''}
                {nameOf(c)}
              </option>
            ))}
        </Select>
      </div>
      {products.isLoading && <Spinner />}
      <ErrorBox error={products.error} />
      {products.data && products.data.items.length === 0 && (
        <Empty title={t('catalog.noResults')}>
          <Link to="/requests/new" className="text-brand-700 hover:underline">
            {t('catalog.requestIt')}
          </Link>
        </Empty>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.data?.items.map((p: any) => (
          <ProductCard
            key={p.id}
            p={p}
            current={inCart(p.id)?.quantity}
            onSet={(quantity) =>
              cart.set({
                productId: p.id,
                quantity,
                nameEn: p.nameEn,
                nameNe: p.nameNe,
                unit: p.sellingUnit,
                unitPrice: p.unitPrice,
                minOrderQty: p.minOrderQty,
              })
            }
          />
        ))}
      </div>
      {products.data && <Pagination page={page} pages={products.data.pages} onPage={setPage} />}
    </div>
  );
}

function ProductCard({ p, current, onSet }: { p: any; current?: string; onSet: (q: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(current ?? '');
  useEffect(() => setValue(current ?? ''), [current]);
  const min = Number(p.minOrderQty);
  const invalid = value !== '' && (Number(value) < min || Number(value) <= 0);
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {p.imageAttachmentId ? (
          <img
            src={`/api/v1/attachments/${p.imageAttachmentId}/download`}
            alt=""
            className="h-16 w-16 rounded-lg object-cover"
          />
        ) : (
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl"
            aria-hidden
          >
            📦
          </div>
        )}
        <div className="min-w-0">
          <h3 className="font-medium leading-snug">{nameOf(p)}</h3>
          <p className="text-xs text-slate-500">
            {p.sku} · {nameOf({ nameEn: p.categoryNameEn, nameNe: p.categoryNameNe })}
          </p>
          {p.brand && <p className="text-xs text-slate-500">{p.brand}</p>}
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          {p.priceAvailable ? (
            <div className="text-lg font-semibold tabular-nums">
              {money(p.unitPrice)}{' '}
              <span className="text-xs font-normal text-slate-500">
                / {t(`units.${p.sellingUnit}`, { defaultValue: p.sellingUnit })}
              </span>
            </div>
          ) : (
            <div className="text-sm text-amber-700">{t('catalog.priceOnRequest')}</div>
          )}
          <div className="text-xs text-slate-500">
            {t('catalog.exclTax')}
            {min > 1 ? ` · ${t('catalog.minQty', { qty: qty(p.minOrderQty) })}` : ''}
          </div>
        </div>
        {p.priceAvailable && (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              inputMode="decimal"
              min={min}
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-20"
              aria-label={t('common.quantity')}
              aria-invalid={invalid}
            />
            <Button size="sm" disabled={!value || invalid} onClick={() => onSet(value)}>
              {current ? t('catalog.update') : t('catalog.add')}
            </Button>
          </div>
        )}
      </div>
      {invalid && (
        <p className="mt-1 text-xs text-red-600">{t('catalog.minQty', { qty: qty(p.minOrderQty) })}</p>
      )}
    </div>
  );
}

export function CartPage() {
  const { t } = useTranslation();
  const cart = useCart();
  const nav = useNavigate();
  const [date, setDate] = useState('');
  const [windowPref, setWindowPref] = useState('any');
  const [notes, setNotes] = useState('');
  const [key] = useState(() => newId());
  const submit = useMutation({
    mutationFn: (submitNow: boolean) =>
      api.post('/orders', {
        lines: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        requestedDeliveryDate: date || null,
        deliveryWindow: windowPref,
        deliveryNotes: notes || null,
        submit: submitNow,
        idempotencyKey: `${key}-${submitNow ? 's' : 'd'}`,
      }),
    onSuccess: (r) => {
      cart.clear();
      nav(`/orders/${r.order.id}`);
    },
  });
  const estimate = cart.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice ?? 0), 0);
  return (
    <div>
      <PageHeader title={t('cart.title')} />
      {cart.lines.length === 0 ? (
        <Empty title={t('cart.empty')}>
          <Link to="/catalog" className="text-brand-700 hover:underline">
            {t('cart.browse')}
          </Link>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title={t('cart.items')} className="lg:col-span-2">
            <ul className="divide-y">
              {cart.lines.map((l) => (
                <li key={l.productId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{nameOf(l)}</div>
                    <div className="text-xs text-slate-500">
                      {money(l.unitPrice)} / {t(`units.${l.unit}`, { defaultValue: l.unit })}
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={l.minOrderQty}
                    step="any"
                    value={l.quantity}
                    onChange={(e) => cart.set({ ...l, quantity: e.target.value })}
                    className="w-24"
                    aria-label={t('common.quantity')}
                  />
                  <div className="w-28 text-right tabular-nums">
                    {money(Number(l.quantity) * Number(l.unitPrice ?? 0))}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => cart.remove(l.productId)}>
                    {t('common.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('cart.delivery')}>
            <div className="space-y-3">
              <Field label={t('cart.deliveryDate')}>
                <Input
                  type="date"
                  min={todayNepal()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label={t('cart.window')}>
                <Select value={windowPref} onChange={(e) => setWindowPref(e.target.value)}>
                  <option value="any">{t('cart.windowAny')}</option>
                  <option value="morning">{t('cart.windowMorning')}</option>
                  <option value="afternoon">{t('cart.windowAfternoon')}</option>
                </Select>
              </Field>
              <Field label={t('cart.notes')}>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
              </Field>
              <div className="flex justify-between border-t pt-3 text-sm">
                <span>{t('cart.estimate')}</span>
                <span className="font-semibold tabular-nums">{money(estimate)}</span>
              </div>
              <Notice>{t('cart.estimateNote')}</Notice>
              <ErrorBox error={submit.error} />
              <Button
                className="w-full"
                size="lg"
                loading={submit.isPending}
                onClick={() => submit.mutate(true)}
              >
                {t('cart.submit')}
              </Button>
              <Button
                className="w-full"
                variant="secondary"
                disabled={submit.isPending}
                onClick={() => submit.mutate(false)}
              >
                {t('cart.saveDraft')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
