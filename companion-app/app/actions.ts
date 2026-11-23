"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createSession, deleteSession, requireUser } from "@/lib/auth";
import { AVATARS, CATEGORIES, LIMITS, MEMORY_CATEGORIES, USERNAME_RE, VIBES } from "@/lib/config";
import { ownPhotoId } from "@/lib/photos";
import { VOICE_KEYS } from "@/lib/voices";

export type FormState = { error?: string; ok?: string } | undefined;

// A valid bcrypt hash that matches nothing, used when the email isn't found.
const DUMMY_HASH = "$2b$10$FKUbTY0z9KnseBNOFuOcH.Vje7GI6a1/UulmH1HH2LPeV6zU1bhHG";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

// Names that would clash with pages or look official.
const RESERVED = new Set(["admin", "kindred", "memorylane", "support", "help", "settings", "official", "system", "team", "api", "me"]);

async function checkUsername(raw: string, userId?: string): Promise<string | { error: string }> {
  const username = raw.toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return { error: "Usernames are 3 to 20 characters: letters, numbers and _ only." };
  }
  if (RESERVED.has(username)) return { error: "That username is reserved. Try another." };
  const taken = await db.user.findUnique({ where: { username } });
  if (taken && taken.id !== userId) return { error: "That username is taken. Try another." };
  return username;
}

// ---------- Auth ----------

export async function signup(_prev: FormState, form: FormData): Promise<FormState> {
  const name = str(form, "name");
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!name || name.length > 60) return { error: "Please enter your name." };
  const username = await checkUsername(str(form, "username"));
  if (typeof username !== "string") return username;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please enter a valid email." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with this email already exists. Try logging in." };

  const user = await db.user.create({
    data: { name, email, username, passwordHash: await bcrypt.hash(password, 10) },
  });
  await createSession(user.id);
  redirect("/home");
}

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");

  const found = await db.user.findUnique({ where: { email } });
  const user = found && !found.isSystem ? found : null;
  // Always run a bcrypt check so a missing account takes as long as a wrong password.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return { error: "Wrong email or password." };

  await createSession(user.id);
  redirect("/home");
}

export async function logout() {
  await deleteSession();
  redirect("/");
}

// ---------- Profile ----------

export async function saveProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = str(form, "name");
  const bio = str(form, "bio");
  if (!name || name.length > 60) return { error: "Please enter your name." };
  if (bio.length > LIMITS.bio) return { error: `Bio must be under ${LIMITS.bio} characters.` };
  const username = await checkUsername(str(form, "username"), user.id);
  if (typeof username !== "string") return username;

  await db.user.update({ where: { id: user.id }, data: { name, bio, username } });
  revalidatePath("/", "layout");
  if (str(form, "next") === "home") redirect("/home");
  return { ok: "Saved." };
}

// ---------- Companions ----------

type CompanionFields = {
  name: string;
  avatar: string;
  vibe: string;
  category: string;
  tagline: string;
  personality: string;
  backstory: string;
  greeting: string;
  isPublic: boolean;
  listed: boolean;
  voice: string;
};

function readCompanion(form: FormData): { error: string } | { data: CompanionFields } {
  const name = str(form, "name");
  const avatar = str(form, "avatar");
  const vibe = str(form, "vibe");
  const category = str(form, "category");
  const tagline = str(form, "tagline");
  const personality = str(form, "personality");
  const backstory = str(form, "backstory");
  const greeting = str(form, "greeting");

  if (!name) return { error: "Give your companion a name." };
  if (name.length > LIMITS.name) return { error: `Name must be under ${LIMITS.name} characters.` };
  if (tagline.length > LIMITS.tagline) return { error: "Tagline is too long." };
  if (!personality) return { error: "Describe your companion's personality." };
  if (personality.length > LIMITS.personality) return { error: "Personality is too long." };
  if (backstory.length > LIMITS.backstory) return { error: "Backstory is too long." };
  if (greeting.length > LIMITS.greeting) return { error: "Greeting is too long." };

  return {
    data: {
      name,
      avatar: (AVATARS as readonly string[]).includes(avatar) ? avatar : AVATARS[0],
      vibe: (VIBES as readonly string[]).includes(vibe) ? vibe : VIBES[0],
      category: (CATEGORIES as readonly string[]).includes(category) ? category : CATEGORIES[0],
      tagline,
      personality,
      backstory,
      greeting,
      // "private": only you. "link": anyone with the link. "public": also listed on Explore.
      isPublic: ["link", "public"].includes(str(form, "visibility")),
      listed: str(form, "visibility") !== "link",
      voice: (VOICE_KEYS as string[]).includes(str(form, "voice")) ? str(form, "voice") : "",
    },
  };
}

