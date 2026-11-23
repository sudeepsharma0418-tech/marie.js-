import Link from "next/link";
import { isAdmin, requireMember } from "@/lib/auth";
import { loadSampleMemories, logout } from "@/app/actions";
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
        <div className="row">
          {isAdmin(user.email) && <Link href="/admin" className="btn primary sm">Admin</Link>}
          <Link href={`/u/${user.username}`} className="btn outline sm">View profile</Link>
        </div>
      </div>
      <section className="panel pad">
        <ProfileForm initial={{ name: user.name, username: user.username, bio: user.bio }} />
      </section>
      <section className="panel pad row between wrap">
        <div>
          <strong>Sample memories</strong>
          <p className="small muted" style={{ marginTop: 4 }}>Adds a private sample companion, Grandpa Joe, with four illustrated memories on your timeline. Handy for demos.</p>
        </div>
        <form action={loadSampleMemories}><button className="btn outline">Load sample</button></form>
      </section>
      <form action={logout}>
        <button className="btn outline">Log out</button>
      </form>
    </main>
  );
}
