import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { deleteCompanion } from "@/app/actions";
import { CLONING_ENABLED } from "@/lib/elevenlabs";
import { SIMULATION_IDS } from "@/lib/official";
import CompanionForm from "@/components/CompanionForm";
import ConfirmButton from "@/components/ConfirmButton";

export const metadata = { title: "Edit companion" };

export default async function EditCompanionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  const c = await db.companion.findFirst({ where: { id, userId: user.id }, include: { voiceClone: { select: { fileName: true } } } });
  if (!c) notFound();

  return (
    <main className="page narrow">
      <div>
        <Link href={`/c/${c.id}`} className="muted small">← Back to {c.name}</Link>
        <h1 style={{ marginTop: 10 }}>Edit {c.name}</h1>
        <p className="muted">Changes apply to everyone&apos;s next message. Chats and memories stay.</p>
      </div>
      <CompanionForm initial={{
        id: c.id, name: c.name, avatar: c.avatar, vibe: c.vibe, category: c.category, tagline: c.tagline,
        personality: c.personality, backstory: c.backstory, greeting: c.greeting, isPublic: c.isPublic, listed: c.listed, photoId: c.photoId, voice: c.voice,
        voiceClone: c.voiceClone,
      }} cloning={CLONING_ENABLED && !SIMULATION_IDS.includes(c.id)} />
      <section className="panel pad row between wrap">
        <div>
          <strong>Delete {c.name}</strong>
          <p className="small muted">Removes the companion and every conversation with it, including other people&apos;s.</p>
        </div>
        <form action={deleteCompanion}>
          <input type="hidden" name="id" value={c.id} />
          <ConfirmButton message={`Delete ${c.name}? This can't be undone.`} className="btn outline danger">Delete</ConfirmButton>
        </form>
      </section>
    </main>
  );
}
