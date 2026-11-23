import { requireMember } from "@/lib/auth";
import { CATEGORIES, LIMITS, VIBES } from "@/lib/config";
import { CLONING_ENABLED } from "@/lib/elevenlabs";
import CompanionForm, { type CompanionPreset } from "@/components/CompanionForm";

export const metadata = { title: "Create a companion" };

type Search = Record<string, string | undefined>;

// A link like /companions/new?name=...&tagline=... opens the form already filled in.
// Nothing is saved until the person presses Create.
function presetFrom(q: Search): CompanionPreset | undefined {
  const text = (key: string, max: number) => (q[key] ?? "").slice(0, max);
  const preset: CompanionPreset = {
    name: text("name", LIMITS.name),
    tagline: text("tagline", LIMITS.tagline),
    personality: text("personality", LIMITS.personality),
    backstory: text("story", LIMITS.backstory),
    greeting: text("greeting", LIMITS.greeting),
    vibe: (VIBES as readonly string[]).includes(q.vibe ?? "") ? q.vibe : undefined,
    category: (CATEGORIES as readonly string[]).includes(q.category ?? "") ? q.category : undefined,
    isPublic: q.visibility === "link" || q.visibility === "public",
    listed: q.visibility !== "link",
  };
  return preset.name || preset.personality ? preset : undefined;
}

export default async function NewCompanionPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireMember();
  const preset = presetFrom(await searchParams);
  return (
    <main className="page narrow">
      <div>
        <h1>Create a companion</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {preset
            ? "This form was filled in from a link. Check everything, change anything you like, then press Create."
            : "A mentor, a friend, a character, or someone you want to remember. Private unless you choose to share."}
        </p>
      </div>
      <CompanionForm preset={preset} cloning={CLONING_ENABLED} />
    </main>
  );
}
