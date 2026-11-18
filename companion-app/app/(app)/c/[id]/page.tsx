import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { compact } from "@/lib/social";
import { APP_NAME } from "@/lib/config";
import { startChat } from "@/app/actions";
import { Avatar, PersonAvatar } from "@/components/Avatar";
import CompanionCard, { cardSelect } from "@/components/CompanionCard";
import CopyLink from "@/components/CopyLink";
import { CheckIcon, GlobeIcon, LockIcon } from "@/components/Icons";

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
  const user = await getUser();
  const c = await load(id, user?.id);
  if (!c) notFound();

  const isOwner = user?.id === c.userId;
  const more = await db.companion.findMany({
    where: { isPublic: true, id: { not: c.id }, category: c.category },
    orderBy: { conversations: { _count: "desc" } },
    take: 3,
    select: cardSelect,
  });

  return (
    <main className="page">
      <section className="panel pad stack-lg" style={{ padding: 32 }}>
        <div className="profile-hero">
          <Avatar name={c.name} avatar={c.avatar} size={112} />
          <div className="stack" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="badge plain">{c.category}</span>
              {c.isOfficial && <span className="badge"><CheckIcon className="" /> Official</span>}
              {isOwner && (c.isPublic
                ? <span className="badge"><GlobeIcon className="" /> Public</span>
                : <span className="badge plain"><LockIcon className="" /> Only you</span>)}
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
            <div className="row"><PersonAvatar name={`${APP_NAME} Team`} /><div><strong>The {APP_NAME} team</strong><p className="small muted">Official companion</p></div></div>
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

      {more.length > 0 && (
        <section>
          <div className="section-head"><h2>More in {c.category}</h2><Link href={`/discover?cat=${c.category}`}>See all</Link></div>
          <div className="grid">{more.map((m) => <CompanionCard key={m.id} c={m} />)}</div>
        </section>
      )}
    </main>
  );
}
