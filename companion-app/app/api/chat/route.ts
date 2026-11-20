import { after } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { anthropic, buildSystem, type SharedMemory, EFFORT, FALLBACK_BETA, MODEL, refreshMemory, SUPPORTS_FALLBACK, toApiHistory } from "@/lib/ai";
import { LIMITS, MEMORY_EVERY, RATE_LIMITS } from "@/lib/config";
import { memoryWhen } from "@/lib/social";

export const runtime = "nodejs";

// How many past messages to send to the model with each reply.
// Older facts live on in the companion's memory notes.
const HISTORY = 40;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return text("You were logged out. Please log in again.", 401);

  let body: { conversationId?: string; message?: string; regenerate?: boolean };
  try {
    body = await req.json();
  } catch {
    return text("Bad request", 400);
  }

  const message = (body.message ?? "").trim();
  const regenerate = body.regenerate === true;
  if (!body.conversationId || (!message && !regenerate)) return text("Missing message", 400);
  if (message.length > LIMITS.message) return text("That message is too long.", 400);

  // Your own conversation, with a companion you still have access to.
  const convo = await db.conversation.findFirst({
    where: {
      id: body.conversationId,
      userId: user.id,
      companion: { OR: [{ isPublic: true }, { userId: user.id }] },
    },
    include: { companion: true },
  });
  if (!convo) return text("This companion is no longer available.", 404);
  const companion = convo.companion;

  // Simple per user rate limit, counted from saved messages.
  const now = Date.now();
  const sentBy = (ms: number) =>
    db.message.count({
      where: { role: "user", createdAt: { gte: new Date(now - ms) }, conversation: { userId: user.id } },
    });
  const [lastMinute, lastDay] = await Promise.all([sentBy(60_000), sentBy(86_400_000)]);
  if (lastMinute >= RATE_LIMITS.perMinute) {
    return text("You're sending messages really fast. Take a breath and try again in a minute.", 429);
  }
  if (lastDay >= RATE_LIMITS.perDay) {
    return text("You've hit today's message limit. Come back tomorrow!", 429);
  }

  let userMessage: { id: string } | null = null;
  if (regenerate) {
    // Drop the last reply (if any) and answer the last user message again.
    const lastMsg = await db.message.findFirst({
      where: { conversationId: convo.id },
      orderBy: { createdAt: "desc" },
    });
    if (lastMsg?.role === "assistant") {
      const hasUser = await db.message.count({ where: { conversationId: convo.id, role: "user" } });
      if (!hasUser) return text("Nothing to regenerate yet.", 400);
      await db.message.delete({ where: { id: lastMsg.id } });
    }
  } else {
    userMessage = await db.message.create({
      data: { conversationId: convo.id, companionId: companion.id, role: "user", content: message },
    });
  }

  const recent = await db.message.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY,
  });
  recent.reverse();
  const history = toApiHistory(recent);

  // Memories the creator connected to this companion (oldest first, trimmed to keep prompts small).
  const connected = await db.memory.findMany({
    where: { companionId: companion.id },
    orderBy: [{ year: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 40,
    select: { title: true, story: true, year: true, month: true, place: true },
  });
  const sharedMemories: SharedMemory[] = connected.map((m) => ({
    title: m.title,
    story: m.story.slice(0, 600),
    when: memoryWhen(m),
    place: m.place,
  }));

  const encoder = new TextEncoder();
  const apiStream = anthropic.beta.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    ...(SUPPORTS_FALLBACK ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    output_config: { effort: EFFORT },
    // Caches the system prompt and chat so far, so each new turn is cheaper and faster.
    cache_control: { type: "ephemeral" },
    system: buildSystem({ ...companion, memory: convo.memory }, user.name, sharedMemories),
    messages: history,
  });

  // Wait until the API accepts the request. If it fails here (bad key, outage),
  // drop the saved message so a retry doesn't send it twice.
  try {
    await apiStream.withResponse();
  } catch (err) {
    console.error("Chat error:", err);
    if (userMessage) await db.message.delete({ where: { id: userMessage.id } }).catch(() => {});
    return text("Sorry, I can't reply right now. Please try again.", 502);
  }

  let reply = "";
  let saved = false;
  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));

  // Saves whatever was written, even if the person closed the tab mid reply.
  async function saveReply() {
    if (saved || !reply.trim()) return;
    saved = true;
    await db.message.create({
      data: { conversationId: convo!.id, companionId: companion.id, role: "assistant", content: reply.trim() },
    });
    await db.conversation.update({ where: { id: convo!.id }, data: { updatedAt: new Date() } });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The browser went away. Keep collecting the reply so it still gets saved.
        }
      };

      try {
        for await (const event of apiStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            reply += event.delta.text;
            send(event.delta.text);
          }
        }
        const final = await apiStream.finalMessage();
        if (final.stop_reason === "refusal" && !reply.trim()) {
          send("Hmm, I'd rather not go there. Want to talk about something else?");
        }
      } catch (err) {
        if (!apiStream.aborted) {
          console.error("Chat error:", err);
          send(reply ? "\n\n(connection lost)" : "Sorry, I can't reply right now. Please try again.");
        }
      } finally {
        await saveReply().catch((e) => console.error("Save error:", e));
        finished();
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      apiStream.abort();
    },
  });

  // After the response is sent, refresh the memory notes every MEMORY_EVERY messages.
  after(async () => {
    await done;
    try {
      if (regenerate) return;
      const count = await db.message.count({ where: { conversationId: convo.id } });
      if (Math.floor(count / MEMORY_EVERY) === Math.floor((count - 2) / MEMORY_EVERY)) return;

      const latest = await db.message.findMany({
        where: { conversationId: convo.id },
        orderBy: { createdAt: "desc" },
        take: MEMORY_EVERY + 4,
      });
      const memory = await refreshMemory({
        companionName: companion.name,
        userName: user.name,
        oldMemory: convo.memory,
        transcript: toApiHistory(latest.reverse()),
      });
      if (memory) {
        await db.conversation.update({ where: { id: convo.id }, data: { memory: memory.slice(0, 4000) } });
      }
    } catch (err) {
      console.error("Memory update failed:", err);
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
