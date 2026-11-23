import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from "./jwt";

export async function createSession(userId: string) {
  const token = await signSession(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function deleteSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession() {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** Returns the signed in user, or null. */
export async function getUser() {
  const session = await getSession();
  if (!session) return null;
  return db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, username: true, bio: true },
  });
}

/** Use in pages and actions that need a signed in user. */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Like requireUser, but also sends people without a username to pick one. */
export async function requireMember() {
  const user = await requireUser();
  if (!user.username) redirect("/welcome");
  return { ...user, username: user.username };
}

/** Admins are the emails listed in the ADMIN_EMAILS setting, separated by commas. */
export function isAdmin(email: string | null | undefined) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}
