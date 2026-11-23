import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import Chat from "./Chat";

export const metadata = { title: "Chat" };

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();

  const convo = await db.conversation.findFirst({
    where: { id, userId: user.id },
    include: {
      companion: { select: { id: true, name: true, avatar: true, photoId: true, image: true, vibe: true, tagline: true, userId: true, isPublic: true } },
      // Newest 200 messages, flipped back into reading order below.
      messages: { orderBy: { createdAt: "desc" }, take: 200 },
    },
  });
  if (!convo) notFound();
  const messages = [...convo.messages].reverse();

  return (
    <Chat
      conversation={{ id: convo.id, memory: convo.memory }}
      companion={{
        id: convo.companion.id,
        name: convo.companion.name,
        avatar: convo.companion.avatar,
        photoId: convo.companion.photoId,
        image: convo.companion.image,
        vibe: convo.companion.vibe,
        tagline: convo.companion.tagline,
        isOwner: convo.companion.userId === user.id,
      }}
      initialMessages={messages.map((m) => ({
        id: m.id,
        role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
        content: m.content,
      }))}
    />
  );
}
