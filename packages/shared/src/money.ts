/**
 * Exact money and quantity arithmetic.
 *
 * Money is stored in PostgreSQL as numeric(14,2) and travels as a decimal string
 * ("1250.50"). Quantities are numeric(14,3). We never use floating point for
 * money: strings are converted to integer minor units (paisa, or thousandths of
 * a unit for quantities) and all maths happens on BigInt.
 */

function parseScaled(value: string | number, scale: number, label: string): bigint {
  const s = typeof value === 'number' ? value.toFixed(scale) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Invalid ${label}: "${value}"`);
  const [, neg, int, frac = ''] = m;
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) {
    throw new Error(`Too many decimal places in ${label}: "${value}"`);
  }
  const digits = BigInt(int + frac.slice(0, scale).padEnd(scale, '0'));
  return neg ? -digits : digits;
}

function formatScaled(v: bigint, scale: number): string {
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(scale + 1, '0');
  const int = abs.slice(0, abs.length - scale);
  const frac = abs.slice(abs.length - scale);
  return `${neg ? '-' : ''}${int}.${frac}`;
}

/** Integer division rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('Division by zero');
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/** Money in paisa (1/100 NPR). */
export type Paisa = bigint;
/** Quantity in thousandths of a unit. */
export type MilliQty = bigint;

export const toPaisa = (v: string | number): Paisa => parseScaled(v, 2, 'amount');
export const fromPaisa = (v: Paisa): string => formatScaled(v, 2);
export const toMilli = (v: string | number): MilliQty => parseScaled(v, 3, 'quantity');
export const fromMilli = (v: MilliQty): string => formatScaled(v, 3);

/** Percent with 3 decimals, e.g. "13.000" -> 13000n. */
export const toPercentMilli = (v: string | number): bigint => parseScaled(v, 3, 'percent');

/** quantity x unit price, rounded to the paisa. */
export function lineAmount(qty: string, unitPrice: string): string {
  return fromPaisa(divRound(toMilli(qty) * toPaisa(unitPrice), 1000n));
}

/** Applies a percentage (e.g. tax rate or markup) to an amount, rounded to the paisa. */
export function percentOf(amount: string, percent: string): string {
  return fromPaisa(divRound(toPaisa(amount) * toPercentMilli(percent), 100_000n));
}

export function addMoney(...values: string[]): string {
  return fromPaisa(values.reduce((acc, v) => acc + toPaisa(v), 0n));
}

export function subMoney(a: string, b: string): string {
  return fromPaisa(toPaisa(a) - toPaisa(b));
}

export function cmpMoney(a: string, b: string): -1 | 0 | 1 {
  const d = toPaisa(a) - toPaisa(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

export function addQty(...values: string[]): string {
  return fromMilli(values.reduce((acc, v) => acc + toMilli(v), 0n));
}

export function subQty(a: string, b: string): string {
  return fromMilli(toMilli(a) - toMilli(b));
}

export function cmpQty(a: string, b: string): -1 | 0 | 1 {
  const d = toMilli(a) - toMilli(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/** Selling price from a cost and markup percentage, rounded to the paisa. */
export function applyMarkup(cost: string, markupPercent: string): string {
  return addMoney(cost, percentOf(cost, markupPercent));
}

/** Gross margin percentage of revenue, 2 decimals. Returns null when revenue is zero. */
export function marginPercent(revenue: string, cost: string): string | null {
  const r = toPaisa(revenue);
  if (r === 0n) return null;
  const m = divRound((r - toPaisa(cost)) * 10_000n, r);
  return fromPaisa(m);
}
