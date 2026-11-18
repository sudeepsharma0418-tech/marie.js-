import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export default async function CompanionsPage() {
  const user = await requireUser();
  const companions = await db.companion.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  return (
    <main className="page">
      <div className="row between">
        <h1>Your companions</h1>
        <Link href="/companions/new" className="btn primary">+ New companion</Link>
      </div>

      {companions.length === 0 ? (
        <div className="card empty">
          <div className="hero-emoji">🌱</div>
          <h2>No companions yet</h2>
          <p className="muted">Create your first one. It only takes a minute.</p>
          <Link href="/companions/new" className="btn primary">Create a companion</Link>
        </div>
      ) : (
        <div className="grid">
          {companions.map((c) => (
            <Link key={c.id} href={`/companions/${c.id}`} className="card companion-card">
              <div className="avatar big">{c.avatar}</div>
              <div className="companion-info">
                <div className="row between">
                  <strong>{c.name}</strong>
                  <span className="tag">{c.vibe}</span>
                </div>
                <p className="muted small clamp">
                  {c.messages[0]?.content ?? "Say hi!"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
