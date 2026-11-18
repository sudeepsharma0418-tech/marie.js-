import { requireMember } from "@/lib/auth";
import CompanionForm from "@/components/CompanionForm";

export const metadata = { title: "Create a companion" };

export default async function NewCompanionPage() {
  await requireMember();
  return (
    <main className="page narrow">
      <div>
        <span className="eyebrow">Create</span>
        <h1 className="display" style={{ fontSize: "2.4rem", fontWeight: 400, marginTop: 8 }}>Bring someone <em>to life</em></h1>
        <p className="muted" style={{ marginTop: 8 }}>A mentor, a friend, a character, or someone you want to remember. Private unless you choose to share.</p>
      </div>
      <CompanionForm />
    </main>
  );
}