/** Memories added while creating a companion: mem_title_0, mem_year_0, mem_story_0, mem_photo_0, ... */
async function readStarterMemories(form: FormData, userId: string) {
  const out: { title: string; story: string; year: number | null; photoId: string | null }[] = [];
  const now = new Date().getFullYear();
  for (let i = 0; i < 6; i++) {
    const title = str(form, `mem_title_${i}`).slice(0, LIMITS.memoryTitle);
    const story = str(form, `mem_story_${i}`).slice(0, LIMITS.memoryStory);
    const photoId = await ownPhotoId(str(form, `mem_photo_${i}`), userId);
    if (!title && !story && !photoId) continue;
    const y = Number(str(form, `mem_year_${i}`));
    out.push({
      title: title || story.split(/[.!?\n]/)[0].slice(0, 60) || "A memory",
      story,
      year: Number.isInteger(y) && y >= 1800 && y <= now + 1 ? y : null,
      photoId,
    });
  }
  return out;
}

const greetingFor = (c: { name: string; greeting: string }, userName: string) =>
  c.greeting || `Hey ${userName}! I'm ${c.name}. How's your day going?`;

export async function createCompanion(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = readCompanion(form);
  if ("error" in parsed) return parsed;

  const photoId = await ownPhotoId(str(form, "photoId"), user.id);
  const memories = await readStarterMemories(form, user.id);
  const companion = await db.companion.create({ data: { userId: user.id, ...parsed.data, photoId } });
  if (memories.length) {
    await db.memory.createMany({
      data: memories.map((m) => ({ ...m, userId: user.id, companionId: companion.id, category: "Moments" })),
    });
  }
  const convo = await db.conversation.create({
    data: {
      userId: user.id,
      companionId: companion.id,
      messages: {
        create: { companionId: companion.id, role: "assistant", content: greetingFor(companion, user.name) },
      },
    },
  });

  revalidatePath("/home");
  redirect(`/chat/${convo.id}`);
}

export async function updateCompanion(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(form, "id");
  const parsed = readCompanion(form);
  if ("error" in parsed) return parsed;

  const photoId = await ownPhotoId(str(form, "photoId"), user.id);
  const { count } = await db.companion.updateMany({
    where: { id, userId: user.id },
    data: { ...parsed.data, photoId },
  });
  if (count === 0) return { error: "Companion not found." };

  revalidatePath("/", "layout");
  redirect(`/c/${id}`);
}

export async function deleteCompanion(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  await db.companion.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/", "layout");
  redirect("/home");
}

// ---------- Conversations ----------

/** Opens your chat with a companion, creating it (with the greeting) the first time. */
export async function startChat(form: FormData) {
  const user = await requireUser();
  const companionId = str(form, "companionId");
  const companion = await db.companion.findFirst({
    where: { id: companionId, OR: [{ isPublic: true }, { userId: user.id }] },
  });
  if (!companion) redirect("/discover");

  const existing = await db.conversation.findUnique({
    where: { userId_companionId: { userId: user.id, companionId } },
  });
  if (existing) redirect(`/chat/${existing.id}`);

  const convo = await db.conversation.create({
    data: {
      userId: user.id,
      companionId,
      messages: { create: { companionId, role: "assistant", content: greetingFor(companion, user.name) } },
    },
  });
  redirect(`/chat/${convo.id}`);
}

