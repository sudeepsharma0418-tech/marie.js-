import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { isAdmin, requireMember } from "@/lib/auth";
import { compact, timeAgo } from "@/lib/social";
import { PersonAvatar } from "@/components/Avatar";
import { SearchIcon } from "@/components/Icons";
import type { Prisma } from "@prisma/client";
import { keyCheck } from "@/lib/elevenlabs";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

// Real numbers straight from the database. Private chats and memories are
// never shown here, only counts.
export default async function Admin({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireMember();
  if (!isAdmin(me.email)) notFound();
  const { q = "" } = await searchParams;

  const day = 86_400_000;
  const since7 = new Date(Date.now() - 7 * day);
  const since30 = new Date(Date.now() - 30 * day);
  const people = { isSystem: false };

  const [
    users, newUsers7, active7, active30, companions, publicCompanions, conversations,
    messages, userMessages7, aiMessages7, memories, photos, directMessages,
  ] = await Promise.all([
    db.user.count({ where: people }),
    db.user.count({ where: { ...people, createdAt: { gte: since7 } } }),
    db.user.count({ where: { ...people, conversations: { some: { updatedAt: { gte: since7 } } } } }),
    db.user.count({ where: { ...people, conversations: { some: { updatedAt: { gte: since30 } } } } }),
    db.companion.count({ where: { isOfficial: false } }),
    db.companion.count({ where: { isOfficial: false, isPublic: true } }),
    db.conversation.count(),
    db.message.count(),
    db.message.count({ where: { role: "user", createdAt: { gte: since7 } } }),
    db.message.count({ where: { role: "assistant", createdAt: { gte: since7 } } }),
    db.memory.count(),
    db.photo.count(),
    db.directMessage.count(),
  ]);

  const where: Prisma.UserWhereInput = { ...people };
  if (q.trim()) {
    where.OR = [
      { name: { contains: q.trim(), mode: "insensitive" } },
      { email: { contains: q.trim(), mode: "insensitive" } },
      { username: { contains: q.trim().toLowerCase() } },
    ];
  }
  const list = await db.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, name: true, email: true, username: true, createdAt: true,
      _count: { select: { companions: true, conversations: true, memories: true } },
      conversations: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
    },
  });

  const stats: [string, number, string?][] = [
    ["Users", users, `+${newUsers7} this week`],
    ["Active this week", active7, `${active30} in 30 days`],
    ["Companions made", companions, `${publicCompanions} shared`],
    ["Conversations", conversations],
    ["Messages", messages, `${userMessages7} sent this week`],
    ["Companion messages this week", aiMessages7],
    ["Memories", memories, `${photos} photos`],
    ["Direct messages", directMessages],
  ];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="muted">Live numbers from the database. AI costs are in the Anthropic Console.</p>
        </div>
      </div>

      <VoiceKeyStatus />

      <section className="stat-grid">
        {stats.map(([label, value, sub]) => (
          <div key={label} className="card">
            <span className="small muted">{label}</span>
            <strong className="stat-big">{compact(value)}</strong>
            {sub && <span className="tiny faint">{sub}</span>}
          </div>
        ))}
      </section>

      <section>
        <div className="section-head"><h2>Users</h2><span className="small faint">Newest first, up to 100</span></div>
        <form className="search" action="/admin" role="search" style={{ marginBottom: 12 }}>
          <SearchIcon />
          <input name="q" defaultValue={q} placeholder="Search by name, email or username" aria-label="Search users" />
        </form>
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr><th>Person</th><th>Email</th><th>Joined</th><th>Last active</th><th>Companions</th><th>Chats</th><th>Memories</th></tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={u.username ? `/u/${u.username}` : "#"} className="row" style={{ gap: 10 }}>
                      <PersonAvatar name={u.name} size={30} />
                      <span><strong>{u.name}</strong><br /><span className="tiny faint">@{u.username ?? "no username"}</span></span>
                    </Link>
                  </td>
                  <td className="small">{u.email}</td>
                  <td className="small">{u.createdAt.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="small">{u.conversations[0] ? timeAgo(u.conversations[0].updatedAt) : "never"}</td>
                  <td>{u._count.companions}</td>
                  <td>{u._count.conversations}</td>
                  <td>{u._count.memories}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={7} className="muted center">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

/** Shows whether the ElevenLabs key works, without showing the key itself. */
async function VoiceKeyStatus() {
  const k = await keyCheck();
  return (
    <section className="panel pad stack" style={{ gap: 6 }}>
      <strong>Voice key (ELEVENLABS_API_KEY)</strong>
      {!k.set ? (
        <p className="small muted">Not set. Add it in Vercel, then redeploy.</p>
      ) : (
        <>
          <p className="small">
            {k.ok ? "✅ " : "❌ "}{k.message}
          </p>
          <p className="small muted">
            What the site has: {k.startsSk ? "starts with sk_" : "does NOT start with sk_"} · {k.length} characters · ends in …{k.last4}
          </p>
          {!k.ok && (
            <p className="tiny faint">A full key is about 50 characters and is only shown once, right after you create it in ElevenLabs. After changing it in Vercel, redeploy.</p>
          )}
        </>
      )}
    </section>
  );
}
