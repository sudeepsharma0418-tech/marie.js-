import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { logout } from "../actions";

export default async function CompanionsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/companions" className="brand">✨ {APP_NAME}</Link>
        <div className="row gap">
          <span className="muted small">Hi, {user.name}</span>
          <form action={logout}>
            <button className="btn ghost small">Log out</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
