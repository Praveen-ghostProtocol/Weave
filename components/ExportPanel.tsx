"use client";

// Export sidebar (DESIGN.md §4 "Export sidebar"): checkbox list of nodes,
// a live char/token counter, and a copy-to-clipboard export button.
// Self-contained — reads from useGraph() directly, no props.
import { useMemo, useRef, useState } from "react";
import { useGraph } from "@/lib/storage/useGraph";
import { useSession } from "@/lib/supabase/useSession";
import { exportContext } from "@/lib/graph/export";

export default function ExportPanel() {
  const { graph } = useGraph();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // What was last successfully copied, so "Copied" is *derived* (does it
  // match the current export?) instead of synced via an effect — it goes
  // stale correctly the moment selection or graph content changes, with
  // no separate state to keep in sync.
  const [copiedMarkdown, setCopiedMarkdown] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);

  // Drafting is server-side now (app/api/ai/draft-brief): signed-in users
  // only, the OpenAI key never leaves the server. The old bring-your-own-key
  // settings row went with it — there is nothing left for the user to
  // configure, so the Key icon affordance in DESIGN.md's addendum no longer
  // has a job.
  const { user, loading: sessionLoading } = useSession();
  // Clicking "Draft with AI" while signed out is a discoverable state, not
  // a failure — same reasoning as DESIGN.md's "No key set" rule — so it
  // gets its own inline prompt instead of the button's error treatment.
  const [signInPrompt, setSignInPrompt] = useState(false);

  // "Draft with AI" (DESIGN.md "AI draft assist"): same idiom as the export
  // button's copy/copyError label-swap, one more state (loading/error) and
  // a separate result instead of a second half-finished state machine.
  const [draftStatus, setDraftStatus] = useState<"idle" | "loading" | "error">("idle");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<string | null>(null);
  const [draftCopied, setDraftCopied] = useState(false);
  // Synchronous guard against a double-submit: the button's own `disabled`
  // relies on React having committed "loading" state before a second click
  // lands, which is timing, not a lock. A fast or synthetic double-click can
  // still beat that and fire two concurrent requests — now billed to the
  // founder's OpenAI key, and each one reserves budget against the user's
  // quota, so this matters more than it did under BYOK.
  const draftInFlightRef = useRef(false);

  // selectedIds can retain the id of a node deleted elsewhere (e.g. via
  // NodeEditor); filter at read time rather than pruning the Set in an
  // effect — exportContext would tolerate a stale id anyway, this just
  // keeps the checkbox list and counter from ever reflecting a dead node.
  const liveSelectedIds = useMemo(() => {
    const liveIds = new Set(graph.nodes.map((n) => n.id));
    return new Set(Array.from(selectedIds).filter((id) => liveIds.has(id)));
  }, [selectedIds, graph.nodes]);

  const result = useMemo(
    () => exportContext(graph, Array.from(liveSelectedIds)),
    [graph, liveSelectedIds],
  );

  const isCopied = copiedMarkdown !== null && copiedMarkdown === result?.markdown;

  async function handleDraft() {
    if (!result) return;
    // Signed out: prompt instead of firing a request the server would
    // reject anyway. While the session is still loading we let the request
    // go and handle a 401 below, rather than guessing from an unsettled
    // `user`. The server checks auth itself — this is UX, not the gate.
    if (!sessionLoading && !user) {
      setSignInPrompt(true);
      setDraftStatus("idle");
      setDraftError(null);
      return;
    }
    if (draftInFlightRef.current) return;
    draftInFlightRef.current = true;
    setSignInPrompt(false);
    setDraftStatus("loading");
    setDraftError(null);
    try {
      const res = await fetch("/api/ai/draft-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: result.markdown }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        // 401 means the session lapsed mid-visit. Same discoverable prompt
        // as never having signed in, not a red "draft failed" button.
        if (res.status === 401) {
          setSignInPrompt(true);
          setDraftStatus("idle");
          return;
        }
        // The route already words every failure for a human (quota spent,
        // monthly cap reached, AI paused, upstream unreachable). Show its
        // message rather than re-deriving one from the status code here —
        // one place owns the wording, and it's the place that knows why.
        setDraftError(
          typeof body?.error === "string" ? body.error : "Something went wrong drafting with AI.",
        );
        setDraftStatus("error");
        return;
      }

      if (typeof body?.text !== "string") {
        setDraftError("The AI service returned an unexpected response.");
        setDraftStatus("error");
        return;
      }

      setDraftResult(body.text);
      setDraftCopied(false);
      setDraftStatus("idle");
    } catch {
      // fetch itself rejected — offline, DNS, request blocked. Distinct
      // from the route's own 502, which means it reached us but not OpenAI.
      setDraftError("Could not reach Weave. Check your connection and try again.");
      setDraftStatus("error");
    } finally {
      draftInFlightRef.current = false;
    }
  }

  async function handleCopyDraft() {
    if (!draftResult) return;
    try {
      await navigator.clipboard.writeText(draftResult);
      setDraftCopied(true);
    } catch {
      // Best-effort — raw export already covers the "clipboard denied"
      // messaging; this is a secondary action on top of that result.
    }
  }

  function dismissDraft() {
    setDraftResult(null);
    setDraftStatus("idle");
    setDraftError(null);
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCopyError(false);
  }

  function selectAll() {
    setSelectedIds(new Set(graph.nodes.map((n) => n.id)));
    setCopyError(false);
  }

  function selectNone() {
    setSelectedIds(new Set());
    setCopyError(false);
  }

  async function handleExport() {
    if (!result) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopiedMarkdown(result.markdown);
    } catch {
      // Clipboard API can throw (denied permission, insecure context, no
      // document focus) — show a visible failure instead of silently
      // doing nothing, so the user knows the export didn't go through.
      setCopyError(true);
    }
  }

  return (
    <aside
      className="flex w-80 flex-col rounded-[8px] border border-[var(--line)] bg-[var(--surface-raised)]"
      style={{ boxShadow: "0 1px 3px color-mix(in srgb, var(--ink) 15%, transparent)" }}
    >
      <div className="sticky top-0 border-b border-[var(--line)] bg-[var(--surface-raised)] p-4">
        <p className="font-mono text-[13px] font-medium text-[var(--ink)]">
          ~{(result?.markdown.length ?? 0).toLocaleString()} characters / ~
          {(result?.estimate ?? 0).toLocaleString()} tokens
        </p>
        <div className="mt-2 flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={selectAll}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={selectNone}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Select none
          </button>
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {graph.nodes.map((node) => (
          <li key={node.id}>
            <label className="flex items-center gap-2 rounded-[6px] px-2 py-2 text-sm text-[var(--ink)] hover:bg-[var(--surface)]">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={liveSelectedIds.has(node.id)}
                onChange={() => toggle(node.id)}
              />
              <span className="flex-1 truncate font-semibold">{node.title}</span>
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[12px] font-medium tracking-wide text-[var(--ink-muted)]">
                {node.domain}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {draftResult && (
        <div className="border-t border-[var(--line)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--ink)]">AI draft</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopyDraft}
                className="text-sm text-[var(--accent)] underline-offset-2 hover:underline"
              >
                {draftCopied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={dismissDraft}
                aria-label="Dismiss AI draft"
                className="text-[var(--ink-muted)]"
              >
                ×
              </button>
            </div>
          </div>
          <div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-[6px] border border-[var(--line)] bg-[var(--surface)] p-2 text-sm text-[var(--ink)]">
            {draftResult}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-[var(--line)] p-4">
        <button
          type="button"
          onClick={handleExport}
          disabled={!result}
          className="w-full rounded-[6px] border border-transparent bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition-transform active:scale-[0.98] disabled:border-[var(--line)] disabled:bg-transparent disabled:text-[var(--ink-muted)] disabled:active:scale-100 data-[state=error]:bg-[var(--danger)]"
          data-state={copyError ? "error" : isCopied ? "copied" : "idle"}
        >
          {copyError ? "Copy failed — try again" : isCopied ? "Copied" : "Export selection"}
        </button>
        <button
          type="button"
          onClick={handleDraft}
          disabled={!result || draftStatus === "loading"}
          className="w-full rounded-[6px] border border-[var(--line)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-transform active:scale-[0.98] disabled:text-[var(--ink-muted)] disabled:active:scale-100 data-[state=error]:border-[var(--danger)]"
          data-state={draftStatus}
        >
          {draftStatus === "loading"
            ? "Drafting…"
            : draftStatus === "error"
              ? "Draft failed — try again"
              : "Draft with AI"}
        </button>
        {draftStatus === "error" && draftError && (
          <p role="alert" aria-live="polite" className="text-[12px] text-[var(--danger)]">
            {draftError}
          </p>
        )}
        {signInPrompt && (
          <p role="status" aria-live="polite" className="text-[12px] text-[var(--ink-muted)]">
            <a href="/login" className="text-[var(--accent)] underline underline-offset-2">
              Sign in
            </a>{" "}
            to draft with AI. Export selection works without an account.
          </p>
        )}
      </div>
    </aside>
  );
}
