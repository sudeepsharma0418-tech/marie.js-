import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { pair } from "@/lib/social";
import DirectChat from "./DirectChat";

export const metadata = { title: "Messages" };

export default async function Thread({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const me = await requireMember();
  const them = await db.user.findUnique({
    where: { username: username.toLowerCase() },
    select: { id: true, name: true, username: true, isSystem: true },
  });
  if (!them || them.isSystem || them.id === me.id) notFound();

  const [thread, blocks] = await Promise.all([
    db.directThread.findUnique({
      where: { userAId_userBId: pair(me.id, them.id) },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 100 } },
    }),
    db.block.findMany({
      where: { OR: [{ blockerId: me.id, blockedId: them.id }, { blockerId: them.id, blockedId: me.id }] },
    }),
  ]);
  if (thread) {
    await db.directMessage.updateMany({
      where: { threadId: thread.id, senderId: them.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  const messages = [...(thread?.messages ?? [])].reverse().map((m) => ({
    id: m.id,
    content: m.content,
    mine: m.senderId === me.id,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <DirectChat
      them={{ name: them.name, username: them.username! }}
      initial={messages}
      iBlocked={blocks.some((b) => b.blockerId === me.id)}
      theyBlocked={blocks.some((b) => b.blockerId === them.id)}
    />
  );
}
