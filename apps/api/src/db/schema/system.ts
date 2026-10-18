import {
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { APPROVAL_TYPES, ROLES } from '@hp/shared';
import { createdAt, inList, money, pk, ts } from './_helpers';
import { users } from './auth';
import { hotels } from './hotels';

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: pk(),
    type: text('type', { enum: APPROVAL_TYPES }).notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'cancelled'] })
      .notNull()
      .default('pending'),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    hotelId: uuid('hotel_id').references((): any => hotels.id),
    amount: money('amount'),
    summary: text('summary').notNull(),
    details: jsonb('details'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references((): any => users.id),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    decidedBy: uuid('decided_by').references((): any => users.id),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
  },
  (t) => [
    check('approval_requests_type_chk', inList(t.type, APPROVAL_TYPES)),
    // only one open request per target and type
    uniqueIndex('approval_requests_pending_uq')
      .on(t.type, t.targetId)
      .where(sql`${t.status} = 'pending'`),
    index('approval_requests_status_idx').on(t.status, t.requestedAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references((): any => users.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt)],
);

export const ATTACHMENT_CATEGORIES = [
  'contract',
  'product_image',
  'request_photo',
  'delivery_evidence',
  'payment_proof',
  'supplier_bill',
  'invoice_pdf',
  'other',
] as const;

export const attachments = pgTable(
  'attachments',
  {
    id: pk(),
    category: text('category', { enum: ATTACHMENT_CATEGORIES }).notNull(),
    /** Hotel the file belongs to, for tenant isolation. Null for internal files. */
    hotelId: uuid('hotel_id').references((): any => hotels.id),
    /** Internal-only files (supplier bills, contracts drafts) are never shown to hotel users. */
    internalOnly: boolean('internal_only').notNull().default(true),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references((): any => users.id),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [check('attachments_category_chk', inList(t.category, ATTACHMENT_CATEGORIES))],
);

/**
 * Tamper-evident audit log: append-only (enforced by trigger) and hash chained.
 * hash = sha256(prev_hash || canonical JSON of the row).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role', { enum: ROLES }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    hotelId: uuid('hotel_id'),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    requestId: text('request_id'),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorId, t.occurredAt),
    index('audit_logs_time_idx').on(t.occurredAt),
  ],
);
