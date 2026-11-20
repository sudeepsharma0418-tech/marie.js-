"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon, ChatIcon, CompassIcon, HomeIcon, UsersIcon } from "./Icons";

const LINKS = [
  { href: "/home", label: "Overview", Icon: HomeIcon },
  { href: "/memories", label: "Memories", Icon: BookIcon },
  { href: "/discover", label: "Discover", Icon: CompassIcon },
  { href: "/messages", label: "Messages", Icon: ChatIcon },
  { href: "/people", label: "People", Icon: UsersIcon },
];

export default function NavLinks({ unread }: { unread: number }) {
  const path = usePathname();
  return (
    <>
      {LINKS.map(({ href, label, Icon }) => {
        const on = path === href || (href !== "/home" && path.startsWith(href));
        return (
          <Link key={href} href={href} className={`nav-link ${on ? "on" : ""}`} aria-current={on ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
            {href === "/messages" && unread > 0 && <span className="count">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        );
      })}
    </>
  );
}
