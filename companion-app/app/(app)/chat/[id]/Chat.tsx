"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { forgetMemory, leaveChat, resetChat } from "@/app/actions";
import { LIMITS } from "@/lib/config";
import { Avatar } from "@/components/Avatar";
import { BackIcon, BrainIcon, DotsIcon, SendIcon, StopIcon } from "@/components/Icons";

type Msg = { id: string; role: "user" | "assistant"; content: string; failed?: boolean };
type CompanionProps = { id: string; name: string; avatar: string; photoId: string | null; vibe: string; tagline: string; isOwner: boolean };

const STARTERS = ["Tell me about yourself", "I had a long day", "Ask me something interesting", "Can you help me think something through?"];

export default function Chat({
  conversation,
  companion,
  initialMessages,
}: {
  conversation: { id: string; memory: string };
  companion: CompanionProps;
  initialMessages: Msg[];
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickToBottom = useRef(true);

  // Server actions (like a fresh start) send fresh props.
  useEffect(() => setMessages(initialMessages), [initialMessages]);

  // Follow new text only if the person is already near the bottom.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Grow the text box with its content.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(opts: { text?: string; regenerate?: boolean }) {
    if (busy) return;
    const stamp = Date.now();
    const replyId = `a-${stamp}`;
    setBusy(true);
    stickToBottom.current = true;
    setMessages((prev) => {
      let next = prev.filter((m) => !m.failed);
      if (opts.regenerate && next[next.length - 1]?.role === "assistant") next = next.slice(0, -1);
      if (opts.text) next = [...next, { id: `u-${stamp}`, role: "user", content: opts.text }];
      return [...next, { id: replyId, role: "assistant", content: "" }];
    });

    const update = (content: string, failed = false) =>
      setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content, failed } : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, message: opts.text, regenerate: opts.regenerate }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        update((await res.text().catch(() => "")) || "Something went wrong. Please try again.", true);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        update(reply);
      }
      if (!reply) update("...", true);
    } catch {
      if (controller.signal.aborted) {
        if (!reply) setMessages((prev) => prev.filter((m) => m.id !== replyId));
      } else {
        update(reply || "Connection problem. Please try again.", !reply);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    if (!textArg) setInput("");
    run({ text });
  }

  const last = messages[messages.length - 1];
  const lastFailed = !busy && last?.failed;
  const canRegenerate = !busy && last?.role === "assistant" && !last.failed && messages.some((m) => m.role === "user");
  const onlyGreeting = messages.every((m) => m.role === "assistant");

  return (
    <div className={`chat-layout ${panelOpen ? "with-panel" : ""}`}>
      <main className="chat" style={{ height: "auto", minHeight: 0 }}>
        <div className="chat-head">
          <Link href="/home" className="btn quiet icon-btn" aria-label="Back"><BackIcon /></Link>
          <Link href={`/c/${companion.id}`}><Avatar name={companion.name} avatar={companion.avatar} photoId={companion.photoId} size={40} /></Link>
          <div className="grow">
            <Link href={`/c/${companion.id}`}><strong>{companion.name}</strong></Link>
            <div className={`sub ${busy ? "typing" : ""}`} aria-live="polite">{busy ? "typing..." : `${companion.vibe} · AI companion`}</div>
          </div>
          <button className={`btn quiet sm ${panelOpen ? "on" : ""}`} onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
            <BrainIcon /> <span className="hide-sm">Memory</span>
          </button>
          <div className="menu-wrap" ref={menuRef}>
            <button className="btn quiet icon-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Chat options" aria-expanded={menuOpen}>
              <DotsIcon />
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <Link href={`/c/${companion.id}`} className="menu-item" role="menuitem">View profile</Link>
                {companion.isOwner && (
                  <Link href={`/companions/${companion.id}/edit`} className="menu-item" role="menuitem">Edit companion</Link>
                )}
                <form action={resetChat} onSubmit={(e) => {
                  if (!confirm(`Start over with ${companion.name}? Messages and memory will be erased.`)) e.preventDefault();
                  else setMenuOpen(false);
                }}>
                  <input type="hidden" name="id" value={conversation.id} />
                  <button className="menu-item" role="menuitem">Start a fresh chat</button>
                </form>
                <form action={leaveChat} onSubmit={(e) => {
                  if (!confirm(`Remove this chat with ${companion.name}? This can't be undone.`)) e.preventDefault();
                }}>
                  <input type="hidden" name="id" value={conversation.id} />
                  <button className="menu-item danger" role="menuitem">Delete chat</button>
                </form>
              </div>
            )}
          </div>
        </div>

        <div
          className="messages"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="messages-inner">
            <div className="intro">
              <Avatar name={companion.name} avatar={companion.avatar} photoId={companion.photoId} size={72} />
              <p className="display">{companion.name}</p>
              {companion.tagline && <p className="muted small">{companion.tagline}</p>}
              <p className="tiny faint">An AI companion. It can make mistakes and is not a real person.</p>
            </div>
            {messages.map((m, i) => {
              const cont = i > 0 && messages[i - 1].role === m.role;
              return (
                <div key={m.id} className={`bubble-row ${m.role} ${cont ? "cont" : ""}`}>
                  {m.role === "assistant" && <Avatar name={companion.name} avatar={companion.avatar} photoId={companion.photoId} size={28} />}
                  <div className={`bubble ${m.role} ${m.failed ? "failed" : ""}`}>
                    {m.content || (
                      <span className="dots" aria-label={`${companion.name} is typing`}><i /><i /><i /></span>
                    )}
                  </div>
                </div>
              );
            })}
            {(lastFailed || canRegenerate) && (
              <div className="row" style={{ justifyContent: "center", marginTop: 10 }}>
                {lastFailed ? (
                  <button className="btn outline sm" onClick={() => run({ regenerate: true })}>Try again</button>
                ) : (
                  <button className="btn quiet sm faint" onClick={() => run({ regenerate: true })}>Regenerate</button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="composer-wrap">
          {onlyGreeting && !busy && (
            <div className="suggestions">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          )}
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
              placeholder={`Message ${companion.name}`}
              aria-label={`Message ${companion.name}`}
              rows={1}
              maxLength={LIMITS.message}
              autoFocus
            />
            {busy ? (
              <button type="button" className="btn outline" onClick={() => abortRef.current?.abort()} aria-label="Stop"><StopIcon /></button>
            ) : (
              <button className="btn primary" disabled={!input.trim()} aria-label="Send"><SendIcon /></button>
            )}
          </form>
        </div>
      </main>

      {panelOpen && (
        <aside className="memory-panel" aria-label="Memory">
          <div className="row between">
            <h2>What {companion.name} remembers</h2>
            <button className="btn quiet icon-btn" onClick={() => setPanelOpen(false)} aria-label="Close">✕</button>
          </div>
          {conversation.memory ? (
            <>
              <p className="memory">{conversation.memory}</p>
              <form action={forgetMemory}>
                <input type="hidden" name="id" value={conversation.id} />
                <button className="btn outline sm">Forget all of this</button>
              </form>
            </>
          ) : (
            <p className="small muted">
              Nothing yet. Every few messages {companion.name} writes short private notes about what matters to you,
              so it can remember across long chats. Only you can see them.
            </p>
          )}
          <hr className="divider" />
          <p className="tiny faint">Notes are written by AI from your conversation. They may be incomplete or wrong.</p>
        </aside>
      )}
    </div>
  );
}
