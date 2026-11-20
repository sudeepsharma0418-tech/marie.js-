import Link from "next/link";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import MemoryForm from "@/components/MemoryForm";

export const metadata = { title: "Add a memory" };

export default async function NewMemory({ searchParams }: { searchParams: Promise<{ companion?: string }> }) {
  const { companion } = await searchParams;
  const user = await requireMember();
  const companions = await db.companion.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <Link href="/memories" className="muted small">← Memories</Link>
          <h1 style={{ marginTop: 8 }}>Add a memory</h1>
          <p className="muted">A photo, a story, or both. Only you can see it.</p>
        </div>
      </div>
      <MemoryForm companions={companions} presetCompanionId={companion} />
    </main>
  );
}
