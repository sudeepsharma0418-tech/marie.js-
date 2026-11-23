import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { memoryWhen } from "@/lib/social";
import { Avatar } from "@/components/Avatar";

export const metadata = { title: "Memory" };

export default async function MemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  const m = await db.memory.findFirst({
    where: { id, userId: user.id },
    include: { companion: { select: { id: true, name: true, avatar: true, photoId: true, image: true } } },
  });
  if (!m) notFound();
  const when = memoryWhen(m);

  return (
    <main className="page narrow" style={{ maxWidth: 820 }}>
      <div className="row between">
        <Link href="/memories" className="muted small">← Memories</Link>
        <Link href={`/memories/${m.id}/edit`} className="btn outline sm">Edit</Link>
      </div>

      <article className="stack-lg">
        {m.photoId && (
          <img className="memory-photo" src={`/api/photos/${m.photoId}`} alt={m.title} />
        )}
        <div className="stack" style={{ gap: 10 }}>
          <p className="small faint">{[when, m.place, m.category].filter(Boolean).join(" · ")}</p>
          <h1 style={{ fontSize: "2.4rem", fontWeight: 400, letterSpacing: "-0.025em" }}>{m.title}</h1>
          {m.story && <p className="memory-story">{m.story}</p>}
        </div>

        {m.companion && (
          <Link href={`/c/${m.companion.id}`} className="panel row" style={{ padding: 18, gap: 14 }}>
            <Avatar name={m.companion.name} avatar={m.companion.avatar} photoId={m.companion.photoId} image={m.companion.image} size={44} />
            <div className="grow">
              <p className="small faint">Connected to</p>
              <strong>{m.companion.name}</strong>
            </div>
            <span className="small muted">They can bring this up in conversation</span>
          </Link>
        )}
      </article>
    </main>
  );
}
