"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "./actions";
import { Logo } from "@/components/Icons";

export default function AuthForm({ mode, appName }: { mode: "login" | "signup"; appName: string }) {
  const [state, action, pending] = useActionState(mode === "login" ? login : signup, undefined);
  const isSignup = mode === "signup";

  return (
    <main className="auth">
      <aside className="auth-side">
        <Link href="/" className="brand" style={{ padding: 0 }}><Logo /> {appName}</Link>
        <div className="stack">
          <p className="display">&ldquo;It asked how my sister&apos;s wedding went. I told it about that <em>a month ago.</em>&rdquo;</p>
          <span className="muted small">What memory feels like</span>
        </div>
        <span className="faint small">Companions are AI. Your chats stay private.</span>
      </aside>

      <div className="auth-main">
        <form action={action} className="auth-card">
          <div className="stack" style={{ gap: 8 }}>
            <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
            <p className="muted">
              {isSignup ? "Takes 20 seconds. Free to start." : "Log in to pick up where you left off."}
            </p>
          </div>

          {isSignup && (
            <>
              <label>
                Your name
                <input name="name" required maxLength={60} autoComplete="name" placeholder="Sam Rivera" />
              </label>
              <label>
                Username
                <input
                  name="username"
                  required
                  minLength={3}
                  maxLength={20}
                  pattern="[a-zA-Z0-9_]{3,20}"
                  autoComplete="username"
                  placeholder="sam"
                />
                <span className="hint">Letters, numbers and _ only. People find you by this.</span>
              </label>
            </>
          )}
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={isSignup ? 8 : undefined}
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? "At least 8 characters" : ""}
            />
          </label>

          {state?.error && <p className="error" role="alert">{state.error}</p>}

          <button className="btn primary lg full" disabled={pending}>
            {pending ? "One moment..." : isSignup ? "Create account" : "Log in"}
          </button>

          <p className="muted small center">
            {isSignup ? (
              <>Already have an account? <Link href="/login" style={{ color: "var(--sky)" }}>Log in</Link></>
            ) : (
              <>New here? <Link href="/signup" style={{ color: "var(--sky)" }}>Create an account</Link></>
            )}
          </p>
        </form>
      </div>
    </main>
  );
}
