import { requireMember } from "@/lib/auth";
import CompanionForm from "@/components/CompanionForm";

export const metadata = { title: "Create a companion" };

export default async function NewCompanionPage() {
  await requireMember();
  return (
    <main className="page narrow">
      <div>
        <h1>Create a companion</h1>
        <p className="muted" style={{ marginTop: 8 }}>A mentor, a friend, a character, or someone you want to remember. Private unless you choose to share.</p>
      </div>
      <CompanionForm />
    </main>
  );
}
