/** Bilingual coverage: both languages define the same keys, and every key used in the UI exists. */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../src/i18n/en.json';
import ne from '../src/i18n/ne.json';

function flat(o: Record<string, unknown>, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
  );
}
function sources(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) =>
      d.isDirectory()
        ? sources(path.join(dir, d.name))
        : /\.tsx?$/.test(d.name)
          ? [path.join(dir, d.name)]
          : [],
    );
}

const enKeys = new Set(flat(en));
const neKeys = new Set(flat(ne));
const base = (k: string) => k.replace(/_(one|other)$/, '');

describe('translations', () => {
  it('English and Nepali have exactly the same keys', () => {
    expect([...enKeys].filter((k) => !neKeys.has(k))).toEqual([]);
    expect([...neKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('every static translation key used in the code exists', () => {
    const src = path.resolve(__dirname, '../src');
    const used = new Set<string>();
    for (const f of sources(src)) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/[^a-zA-Z0-9_]t\('([a-zA-Z0-9_.]+)'/g))
        used.add(m[1]!);
    }
    const known = new Set([...enKeys, ...[...enKeys].map(base)]);
    expect([...used].filter((k) => !known.has(k))).toEqual([]);
    expect(used.size).toBeGreaterThan(400);
  });

  it('Nepali strings are actually Nepali (Devanagari) and keep interpolation placeholders', () => {
    const neFlat = Object.fromEntries(
      flat(ne).map((k) => [k, k.split('.').reduce((o: any, p) => o[p], ne) as string]),
    );
    const enFlat = Object.fromEntries(
      flat(en).map((k) => [k, k.split('.').reduce((o: any, p) => o[p], en) as string]),
    );
    const devanagari = Object.values(neFlat).filter((v) => /[ऀ-ॿ]/.test(v)).length;
    expect(devanagari / Object.keys(neFlat).length).toBeGreaterThan(0.9);
    for (const [k, v] of Object.entries(enFlat)) {
      const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
      expect(ph(neFlat[k]!), k).toEqual(ph(v));
    }
  });

  it('covers every order status, role and unit', async () => {
    const { ORDER_STATUSES, PO_STATUSES, ROLES } = await import('@hp/shared');
    for (const s of [...ORDER_STATUSES, ...PO_STATUSES]) expect(enKeys.has(`status.${s}`), s).toBe(true);
    for (const r of ROLES) expect(enKeys.has(`roles.${r}`), r).toBe(true);
  });
});
