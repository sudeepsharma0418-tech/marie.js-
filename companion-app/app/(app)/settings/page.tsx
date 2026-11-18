import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { logout } from "@/app/actions";
import ProfileForm from "@/components/ProfileForm";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const user = await requireMember();
  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <Link href={`/u/${user.username}`} className="btn outline sm">View profile</Link>
      </div>
      <section className="panel pad">
        <ProfileForm initial={{ name: user.name, username: user.username, bio: user.bio }} />
      </section>
      <form action={logout}>
        <button className="btn outline">Log out</button>
      </form>
    </main>
  );
}
