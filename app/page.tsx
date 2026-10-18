"use client";

// Main app shell (DESIGN.md §4 "Shared layout rule"): canvas is the base
// layer, full-bleed; the export sidebar and the node editor are both
// toggleable overlay panels from opposite edges, never a permanent third
// column — DESIGN.md's rule explicitly, not just a narrow-viewport nicety.
// On narrow viewports opening one closes the other, since both can't fit.
import { useRef, useState } from "react";
import { useGraph } from "@/lib/storage/useGraph";
import EmptyState from "@/components/EmptyState";
import GraphView from "@/components/GraphView";
import NodeEditor, { type NodeEditorHandle } from "@/components/NodeEditor";
import ExportPanel from "@/components/ExportPanel";

export default function Home() {
  const { graph, loading } = useGraph();

  // undefined = editor closed, null = editor open for a new node,
  // string = editor open for that node's id. Distinguishing "closed" from
  // "new" (both would otherwise be falsy) is why this isn't just
  // `string | null`.
  const [editorTarget, setEditorTarget] = useState<string | null | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const editorRef = useRef<NodeEditorHandle>(null);

  const NARROW_VIEWPORT = 768; // DESIGN.md's "narrow viewports" breakpoint

  // Changing editorTarget changes NodeEditor's `key`, which remounts it —
  // bypassing its own Cancel button entirely. Without this check, clicking
  // a different node (or "+ New node") while mid-edit silently discards
  // whatever wasn't saved yet.
  function requestEditorTarget(next: string | null | undefined) {
    if (editorRef.current?.isDirty() && !window.confirm("Discard unsaved changes?")) {
      return;
    }
    if (next !== undefined && window.innerWidth < NARROW_VIEWPORT) setExportOpen(false);
    setEditorTarget(next);
  }

  function toggleExport() {
    if (
      !exportOpen &&
      editorTarget !== undefined &&
      window.innerWidth < NARROW_VIEWPORT
    ) {
      if (editorRef.current?.isDirty() && !window.confirm("Discard unsaved changes?")) {
        return;
      }
      setEditorTarget(undefined);
    }
    setExportOpen((open) => !open);
  }

  if (loading) {
    return (
      <main className="dot-grid flex h-screen w-full items-center justify-center">
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      </main>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <main className="dot-grid relative h-full w-full">
        <GraphView onNodeClick={(nodeId) => requestEditorTarget(nodeId)} />

        {graph.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto">
              <EmptyState onAddFirstNode={() => requestEditorTarget(null)} />
            </div>
          </div>
        )}

        {/* Only rendered while the editor is closed — otherwise it sits
            underneath the editor panel, visually hidden but still
            keyboard-focusable (a real a11y issue, not just visual). */}
        {editorTarget === undefined && (
          <button
            type="button"
            onClick={() => requestEditorTarget(null)}
            className="absolute right-4 top-4 z-10 rounded-[6px] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition-transform active:scale-[0.98]"
          >
            + New node
          </button>
        )}
      </main>

      {/* z-30: above both overlay panels, so it's always reachable to close
          the export panel — never covered the way "+ New node" was. */}
      <button
        type="button"
        onClick={toggleExport}
        className="absolute left-4 top-4 z-30 rounded-[6px] border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-transform active:scale-[0.98]"
      >
        {exportOpen ? "Close export" : "Export"}
      </button>

      {exportOpen && (
        <div className="absolute left-0 top-0 z-20 h-full">
          <ExportPanel />
        </div>
      )}

      {editorTarget !== undefined && (
        <div className="absolute right-0 top-0 z-20 h-full">
          <NodeEditor
            ref={editorRef}
            key={editorTarget ?? "new"}
            nodeId={editorTarget}
            onClose={() => setEditorTarget(undefined)}
          />
        </div>
      )}
    </div>
  );
}
