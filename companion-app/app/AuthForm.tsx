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
        <blockquote>Some memories deserve to live forever.</blockquote>
        <span className="faint small">Private by default. Companions are AI, never the real person.</span>
      </aside>

      <div className="auth-main">
        <form action={action} className="auth-card">
          <div className="stack" style={{ gap: 8 }}>
            <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
            <p className="muted small">
              {isSignup ? "Just your name, email and a password. Free during early access." : "Log in to continue."}
            </p>
          </div>

          {isSignup && (
            <>
              <label>
                Your name
                <input name="name" required maxLength={60} autoComplete="name" placeholder="Sam Rivera" />
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

          <button className="btn primary lg full" disabled={pending} style={{ marginTop: 4 }}>
            {pending ? "One moment..." : isSignup ? "Create account" : "Log in"}
          </button>

          <p className="muted small center">
            {isSignup ? (
              <>Already have an account? <Link href="/login" style={{ color: "var(--primary-hover)" }}>Log in</Link></>
            ) : (
              <>New here? <Link href="/signup" style={{ color: "var(--primary-hover)" }}>Create an account</Link></>
            )}
          </p>
        </form>
      </div>
    </main>
  );
}
