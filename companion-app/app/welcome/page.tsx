import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import ProfileForm from "@/components/ProfileForm";

export const metadata = { title: "Pick a username" };

// Older accounts made before usernames existed land here once.
export default async function Welcome() {
  const user = await requireUser();
  if (user.username) redirect("/home");
  return (
    <main className="auth-main" style={{ minHeight: "100vh" }}>
      <div className="auth-card">
        <h1 className="display" style={{ fontSize: "2.2rem" }}>One quick thing</h1>
        <p className="muted">Pick a username so people can find you and message you.</p>
        <ProfileForm initial={{ name: user.name, username: "", bio: user.bio }} next="home" />
      </div>
    </main>
  );
}
