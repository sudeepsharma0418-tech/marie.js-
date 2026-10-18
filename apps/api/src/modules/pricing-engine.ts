import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { applyMarkup, toPaisa } from '@hp/shared';
import type { DbOrTx } from '../db/client';
import { categories, pricingRules, products } from '../db/schema';
import { getSettings } from '../lib/settings';
import { todayNepal } from '../lib/http';

export interface ResolvedPrice {
  unitPrice: string;
  /** Human readable origin, e.g. "hotel_product:fixed_price". */
  source: string;
  ruleId: string | null;
  /** False when no usable price exists (e.g. no reference cost yet). */
  available: boolean;
}

type Rule = typeof pricingRules.$inferSelect;

/**
 * Selling price resolution. The most specific active rule wins:
 *   1. hotel + product      (customer specific)
 *   2. hotel + category     (nearest category up the tree)
 *   3. hotel                (blanket markup for the customer)
 *   4. product
 *   5. category             (nearest category up the tree)
 *   6. default rule
 *   7. company default markup setting
 * Customer-specific rules always beat general rules. Within a level the rule
 * with the latest valid_from (then created_at) wins. Markups apply to the
 * product's confidential reference cost.
 */
export async function resolvePrices(
  db: DbOrTx,
  hotelId: string | null,
  productIds: string[],
  on: string = todayNepal(),
): Promise<Map<string, ResolvedPrice>> {
  const result = new Map<string, ResolvedPrice>();
  if (productIds.length === 0) return result;

  const prods = await db
    .select({ id: products.id, categoryId: products.categoryId, referenceCost: products.referenceCost })
    .from(products)
    .where(inArray(products.id, productIds));
  const cats = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
  const chain = (catId: string) => {
    const out: string[] = [];
    let cur: string | null | undefined = catId;
    while (cur && !out.includes(cur)) {
      out.push(cur);
      cur = parentOf.get(cur);
    }
    return out;
  };

  const rules = await db
    .select()
    .from(pricingRules)
    .where(
      and(
        eq(pricingRules.isActive, true),
        lte(pricingRules.validFrom, on),
        or(isNull(pricingRules.validTo), gte(pricingRules.validTo, on)),
        hotelId
          ? or(isNull(pricingRules.hotelId), eq(pricingRules.hotelId, hotelId))
          : isNull(pricingRules.hotelId),
      ),
    )
    .orderBy(sql`${pricingRules.validFrom} desc, ${pricingRules.createdAt} desc`);

  const settings = await getSettings(db);
  const first = (pred: (r: Rule) => boolean) => rules.find(pred);

  for (const p of prods) {
    const catChain = chain(p.categoryId);
    let rule: Rule | undefined;
    if (hotelId) {
      rule = first((r) => r.scope === 'hotel_product' && r.productId === p.id);
      for (const c of catChain) {
        if (rule) break;
        rule = first((r) => r.scope === 'hotel_category' && r.categoryId === c);
      }
      rule ??= first((r) => r.scope === 'hotel');
    }
    rule ??= first((r) => r.scope === 'product' && r.productId === p.id);
    for (const c of catChain) {
      if (rule) break;
      rule = first((r) => r.scope === 'category' && r.categoryId === c);
    }
    rule ??= first((r) => r.scope === 'default');

    let price: string;
    let source: string;
    if (rule?.ruleType === 'fixed_price') {
      price = toTwo(rule.value);
      source = `${rule.scope}:fixed_price`;
    } else {
      const markup = rule ? rule.value : settings.defaultMarkupPercent;
      price = applyMarkup(p.referenceCost, markup);
      source = rule ? `${rule.scope}:markup` : 'company_default:markup';
    }
    result.set(p.id, { unitPrice: price, source, ruleId: rule?.id ?? null, available: toPaisa(price) > 0n });
  }
  return result;
}

/** numeric(14,3) rule value -> 2-decimal money string, rounding half up on the third decimal. */
function toTwo(v: string): string {
  const [i, f = ''] = v.split('.');
  const milli = BigInt(i + f.padEnd(3, '0').slice(0, 3));
  const paisa = (milli + 5n) / 10n;
  const s = paisa.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}
