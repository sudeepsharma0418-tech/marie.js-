import Link from "next/link";
import { Avatar } from "./Avatar";
import { ChatIcon } from "./Icons";
import { compact } from "@/lib/social";
import { APP_NAME } from "@/lib/config";

export type CardCompanion = {
  id: string;
  name: string;
  avatar: string;
  photoId?: string | null;
  image?: string;
  tagline: string;
  category: string;
  isOfficial: boolean;
  isPublic?: boolean;
  listed?: boolean;
  user: { username: string | null; name: string; isSystem?: boolean };
  _count: { conversations: number };
};

export const cardSelect = {
  id: true,
  name: true,
  avatar: true,
  photoId: true,
  image: true,
  tagline: true,
  category: true,
  isOfficial: true,
  isPublic: true,
  listed: true,
  user: { select: { username: true, name: true, isSystem: true } },
  _count: { select: { conversations: true } },
} as const;

export default function CompanionCard({ c, showPrivacy }: { c: CardCompanion; showPrivacy?: boolean }) {
  return (
    <Link href={`/c/${c.id}`} className="card">
      <div className="card-top">
        <Avatar name={c.name} avatar={c.avatar} photoId={c.photoId} image={c.image} size={44} />
        <div className="grow">
          <h3 className="truncate">{c.name}</h3>
          <span className="tiny faint truncate" style={{ display: "block" }}>
            {c.isOfficial ? `By ${APP_NAME}` : c.user.isSystem ? APP_NAME : `By @${c.user.username ?? c.user.name}`}
          </span>
        </div>
        {showPrivacy && !c.isPublic && <span className="badge plain">Private</span>}
        {showPrivacy && c.isPublic && c.listed === false && <span className="badge plain">Link only</span>}
      </div>
      <p className="small muted clamp2" style={{ minHeight: "3.2em" }}>{c.tagline || "No description yet."}</p>
      <div className="meta">
        <span>{c.category}</span>
        <span><ChatIcon /> {compact(c._count.conversations)} {c._count.conversations === 1 ? "chat" : "chats"}</span>
      </div>
    </Link>
  );
}
