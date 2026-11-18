// Change the app name here (or set NEXT_PUBLIC_APP_NAME in .env).
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Companion";

export const AVATARS = ["✨", "🌙", "🌸", "🦊", "🐼", "🌊", "🔥", "🎧", "📚", "🌿", "🤖", "🦋"];

export const VIBES = ["Friendly", "Playful", "Calm", "Wise", "Motivating", "Witty"] as const;

export const LIMITS = {
  name: 40,
  personality: 1000,
  backstory: 2000,
  greeting: 300,
  message: 4000,
};

// Per user message limits for /api/chat. Keeps one person from running up your API bill.
export const RATE_LIMITS = {
  perMinute: Number(process.env.CHAT_LIMIT_PER_MINUTE) || 15,
  perDay: Number(process.env.CHAT_LIMIT_PER_DAY) || 400,
};

// The companion's memory notes are refreshed every this many messages.
export const MEMORY_EVERY = 12;
