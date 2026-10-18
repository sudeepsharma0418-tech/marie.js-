import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'px-2.5 py-1 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-3.5 text-base',
        variant === 'primary' && 'bg-brand-700 text-white hover:bg-brand-800',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        variant === 'ghost' && 'text-slate-700 hover:bg-slate-100',
        className,
      )}
    >
      {loading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  required,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none disabled:bg-slate-100';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...p },
  ref,
) {
  return <input ref={ref} {...p} className={cx(inputCls, className)} />;
});
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={cx(inputCls, className)}>
      {children}
    </select>
  );
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...p} className={cx(inputCls, className)} />;
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_hotel_approval: 'bg-amber-100 text-amber-800',
  pending_approval: 'bg-amber-100 text-amber-800',
  pending: 'bg-amber-100 text-amber-800',
  needs_review: 'bg-amber-100 text-amber-800',
  submitted: 'bg-sky-100 text-sky-800',
  approved: 'bg-emerald-100 text-emerald-800',
  applied: 'bg-emerald-100 text-emerald-800',
  procurement: 'bg-indigo-100 text-indigo-800',
  consolidating: 'bg-indigo-100 text-indigo-800',
  ready_for_dispatch: 'bg-cyan-100 text-cyan-800',
  dispatched: 'bg-blue-100 text-blue-800',
  sent: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-blue-100 text-blue-800',
  partially_delivered: 'bg-orange-100 text-orange-800',
  partially_received: 'bg-orange-100 text-orange-800',
  partially_paid: 'bg-orange-100 text-orange-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  received: 'bg-emerald-100 text-emerald-800',
  issued: 'bg-emerald-100 text-emerald-800',
  posted: 'bg-emerald-100 text-emerald-800',
  paid: 'bg-emerald-100 text-emerald-800',
  recorded: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-200 text-slate-700',
  completed: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-500',
  discarded: 'bg-slate-200 text-slate-500',
  reversed: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
  unpaid: 'bg-red-100 text-red-700',
  overdue: 'bg-red-100 text-red-700',
  on_hold: 'bg-amber-100 text-amber-800',
  suspended: 'bg-red-100 text-red-700',
  active: 'bg-emerald-100 text-emerald-800',
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useTranslation();
  if (!status) return null;
  return (
    <span
      className={cx(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700',
      )}
    >
      {t(`status.${status}`, { defaultValue: status.replace(/_/g, ' ') })}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500" role="status">
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent"
        aria-hidden
      />
      {label ?? t('common.loading')}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  let msg = t('errors.generic');
  if (error instanceof ApiError) {
    if (error.status === 0) msg = t('errors.network');
    else if (error.status === 403) msg = t('errors.forbidden');
    else if (error.status === 404) msg = t('errors.notFound');
    else msg = error.message;
  }
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as { path?: string; message?: string }[])
      : [];
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {msg}
      {details.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {details.slice(0, 5).map((d, i) => (
            <li key={i}>
              {d.path ? `${d.path}: ` : ''}
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'success' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-lg border p-3 text-sm',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
      )}
    >
      {children}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'right' | 'left';
  className?: string;
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  empty?: string;
}) {
  const { t } = useTranslation();
  if (!rows.length) return <Empty title={empty ?? t('common.noRecords')} />;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  'px-3 py-2 text-left font-medium whitespace-nowrap text-slate-600',
                  c.align === 'right' && 'text-right',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cx(onRowClick && 'cursor-pointer hover:bg-brand-50 focus:bg-brand-50')}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cx(
                    'px-3 py-2 align-top',
                    c.align === 'right' && 'text-right tabular-nums whitespace-nowrap',
                    c.className,
                  )}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) {
  const { t } = useTranslation();
  if (pages <= 1) return null;
  return (
    <nav className="mt-3 flex items-center justify-end gap-2 text-sm" aria-label={t('common.pagination')}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('common.previous')}
      </Button>
      <span>{t('common.pageOf', { page, pages })}</span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('common.next')}
      </Button>
    </nav>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t px-4 py-3">{footer}</div>}
    </dialog>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'good' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div
        className={cx(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'warn' && 'text-amber-700',
          tone === 'good' && 'text-emerald-700',
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function DL({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-right font-medium">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export { cx };
