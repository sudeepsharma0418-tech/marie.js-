"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createSession, deleteSession, requireUser } from "@/lib/auth";
import { AVATARS, LIMITS, VIBES } from "@/lib/config";

export type FormState = { error?: string } | undefined;

// A valid bcrypt hash that matches nothing, used when the email isn't found.
const DUMMY_HASH = "$2b$10$FKUbTY0z9KnseBNOFuOcH.Vje7GI6a1/UulmH1HH2LPeV6zU1bhHG";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

// ---------- Auth ----------

export async function signup(_prev: FormState, form: FormData): Promise<FormState> {
  const name = str(form, "name");
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!name || name.length > 60) return { error: "Please enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please enter a valid email." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with this email already exists. Try logging in." };

  const user = await db.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10) },
  });
  await createSession(user.id);
  redirect("/companions");
}

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");

  const user = await db.user.findUnique({ where: { email } });
  // Always run a bcrypt check so a missing account takes as long as a wrong password.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return { error: "Wrong email or password." };

  await createSession(user.id);
  redirect("/companions");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}

// ---------- Companions ----------

type CompanionFields = {
  name: string;
  avatar: string;
  vibe: string;
  personality: string;
  backstory: string;
  greeting: string;
};

function readCompanion(form: FormData): { error: string } | { data: CompanionFields } {
  const name = str(form, "name");
  const avatar = str(form, "avatar");
  const vibe = str(form, "vibe");
  const personality = str(form, "personality");
  const backstory = str(form, "backstory");
  const greeting = str(form, "greeting");

  if (!name) return { error: "Give your companion a name." };
  if (name.length > LIMITS.name) return { error: `Name must be under ${LIMITS.name} characters.` };
  if (!personality) return { error: "Describe your companion's personality." };
  if (personality.length > LIMITS.personality) return { error: "Personality is too long." };
  if (backstory.length > LIMITS.backstory) return { error: "Backstory is too long." };
  if (greeting.length > LIMITS.greeting) return { error: "Greeting is too long." };

  return {
    data: {
      name,
      avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
      vibe: (VIBES as readonly string[]).includes(vibe) ? vibe : VIBES[0],
      personality,
      backstory,
      greeting,
    },
  };
}

const greetingFor = (c: { name: string; greeting: string }, userName: string) =>
  c.greeting || `Hey ${userName}! I'm ${c.name}. How's your day going?`;

export async function createCompanion(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = readCompanion(form);
  if ("error" in parsed) return parsed;

  const companion = await db.companion.create({
    data: {
      userId: user.id,
      ...parsed.data,
      messages: { create: { role: "assistant", content: greetingFor(parsed.data, user.name) } },
    },
  });

  revalidatePath("/companions");
  redirect(`/companions/${companion.id}`);
}

export async function updateCompanion(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(form, "id");
  const parsed = readCompanion(form);
  if ("error" in parsed) return parsed;

  const { count } = await db.companion.updateMany({
    where: { id, userId: user.id },
    data: parsed.data,
  });
  if (count === 0) return { error: "Companion not found." };

  revalidatePath("/companions");
  revalidatePath(`/companions/${id}`);
  redirect(`/companions/${id}`);
}

export async function deleteCompanion(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await db.companion.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/companions");
  redirect("/companions");
}

/** Starts the chat over: removes messages and memory, then says hi again. */
export async function clearChat(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const companion = await db.companion.findFirst({ where: { id, userId: user.id } });
  if (!companion) redirect("/companions");

  await db.$transaction([
    db.message.deleteMany({ where: { companionId: companion.id } }),
    db.companion.update({ where: { id: companion.id }, data: { memory: "" } }),
    db.message.create({
      data: { companionId: companion.id, role: "assistant", content: greetingFor(companion, user.name) },
    }),
  ]);
  revalidatePath(`/companions/${companion.id}`);
  revalidatePath("/companions");
}

/** Wipes only the memory notes, keeping the chat. */
export async function forgetMemory(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await db.companion.updateMany({ where: { id, userId: user.id }, data: { memory: "" } });
  revalidatePath(`/companions/${id}/edit`);
}
