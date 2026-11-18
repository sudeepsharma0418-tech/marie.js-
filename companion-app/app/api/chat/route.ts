import { after } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { anthropic, buildSystem, EFFORT, FALLBACK_BETA, MODEL, refreshMemory, toApiHistory } from "@/lib/ai";
import { LIMITS, MEMORY_EVERY, RATE_LIMITS } from "@/lib/config";

export const runtime = "nodejs";

// How many past messages to send to the model with each reply.
// Older facts live on in the companion's memory notes.
const HISTORY = 40;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return text("You were logged out. Please log in again.", 401);

  let body: { companionId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return text("Bad request", 400);
  }

  const message = (body.message ?? "").trim();
  if (!body.companionId || !message) return text("Missing message", 400);
  if (message.length > LIMITS.message) return text("That message is too long.", 400);

  const companion = await db.companion.findFirst({
    where: { id: body.companionId, userId: user.id },
  });
  if (!companion) return text("Companion not found", 404);

  // Simple per user rate limit, counted from saved messages.
  const now = Date.now();
  const sentBy = (ms: number) =>
    db.message.count({
      where: { role: "user", createdAt: { gte: new Date(now - ms) }, companion: { userId: user.id } },
    });
  const [lastMinute, lastDay] = await Promise.all([sentBy(60_000), sentBy(86_400_000)]);
  if (lastMinute >= RATE_LIMITS.perMinute) {
    return text("You're sending messages really fast. Take a breath and try again in a minute.", 429);
  }
  if (lastDay >= RATE_LIMITS.perDay) {
    return text("You've hit today's message limit. Come back tomorrow!", 429);
  }

  const userMessage = await db.message.create({
    data: { companionId: companion.id, role: "user", content: message },
  });

  const recent = await db.message.findMany({
    where: { companionId: companion.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY,
  });
  recent.reverse();
  const history = toApiHistory(recent);

  const encoder = new TextEncoder();
  const apiStream = anthropic.beta.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: EFFORT },
    // Caches the system prompt and chat so far, so each new turn is cheaper and faster.
    cache_control: { type: "ephemeral" },
    system: buildSystem(companion, user.name),
    messages: history,
  });

  // Wait until the API accepts the request. If it fails here (bad key, outage),
  // drop the saved message so a retry doesn't send it twice.
  try {
    await apiStream.withResponse();
  } catch (err) {
    console.error("Chat error:", err);
    await db.message.delete({ where: { id: userMessage.id } }).catch(() => {});
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
      data: { companionId: companion!.id, role: "assistant", content: reply.trim() },
    });
    await db.companion.update({ where: { id: companion!.id }, data: { updatedAt: new Date() } });
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
      const count = await db.message.count({ where: { companionId: companion.id } });
      if (Math.floor(count / MEMORY_EVERY) === Math.floor((count - 2) / MEMORY_EVERY)) return;

      const latest = await db.message.findMany({
        where: { companionId: companion.id },
        orderBy: { createdAt: "desc" },
        take: MEMORY_EVERY + 4,
      });
      const memory = await refreshMemory({
        companionName: companion.name,
        userName: user.name,
        oldMemory: companion.memory,
        transcript: toApiHistory(latest.reverse()),
      });
      if (memory) {
        await db.companion.update({ where: { id: companion.id }, data: { memory: memory.slice(0, 4000) } });
      }
    } catch (err) {
      console.error("Memory update failed:", err);
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
