import { AVATARS } from "@/lib/config";

/** Companion avatar: a tinted circle with the first letter, or an old emoji avatar. */
export function Avatar({ name, avatar, size = 44 }: { name: string; avatar: string; size?: number }) {
  const style = { "--size": `${size}px` } as React.CSSProperties;
  if ((AVATARS as readonly string[]).includes(avatar)) {
    return (
      <span className={`av ${avatar}`} style={style} aria-hidden>
        {initial(name)}
      </span>
    );
  }
  return (
    <span className="av emoji" style={style} aria-hidden>
      {avatar || "✨"}
    </span>
  );
}

/** Person avatar: initials on a dark circle. */
export function PersonAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const style = { "--size": `${size}px` } as React.CSSProperties;
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => initial(w))
    .join("");
  return (
    <span className="av person" style={style} aria-hidden>
      {letters || "?"}
    </span>
  );
}

function initial(s: string) {
  // Skip words like "Coach" or "Professor" so the letter matches the real name.
  const words = s.trim().split(/\s+/);
  const word = words.length > 1 && /^(coach|professor|dr|mr|ms|mrs)$/i.test(words[0]) ? words[1] : words[0];
  return (word?.[0] ?? "?").toUpperCase();
}
