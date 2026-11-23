import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { CLONING_ENABLED, createClone, deleteClone } from "./elevenlabs";
import { SYSTEM_EMAIL } from "./official";

// Voices built into the app that anyone can pick when making a companion.
// Each is cloned from a recording in /voices, with the speaker's permission.
export const SHARED_VOICES = [
  {
    slug: "sanjay-youtuber",
    label: "Sanjay, YouTuber voice",
    hint: "Loud, fast and high energy, like a YouTube host",
    file: "sanjay-youtuber.mp3",
  },
];

export type SharedVoice = { id: string; label: string; hint: string };

let ready: Promise<SharedVoice[]> | null = null;

/** Makes sure each shared voice exists on ElevenLabs, and returns them for the form. */
export function getSharedVoices(): Promise<SharedVoice[]> {
  if (!CLONING_ENABLED) return Promise.resolve([]);
  ready ??= load().catch((err) => {
    console.error("Shared voices failed:", err);
    ready = null; // try again on the next visit
    return [];
  });
  return ready;
}

async function load(): Promise<SharedVoice[]> {
  const system = await db.user.findUnique({ where: { email: SYSTEM_EMAIL }, select: { id: true } });
  if (!system) return [];
  const out: SharedVoice[] = [];
  for (const v of SHARED_VOICES) {
    let row = await db.voiceClone.findUnique({ where: { slug: v.slug } });
    if (!row) {
      const data = await readFile(path.join(process.cwd(), "voices", v.file));
      const providerId = await createClone(v.label, new File([data], v.file, { type: "audio/mpeg" }));
      try {
        row = await db.voiceClone.create({
          data: { userId: system.id, providerId, fileName: v.file, shared: true, slug: v.slug, label: v.label },
        });
      } catch {
        // Another visit made it at the same moment: keep theirs, remove ours.
        await deleteClone(providerId);
        row = await db.voiceClone.findUnique({ where: { slug: v.slug } });
        if (!row) continue;
      }
    }
    out.push({ id: row.id, label: v.label, hint: v.hint });
  }
  return out;
}
