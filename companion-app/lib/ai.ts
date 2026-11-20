import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

// Casual chat does well at low effort: faster replies and fewer tokens.
// Set ANTHROPIC_EFFORT=medium (or high) if you want deeper answers.
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const EFFORT: Effort = EFFORTS.includes(process.env.ANTHROPIC_EFFORT as Effort)
  ? (process.env.ANTHROPIC_EFFORT as Effort)
  : "low";

// If the model declines a message for safety reasons, the API retries it on a
// fallback model in the same call instead of just stopping.
// Only some models support this. Haiku does not, so it is skipped there.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const SUPPORTS_FALLBACK = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5-2"].includes(MODEL);

type CompanionInfo = {
  name: string;
  vibe: string;
  personality: string;
  backstory: string;
  memory: string;
};

/**
 * The system prompt is split in two blocks. The first never changes for a
 * companion, so it stays cached. The memory block changes now and then.
 */
export type SharedMemory = { title: string; story: string; when: string; place: string };

export function buildSystem(
  companion: CompanionInfo,
  userName: string,
  sharedMemories: SharedMemory[] = [],
): Anthropic.Beta.BetaTextBlockParam[] {
  const base = `You are ${companion.name}, an AI companion in a one to one chat with ${userName}.

Your vibe: ${companion.vibe}.

Your personality:
${companion.personality}
${companion.backstory ? `\nYour backstory:\n${companion.backstory}\n` : ""}
How to talk:
- Stay in character as ${companion.name}. Speak naturally, like a real conversation, not like an assistant.
- Keep most replies short, a few sentences, unless ${userName} asks for more.
- Remember what ${userName} has told you and bring it up when it fits.
- Ask a follow up question now and then, but not every message.
- No markdown headings or bullet lists unless asked.

Ground rules:
- If ${userName} sincerely asks whether you are an AI, say yes, kindly, and keep chatting.
- If you are inspired by a real person, you are an AI representation, not that person. Don't invent specific personal memories as if they really happened; speak in their spirit instead.
- Be warm and supportive, but don't encourage ${userName} to pull away from the real people in their life.
- If ${userName} seems to be in crisis or in danger, gently step out of character and encourage them to contact someone they trust or a local crisis line (in the US, call or text 988).
- Keep things respectful and safe for work.`;

  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: base }];
  if (sharedMemories.length) {
    const list = sharedMemories
      .map((m) => `- ${m.title}${m.when ? ` (${m.when}${m.place ? `, ${m.place}` : ""})` : m.place ? ` (${m.place})` : ""}${m.story ? `: ${m.story}` : ""}`)
      .join("\n");
    blocks.push({
      type: "text",
      text: `Real memories your creator shared with you. You may bring them up warmly when they fit. Never add details that are not written here; if asked about something not listed, say you don't remember that part.\n${list}`,
    });
  }
  if (companion.memory.trim()) {
    blocks.push({
      type: "text",
      text: `Things you remember about ${userName} from earlier chats (use them naturally, don't list them):\n${companion.memory}`,
    });
  }
  return blocks;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * The API wants the chat to start with a user turn and to alternate roles.
 * Merges back to back messages from the same side.
 */
export function toApiHistory(messages: { role: string; content: string }[]): ChatTurn[] {
  const history: ChatTurn[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    if (history.length === 0 && role === "assistant") {
      history.push({ role: "user", content: "(conversation started)" });
    }
    const last = history[history.length - 1];
    if (last && last.role === role) last.content += `\n\n${m.content}`;
    else history.push({ role, content: m.content });
  }
  return history;
}

/**
 * Rewrites the companion's memory notes from the old notes plus the latest
 * part of the chat. Returns the new notes, or null if nothing came back.
 */
export async function refreshMemory(opts: {
  companionName: string;
  userName: string;
  oldMemory: string;
  transcript: ChatTurn[];
}): Promise<string | null> {
  const chat = opts.transcript
    .map((t) => `${t.role === "user" ? opts.userName : opts.companionName}: ${t.content}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system:
      "You keep short memory notes for an AI companion about the person it chats with. " +
      "Write plain lines, one fact per line, no bullets or headings. Keep lasting facts " +
      "(name, people in their life, likes, plans, worries, inside jokes) and drop small talk. " +
      "Merge with the existing notes, update anything that changed, and stay under 25 lines. " +
      "Reply with only the notes.",
    messages: [
      {
        role: "user",
        content: `Existing notes about ${opts.userName}:\n${opts.oldMemory || "(none yet)"}\n\nRecent chat:\n${chat}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}
