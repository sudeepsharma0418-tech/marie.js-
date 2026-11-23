import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { CLONING_ENABLED, VOICE_UPLOAD, createClone } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const maxDuration = 60;

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** Upload a voice recording and clone it. Needs the uploader's consent. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return json({ error: "Please log in again." }, 401);
  if (!CLONING_ENABLED) return json({ error: "Voice cloning isn't turned on yet." }, 503);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "That file is too big. Use a clip under 4 MB (about 2 minutes of mp3)." }, 400);
  }
  const file = form.get("file");
  if (form.get("consent") !== "yes") return json({ error: "Please confirm you have permission to use this voice." }, 400);
  if (!(file instanceof File) || !file.size) return json({ error: "Pick a recording first." }, 400);
  if (!file.type.startsWith("audio/") && !/\.(mp3|m4a|wav|ogg|webm|aac)$/i.test(file.name)) return json({ error: "Please use an audio file like mp3, m4a or wav." }, 400);
  if (file.size > VOICE_UPLOAD.maxBytes) return json({ error: "That file is too big. Use a clip under 4 MB (about 2 minutes of mp3)." }, 400);

  const count = await db.voiceClone.count({ where: { userId: user.id } });
  if (count >= VOICE_UPLOAD.perUser) return json({ error: `You can have up to ${VOICE_UPLOAD.perUser} uploaded voices for now.` }, 400);

  try {
    const name = String(form.get("name") || "").trim();
    const providerId = await createClone(`${name || "Companion"} (${user.username || user.id})`, file);
    const clone = await db.voiceClone.create({ data: { userId: user.id, providerId, fileName: file.name.slice(0, 120) } });
    return json({ id: clone.id, fileName: clone.fileName });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't make that voice." }, 502);
  }
}
