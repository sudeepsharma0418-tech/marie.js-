// Voice cloning and speech with ElevenLabs. Set ELEVENLABS_API_KEY to turn it on.
const BASE = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
const KEY = process.env.ELEVENLABS_API_KEY || "";
// Fast, low cost model. Override with ELEVENLABS_MODEL if you like.
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";

export const CLONING_ENABLED = Boolean(KEY);
export const VOICE_UPLOAD = { maxBytes: 4 * 1024 * 1024, perUser: 5 };

/** The human readable message inside an ElevenLabs error body, if any. */
function providerMessage(body: string) {
  try {
    const d = JSON.parse(body).detail;
    const msg = typeof d === "string" ? d : d?.message ?? (Array.isArray(d) ? d.map((x: { msg?: string }) => x.msg).join("; ") : "");
    return String(msg || "").replace(/\.$/, "").slice(0, 200);
  } catch {
    return "";
  }
}

/** Turns an ElevenLabs error into a short message people can act on. */
export function explain(status: number, body: string, action: string) {
  const msg = providerMessage(body);
  const why = msg ? ` (ElevenLabs says: ${msg})` : "";
  const b = body.toLowerCase();
  if (b.includes("quota") || b.includes("credits") || status === 402) return `${action}: the voice account is out of credits.${why}`;
  if (b.includes("instant_voice_cloning") || b.includes("subscription") || b.includes("plan")) return `${action}: the voice account's plan doesn't include voice cloning (needs Starter or higher).${why}`;
  if (b.includes("permission") || b.includes("missing_permissions")) return `${action}: the API key is missing a permission (turn on Voices and Text to Speech for the key).${why}`;
  if (status === 401) return `${action}: the voice service rejected the API key.${why}`;
  return `${action}: ${msg || `voice service error ${status}`}.`;
}

/** Creates an instant voice clone from one recording. Returns the provider's voice id. */
export async function createClone(name: string, file: File): Promise<string> {
  const form = new FormData();
  form.set("name", name.slice(0, 80) || "Companion voice");
  form.set("description", "Uploaded on MemoryLane with the speaker's consent.");
  form.set("remove_background_noise", "true");
  form.append("files", file, file.name || "voice.mp3");
  const res = await fetch(`${BASE}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": KEY }, body: form });
  const raw = await res.text();
  let data: { voice_id?: string } = {};
  try { data = JSON.parse(raw); } catch {}
  if (!res.ok || !data.voice_id) {
    console.error("Voice clone failed:", res.status, raw.slice(0, 500));
    throw new Error(explain(res.status, raw, "Couldn't make the voice"));
  }
  return data.voice_id;
}

/** Speaks text in a cloned voice. Returns the provider's mp3 response. */
export function speech(voiceId: string, text: string) {
  return fetch(`${BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL }),
  });
}

/** Removes a cloned voice from ElevenLabs. Best effort. */
export async function deleteClone(voiceId: string) {
  if (!KEY) return;
  await fetch(`${BASE}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: { "xi-api-key": KEY } }).catch(() => {});
}
