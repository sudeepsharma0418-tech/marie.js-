import { sql, type SQL } from 'drizzle-orm';
import { numeric, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** Money: fixed precision, never floating point. Travels as a decimal string. */
export const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
/** Quantities allow 3 decimals (e.g. 2.500 kg). */
export const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
export const percent = (name: string) => numeric(name, { precision: 7, scale: 3 });

/** All timestamps are timestamptz stored in UTC and displayed in Asia/Kathmandu. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () => ts('updated_at').notNull().defaultNow();
export const pk = () => uuid('id').primaryKey().defaultRandom();

/** CHECK (col IN (...)) built from the shared constant lists. */
export function inList(col: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${col} in (${sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '))})`;
}
