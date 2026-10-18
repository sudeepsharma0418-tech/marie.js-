import i18n from '../i18n';

const TZ = 'Asia/Kathmandu';
const locale = () => (i18n.language === 'ne' ? 'ne-NP' : 'en-IN');

/** Display-only formatting. Money is never calculated in the browser. */
export function money(v: string | number | null | undefined, withSymbol = true): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  const s = new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return withSymbol ? `${i18n.language === 'ne' ? 'रु.' : 'Rs.'} ${s}` : s;
}

export function qty(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 3 }).format(Number(v));
}

export function date(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d =
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+05:45`) : new Date(v);
  return new Intl.DateTimeFormat(locale(), {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat(locale(), {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v));
}

/** Today in Nepal as YYYY-MM-DD (for date inputs). */
export function todayNepal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** Product or category name in the active language, falling back to English. */
export function nameOf(o: { nameEn?: string | null; nameNe?: string | null } | null | undefined): string {
  if (!o) return '';
  return (i18n.language === 'ne' ? o.nameNe || o.nameEn : o.nameEn || o.nameNe) ?? '';
}
