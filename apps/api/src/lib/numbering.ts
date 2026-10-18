import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { documentSeries, DOC_TYPES } from '../db/schema';
import { getSettings } from './settings';

type DocType = (typeof DOC_TYPES)[number];

export const DEFAULT_PREFIX: Record<DocType, string> = {
  order: 'ORD',
  product_request: 'REQ',
  purchase_order: 'PO',
  goods_receipt: 'GRN',
  delivery_run: 'RUN',
  delivery: 'DLV',
  invoice: 'INV',
  credit_note: 'CN',
  payment_in: 'RCPT',
  payment_out: 'PAY',
  supplier_bill: 'BILL',
};

/**
 * Allocate the next number in a gapless series for the current fiscal year.
 * Must be called inside a transaction: the series row is locked until commit,
 * and a rollback also rolls back the increment, so issued numbers have no gaps.
 */
export async function nextDocumentNumber(tx: DbOrTx, docType: DocType): Promise<string> {
  const settings = await getSettings(tx);
  const fy = settings.fiscalYearLabel;
  await tx
    .insert(documentSeries)
    .values({ docType, fiscalYear: fy, prefix: DEFAULT_PREFIX[docType] })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(documentSeries)
    .where(and(eq(documentSeries.docType, docType), eq(documentSeries.fiscalYear, fy)))
    .for('update');
  if (!row) throw new Error('document series missing');
  await tx
    .update(documentSeries)
    .set({ nextNumber: sql`${documentSeries.nextNumber} + 1` })
    .where(eq(documentSeries.id, row.id));
  return `${row.prefix}-${fy.replace(/\//g, '')}-${String(row.nextNumber).padStart(row.padding, '0')}`;
}
