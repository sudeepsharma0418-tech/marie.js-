import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { forgetMemory } from "../../../actions";
import CompanionForm from "../../new/CompanionForm";

export default async function EditCompanionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const companion = await db.companion.findFirst({ where: { id, userId: user.id } });
  if (!companion) notFound();

  return (
    <main className="page narrow">
      <Link href={`/companions/${companion.id}`} className="muted small">← Back to chat</Link>
      <h1>Edit {companion.name}</h1>
      <p className="muted">Changes apply to the next message. Your chat history stays.</p>

      <CompanionForm
        initial={{
          id: companion.id,
          name: companion.name,
          avatar: companion.avatar,
          vibe: companion.vibe,
          personality: companion.personality,
          backstory: companion.backstory,
          greeting: companion.greeting,
        }}
      />

      <section className="card form">
        <h2>What {companion.name} remembers about you</h2>
        {companion.memory ? (
          <>
            <p className="memory">{companion.memory}</p>
            <form action={forgetMemory}>
              <input type="hidden" name="id" value={companion.id} />
              <button className="btn ghost small">Forget all of this</button>
            </form>
          </>
        ) : (
          <p className="muted small">
            Nothing yet. As you chat, {companion.name} keeps short notes about you so it can
            remember things even in very long chats.
          </p>
        )}
      </section>
    </main>
  );
}
