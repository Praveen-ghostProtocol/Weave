// Plain, honest disclosure of actual data practices — not legal advice.
// Consider real legal review before meaningful traffic; this is a
// reasonable baseline for a small launch, not a substitute for one.
//
// CONTACT_EMAIL is the one line here a user is told to act on, so it must
// be a real monitored address — a placeholder shipped publicly is worse
// than no contact section at all. Bump LAST_UPDATED whenever the wording
// below changes in substance.
const CONTACT_EMAIL = "s4spraveen.2005@gmail.com";
const LAST_UPDATED = "2026-10-20";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-[var(--ink)]">
      <h1 className="text-[22px] font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 flex flex-col gap-6 text-[15px] leading-relaxed">
        <section>
          <h2 className="font-semibold">What Weave is</h2>
          <p className="mt-2">
            Weave is a tool for building a personal graph of notes about yourself — one
            node per life domain — that you can export as context for AI chat tools.
          </p>
        </section>

        <section>
          <h2 className="font-semibold">Your persona content stays in your browser</h2>
          <p className="mt-2">
            Everything you write in Weave — node titles, notes, links between nodes — is
            stored only in your own browser (IndexedDB), not on our servers. We never see
            it, except for the one case below.
          </p>
        </section>

        <section>
          <h2 className="font-semibold">Account data</h2>
          <p className="mt-2">
            If you sign in, we use Google OAuth (via Supabase) to create your account. We
            receive your email address and basic profile info from Google. We store your
            account, your session, and a log of your AI feature usage (which task, which
            model, token counts, and cost — never the content of what you asked).
          </p>
        </section>

        <section>
          <h2 className="font-semibold">AI features and OpenAI</h2>
          <p className="mt-2">
            When you use an AI feature (like &ldquo;Draft with AI&rdquo;), the relevant
            node content you&apos;ve selected is sent to OpenAI to generate a response.
            OpenAI acts as our data processor for this. We don&apos;t store what you sent
            or what came back — only the usage metadata described above. See{" "}
            <a
              className="underline"
              href="https://openai.com/policies/privacy-policy"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI&apos;s privacy policy
            </a>{" "}
            for how they handle API data.
          </p>
        </section>

        <section>
          <h2 className="font-semibold">Cookies</h2>
          <p className="mt-2">
            We use a session cookie (via Supabase) to keep you signed in. That&apos;s it —
            no tracking or advertising cookies.
          </p>
        </section>

        <section>
          <h2 className="font-semibold">Deleting your account</h2>
          <p className="mt-2">
            Click &ldquo;Delete account&rdquo; in the app at any time. This removes your
            account, session, and usage records immediately and permanently. Your persona
            content was never on our servers to begin with — it stays in your browser
            until you clear it yourself.
          </p>
        </section>

        <section>
          <h2 className="font-semibold">Contact</h2>
          <p className="mt-2">
            Questions about this policy:{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
