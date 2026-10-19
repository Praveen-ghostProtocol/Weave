"use client";

// Sign-in page: Google OAuth (unchanged, just relocated from the app's
// corner) plus an email magic-link form (no passwords — same reasoning
// that picked OAuth-only originally). Both paths land on /app on success.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSession } from "@/lib/supabase/useSession";

export default function LoginPage() {
  const { signInWithGoogle, signInWithMagicLink } = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const { error } = await signInWithMagicLink(email);
    setStatus(error ? "error" : "sent");
  }

  return (
    <main className="dot-grid flex h-screen w-full items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-[8px] border border-[var(--line)] bg-[var(--surface-raised)] p-6">
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">Sign in</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
          Signing in unlocks AI draft assist. Guest mode works fully without it.
        </p>

        <button
          type="button"
          onClick={signInWithGoogle}
          className="mt-6 w-full rounded-[6px] border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-transform active:scale-[0.98]"
        >
          Sign in with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-[12px] text-[var(--ink-muted)]">
          <span className="h-px flex-1 bg-[var(--line)]" />
          or
          <span className="h-px flex-1 bg-[var(--line)]" />
        </div>

        {status === "sent" ? (
          <p role="status" className="text-sm text-[var(--ink)]">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleMagicLink} className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-medium text-[var(--ink)]">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-[6px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="mt-2 rounded-[6px] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {status === "error" && (
              <p role="alert" className="text-sm text-[var(--danger)]">
                Couldn&apos;t send the link. Please try again.
              </p>
            )}
          </form>
        )}

        <Link href="/" className="mt-6 block text-center text-[12px] text-[var(--ink-muted)] underline">
          Back
        </Link>
      </div>
    </main>
  );
}
