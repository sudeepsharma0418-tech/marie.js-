import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { companySettings } from '../db/schema';
import { AppError } from './errors';

export type CompanySettings = typeof companySettings.$inferSelect;

export async function getSettings(db: DbOrTx): Promise<CompanySettings> {
  const [s] = await db.select().from(companySettings).where(eq(companySettings.id, 1));
  if (!s)
    throw new AppError(500, 'not_configured', 'Company settings have not been initialised. Run the seed.');
  return s;
}
