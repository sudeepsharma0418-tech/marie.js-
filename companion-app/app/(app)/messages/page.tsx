import Link from "next/link";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { timeAgo } from "@/lib/social";
import { PersonAvatar } from "@/components/Avatar";

export const metadata = { title: "Messages" };

export default async function Messages() {
  const me = await requireMember();
  const threads = await db.directThread.findMany({
    where: { OR: [{ userAId: me.id }, { userBId: me.id }] },
    orderBy: { lastAt: "desc" },
    take: 50,
    include: {
      userA: { select: { id: true, name: true, username: true } },
      userB: { select: { id: true, name: true, username: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: { where: { readAt: null, senderId: { not: me.id } } } } },
    },
  });

  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p className="muted">Private conversations with real people.</p>
        </div>
        <Link href="/people" className="btn outline sm">Find people</Link>
      </div>

      {threads.length === 0 ? (
        <div className="panel empty">
          <p className="display">No messages yet</p>
          <p className="muted">Find someone whose companions you like and say hello.</p>
          <Link href="/people" className="btn primary">Browse people</Link>
        </div>
      ) : (
        <div className="panel list">
          {threads.map((t) => {
            const them = t.userA.id === me.id ? t.userB : t.userA;
            const last = t.messages[0];
            const unread = t._count.messages > 0;
            return (
              <Link key={t.id} href={`/messages/${them.username}`} className={`list-item ${unread ? "unread" : ""}`}>
                <PersonAvatar name={them.name} size={44} />
                <div className="grow">
                  <strong>{them.name}</strong>
                  <p className="small muted truncate preview">
                    {last ? `${last.senderId === me.id ? "You: " : ""}${last.content}` : "Say hello"}
                  </p>
                </div>
                <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
                  <span className="when">{timeAgo(t.lastAt)}</span>
                  {unread && <span className="count">{t._count.messages}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
