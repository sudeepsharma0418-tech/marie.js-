// Change the app name here (or set NEXT_PUBLIC_APP_NAME in .env).
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Kindred";

export const TAGLINE = "AI companions that remember you, and a community to share them with.";

// Avatar styles. Each companion gets a tinted circle with its first letter.
// Older companions may still have an emoji saved, which is shown as is.
export const AVATARS = ["blue", "sky", "ink", "slate", "ice", "deep"] as const;
export type AvatarKey = (typeof AVATARS)[number];

export const VIBES = ["Friendly", "Playful", "Calm", "Wise", "Motivating", "Witty"] as const;

export const CATEGORIES = ["Friends", "Wellness", "Coaching", "Learning", "Creative", "Fun"] as const;

export const LIMITS = {
  name: 40,
  tagline: 90,
  personality: 1000,
  backstory: 2000,
  greeting: 300,
  message: 4000,
  bio: 160,
  directMessage: 2000,
};

// Per user message limits. Keeps one person from running up your API bill.
export const RATE_LIMITS = {
  perMinute: Number(process.env.CHAT_LIMIT_PER_MINUTE) || 15,
  perDay: Number(process.env.CHAT_LIMIT_PER_DAY) || 400,
  directPerMinute: 30,
};

// A conversation's memory notes are refreshed every this many messages.
export const MEMORY_EVERY = 12;

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
