import Link from "next/link";
import { Avatar } from "./Avatar";
import { ChatIcon, CheckIcon } from "./Icons";
import { compact } from "@/lib/social";

export type CardCompanion = {
  id: string;
  name: string;
  avatar: string;
  tagline: string;
  category: string;
  isOfficial: boolean;
  isPublic?: boolean;
  user: { username: string | null; name: string };
  _count: { conversations: number };
};

export const cardSelect = {
  id: true,
  name: true,
  avatar: true,
  tagline: true,
  category: true,
  isOfficial: true,
  isPublic: true,
  user: { select: { username: true, name: true } },
  _count: { select: { conversations: true } },
} as const;

export default function CompanionCard({ c, showPrivacy }: { c: CardCompanion; showPrivacy?: boolean }) {
  return (
    <Link href={`/c/${c.id}`} className="card">
      <div className="card-top">
        <Avatar name={c.name} avatar={c.avatar} size={48} />
        <div className="grow">
          <h3 className="truncate">{c.name}</h3>
          <span className="tiny faint truncate" style={{ display: "block" }}>
            {c.isOfficial ? "Official" : `by @${c.user.username ?? c.user.name}`}
          </span>
        </div>
        {c.isOfficial && <span className="badge" title="Official companion" style={{ padding: "0 6px" }}><CheckIcon className="" /></span>}
        {showPrivacy && !c.isPublic && <span className="badge plain">Private</span>}
      </div>
      <p className="small muted clamp2" style={{ minHeight: "2.6em" }}>{c.tagline || "No tagline yet."}</p>
      <div className="meta">
        <span>{c.category}</span>
        <span><ChatIcon /> {compact(c._count.conversations)} {c._count.conversations === 1 ? "chat" : "chats"}</span>
      </div>
    </Link>
  );
}
