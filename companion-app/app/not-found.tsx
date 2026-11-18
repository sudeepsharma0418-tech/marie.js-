import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-page">
      <div className="hero">
        <div className="hero-emoji">🔭</div>
        <h1>Nothing here</h1>
        <p className="muted">That page or companion doesn&apos;t exist, or it isn&apos;t yours.</p>
        <Link href="/companions" className="btn primary">Go to my companions</Link>
      </div>
    </main>
  );
}
