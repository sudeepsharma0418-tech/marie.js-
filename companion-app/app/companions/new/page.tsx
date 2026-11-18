import Link from "next/link";
import CompanionForm from "./CompanionForm";

export default function NewCompanionPage() {
  return (
    <main className="page narrow">
      <Link href="/companions" className="muted small">← Your companions</Link>
      <h1>Create a companion</h1>
      <p className="muted">Pick a look, a vibe and a personality. You can make as many as you like.</p>
      <CompanionForm />
    </main>
  );
}
