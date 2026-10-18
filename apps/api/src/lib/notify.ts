import { and, eq, inArray } from 'drizzle-orm';
import type { Role } from '@hp/shared';
import type { DbOrTx } from '../db/client';
import { notifications, users } from '../db/schema';

export interface Note {
  kind: string;
  title: string;
  body?: string;
  link?: string;
}

/** In-app notifications. Email/SMS delivery is a later integration (see docs/KNOWN_LIMITATIONS.md). */
export async function notifyUsers(tx: DbOrTx, userIds: string[], note: Note) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await tx.insert(notifications).values(ids.map((userId) => ({ userId, ...note })));
}

export async function notifyRoles(tx: DbOrTx, roles: Role[], note: Note, hotelId?: string | null) {
  const conds = [inArray(users.role, roles), eq(users.isActive, true)];
  if (hotelId) conds.push(eq(users.hotelId, hotelId));
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(...conds));
  await notifyUsers(
    tx,
    rows.map((r) => r.id),
    note,
  );
}
