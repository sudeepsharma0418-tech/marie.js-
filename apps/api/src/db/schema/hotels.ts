import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, inList, money, pk, updatedAt } from './_helpers';
import { users } from './auth';
import { attachments } from './system';

export const HOTEL_TYPES = ['hotel', 'guesthouse', 'resort', 'homestay', 'lodge', 'other'] as const;
export const HOTEL_STATUSES = ['active', 'on_hold', 'suspended', 'closed'] as const;

export const hotels = pgTable(
  'hotels',
  {
    id: pk(),
    code: text('code').notNull().unique(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    hotelType: text('hotel_type', { enum: HOTEL_TYPES }).notNull().default('hotel'),
    pan: text('pan'),
    vatNumber: text('vat_number'),
    address: text('address').notNull(),
    city: text('city').notNull().default('Butwal'),
    district: text('district').default('Rupandehi'),
    phone: text('phone'),
    email: text('email'),
    primaryContactName: text('primary_contact_name'),
    primaryContactPhone: text('primary_contact_phone'),
    deliveryAddress: text('delivery_address'),
    deliveryInstructions: text('delivery_instructions'),
    /** Preferred delivery weekdays, 0 = Sunday. */
    deliveryDays: integer('delivery_days')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    creditLimit: money('credit_limit').notNull().default('0.00'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(15),
    status: text('status', { enum: HOTEL_STATUSES }).notNull().default('active'),
    accountManagerId: uuid('account_manager_id').references((): AnyPgColumn => users.id),
    /** When true, orders prepared by hotel purchasing staff need the hotel manager's approval. */
    requireManagerApproval: boolean('require_manager_approval').notNull().default(true),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('hotels_type_chk', inList(t.hotelType, HOTEL_TYPES)),
    check('hotels_status_chk', inList(t.status, HOTEL_STATUSES)),
    check('hotels_credit_limit_chk', sql`${t.creditLimit} >= 0`),
    check('hotels_terms_chk', sql`${t.paymentTermsDays} >= 0 and ${t.paymentTermsDays} <= 365`),
  ],
);

export const hotelContracts = pgTable(
  'hotel_contracts',
  {
    id: pk(),
    hotelId: uuid('hotel_id')
      .notNull()
      .references(() => hotels.id),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    termsSummary: text('terms_summary'),
    attachmentId: uuid('attachment_id').references((): AnyPgColumn => attachments.id),
    status: text('status', { enum: ['draft', 'active', 'superseded', 'expired'] })
      .notNull()
      .default('active'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('hotel_contracts_version_uq').on(t.hotelId, t.title, t.version),
    index('hotel_contracts_hotel_idx').on(t.hotelId),
  ],
);
