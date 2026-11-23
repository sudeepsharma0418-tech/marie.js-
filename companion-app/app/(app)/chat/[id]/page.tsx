import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { SIMULATION_IDS } from "@/lib/official";
import { memorySrc } from "@/lib/photos";
import { CLONING_ENABLED } from "@/lib/elevenlabs";
import Chat from "./Chat";

export const metadata = { title: "Chat" };

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();

  const convo = await db.conversation.findFirst({
    where: { id, userId: user.id },
    include: {
      companion: { select: { id: true, name: true, avatar: true, photoId: true, image: true, vibe: true, tagline: true, userId: true, isPublic: true, voice: true, voiceCloneId: true } },
      // Newest 200 messages, flipped back into reading order below.
      messages: { orderBy: { createdAt: "desc" }, take: 200 },
    },
  });
  if (!convo) notFound();
  const messages = [...convo.messages].reverse();

  // The companion's memory lane: its owner's memories, or the public timeline of a simulation.
  const showLane = convo.companion.userId === user.id || SIMULATION_IDS.includes(convo.companion.id);
  const lane = showLane
    ? await db.memory.findMany({
        where: { companionId: convo.companion.id },
        orderBy: [{ year: { sort: "asc", nulls: "last" } }, { month: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
        take: 40,
        select: { id: true, title: true, year: true, place: true, photoId: true, image: true },
      })
    : [];

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
        voice: convo.companion.voice,
        hasClone: CLONING_ENABLED && Boolean(convo.companion.voiceCloneId),
      }}
      lane={lane.filter((m, i) => lane.findIndex((o) => o.title === m.title && o.year === m.year) === i).map((m) => ({ id: m.id, title: m.title, year: m.year, place: m.place, src: memorySrc(m) }))}
      initialMessages={messages.map((m) => ({
        id: m.id,
        role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
        content: m.content,
      }))}
    />
  );
}
