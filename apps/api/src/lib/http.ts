import { z } from 'zod';
import { badRequest } from './errors';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw badRequest(
      'Validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const idParam = z.object({ id: z.uuid() });

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Today's date in Nepal (Asia/Kathmandu, UTC+05:45) as YYYY-MM-DD. */
export function todayNepal(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    // neutralise spreadsheet formula injection
    if (/^[=+@\t\r]/.test(s) || /^-[^0-9.]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/** Query-string boolean: only "true"/"1" are true. (z.coerce.boolean would turn "false" into true.) */
export const qbool = (defaultValue: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? defaultValue : v === true || v === 'true' || v === '1'),
    z.boolean(),
  );

/**
 * Parse a PATCH body: validates with the schema made partial, then keeps only the
 * keys the client actually sent, so create-time defaults never overwrite stored values.
 */
export function parsePatch<T extends z.ZodObject>(schema: T, data: unknown): Partial<z.infer<T>> {
  const parsed = parse(schema.partial(), data) as Record<string, unknown>;
  const sent = data && typeof data === 'object' ? new Set(Object.keys(data)) : new Set<string>();
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))) as Partial<z.infer<T>>;
}
