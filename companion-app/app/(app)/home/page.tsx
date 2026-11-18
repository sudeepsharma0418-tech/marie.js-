import Link from "next/link";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { timeAgo } from "@/lib/social";
import { Avatar } from "@/components/Avatar";
import CompanionCard, { cardSelect } from "@/components/CompanionCard";
import { PlusIcon } from "@/components/Icons";

export const metadata = { title: "Home" };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Home() {
  const user = await requireMember();

  const [chats, mine, official, community] = await Promise.all([
    db.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 8,
      include: {
        companion: { select: { name: true, avatar: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true } },
      },
    }),
    db.companion.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, select: cardSelect }),
    db.companion.findMany({ where: { isOfficial: true }, orderBy: { createdAt: "asc" }, take: 4, select: cardSelect }),
    db.companion.findMany({
      where: { isPublic: true, isOfficial: false, userId: { not: user.id } },
      orderBy: { updatedAt: "desc" },
      take: 4,
      select: cardSelect,
    }),
  ]);

  const first = user.name.split(" ")[0];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="muted small">{greeting()},</p>
          <h1 className="display" style={{ fontSize: "2.6rem", fontWeight: 400 }}>{first}</h1>
        </div>
        <Link href="/companions/new" className="btn primary"><PlusIcon className="" /> New companion</Link>
      </div>

      {chats.length > 0 ? (
        <section>
          <div className="section-head"><h2>Continue chatting</h2></div>
          <div className="panel list">
            {chats.map((c) => {
              const last = c.messages[0];
              return (
                <Link key={c.id} href={`/chat/${c.id}`} className="list-item">
                  <Avatar name={c.companion.name} avatar={c.companion.avatar} size={44} />
                  <div className="grow">
                    <strong>{c.companion.name}</strong>
                    <p className="small muted truncate">
                      {last ? `${last.role === "user" ? "You: " : ""}${last.content}` : "Say hi"}
                    </p>
                  </div>
                  <span className="when">{timeAgo(c.updatedAt)}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="panel empty">
          <p className="display">Who do you want to talk to?</p>
          <p className="muted">Pick someone below, or make your own companion in a minute.</p>
        </section>
      )}

      <section>
        <div className="section-head"><h2>Official companions</h2><Link href="/discover">See all</Link></div>
        <div className="grid">{official.map((c) => <CompanionCard key={c.id} c={c} />)}</div>
      </section>

      {community.length > 0 && (
        <section>
          <div className="section-head"><h2>New from the community</h2><Link href="/discover?tab=community">Explore</Link></div>
          <div className="grid">{community.map((c) => <CompanionCard key={c.id} c={c} />)}</div>
        </section>
      )}

      <section>
        <div className="section-head"><h2>Made by you</h2><Link href="/companions/new">Create</Link></div>
        {mine.length > 0 ? (
          <div className="grid">{mine.map((c) => <CompanionCard key={c.id} c={c} showPrivacy />)}</div>
        ) : (
          <Link href="/companions/new" className="card" style={{ alignItems: "center", justifyContent: "center", minHeight: 140, borderStyle: "dashed" }}>
            <PlusIcon className="faint big-icon" />
            <span className="muted small">Create your first companion</span>
          </Link>
        )}
      </section>
    </main>
  );
}
