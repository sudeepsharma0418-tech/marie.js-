"use client";

import { useActionState } from "react";
import { saveProfile } from "@/app/actions";
import { LIMITS } from "@/lib/config";

export default function ProfileForm({
  initial,
  next,
}: {
  initial: { name: string; username: string; bio: string };
  next?: "home";
}) {
  const [state, action, pending] = useActionState(saveProfile, undefined);
  return (
    <form action={action} className="form">
      {next && <input type="hidden" name="next" value={next} />}
      <label>
        Name
        <input name="name" required maxLength={60} defaultValue={initial.name} />
      </label>
      <label>
        Username
        <input
          name="username"
          required
          minLength={3}
          maxLength={20}
          pattern="[a-zA-Z0-9_]{3,20}"
          defaultValue={initial.username}
          placeholder="sam"
        />
        <span className="hint">Your profile lives at /u/username.</span>
      </label>
      <label>
        Bio <span className="hint">Optional</span>
        <textarea name="bio" rows={3} maxLength={LIMITS.bio} defaultValue={initial.bio} placeholder="Night owl, sci fi nerd, building my first companion." />
      </label>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <p className="small" style={{ color: "var(--ok)" }}>{state.ok}</p>}
      <button className="btn primary" disabled={pending}>{pending ? "Saving..." : next ? "Continue" : "Save profile"}</button>
    </form>
  );
}
