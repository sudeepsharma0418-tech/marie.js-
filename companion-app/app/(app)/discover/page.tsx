import Link from "next/link";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { CATEGORIES } from "@/lib/config";
import CompanionCard, { cardSelect } from "@/components/CompanionCard";
import { SearchIcon } from "@/components/Icons";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Explore" };

type Search = { q?: string; cat?: string; tab?: string };

export default async function Discover({ searchParams }: { searchParams: Promise<Search> }) {
  const { q = "", cat = "", tab = "all" } = await searchParams;
  const user = await getUser();

  const where: Prisma.CompanionWhereInput = { isPublic: true };
  if (tab === "official") where.isOfficial = true;
  if (tab === "community") where.isOfficial = false;
  if ((CATEGORIES as readonly string[]).includes(cat)) where.category = cat;
  if (q.trim()) {
    where.OR = [
      { name: { contains: q.trim(), mode: "insensitive" } },
      { tagline: { contains: q.trim(), mode: "insensitive" } },
    ];
  }

  const companions = await db.companion.findMany({
    where,
    orderBy: [{ isOfficial: "desc" }, { conversations: { _count: "desc" } }, { updatedAt: "desc" }],
    take: 60,
    select: cardSelect,
  });

  const link = (next: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { q, cat, tab, ...next };
    if (merged.q) p.set("q", merged.q);
    if (merged.cat) p.set("cat", merged.cat);
    if (merged.tab && merged.tab !== "all") p.set("tab", merged.tab);
    const s = p.toString();
    return `/discover${s ? `?${s}` : ""}`;
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>
            Explore
          </h1>
          <p className="muted" style={{ marginTop: 8 }}>Every conversation is private to you, whoever made the companion.</p>
        </div>
        {user && <Link href="/companions/new" className="btn outline">Share your own</Link>}
      </div>

      <form className="search" action="/discover" role="search">
        <SearchIcon />
        <input name="q" defaultValue={q} placeholder="Search by name or what they're about" aria-label="Search companions" />
        {cat && <input type="hidden" name="cat" value={cat} />}
        {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
      </form>

      <div className="stack" style={{ gap: 12 }}>
        <div className="picker" role="tablist" aria-label="Source">
          {[["all", "All"], ["official", "Official"], ["community", "Community"]].map(([key, label]) => (
            <Link key={key} href={link({ tab: key })} className={`chip ${tab === key ? "on" : ""}`} role="tab" aria-selected={tab === key}>{label}</Link>
          ))}
        </div>
        <div className="picker" aria-label="Category">
          <Link href={link({ cat: "" })} className={`chip ${!cat ? "on" : ""}`}>Every category</Link>
          {CATEGORIES.map((c) => (
            <Link key={c} href={link({ cat: c })} className={`chip ${cat === c ? "on" : ""}`}>{c}</Link>
          ))}
        </div>
      </div>

      {companions.length > 0 ? (
        <div className="grid">{companions.map((c) => <CompanionCard key={c.id} c={c} />)}</div>
      ) : (
        <div className="panel empty">
          <p className="display">No one here yet</p>
          <p className="muted">Try another search, or be the first to share a companion in this space.</p>
          <Link href={link({ q: "", cat: "", tab: "all" })} className="btn outline sm">Clear filters</Link>
        </div>
      )}
    </main>
  );
}
