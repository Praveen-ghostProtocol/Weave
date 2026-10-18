"use client";

// Export sidebar (DESIGN.md §4 "Export sidebar"): checkbox list of nodes,
// a live char/token counter, and a copy-to-clipboard export button.
// Self-contained — reads from useGraph() directly, no props.
import { useEffect, useMemo, useRef, useState } from "react";
import { Key } from "@phosphor-icons/react";
import { useGraph } from "@/lib/storage/useGraph";
import { exportContext } from "@/lib/graph/export";
import { clearApiKey, getApiKey, hasApiKey, setApiKey } from "@/lib/storage/apiKey";
import { draftContext, DraftContextError } from "@/lib/llm/anthropic";

export default function ExportPanel() {
  const { graph } = useGraph();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // What was last successfully copied, so "Copied" is *derived* (does it
  // match the current export?) instead of synced via an effect — it goes
  // stale correctly the moment selection or graph content changes, with
  // no separate state to keep in sync.
  const [copiedMarkdown, setCopiedMarkdown] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);

  // API key settings row (DESIGN.md "Export sidebar — AI draft assist"):
  // collapsed by default, never prefilled with the real stored key — the
  // icon's tint/label is the only place "key set" status shows.
  const [keySet, setKeySet] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const keyInputRef = useRef<HTMLInputElement>(null);

  // hasApiKey() reads localStorage, unavailable during SSR. Read it after
  // mount, inside a microtask callback rather than synchronously in the
  // effect body — same async-boundary shape useGraph's Dexie load uses,
  // which the react-hooks set-state-in-effect lint rule requires.
  useEffect(() => {
    Promise.resolve().then(() => setKeySet(hasApiKey()));
  }, []);

  // Focus the key input whenever the settings row opens — covers both the
  // icon toggle and "Draft with AI"'s no-key redirect below.
  useEffect(() => {
    if (settingsOpen) keyInputRef.current?.focus();
  }, [settingsOpen]);

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
  // still beat that and fire two concurrent requests against the user's
  // paid API key.
  const draftInFlightRef = useRef(false);

  function saveKey() {
    setApiKey(keyInput);
    setKeySet(hasApiKey());
    setKeyInput("");
    setSettingsOpen(false);
  }

  function handleClearKey() {
    clearApiKey();
    setKeySet(false);
    setKeyInput("");
  }

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
    if (!hasApiKey()) {
      setSettingsOpen(true);
      return;
    }
    if (draftInFlightRef.current) return;
    draftInFlightRef.current = true;
    setDraftStatus("loading");
    setDraftError(null);
    try {
      const text = await draftContext(result.markdown, getApiKey() ?? "");
      setDraftResult(text);
      setDraftCopied(false);
      setDraftStatus("idle");
    } catch (err) {
      setDraftError(err instanceof DraftContextError ? err.message : "Something went wrong drafting with AI.");
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
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <div className="flex gap-3">
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
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label={keySet ? "API key set" : "No API key set"}
            title={keySet ? "API key set" : "No API key set"}
            className={`rounded-[6px] p-1 transition-transform active:scale-[0.98] ${
              keySet ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
            }`}
          >
            <Key size={16} weight="regular" />
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="border-b border-[var(--line)] p-4">
          <label className="block text-sm text-[var(--ink)]">
            Anthropic API key
            <input
              ref={keyInputRef}
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoComplete="off"
              className="mt-2 w-full rounded-[6px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]"
            />
          </label>
          <p className="mt-2 text-[12px] text-[var(--ink-muted)]">
            Stored only in this browser. Used only to call Anthropic directly.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={saveKey}
              className="rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--surface)] transition-transform active:scale-[0.98]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleClearKey}
              className="text-sm text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>
      )}

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
      </div>
    </aside>
  );
}
