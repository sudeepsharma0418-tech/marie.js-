import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";

export default async function Home() {
  if (await getSession()) redirect("/companions");

  return (
    <main className="center-page">
      <div className="hero">
        <div className="hero-emoji">✨</div>
        <h1>{APP_NAME}</h1>
        <p className="muted">
          Create your own AI companion. Give it a name and a personality, then talk one to one,
          any time.
        </p>
        <div className="row gap">
          <Link href="/signup" className="btn primary">Get started</Link>
          <Link href="/login" className="btn ghost">Log in</Link>
        </div>
      </div>
    </main>
  );
}
