import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  bigserial,
} from 'drizzle-orm/pg-core';
import { HOTEL_ROLES, ROLES } from '@hp/shared';
import { createdAt, inList, pk, ts, updatedAt } from './_helpers';
import { hotels } from './hotels';

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    role: text('role', { enum: ROLES }).notNull(),
    hotelId: uuid('hotel_id').references(() => hotels.id),
    passwordHash: text('password_hash'),
    isActive: boolean('is_active').notNull().default(true),
    preferredLanguage: text('preferred_language', { enum: ['en', 'ne'] })
      .notNull()
      .default('en'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    /** TOTP secret encrypted with APP_ENCRYPTION_KEY (AES-256-GCM). Never stored in plaintext. */
    mfaSecretEnc: text('mfa_secret_enc'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    index('users_hotel_idx').on(t.hotelId),
    check('users_role_chk', inList(t.role, ROLES)),
    // hotel roles must belong to exactly one hotel; internal roles must not
    check('users_hotel_scope_chk', sql`(${inList(t.role, HOTEL_ROLES)}) = (${t.hotelId} is not null)`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** sha256 of the random session token. The raw token only lives in the client cookie. */
    tokenHash: text('token_hash').notNull().unique(),
    csrfToken: text('csrf_token').notNull(),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const userInvitations = pgTable('user_invitations', {
  id: pk(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ROLES }).notNull(),
  hotelId: uuid('hotel_id').references(() => hotels.id),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});

export const authEvents = pgTable(
  'auth_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    email: text('email'),
    event: text('event').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    detail: text('detail'),
    createdAt: createdAt(),
  },
  (t) => [index('auth_events_user_idx').on(t.userId, t.createdAt)],
);
