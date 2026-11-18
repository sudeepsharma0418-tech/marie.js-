import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import Chat from "./Chat";

export default async function CompanionChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const companion = await db.companion.findFirst({
    where: { id, userId: user.id },
    // Newest 200 messages, flipped back into reading order below.
    include: { messages: { orderBy: { createdAt: "desc" }, take: 200 } },
  });
  if (!companion) notFound();
  const messages = [...companion.messages].reverse();

  return (
    <Chat
      companion={{
        id: companion.id,
        name: companion.name,
        avatar: companion.avatar,
        vibe: companion.vibe,
      }}
      initialMessages={messages.map((m) => ({
        id: m.id,
        role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
        content: m.content,
      }))}
    />
  );
}
