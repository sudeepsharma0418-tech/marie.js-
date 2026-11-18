import Link from "next/link";
import { getUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { ensureSetup } from "@/lib/official";
import { unreadCount } from "@/lib/social";
import NavLinks from "@/components/NavLinks";
import { Logo } from "@/components/Icons";
import { PersonAvatar } from "@/components/Avatar";

// The signed in app frame: sidebar on desktop, tab bar on phones.
// Public pages (companion and profile pages) also use it, with a simple top bar
// for visitors who aren't signed in.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await ensureSetup();
  const user = await getUser();

  if (!user) {
    return (
      <div className="landing">
        <header className="land-nav">
          <div className="inner">
            <Link href="/" className="brand" style={{ padding: 0 }}><Logo /> {APP_NAME}</Link>
            <div className="row">
              <Link href="/login" className="btn quiet sm">Log in</Link>
              <Link href="/signup" className="btn primary sm">Get started</Link>
            </div>
          </div>
        </header>
        {children}
      </div>
    );
  }

  const unread = await unreadCount(user.id);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/home" className="brand"><Logo /> {APP_NAME}</Link>
        <nav className="stack" style={{ gap: 4 }} aria-label="Main">
          <NavLinks unread={unread} />
        </nav>
        <div className="spacer" />
        <Link href="/settings" className="me">
          <PersonAvatar name={user.name} size={34} />
          <div className="grow">
            <div className="truncate small" style={{ fontWeight: 600 }}>{user.name}</div>
            <div className="truncate tiny faint">@{user.username ?? "pick a username"}</div>
          </div>
        </Link>
      </aside>
      <div className="main">{children}</div>
      <nav className="tabbar" aria-label="Main">
        <NavLinks unread={unread} />
      </nav>
    </div>
  );
}
