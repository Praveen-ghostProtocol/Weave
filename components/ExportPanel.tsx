"use client";

// Export sidebar (DESIGN.md §4 "Export sidebar"): checkbox list of nodes,
// a live char/token counter, and a copy-to-clipboard export button.
// Self-contained — reads from useGraph() directly, no props.
import { useMemo, useState } from "react";
import { useGraph } from "@/lib/storage/useGraph";
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
        <div className="mt-2 flex gap-3 text-sm">
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

      <div className="border-t border-[var(--line)] p-4">
        <button
          type="button"
          onClick={handleExport}
          disabled={!result}
          className="w-full rounded-[6px] border border-transparent bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition-transform active:scale-[0.98] disabled:border-[var(--line)] disabled:bg-transparent disabled:text-[var(--ink-muted)] disabled:active:scale-100 data-[state=error]:bg-[var(--danger)]"
          data-state={copyError ? "error" : isCopied ? "copied" : "idle"}
        >
          {copyError ? "Copy failed — try again" : isCopied ? "Copied" : "Export selection"}
        </button>
      </div>
    </aside>
  );
}
