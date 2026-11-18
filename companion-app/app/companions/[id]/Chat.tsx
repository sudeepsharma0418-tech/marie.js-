"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clearChat, deleteCompanion } from "../../actions";
import { LIMITS } from "@/lib/config";

type Msg = { id: string; role: "user" | "assistant"; content: string; failed?: boolean };
type CompanionProps = { id: string; name: string; avatar: string; vibe: string };

export default function Chat({
  companion,
  initialMessages,
}: {
  companion: CompanionProps;
  initialMessages: Msg[];
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickToBottom = useRef(true);

  // Server actions (like clear chat) send fresh props.
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Follow new text only if the person is already near the bottom,
  // so scrolling up to reread doesn't get yanked back down.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Grow the text box with its content, up to the CSS max height.
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

  // Stop any reply in progress if the person leaves the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;

    const stamp = Date.now();
    const replyId = `a-${stamp}`;
    if (!textArg) setInput("");
    setBusy(true);
    stickToBottom.current = true;
    setMessages((prev) => [
      ...prev.filter((m) => !m.failed),
      { id: `u-${stamp}`, role: "user", content: text },
      { id: replyId, role: "assistant", content: "" },
    ]);

    const update = (content: string, failed = false) =>
      setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content, failed } : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companionId: companion.id, message: text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        update(msg || "Something went wrong. Please try again.", true);
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
        // Stopped on purpose. Keep what came through.
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

  function retryLast() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) send(lastUser.content);
  }

  const last = messages[messages.length - 1];

  return (
    <main className="chat">
      <div className="chat-head">
        <Link href="/companions" className="back" aria-label="Back to companions">←</Link>
        <div className="avatar">{companion.avatar}</div>
        <div className="grow">
          <strong>{companion.name}</strong>
          <div className="muted small" aria-live="polite">{busy ? "typing..." : companion.vibe}</div>
        </div>
        <div className="menu-wrap" ref={menuRef}>
          <button
            className="btn ghost small"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Chat options"
            aria-expanded={menuOpen}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="menu card" role="menu">
              <Link href={`/companions/${companion.id}/edit`} className="menu-item" role="menuitem">
                Edit companion and memory
              </Link>
              <form
                action={clearChat}
                onSubmit={(e) => {
                  if (!confirm(`Start over with ${companion.name}? Messages and memory will be erased.`)) {
                    e.preventDefault();
                  } else setMenuOpen(false);
                }}
              >
                <input type="hidden" name="id" value={companion.id} />
                <button className="menu-item" role="menuitem">Start a fresh chat</button>
              </form>
              <form
                action={deleteCompanion}
                onSubmit={(e) => {
                  if (!confirm(`Delete ${companion.name}? This can't be undone.`)) e.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={companion.id} />
                <button className="menu-item danger" role="menuitem">Delete companion</button>
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
        {messages.length === 0 && (
          <p className="muted center small">Say hi to {companion.name} to start.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble-row ${m.role}`}>
            {m.role === "assistant" && <div className="avatar tiny">{companion.avatar}</div>}
            <div className={`bubble ${m.role} ${m.failed ? "failed" : ""}`}>
              {m.content || (
                <span className="dots" aria-label={`${companion.name} is typing`}>
                  <i /><i /><i />
                </span>
              )}
            </div>
          </div>
        ))}
        {!busy && last?.failed && (
          <div className="center">
            <button className="btn ghost small" onClick={retryLast}>Try again</button>
          </div>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
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
          placeholder={`Message ${companion.name}...`}
          aria-label={`Message ${companion.name}`}
          rows={1}
          maxLength={LIMITS.message}
          autoFocus
        />
        {busy ? (
          <button type="button" className="btn ghost" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="btn primary" disabled={!input.trim()}>Send</button>
        )}
      </form>
    </main>
  );
}
