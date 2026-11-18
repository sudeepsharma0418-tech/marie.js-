"use client";

import { useActionState, useState } from "react";
import { createCompanion, updateCompanion } from "../../actions";
import { AVATARS, LIMITS, VIBES } from "@/lib/config";

export type CompanionDefaults = {
  id: string;
  name: string;
  avatar: string;
  vibe: string;
  personality: string;
  backstory: string;
  greeting: string;
};

// A few ready made ideas so people aren't staring at an empty box.
const STARTERS = [
  {
    name: "Luna",
    avatar: "🌙",
    vibe: "Calm",
    personality: "Gentle, curious and a great listener. Loves stargazing, rainy days and late night talks. Never judges.",
    backstory: "Grew up in a small seaside town and now studies astronomy. Keeps a notebook of everyone's favorite songs.",
    greeting: "Hey you. I was just watching the sky. How are you really doing today?",
  },
  {
    name: "Max",
    avatar: "🔥",
    vibe: "Motivating",
    personality: "High energy coach who hypes you up, holds you to your goals and celebrates small wins. Honest but kind.",
    backstory: "Former college runner who now helps friends train for their first 5k.",
    greeting: "Let's go! What's one thing you want to get done today?",
  },
  {
    name: "Pip",
    avatar: "🦊",
    vibe: "Witty",
    personality: "Quick, playful and a little sarcastic. Loves puns, weird facts and gentle teasing, but always has your back.",
    backstory: "",
    greeting: "Oh good, you're here. I have a fact about octopuses you are NOT ready for.",
  },
];

export default function CompanionForm({ initial }: { initial?: CompanionDefaults }) {
  const editing = Boolean(initial);
  const [state, action, pending] = useActionState(editing ? updateCompanion : createCompanion, undefined);

  const [name, setName] = useState(initial?.name ?? "");
  const [avatar, setAvatar] = useState(initial?.avatar ?? AVATARS[0]);
  const [vibe, setVibe] = useState<string>(initial?.vibe ?? VIBES[0]);
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [backstory, setBackstory] = useState(initial?.backstory ?? "");
  const [greeting, setGreeting] = useState(initial?.greeting ?? "");

  function applyStarter(s: (typeof STARTERS)[number]) {
    setName(s.name);
    setAvatar(s.avatar);
    setVibe(s.vibe);
    setPersonality(s.personality);
    setBackstory(s.backstory);
    setGreeting(s.greeting);
  }

  return (
    <form action={action} className="card form">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      {!editing && (
        <div>
          <span className="label">Need an idea? Start from one of these</span>
          <div className="picker">
            {STARTERS.map((s) => (
              <button type="button" key={s.name} className="chip" onClick={() => applyStarter(s)}>
                {s.avatar} {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="preview">
        <div className="avatar big">{avatar}</div>
        <div className="grow">
          <strong>{name || "Your companion"}</strong>
          <div className="muted small">{vibe}</div>
        </div>
      </div>

      <label>
        Name
        <input
          name="name"
          required
          maxLength={LIMITS.name}
          placeholder="e.g. Luna"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div>
        <span className="label">Avatar</span>
        <input type="hidden" name="avatar" value={avatar} />
        <div className="picker" role="radiogroup" aria-label="Avatar">
          {AVATARS.map((a) => (
            <button
              type="button"
              key={a}
              role="radio"
              aria-checked={a === avatar}
              className={`avatar pick ${a === avatar ? "selected" : ""}`}
              onClick={() => setAvatar(a)}
              aria-label={`Choose ${a}`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Vibe</span>
        <input type="hidden" name="vibe" value={vibe} />
        <div className="picker" role="radiogroup" aria-label="Vibe">
          {VIBES.map((v) => (
            <button
              type="button"
              key={v}
              role="radio"
              aria-checked={v === vibe}
              className={`chip ${v === vibe ? "selected" : ""}`}
              onClick={() => setVibe(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <label>
        <span className="row between">
          Personality <Counter value={personality} max={LIMITS.personality} />
        </span>
        <textarea
          name="personality"
          required
          rows={4}
          maxLength={LIMITS.personality}
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="e.g. Curious and kind. Loves music and late night talks. Teases a little but always has your back."
        />
      </label>

      <label>
        <span className="row between">
          <span>
            Backstory <span className="muted small">(optional)</span>
          </span>
          <Counter value={backstory} max={LIMITS.backstory} />
        </span>
        <textarea
          name="backstory"
          rows={3}
          maxLength={LIMITS.backstory}
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          placeholder="e.g. Grew up by the ocean, studies astronomy, dreams of traveling to Japan."
        />
      </label>

      <label>
        <span>
          First message <span className="muted small">(optional)</span>
        </span>
        <input
          name="greeting"
          maxLength={LIMITS.greeting}
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          placeholder="e.g. Hey you! I was just thinking about the stars. How was your day?"
        />
      </label>

      {state?.error && <p className="error" role="alert">{state.error}</p>}

      <button className="btn primary full" disabled={pending}>
        {pending ? "Saving..." : editing ? "Save changes" : "Create companion"}
      </button>
    </form>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const near = value.length > max * 0.9;
  return <span className={`muted small counter ${near ? "near" : ""}`}>{value.length}/{max}</span>;
}
