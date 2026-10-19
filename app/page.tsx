"use client";

// Landing page. Weave's graph app itself lives at /app now (moved from
// here) — this route's only job is: say what Weave is in one line, and get
// a visitor into the app, signed in or not. DESIGN.md was written for the
// graph app's 4 surfaces, not this page, but the same tokens/type-scale and
// avoid-list spirit apply: no hero section, no gradients, no bento, no
// stock SaaS two-button-centered-card look — just the dot-grid canvas
// background the app itself uses, a headline at the same size as the empty
// state's, and two plain buttons in the existing button styles.
import { useSession } from "@/lib/supabase/useSession";

export default function LandingPage() {
  const { user, loading } = useSession();
  const signedIn = !loading && !!user;

  return (
    <main className="dot-grid flex h-screen w-full flex-col items-center justify-center gap-7 px-6 text-center">
      <div className="max-w-md">
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">Map out who you are.</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
          One graph of linked notes about your life — work, people, projects — exported as
          context any AI chat can use. No setup required.
        </p>
      </div>

      {/* Gated on loading, not just rendered optimistically signed-out —
          otherwise a returning signed-in visitor sees "Continue as guest"
          flash before flipping to "Open your graph" once the session
          resolves. A fixed-height placeholder holds the layout steady. */}
      <div className="flex h-[42px] flex-col items-center gap-3 sm:flex-row">
        {!loading && (
          <>
            <a
              href="/app"
              className="rounded-[6px] bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--surface)] transition-transform active:scale-[0.98]"
            >
              {signedIn ? "Open your graph" : "Continue as guest"}
            </a>
            {!signedIn && (
              <a
                href="/login"
                className="rounded-[6px] border border-[var(--line)] bg-[var(--surface-raised)] px-5 py-2.5 text-sm font-medium text-[var(--ink)] transition-transform active:scale-[0.98]"
              >
                Sign in
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}
