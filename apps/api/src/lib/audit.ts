import { desc, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { auditLogs } from '../db/schema';
import { sha256 } from './crypto';
import type { Ctx } from './context';

const GENESIS = '0'.repeat(64);
const AUDIT_LOCK_KEY = 72_310_001;

/** Fields never written to the audit log. */
const REDACT = new Set(['passwordHash', 'password', 'mfaSecretEnc', 'tokenHash', 'csrfToken', 'token']);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT.has(k)) continue;
      out[k] = redact(v);
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** Deterministic JSON with sorted keys so the hash can be recomputed from stored rows. */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  hotelId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

export function auditHash(prevHash: string, row: Record<string, unknown>): string {
  return sha256(prevHash + canonical(row));
}

export function hashableRow(r: {
  occurredAt: Date;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  hotelId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
}) {
  return {
    occurredAt: r.occurredAt.toISOString(),
    actorId: r.actorId,
    actorRole: r.actorRole,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    hotelId: r.hotelId,
    reason: r.reason,
    before: r.before ?? null,
    after: r.after ?? null,
  };
}

/**
 * Write an audit record inside the caller's transaction. A transaction-scoped
 * advisory lock serialises writers so the hash chain stays linear.
 */
export async function audit(tx: DbOrTx, ctx: Ctx | null, input: AuditInput): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
  const [last] = await tx
    .select({ hash: auditLogs.hash })
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(1);
  const prevHash = last?.hash ?? GENESIS;
  const row = {
    occurredAt: new Date(),
    actorId: ctx?.actor.id ?? null,
    actorRole: ctx?.actor.role ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId != null ? String(input.entityId) : null,
    hotelId: input.hotelId ?? null,
    reason: input.reason ?? null,
    before: redact(input.before),
    after: redact(input.after),
  };
  const hash = auditHash(prevHash, hashableRow(row));
  await tx.insert(auditLogs).values({
    ...row,
    actorRole: row.actorRole as never,
    ip: ctx?.ip ?? null,
    requestId: ctx?.requestId ?? null,
    prevHash,
    hash,
  });
}

/** Walk the whole chain and report the first broken link, if any. */
export async function verifyAuditChain(
  db: DbOrTx,
): Promise<{ ok: boolean; checked: number; brokenAtId?: number }> {
  let prev = GENESIS;
  let checked = 0;
  let lastId = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.id} > ${lastId}`)
      .orderBy(auditLogs.id)
      .limit(1000);
    if (rows.length === 0) break;
    for (const r of rows) {
      const expected = auditHash(prev, hashableRow(r as never));
      if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked, brokenAtId: r.id };
      prev = r.hash;
      checked++;
      lastId = r.id;
    }
  }
  return { ok: true, checked };
}
