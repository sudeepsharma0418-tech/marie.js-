import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { ensureSchoolSim, ensureSetup, SIMULATION_IDS } from "@/lib/official";
import { memorySrc } from "@/lib/photos";
import { getUser } from "@/lib/auth";
import { compact, memoryWhen } from "@/lib/social";
import { APP_NAME } from "@/lib/config";
import { startChat } from "@/app/actions";
import { Avatar, PersonAvatar } from "@/components/Avatar";
import CompanionCard, { cardSelect } from "@/components/CompanionCard";
import CopyLink from "@/components/CopyLink";
import { CheckIcon, GlobeIcon, LockIcon, ShareIcon } from "@/components/Icons";

type Props = { params: Promise<{ id: string }> };

async function load(id: string, viewerId?: string) {
  return db.companion.findFirst({
    where: { id, OR: [{ isPublic: true }, ...(viewerId ? [{ userId: viewerId }] : [])] },
    include: {
      user: { select: { id: true, name: true, username: true, bio: true, isSystem: true } },
      _count: { select: { conversations: true, messages: true } },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await db.companion.findFirst({ where: { id, isPublic: true }, select: { name: true, tagline: true } });
  return c ? { title: c.name, description: c.tagline } : { title: "Companion" };
}

export default async function CompanionPage({ params }: Props) {
  const { id } = await params;
  await ensureSetup();
  await ensureSchoolSim();
  const user = await getUser();
  const c = await load(id, user?.id);
  if (!c) notFound();

  const isOwner = user?.id === c.userId;
  const isSim = SIMULATION_IDS.includes(c.id);
  const showMemories = isOwner || isSim;
  const memories = showMemories
    ? await db.memory.findMany({
        where: { companionId: c.id },
        orderBy: [{ year: { sort: "asc", nulls: "last" } }, { month: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
        take: 24,
        select: { id: true, title: true, year: true, month: true, photoId: true, image: true, credit: true, story: true, place: true },
      })
    : [];
  const more = await db.companion.findMany({
    where: { isPublic: true, listed: true, id: { not: c.id }, category: c.category },
    orderBy: { conversations: { _count: "desc" } },
    take: 3,
    select: cardSelect,
  });

  return (
    <main className="page">
      <section className="panel pad stack-lg" style={{ padding: 32 }}>
        <div className="profile-hero">
          <Avatar name={c.name} avatar={c.avatar} photoId={c.photoId} image={c.image} size={112} />
          <div className="stack" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="badge plain">{c.category}</span>
              {c.isOfficial && <span className="badge"><CheckIcon className="" /> Official</span>}
              {isSim && <span className="badge accent">AI simulation · not the real person</span>}
              {isOwner && (!c.isPublic
                ? <span className="badge plain"><LockIcon className="" /> Only you</span>
                : c.listed
                  ? <span className="badge"><GlobeIcon className="" /> Public</span>
                  : <span className="badge"><ShareIcon className="" /> Anyone with the link</span>)}
            </div>
            <h1>{c.name}</h1>
            {c.tagline && <p className="muted" style={{ fontSize: "1.05rem" }}>{c.tagline}</p>}
            <div className="row wrap" style={{ marginTop: 8 }}>
              {user ? (
                <form action={startChat}>
                  <input type="hidden" name="companionId" value={c.id} />
                  <button className="btn primary lg">Start a conversation</button>
                </form>
              ) : (
                <Link href="/signup" className="btn primary lg">Sign up to chat</Link>
              )}
              {isOwner && <Link href={`/companions/${c.id}/edit`} className="btn outline lg">Edit</Link>}
              {c.isPublic && <CopyLink path={`/c/${c.id}`} />}
            </div>
          </div>
        </div>

        <div className="stats">
          <div className="stat"><strong>{compact(c._count.conversations)}</strong><span>conversations</span></div>
          <div className="stat"><strong>{compact(c._count.messages)}</strong><span>messages</span></div>
          <div className="stat"><strong>{c.vibe}</strong><span>vibe</span></div>
        </div>

        {c.greeting && <p className="quote">&ldquo;{c.greeting}&rdquo;</p>}
      </section>

      <div className="split">
        <section className="panel pad stack">
          <h2>About {c.name}</h2>
          <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{c.personality}</p>
          {c.backstory && (
            <>
              <h2 style={{ marginTop: 8 }}>Story</h2>
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{c.backstory}</p>
            </>
          )}
          <p className="tiny faint" style={{ marginTop: 8 }}>
            {c.name} is an AI companion. It can make mistakes and is not a real person.
          </p>
        </section>

        <section className="panel pad stack">
          <span className="eyebrow">Made by</span>
          {c.user.isSystem ? (
            <div className="row"><PersonAvatar name={`${APP_NAME} Team`} /><div><strong>The {APP_NAME} team</strong><p className="small muted">{c.isOfficial ? "Official companion" : "AI simulation"}</p></div></div>
          ) : (
            <Link href={`/u/${c.user.username}`} className="row">
              <PersonAvatar name={c.user.name} />
              <div className="grow">
                <strong>{c.user.name}</strong>
                <p className="small muted">@{c.user.username}</p>
              </div>
            </Link>
          )}
          {!c.user.isSystem && c.user.bio && <p className="small muted">{c.user.bio}</p>}
        </section>
      </div>

      {showMemories && (
        <section>
          <div className="section-head">
            <h2>{isSim ? "Timeline from the public record" : `Memories ${c.name} knows`}</h2>
            {isOwner && <Link href={`/memories/new?companion=${c.id}`}>Add a memory</Link>}
          </div>
          {memories.length > 0 ? (
            <div className="memory-strip">
              {memories.map((m) => (
                <Link key={m.id} href={isOwner ? `/memories/${m.id}` : "#"} className={`memory-card ${memorySrc(m) ? "" : "text-only"}`}>
                  {memorySrc(m) ? <img src={memorySrc(m)} alt="" loading="lazy" /> : <p className="memory-quote clamp4">{m.story}</p>}
                  <div className="memory-meta">
                    <strong className="truncate">{m.title}</strong>
                    <span className="tiny faint">{[memoryWhen(m), m.place].filter(Boolean).join(" · ")}</span>
                    {m.credit && <span className="tiny faint" style={{ fontSize: "0.68rem" }}>{m.credit}</span>}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">Connect photos and stories so {c.name} can bring them up in conversation.</p>
          )}
        </section>
      )}

      {more.length > 0 && (
        <section>
          <div className="section-head"><h2>More in {c.category}</h2><Link href={`/discover?cat=${c.category}`}>See all</Link></div>
          <div className="grid">{more.map((m) => <CompanionCard key={m.id} c={m} />)}</div>
        </section>
      )}
    </main>
  );
}
