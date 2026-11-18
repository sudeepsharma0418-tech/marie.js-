import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { LIMITS, RATE_LIMITS } from "@/lib/config";
import { pair } from "@/lib/social";

export const runtime = "nodejs";

async function other(username: string | null | undefined, meId: string) {
  if (!username) return null;
  const u = await db.user.findUnique({ where: { username: username.toLowerCase() } });
  return u && u.id !== meId && !u.isSystem ? u : null;
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** New messages in a thread since `after`, and marks theirs as read. */
export async function GET(req: Request) {
  const me = await getUser();
  if (!me) return json({ error: "Not signed in" }, 401);
  const url = new URL(req.url);
  const them = await other(url.searchParams.get("with"), me.id);
  if (!them) return json({ error: "Not found" }, 404);

  const thread = await db.directThread.findUnique({ where: { userAId_userBId: pair(me.id, them.id) } });
  if (!thread) return json({ messages: [] });

  const after = url.searchParams.get("after");
  const messages = await db.directMessage.findMany({
    where: { threadId: thread.id, ...(after ? { createdAt: { gt: new Date(after) } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, senderId: true, content: true, createdAt: true },
  });
  await db.directMessage.updateMany({
    where: { threadId: thread.id, senderId: them.id, readAt: null },
    data: { readAt: new Date() },
  });
  return json({ messages: messages.map((m) => ({ ...m, mine: m.senderId === me.id })) });
}

export async function POST(req: Request) {
  const me = await getUser();
  if (!me) return json({ error: "You were logged out. Please log in again." }, 401);
  if (!me.username) return json({ error: "Pick a username first." }, 400);

  let body: { to?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const content = (body.content ?? "").trim();
  if (!content) return json({ error: "Empty message" }, 400);
  if (content.length > LIMITS.directMessage) return json({ error: "That message is too long." }, 400);

  const them = await other(body.to, me.id);
  if (!them) return json({ error: "That person doesn't exist." }, 404);

  const blocked = await db.block.findFirst({
    where: { OR: [{ blockerId: them.id, blockedId: me.id }, { blockerId: me.id, blockedId: them.id }] },
  });
  if (blocked) return json({ error: "You can't message this person." }, 403);

  const recent = await db.directMessage.count({
    where: { senderId: me.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
  });
  if (recent >= RATE_LIMITS.directPerMinute) return json({ error: "Slow down a little and try again in a minute." }, 429);

  const ids = pair(me.id, them.id);
  const thread = await db.directThread.upsert({
    where: { userAId_userBId: ids },
    update: { lastAt: new Date() },
    create: { ...ids },
  });
  const message = await db.directMessage.create({
    data: { threadId: thread.id, senderId: me.id, content },
    select: { id: true, senderId: true, content: true, createdAt: true },
  });
  return json({ message: { ...message, mine: true } });
}
