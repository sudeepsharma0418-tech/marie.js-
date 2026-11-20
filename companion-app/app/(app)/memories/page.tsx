import Link from "next/link";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { MEMORY_CATEGORIES } from "@/lib/config";
import { memoryWhen } from "@/lib/social";
import { SearchIcon } from "@/components/Icons";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Memories" };

type Search = { q?: string; cat?: string; year?: string; view?: string };

export default async function Memories({ searchParams }: { searchParams: Promise<Search> }) {
  const { q = "", cat = "", year = "", view = "grid" } = await searchParams;
  const user = await requireMember();

  const where: Prisma.MemoryWhereInput = { userId: user.id };
  if ((MEMORY_CATEGORIES as readonly string[]).includes(cat)) where.category = cat;
  if (/^\d{4}$/.test(year)) where.year = Number(year);
  if (q.trim()) {
    where.OR = [
      { title: { contains: q.trim(), mode: "insensitive" } },
      { story: { contains: q.trim(), mode: "insensitive" } },
      { place: { contains: q.trim(), mode: "insensitive" } },
    ];
  }

  const [memories, years, total] = await Promise.all([
    db.memory.findMany({
      where,
      orderBy: [{ year: { sort: "desc", nulls: "last" } }, { month: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
      select: { id: true, title: true, story: true, year: true, month: true, place: true, category: true, photoId: true },
    }),
    db.memory.findMany({ where: { userId: user.id, year: { not: null } }, distinct: ["year"], select: { year: true }, orderBy: { year: "desc" } }),
    db.memory.count({ where: { userId: user.id } }),
  ]);

  const link = (next: Partial<Search>) => {
    const merged = { q, cat, year, view, ...next };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "view" && v === "grid")) p.set(k, v);
    const s = p.toString();
    return `/memories${s ? `?${s}` : ""}`;
  };

  // Group by year for the timeline. Sides alternate across the whole timeline.
  const side = new Map(memories.map((m, i) => [m.id, i % 2 === 0 ? "left" : "right"]));
  const groups = new Map<string, typeof memories>();
  for (const m of memories) {
    const key = m.year ? String(m.year) : "Undated";
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Memories</h1>
          <p className="muted">{total === 0 ? "Your private collection of photos and stories." : `${total} ${total === 1 ? "memory" : "memories"}, private to you.`}</p>
        </div>
        <Link href="/memories/new" className="btn primary">Add a memory</Link>
      </div>

      {total === 0 ? (
        <div className="ink-panel empty" style={{ padding: "64px 24px" }}>
          <h2 style={{ fontSize: "2rem", fontWeight: 400, letterSpacing: "-0.025em" }}>Start with one moment.</h2>
          <p className="muted" style={{ maxWidth: 440 }}>A photo from a holiday, a birthday, or an ordinary Sunday. Add the year and a few words about why it matters.</p>
          <Link href="/memories/new" className="btn light lg" style={{ marginTop: 12 }}>Add your first memory</Link>
        </div>
      ) : (
        <>
          <div className="stack" style={{ gap: 12 }}>
            <div className="row wrap between">
              <form className="search grow" action="/memories" role="search" style={{ maxWidth: 520 }}>
                <SearchIcon />
                <input name="q" defaultValue={q} placeholder="Search titles, stories and places" aria-label="Search memories" />
                {cat && <input type="hidden" name="cat" value={cat} />}
                {year && <input type="hidden" name="year" value={year} />}
                {view !== "grid" && <input type="hidden" name="view" value={view} />}
              </form>
              <div className="picker" role="tablist" aria-label="View">
                <Link href={link({ view: "grid" })} className={`chip ${view !== "timeline" ? "on" : ""}`} role="tab" aria-selected={view !== "timeline"}>Gallery</Link>
                <Link href={link({ view: "timeline" })} className={`chip ${view === "timeline" ? "on" : ""}`} role="tab" aria-selected={view === "timeline"}>Timeline</Link>
              </div>
            </div>
            <div className="picker" aria-label="Kind">
              <Link href={link({ cat: "" })} className={`chip ${!cat ? "on" : ""}`}>All</Link>
              {MEMORY_CATEGORIES.map((c) => <Link key={c} href={link({ cat: c })} className={`chip ${cat === c ? "on" : ""}`}>{c}</Link>)}
            </div>
            {years.length > 1 && (
              <div className="picker" aria-label="Year">
                <Link href={link({ year: "" })} className={`chip ${!year ? "on" : ""}`}>Every year</Link>
                {years.map((y) => <Link key={y.year} href={link({ year: String(y.year) })} className={`chip ${year === String(y.year) ? "on" : ""}`}>{y.year}</Link>)}
              </div>
            )}
          </div>

          {memories.length === 0 ? (
            <div className="panel empty">
              <p className="display">Nothing matches</p>
              <Link href="/memories" className="btn outline sm">Clear filters</Link>
            </div>
          ) : view === "timeline" ? (
            <div className="timeline">
              {[...groups.entries()].map(([label, items]) => (
                <section key={label} className="tl-year">
                  <h2 className="tl-label">{label}</h2>
                  <div className="tl-items">
                    {items.map((m) => (
                      <Link key={m.id} href={`/memories/${m.id}`} className={`tl-item ${side.get(m.id)}`}>
                        <span className="tl-dot" aria-hidden />
                        <div className="tl-card">
                          {m.photoId && <img src={`/api/photos/${m.photoId}?size=thumb`} alt="" loading="lazy" />}
                          <div className="tl-text">
                            <p className="tiny faint">{[memoryWhen(m), m.place].filter(Boolean).join(" · ") || m.category}</p>
                            <h3>{m.title}</h3>
                            {m.story && <p className="small muted clamp2">{m.story}</p>}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="gallery">
              {memories.map((m) => (
                <Link key={m.id} href={`/memories/${m.id}`} className={`memory-card ${m.photoId ? "" : "text-only"}`}>
                  {m.photoId ? (
                    <img src={`/api/photos/${m.photoId}?size=thumb`} alt="" loading="lazy" />
                  ) : (
                    <p className="memory-quote clamp4">{m.story}</p>
                  )}
                  <div className="memory-meta">
                    <strong className="truncate">{m.title}</strong>
                    <span className="tiny faint">{[memoryWhen(m), m.place].filter(Boolean).join(" · ") || m.category}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
