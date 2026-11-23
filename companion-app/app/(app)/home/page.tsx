import Link from "next/link";
import { db } from "@/lib/db";
import { memorySrc } from "@/lib/photos";
import { requireMember } from "@/lib/auth";
import { memoryWhen, timeAgo } from "@/lib/social";
import { Avatar } from "@/components/Avatar";
import CompanionCard, { cardSelect } from "@/components/CompanionCard";

export const metadata = { title: "Home" };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Home() {
  const user = await requireMember();

  const [chats, mine, suggested, memories] = await Promise.all([
    db.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        companion: { select: { name: true, avatar: true, photoId: true, image: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true } },
      },
    }),
    db.companion.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 6, select: cardSelect }),
    db.companion.findMany({
      where: { isPublic: true, listed: true, userId: { not: user.id }, conversations: { none: { userId: user.id } } },
      orderBy: [{ isOfficial: "desc" }, { conversations: { _count: "desc" } }],
      take: 3,
      select: cardSelect,
    }),
    db.memory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, title: true, year: true, month: true, place: true, photoId: true, image: true, story: true },
    }),
  ]);

  const first = user.name.split(" ")[0];

  return (
    <main className="page">
      <header className="row between wrap" style={{ alignItems: "flex-end" }}>
        <div>
          <p className="muted">{greeting()},</p>
          <h1 className="serif" style={{ fontSize: "3rem", lineHeight: 1.05, marginTop: 2 }}>{first}</h1>
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
                  <Avatar name={c.companion.name} avatar={c.companion.avatar} photoId={c.companion.photoId} image={c.companion.image} size={40} />
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
          <div className="ink-panel row between wrap" style={{ padding: 32, gap: 20 }}>
            <div>
              <h3 style={{ fontSize: "1.6rem", fontWeight: 400, letterSpacing: "-0.02em" }}>Keep their stories close.</h3>
              <p className="muted" style={{ marginTop: 6 }}>Someone you love, a mentor, or a character. Private unless you share it.</p>
            </div>
            <Link href="/companions/new" className="btn light lg">Create your first companion</Link>
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Recent memories</h2>
          <Link href={memories.length ? "/memories" : "/memories/new"}>{memories.length ? "View all" : "Add one"}</Link>
        </div>
        {memories.length > 0 ? (
          <div className="memory-strip">
            {memories.map((m) => (
              <Link key={m.id} href={`/memories/${m.id}`} className={`memory-card ${memorySrc(m) ? "" : "text-only"}`}>
                {memorySrc(m) ? <img src={memorySrc(m)} alt="" loading="lazy" /> : <p className="memory-quote clamp4">{m.story}</p>}
                <div className="memory-meta">
                  <strong className="truncate">{m.title}</strong>
                  <span className="tiny faint">{[memoryWhen(m), m.place].filter(Boolean).join(" · ")}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">Photos and stories you add appear here. <Link href="/memories/new" style={{ textDecoration: "underline" }}>Add your first memory</Link>.</p>
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