async function ownConversation(form: FormData) {
  const user = await requireUser();
  const convo = await db.conversation.findFirst({
    where: { id: str(form, "id"), userId: user.id },
    include: { companion: true },
  });
  return { user, convo };
}

/** Starts the chat over: removes messages and memory, then says hi again. */
export async function resetChat(form: FormData) {
  const { user, convo } = await ownConversation(form);
  if (!convo) redirect("/home");

  await db.$transaction([
    db.message.deleteMany({ where: { conversationId: convo.id } }),
    db.conversation.update({ where: { id: convo.id }, data: { memory: "" } }),
    db.message.create({
      data: {
        conversationId: convo.id,
        companionId: convo.companionId,
        role: "assistant",
        content: greetingFor(convo.companion, user.name),
      },
    }),
  ]);
  revalidatePath(`/chat/${convo.id}`);
}

/** Wipes only the memory notes, keeping the chat. */
export async function forgetMemory(form: FormData) {
  const { convo } = await ownConversation(form);
  if (!convo) return;
  await db.conversation.update({ where: { id: convo.id }, data: { memory: "" } });
  revalidatePath(`/chat/${convo.id}`);
}

/** Removes the chat from your list entirely. */
export async function leaveChat(form: FormData) {
  const { convo } = await ownConversation(form);
  if (convo) await db.conversation.delete({ where: { id: convo.id } });
  revalidatePath("/home");
  redirect("/home");
}

// ---------- People ----------

/** Blocks or unblocks someone. Blocked people can't send you messages. */
export async function toggleBlock(form: FormData) {
  const user = await requireUser();
  const other = await db.user.findUnique({ where: { username: str(form, "username") } });
  if (!other || other.id === user.id) return;
  const key = { blockerId_blockedId: { blockerId: user.id, blockedId: other.id } };
  const existing = await db.block.findUnique({ where: key });
  if (existing) await db.block.delete({ where: key });
  else await db.block.create({ data: { blockerId: user.id, blockedId: other.id } });
  revalidatePath(`/messages/${other.username}`);
  revalidatePath(`/u/${other.username}`);
}

// ---------- Memories ----------

async function readMemory(form: FormData, userId: string) {
  const title = str(form, "title");
  const story = str(form, "story");
  const place = str(form, "place");
  const category = str(form, "category");
  const yearRaw = str(form, "year");
  const monthRaw = str(form, "month");

  if (!title) return { error: "Give this memory a title." } as const;
  if (title.length > LIMITS.memoryTitle) return { error: "Title is too long." } as const;
  if (story.length > LIMITS.memoryStory) return { error: "Story is too long." } as const;
  if (place.length > LIMITS.place) return { error: "Place is too long." } as const;

  const now = new Date().getFullYear();
  const year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && !(Number.isInteger(year) && year >= 1800 && year <= now + 1)) {
    return { error: "Please enter a real year, like 1998." } as const;
  }
  const month = monthRaw ? Number(monthRaw) : null;
  if (month !== null && !(Number.isInteger(month) && month >= 1 && month <= 12)) {
    return { error: "Please pick a month." } as const;
  }

  const companionId = str(form, "companionId");
  const companion = companionId
    ? await db.companion.findFirst({ where: { id: companionId, userId }, select: { id: true } })
    : null;

  return {
    data: {
      title,
      story,
      place,
      category: (MEMORY_CATEGORIES as readonly string[]).includes(category) ? category : MEMORY_CATEGORIES[0],
      year,
      month: year ? month : null,
      companionId: companion?.id ?? null,
      photoId: await ownPhotoId(str(form, "photoId"), userId),
    },
  } as const;
}

