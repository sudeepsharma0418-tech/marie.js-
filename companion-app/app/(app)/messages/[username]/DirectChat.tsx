"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toggleBlock } from "@/app/actions";
import { LIMITS } from "@/lib/config";
import { PersonAvatar } from "@/components/Avatar";
import { BackIcon, DotsIcon, SendIcon } from "@/components/Icons";

type DM = { id: string; content: string; mine: boolean; createdAt: string; pending?: boolean; failed?: boolean };

export default function DirectChat({
  them,
  initial,
  iBlocked,
  theyBlocked,
}: {
  them: { name: string; username: string };
  initial: DM[];
  iBlocked: boolean;
  theyBlocked: boolean;
}) {
  const [messages, setMessages] = useState<DM[]>(initial);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastAt = useRef(initial[initial.length - 1]?.createdAt ?? "");

  useEffect(() => setMessages(initial), [initial]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Check for new messages every few seconds while the tab is visible.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      if (document.hidden) return;
      try {
        const q = new URLSearchParams({ with: them.username });
        if (lastAt.current) q.set("after", lastAt.current);
        const res = await fetch(`/api/dm?${q}`);
        if (!res.ok || stopped) return;
        const data: { messages: DM[] } = await res.json();
        if (data.messages.length) {
          lastAt.current = data.messages[data.messages.length - 1].createdAt;
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            return [...prev, ...data.messages.filter((m) => !seen.has(m.id))];
          });
        }
      } catch {}
    }
    const t = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [them.username]);

  async function send() {
    const content = input.trim();
    if (!content) return;
    setInput("");
    setError("");
    const tempId = `t-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, content, mine: true, createdAt: new Date().toISOString(), pending: true }]);
    try {
      const res = await fetch("/api/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: them.username, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't send.");
      lastAt.current = data.message.createdAt;
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id)
          ? prev.filter((m) => m.id !== tempId)
          : prev.map((m) => (m.id === tempId ? data.message : m)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send.");
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      setInput(content);
    }
  }

  const blocked = iBlocked || theyBlocked;

  return (
    <div className="page-chat"><main className="chat">
      <div className="chat-head">
        <Link href="/messages" className="btn quiet icon-btn" aria-label="Back"><BackIcon /></Link>
        <Link href={`/u/${them.username}`}><PersonAvatar name={them.name} size={40} /></Link>
        <div className="grow">
          <Link href={`/u/${them.username}`}><strong>{them.name}</strong></Link>
          <div className="sub">@{them.username}</div>
        </div>
        <div className="menu-wrap">
          <button className="btn quiet icon-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Options" aria-expanded={menuOpen}><DotsIcon /></button>
          {menuOpen && (
            <div className="menu" role="menu">
              <Link href={`/u/${them.username}`} className="menu-item" role="menuitem">View profile</Link>
              <form action={toggleBlock} onSubmit={(e) => {
                if (!iBlocked && !confirm(`Block ${them.name}? They won't be able to message you.`)) e.preventDefault();
                else setMenuOpen(false);
              }}>
                <input type="hidden" name="username" value={them.username} />
                <button className="menu-item danger" role="menuitem">{iBlocked ? "Unblock" : "Block"}</button>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="messages" ref={listRef}>
        <div className="messages-inner">
          <div className="intro">
            <PersonAvatar name={them.name} size={72} />
            <p className="display">{them.name}</p>
            <p className="tiny faint">Messages are between the two of you. Be kind.</p>
          </div>
          {messages.map((m, i) => {
            const cont = i > 0 && messages[i - 1].mine === m.mine;
            return (
              <div key={m.id} className={`bubble-row ${m.mine ? "user" : ""} ${cont ? "cont" : ""}`}>
                {!m.mine && <PersonAvatar name={them.name} size={28} />}
                <div className={`bubble ${m.mine ? "me" : "them"} ${m.failed ? "failed" : ""}`} style={{ opacity: m.pending ? 0.6 : 1 }}>
                  {m.content}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="composer-wrap">
        {error && <p className="error center small" style={{ marginBottom: 8 }}>{error}</p>}
        {blocked ? (
          <p className="muted center small">{iBlocked ? "You blocked this person. Unblock them from the menu to message." : "You can't message this person."}</p>
        ) : (
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Message ${them.name.split(" ")[0]}`}
              aria-label={`Message ${them.name}`}
              rows={1}
              maxLength={LIMITS.directMessage}
              autoFocus
            />
            <button className="btn primary" disabled={!input.trim()} aria-label="Send"><SendIcon /></button>
          </form>
        )}
      </div>
    </main></div>
  );
}
