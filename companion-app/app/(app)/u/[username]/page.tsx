import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { PersonAvatar } from "@/components/Avatar";
import CompanionCard, { cardSelect } from "@/components/CompanionCard";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const u = await db.user.findUnique({ where: { username: username.toLowerCase() }, select: { name: true } });
  return { title: u ? `${u.name} (@${username})` : "Profile" };
}

export default async function Profile({ params }: Props) {
  const { username } = await params;
  const viewer = await getUser();
  const u = await db.user.findUnique({
    where: { username: username.toLowerCase() },
    select: { id: true, name: true, username: true, bio: true, createdAt: true, isSystem: true },
  });
  if (!u || u.isSystem) notFound();

  const isMe = viewer?.id === u.id;
  const companions = await db.companion.findMany({
    where: { userId: u.id, ...(isMe ? {} : { isPublic: true }) },
    orderBy: { updatedAt: "desc" },
    select: cardSelect,
  });

  return (
    <main className="page">
      <section className="panel pad" style={{ padding: 32 }}>
        <div className="profile-hero">
          <PersonAvatar name={u.name} size={112} />
          <div className="stack" style={{ gap: 10 }}>
            <h1>{u.name}</h1>
            <p className="muted">@{u.username} · joined {u.createdAt.toLocaleDateString("en", { month: "long", year: "numeric" })}</p>
            {u.bio && <p style={{ maxWidth: 560 }}>{u.bio}</p>}
            <div className="row wrap" style={{ marginTop: 6 }}>
              {isMe ? (
                <Link href="/settings" className="btn outline">Edit profile</Link>
              ) : viewer ? (
                <Link href={`/messages/${u.username}`} className="btn primary">Message</Link>
              ) : (
                <Link href="/signup" className="btn primary">Sign up to message</Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><h2>{isMe ? "Your companions" : "Companions"}</h2></div>
        {companions.length > 0 ? (
          <div className="grid">{companions.map((c) => <CompanionCard key={c.id} c={c} showPrivacy={isMe} />)}</div>
        ) : (
          <div className="panel empty"><p className="muted">{isMe ? "You haven't made any companions yet." : `${u.name} hasn't shared any companions yet.`}</p></div>
        )}
      </section>
    </main>
  );
}
