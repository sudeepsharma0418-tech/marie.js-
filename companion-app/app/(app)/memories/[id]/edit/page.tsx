import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { deleteMemory } from "@/app/actions";
import MemoryForm from "@/components/MemoryForm";
import ConfirmButton from "@/components/ConfirmButton";

export const metadata = { title: "Edit memory" };

export default async function EditMemory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  const [m, companions] = await Promise.all([
    db.memory.findFirst({ where: { id, userId: user.id } }),
    db.companion.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!m) notFound();

  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <Link href={`/memories/${m.id}`} className="muted small">← Back</Link>
          <h1 style={{ marginTop: 8 }}>Edit memory</h1>
        </div>
      </div>
      <MemoryForm companions={companions} initial={{
        id: m.id, title: m.title, story: m.story, year: m.year, month: m.month,
        place: m.place, category: m.category, companionId: m.companionId, photoId: m.photoId,
      }} />
      <form action={deleteMemory} className="row between wrap panel pad">
        <div>
          <strong>Delete this memory</strong>
          <p className="small muted">The photo is deleted too. This can&apos;t be undone.</p>
        </div>
        <input type="hidden" name="id" value={m.id} />
        <ConfirmButton message="Delete this memory? This can't be undone." className="btn outline danger">Delete</ConfirmButton>
      </form>
    </main>
  );
}
