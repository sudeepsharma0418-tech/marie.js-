"use client";

import { useActionState, useState } from "react";
import { createCompanion, updateCompanion } from "@/app/actions";
import { AVATARS, CATEGORIES, LIMITS, VIBES } from "@/lib/config";
import { Avatar } from "./Avatar";
import PhotoPicker from "./PhotoPicker";
import VoiceUpload from "./VoiceUpload";
import { previewVoice } from "./useVoice";
import { VOICES, VOICE_KEYS, voiceStyle } from "@/lib/voices";

export type CompanionDefaults = {
  id: string;
  name: string;
  avatar: string;
  vibe: string;
  category: string;
  tagline: string;
  personality: string;
  backstory: string;
  greeting: string;
  isPublic: boolean;
  listed: boolean;
  photoId: string | null;
  voice: string;
  voiceClone: { fileName: string } | null;
};

export type CompanionPreset = Partial<Omit<CompanionDefaults, "id" | "photoId" | "voiceClone">>;

export default function CompanionForm({
  initial,
  preset,
  cloning = false,
  sharedVoices = [],
}: {
  initial?: CompanionDefaults;
  preset?: CompanionPreset;
  cloning?: boolean;
  sharedVoices?: { id: string; label: string; hint: string }[];
}) {
  // Defaults come from the companion being edited, or from a prefilled link.
  const d: CompanionPreset | undefined = initial ?? preset;
  const editing = Boolean(initial);
  const [state, action, pending] = useActionState(editing ? updateCompanion : createCompanion, undefined);

  const [name, setName] = useState(d?.name ?? "");
  const [avatar, setAvatar] = useState<string>(
    initial && (AVATARS as readonly string[]).includes(initial.avatar) ? initial.avatar : AVATARS[0],
  );
  const [vibe, setVibe] = useState<string>(d?.vibe ?? VIBES[0]);
  const [category, setCategory] = useState<string>(d?.category ?? CATEGORIES[0]);
  const [tagline, setTagline] = useState(d?.tagline ?? "");
  const [personality, setPersonality] = useState(d?.personality ?? "");
  const [backstory, setBackstory] = useState(d?.backstory ?? "");
  const [greeting, setGreeting] = useState(d?.greeting ?? "");
  const [voice, setVoice] = useState<string>(d?.voice || "natural");
  const [memCount, setMemCount] = useState(1);
  const [visibility, setVisibility] = useState<"private" | "link" | "public">(
    !d?.isPublic ? "private" : d.listed === false ? "link" : "public",
  );

  return (
    <form action={action} className="form panel pad" style={{ padding: 28 }}>
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className="form-preview">
        <Avatar name={name || "?"} avatar={avatar} size={56} />
        <div className="grow">
          <strong>{name || "Your companion"}</strong>
          <p className="small muted truncate">{tagline || "A short line about who they are"}</p>
        </div>
        <span className="badge plain">{visibility === "public" ? "Public" : visibility === "link" ? "Link only" : "Private"}</span>
      </div>

      <label>
        Name
        <input name="name" required maxLength={LIMITS.name} placeholder="e.g. Grandpa Joe, Luna, Coach Sam" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="label">
        Photo <span className="hint">Optional. A real picture makes them feel close.</span>
        <PhotoPicker initialId={initial?.photoId} round label="Add photo" />
      </div>

      <div className="label">
        Or pick a color
        <input type="hidden" name="avatar" value={avatar} />
        <div className="picker" role="radiogroup" aria-label="Look">
          {AVATARS.map((a) => (
            <button type="button" key={a} role="radio" aria-checked={a === avatar} aria-label={a}
              className={`av-pick ${a === avatar ? "on" : ""}`} style={{ borderRadius: "50%" }} onClick={() => setAvatar(a)}>
              <Avatar name={name || "A"} avatar={a} size={42} />
            </button>
          ))}
        </div>
      </div>

      <label>
        <span className="row between">Tagline <Counter value={tagline} max={LIMITS.tagline} /></span>
        <input name="tagline" maxLength={LIMITS.tagline} placeholder="e.g. Tells the best stories about the old farm." value={tagline} onChange={(e) => setTagline(e.target.value)} />
      </label>

      <div className="label">
        Vibe
        <input type="hidden" name="vibe" value={vibe} />
        <div className="picker" role="radiogroup" aria-label="Vibe">
          {VIBES.map((v) => (
            <button type="button" key={v} role="radio" aria-checked={v === vibe} className={`chip ${v === vibe ? "on" : ""}`} onClick={() => setVibe(v)}>{v}</button>
          ))}
        </div>
      </div>

      <div className="label">
        Category
        <input type="hidden" name="category" value={category} />
        <div className="picker" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={c === category} className={`chip ${c === category ? "on" : ""}`} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
      </div>

      <label>
        <span className="row between">Personality <Counter value={personality} max={LIMITS.personality} /></span>
        <textarea name="personality" required rows={4} maxLength={LIMITS.personality} value={personality} onChange={(e) => setPersonality(e.target.value)}
          placeholder="How do they talk? What do they care about? Favorite sayings, sense of humor, habits." />
      </label>

      <label>
        <span className="row between"><span>Story and memories <span className="hint">Optional</span></span><Counter value={backstory} max={LIMITS.backstory} /></span>
        <textarea name="backstory" rows={4} maxLength={LIMITS.backstory} value={backstory} onChange={(e) => setBackstory(e.target.value)}
          placeholder="Where they grew up, important people and places, stories they loved to tell." />
      </label>

      <label>
        First message <span className="hint">Optional</span>
        <input name="greeting" maxLength={LIMITS.greeting} value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="e.g. There you are! Pull up a chair." />
      </label>

      {!editing && (
        <div className="label">
          <span>Memories <span className="hint">Optional. Add moments you shared. {name || "They"} will remember them and can bring them up in chat.</span></span>
          <div className="mem-rows">
            {Array.from({ length: memCount }, (_, i) => (
              <div className="mem-row" key={i}>
                <PhotoPicker name={`mem_photo_${i}`} label="Add photo" />
                <div className="grow mem-fields">
                  <div className="row" style={{ gap: 8 }}>
                    <input name={`mem_title_${i}`} maxLength={LIMITS.memoryTitle} placeholder="e.g. Fishing at the lake" className="grow" aria-label={`Memory ${i + 1} title`} />
                    <input name={`mem_year_${i}`} inputMode="numeric" maxLength={4} placeholder="Year" style={{ width: 84 }} aria-label={`Memory ${i + 1} year`} />
                  </div>
                  <textarea name={`mem_story_${i}`} rows={2} maxLength={LIMITS.memoryStory} placeholder="What happened? A few words is enough." aria-label={`Memory ${i + 1} story`} />
                </div>
              </div>
            ))}
          </div>
          {memCount < 6 && (
            <button type="button" className="btn outline sm" style={{ alignSelf: "flex-start" }} onClick={() => setMemCount((n) => n + 1)}>
              + Add another memory
            </button>
          )}
        </div>
      )}

      <div className="label">
        <span>Voice <span className="hint">How {name || "they"} sound when you turn voice on in chat. Tap to hear it.</span></span>
        <input type="hidden" name="voice" value={voice} />
        <div className="picker" role="radiogroup" aria-label="Voice">
          {VOICE_KEYS.map((k) => (
            <button type="button" key={k} role="radio" aria-checked={k === voice} title={VOICES[k].hint}
              className={`chip ${k === voice ? "on" : ""}`}
              onClick={() => {
                setVoice(k);
                previewVoice(greeting || `Hi, I'm ${name || "your companion"}. It's so good to talk to you.`, name || "companion", voiceStyle(k));
              }}>
              {VOICES[k].label}
            </button>
          ))}
        </div>
        <span className="hint">{VOICES[voice as keyof typeof VOICES]?.hint}. Uses your device&apos;s voice, so it sounds a little different on each device.</span>
        <VoiceUpload enabled={cloning} companionName={name} initial={initial?.voiceClone} shared={sharedVoices} />
      </div>

      <div className="label">
        Who can see and chat with them
        <input type="hidden" name="visibility" value={visibility} />
        <div className="choice-list" role="radiogroup" aria-label="Visibility">
          {([
            ["private", "Only me", "Nobody else can find or open this companion."],
            ["link", "Anyone with the link", "Share the link with a teacher, friend or family. Not shown on Explore."],
            ["public", "Public", "Anyone can find it on Explore and chat with it."],
          ] as const).map(([value, title, hint]) => (
            <button type="button" key={value} role="radio" aria-checked={visibility === value}
              className={`choice ${visibility === value ? "on" : ""}`} onClick={() => setVisibility(value)}>
              <strong>{title}</strong>
              <span className="hint">{hint}</span>
            </button>
          ))}
        </div>
        <span className="hint">Everyone&apos;s conversations stay private. Never share a companion based on a real person without their family&apos;s consent.</span>
      </div>

      {state?.error && <p className="error" role="alert">{state.error}</p>}

      <button className="btn primary lg full" disabled={pending}>
        {pending ? "Saving..." : editing ? "Save changes" : "Create companion"}
      </button>
    </form>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`hint counter ${value.length > max * 0.9 ? "near" : ""}`}>{value.length}/{max}</span>;
}
