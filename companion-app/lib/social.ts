import { db } from "./db";

/** Thread ids are stored with the smaller user id first, so each pair has one thread. */
export function pair(a: string, b: string) {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

export async function unreadCount(userId: string) {
  return db.directMessage.count({
    where: {
      readAt: null,
      senderId: { not: userId },
      thread: { OR: [{ userAId: userId }, { userBId: userId }] },
    },
  });
}

export function timeAgo(date: Date) {
  const s = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function compact(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
