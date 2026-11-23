import Link from "next/link";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { PersonAvatar } from "@/components/Avatar";
import { SearchIcon } from "@/components/Icons";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "People" };

export default async function People({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const me = await requireMember();

  const where: Prisma.UserWhereInput = { isSystem: false, username: { not: null }, id: { not: me.id } };
  if (q.trim()) {
    where.OR = [
      { name: { contains: q.trim(), mode: "insensitive" } },
      { username: { contains: q.trim().toLowerCase().replace(/^@/, "") } },
    ];
  }
  const people = await db.user.findMany({
    where,
    orderBy: [{ companions: { _count: "desc" } }, { createdAt: "desc" }],
    take: 60,
    select: {
      id: true, name: true, username: true, bio: true,
      _count: { select: { companions: { where: { isPublic: true, listed: true } } } },
    },
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>People</h1>
        </div>
      </div>
      <form className="search" action="/people" role="search">
        <SearchIcon />
        <input name="q" defaultValue={q} placeholder="Search by name or @username" aria-label="Search people" />
      </form>
      {people.length === 0 ? (
        <div className="panel empty">
          <p className="display">{q ? "No one found" : "It's quiet here"}</p>
          <p className="muted">{q ? "Try a different name." : "Invite a friend and you'll see them here."}</p>
        </div>
      ) : (
        <div className="grid">
          {people.map((p) => (
            <Link key={p.id} href={`/u/${p.username}`} className="card">
              <div className="card-top">
                <PersonAvatar name={p.name} size={48} />
                <div className="grow">
                  <h3 className="truncate">{p.name}</h3>
                  <span className="tiny faint">@{p.username}</span>
                </div>
              </div>
              <p className="small muted clamp2" style={{ minHeight: "2.6em" }}>{p.bio || "No bio yet."}</p>
              <div className="meta"><span>{p._count.companions} public companion{p._count.companions === 1 ? "" : "s"}</span></div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
