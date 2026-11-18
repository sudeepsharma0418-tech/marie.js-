import Link from "next/link";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { timeAgo } from "@/lib/social";
import { Avatar } from "@/components/Avatar";
import CompanionCard, { cardSelect } from "@/components/CompanionCard";

export const metadata = { title: "Home" };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Home() {
  const user = await requireMember();

  const [chats, mine, suggested] = await Promise.all([
    db.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        companion: { select: { name: true, avatar: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true } },
      },
    }),
    db.companion.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 6, select: cardSelect }),
    db.companion.findMany({
      where: { isPublic: true, userId: { not: user.id }, conversations: { none: { userId: user.id } } },
      orderBy: [{ isOfficial: "desc" }, { conversations: { _count: "desc" } }],
      take: 3,
      select: cardSelect,
    }),
  ]);

  const first = user.name.split(" ")[0];

  return (
    <main className="page">
      <header className="row between wrap" style={{ alignItems: "flex-end" }}>
        <div>
          <p className="muted">{greeting()},</p>
          <h1 className="serif" style={{ fontSize: "2.6rem", lineHeight: 1.1, marginTop: 4 }}>{first}</h1>
        </div>
        <Link href="/companions/new" className="btn primary">New companion</Link>
      </header>

      <section>
        <div className="section-head"><h2>Recent conversations</h2></div>
        {chats.length > 0 ? (
          <div className="list">
            {chats.map((c) => {
              const last = c.messages[0];
              return (
                <Link key={c.id} href={`/chat/${c.id}`} className="list-item">
                  <Avatar name={c.companion.name} avatar={c.companion.avatar} size={40} />
                  <div className="grow">
                    <strong>{c.companion.name}</strong>
                    <p className="small muted truncate">
                      {last ? `${last.role === "user" ? "You: " : ""}${last.content}` : "Say hello"}
                    </p>
                  </div>
                  <span className="when">{timeAgo(c.updatedAt)}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="muted">No conversations yet. Create a companion, or start with someone below.</p>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Your companions</h2>
          {mine.length > 0 && <Link href={`/u/${user.username}`}>View all</Link>}
        </div>
        {mine.length > 0 ? (
          <div className="grid">{mine.map((c) => <CompanionCard key={c.id} c={c} showPrivacy />)}</div>
        ) : (
          <div className="panel pad row between wrap">
            <div>
              <h3>Create your first companion</h3>
              <p className="small muted" style={{ marginTop: 4 }}>Someone you love, a mentor, or a character. Private unless you share it.</p>
            </div>
            <Link href="/companions/new" className="btn outline">Get started</Link>
          </div>
        )}
      </section>

      {suggested.length > 0 && (
        <section>
          <div className="section-head"><h2>You might like</h2><Link href="/discover">Explore</Link></div>
          <div className="grid">{suggested.map((c) => <CompanionCard key={c.id} c={c} />)}</div>
        </section>
      )}
    </main>
  );
}
