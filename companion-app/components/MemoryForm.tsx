"use client";

import { useActionState } from "react";
import { createMemory, updateMemory } from "@/app/actions";
import { LIMITS, MEMORY_CATEGORIES } from "@/lib/config";
import { MONTH_NAMES } from "@/lib/social";
import PhotoPicker from "./PhotoPicker";

export type MemoryDefaults = {
  id: string;
  title: string;
  story: string;
  year: number | null;
  month: number | null;
  place: string;
  category: string;
  companionId: string | null;
  photoId: string | null;
};

export default function MemoryForm({
  initial,
  companions,
  presetCompanionId,
}: {
  initial?: MemoryDefaults;
  companions: { id: string; name: string }[];
  presetCompanionId?: string;
}) {
  const [state, action, pending] = useActionState(initial ? updateMemory : createMemory, undefined);
  const thisYear = new Date().getFullYear();

  return (
    <form action={action} className="form panel pad" style={{ padding: 28 }}>
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className="label">
        Photo
        <PhotoPicker initialId={initial?.photoId} label="Add a photo of this moment" />
      </div>

      <label>
        Title
        <input name="title" required maxLength={LIMITS.memoryTitle} defaultValue={initial?.title} placeholder="e.g. Summer at the lake house" />
      </label>

      <div className="form-row">
        <label>
          Year <span className="hint">Optional</span>
          <input name="year" type="number" min={1800} max={thisYear + 1} defaultValue={initial?.year ?? ""} placeholder="1998" inputMode="numeric" />
        </label>
        <label>
          Month <span className="hint">Optional</span>
          <select name="month" defaultValue={initial?.month ?? ""}>
            <option value="">Any month</option>
            {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
      </div>

      <label>
        Place <span className="hint">Optional</span>
        <input name="place" maxLength={LIMITS.place} defaultValue={initial?.place} placeholder="e.g. Lake Tahoe" />
      </label>

      <label>
        Kind of memory
        <select name="category" defaultValue={initial?.category ?? MEMORY_CATEGORIES[0]}>
          {MEMORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <label>
        The story <span className="hint">What happened, who was there, why it matters</span>
        <textarea name="story" rows={6} maxLength={LIMITS.memoryStory} defaultValue={initial?.story}
          placeholder="Every summer Grandpa woke us at 6 to go fishing. He never caught anything, but he always said tomorrow would be the day." />
      </label>

      {companions.length > 0 && (
        <label>
          Connect to a companion <span className="hint">Optional</span>
          <select name="companionId" defaultValue={initial?.companionId ?? presetCompanionId ?? ""}>
            <option value="">Not connected</option>
            {companions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="hint">The companion can bring this memory up in conversation. If the companion is public, anyone chatting with it may hear about this memory.</span>
        </label>
      )}

      {state?.error && <p className="error" role="alert">{state.error}</p>}

      <button className="btn primary lg full" disabled={pending}>
        {pending ? "Saving..." : initial ? "Save changes" : "Save memory"}
      </button>
    </form>
  );
}