export async function createMemory(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = await readMemory(form, user.id);
  if ("error" in parsed) return { error: parsed.error };
  if (!parsed.data.photoId && !parsed.data.story) return { error: "Add a photo or a few words about this memory." };

  const memory = await db.memory.create({ data: { userId: user.id, ...parsed.data } });
  revalidatePath("/memories");
  redirect(`/memories/${memory.id}`);
}

export async function updateMemory(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(form, "id");
  const parsed = await readMemory(form, user.id);
  if ("error" in parsed) return { error: parsed.error };

  const { count } = await db.memory.updateMany({ where: { id, userId: user.id }, data: parsed.data });
  if (count === 0) return { error: "Memory not found." };
  revalidatePath("/memories");
  redirect(`/memories/${id}`);
}

export async function deleteMemory(form: FormData) {
  const user = await requireUser();
  const memory = await db.memory.findFirst({ where: { id: str(form, "id"), userId: user.id } });
  if (memory) {
    await db.memory.delete({ where: { id: memory.id } });
    // Remove the photo too, unless a companion is using it as its picture.
    if (memory.photoId) {
      const inUse = await db.companion.count({ where: { photoId: memory.photoId } });
      const otherMemories = await db.memory.count({ where: { photoId: memory.photoId } });
      if (!inUse && !otherMemories) await db.photo.delete({ where: { id: memory.photoId } }).catch(() => {});
    }
  }
  revalidatePath("/memories");
  redirect("/memories");
}

// ---------- Sample memories (for demos and first time users) ----------

const SAMPLE_COMPANION = {
  name: "Grandpa Joe",
  image: "/demo/joe.svg",
  avatar: "slate",
  vibe: "Friendly",
  category: "Friends",
  tagline: "Stories from the farm, bad puns, and the best pancakes.",
  personality:
    "Warm, patient and a little cheeky. Calls you \"kiddo\". Loves bad puns, fishing, and Sunday breakfasts. Always asks if you're eating well. Gives advice through stories instead of lectures.",
  backstory:
    "Grew up on a small farm in Ohio, the youngest of five. Worked 30 years as a carpenter. Married to Rose for 52 years. Taught every grandchild to fish at the lake, though he never caught much himself.",
  greeting: "There you are, kiddo! Pull up a chair. How's life treating you?",
};

const SAMPLE_MEMORIES = [
  { title: "Summer at the lake", year: 1998, month: 7, place: "Lake Erie", category: "Travel", image: "/demo/lake.svg",
    story: "Every summer he woke us at 6 to go fishing. He never caught anything, but he always said tomorrow would be the day." },
  { title: "Sunday pancakes", year: 2003, month: null, place: "Grandma's kitchen", category: "Family", image: "/demo/pancakes.svg",
    story: "He made pancakes every Sunday with a pinch of cinnamon. He said it was a secret, and Grandma pretended not to know." },
  { title: "The workshop", year: 2008, month: null, place: "His garage", category: "Everyday", image: "/demo/workshop.svg",
    story: "He built me a bookshelf for my 12th birthday. It wobbled, and he said that gave it character." },
  { title: "Golden anniversary", year: 2015, month: 6, place: "The backyard", category: "Celebrations", image: "/demo/anniversary.svg",
    story: "Fifty years with Rose. He gave a speech and cried halfway through, then blamed the onions in the potato salad." },
];

/** Adds a sample companion with four illustrated memories, once per account. */
export async function loadSampleMemories() {
  const user = await requireUser();
  const existing = await db.companion.findFirst({ where: { userId: user.id, image: SAMPLE_COMPANION.image } });
  if (!existing) {
    const companion = await db.companion.create({
      data: { userId: user.id, ...SAMPLE_COMPANION, isPublic: false },
    });
    await db.memory.createMany({
      data: SAMPLE_MEMORIES.map((m) => ({ ...m, userId: user.id, companionId: companion.id })),
    });
  }
  revalidatePath("/", "layout");
  redirect("/memories?view=timeline");
}
