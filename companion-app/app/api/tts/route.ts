import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { CLONING_ENABLED, explain, speech } from "@/lib/elevenlabs";
import { stripRefs } from "@/lib/refs";

export const runtime = "nodejs";

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Simple per person limit so nobody runs up the voice bill.
const recent = new Map<string, number[]>();
function allowed(userId: string) {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= 20) return false;
  list.push(now);
  recent.set(userId, list);
  return true;
}

/** Speaks a reply in the companion's uploaded voice. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return json({ error: "Please log in again." }, 401);
  if (!CLONING_ENABLED) return json({ error: "Voice cloning isn't turned on." }, 503);

  const body = (await req.json().catch(() => ({}))) as { companionId?: string; voiceId?: string; text?: string };
  const text = stripRefs(String(body.text ?? "")).replace(/[*_#`>]/g, "").trim().slice(0, 800);
  if (!text) return json({ error: "Nothing to say." }, 400);

  // Either a companion's voice, or a shared voice being previewed in the form.
  const clone = body.voiceId
    ? await db.voiceClone.findFirst({ where: { id: String(body.voiceId), OR: [{ shared: true }, { userId: user.id }] }, select: { providerId: true } })
    : (
        await db.companion.findFirst({
          where: { id: String(body.companionId ?? ""), OR: [{ isPublic: true }, { userId: user.id }] },
          select: { voiceClone: { select: { providerId: true } } },
        })
      )?.voiceClone;
  if (!clone) return json({ error: "This companion has no uploaded voice." }, 404);
  if (!allowed(user.id)) return json({ error: "Too many voice replies. Try again in a minute." }, 429);

  const res = await speech(clone.providerId, text);
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    console.error("Speech failed:", res.status, raw.slice(0, 500));
    return json({ error: explain(res.status, raw, "Couldn't play the uploaded voice") }, 502);
  }
  return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=3600" } });
}
