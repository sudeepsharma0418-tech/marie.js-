"use client";

import { useActionState, useState } from "react";
import { createCompanion, updateCompanion } from "@/app/actions";
import { AVATARS, CATEGORIES, LIMITS, VIBES } from "@/lib/config";
import { Avatar } from "./Avatar";

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
};

export default function CompanionForm({ initial }: { initial?: CompanionDefaults }) {
  const editing = Boolean(initial);
  const [state, action, pending] = useActionState(editing ? updateCompanion : createCompanion, undefined);

  const [name, setName] = useState(initial?.name ?? "");
  const [avatar, setAvatar] = useState<string>(
    initial && (AVATARS as readonly string[]).includes(initial.avatar) ? initial.avatar : AVATARS[0],
  );
  const [vibe, setVibe] = useState<string>(initial?.vibe ?? VIBES[0]);
  const [category, setCategory] = useState<string>(initial?.category ?? CATEGORIES[0]);
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [backstory, setBackstory] = useState(initial?.backstory ?? "");
  const [greeting, setGreeting] = useState(initial?.greeting ?? "");
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? false);

  return (
    <form action={action} className="form panel pad" style={{ padding: 28 }}>
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className="form-preview">
        <Avatar name={name || "?"} avatar={avatar} size={56} />
        <div className="grow">
          <strong>{name || "Your companion"}</strong>
          <p className="small muted truncate">{tagline || "A short line about who they are"}</p>
        </div>
        <span className="badge plain">{isPublic ? "Public" : "Private"}</span>
      </div>

      <label>
        Name
        <input name="name" required maxLength={LIMITS.name} placeholder="e.g. Grandpa Joe, Luna, Coach Sam" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="label">
        Look
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

      <label className="switch">
        <input type="checkbox" name="isPublic" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        <span>
          Share publicly
          <span className="hint" style={{ display: "block" }}>
            Anyone can find and chat with this companion. Their chats stay private. Never share a companion based on a real person without their family&apos;s consent.
          </span>
        </span>
      </label>

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
