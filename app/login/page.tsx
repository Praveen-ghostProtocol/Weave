"use client";

// Sign-in page: Google OAuth only.
//
// An email magic-link form lived here until 2026-10-20 and was removed on
// purpose. SPEC.md's Tech Stack says "Google OAuth at launch — no passwords,
// no reset flow, no credential-stuffing surface", and Open Question 2
// records the same decision. Beyond matching the spec, Google *is* the abuse
// control: it carries phone verification and throwaway-account heuristics
// that `signInWithOtp` carries none of. That endpoint defaults to creating a
// user for any address the requester can read, and every new account comes
// with a fresh per-user OpenAI quota — so plus-addressing or one catch-all
// domain is an unlimited account-minting path straight into the founder's
// spend. Do not add it back without an abuse story, a SPEC amendment, and a
// privacy-policy update (app/privacy/page.tsx describes sign-in as Google).
import Link from "next/link";
import { useSession } from "@/lib/supabase/useSession";

export default function LoginPage() {
  const { signInWithGoogle } = useSession();

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

        <Link href="/" className="mt-6 block text-center text-[12px] text-[var(--ink-muted)] underline">
          Back
        </Link>
      </div>
    </main>
  );
}
