"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "./actions";

export default function AuthForm({ mode, appName }: { mode: "login" | "signup"; appName: string }) {
  const [state, action, pending] = useActionState(mode === "login" ? login : signup, undefined);
  const isSignup = mode === "signup";

  return (
    <main className="center-page">
      <form action={action} className="card auth-card">
        <h1>{isSignup ? `Join ${appName}` : "Welcome back"}</h1>
        <p className="muted">
          {isSignup ? "Make an account to create your companion." : "Log in to talk to your companions."}
        </p>

        {isSignup && (
          <label>
            Your name
            <input name="name" required maxLength={60} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
          />
        </label>

        {state?.error && <p className="error">{state.error}</p>}

        <button className="btn primary full" disabled={pending}>
          {pending ? "Please wait..." : isSignup ? "Create account" : "Log in"}
        </button>

        <p className="muted small center">
          {isSignup ? (
            <>Already have an account? <Link href="/login">Log in</Link></>
          ) : (
            <>New here? <Link href="/signup">Create an account</Link></>
          )}
        </p>
      </form>
    </main>
  );
}
