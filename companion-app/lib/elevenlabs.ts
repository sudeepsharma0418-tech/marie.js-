// Voice cloning and speech with ElevenLabs. Set ELEVENLABS_API_KEY to turn it on.
const BASE = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
const KEY = process.env.ELEVENLABS_API_KEY || "";
// Fast, low cost model. Override with ELEVENLABS_MODEL if you like.
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";

export const CLONING_ENABLED = Boolean(KEY);
export const VOICE_UPLOAD = { maxBytes: 4 * 1024 * 1024, perUser: 5 };

/** Creates an instant voice clone from one recording. Returns the provider's voice id. */
export async function createClone(name: string, file: File): Promise<string> {
  const form = new FormData();
  form.set("name", name.slice(0, 80) || "Companion voice");
  form.set("description", "Uploaded on MemoryLane with the speaker's consent.");
  form.set("remove_background_noise", "true");
  form.append("files", file, file.name || "voice.mp3");
  const res = await fetch(`${BASE}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": KEY }, body: form });
  const data = (await res.json().catch(() => ({}))) as { voice_id?: string; detail?: { message?: string } | string };
  if (!res.ok || !data.voice_id) {
    const detail = typeof data.detail === "string" ? data.detail : data.detail?.message;
    console.error("Voice clone failed:", res.status, detail);
    throw new Error(res.status === 401 ? "Voice cloning isn't set up correctly." : "Couldn't make a voice from that recording. Try a clearer clip.");
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
