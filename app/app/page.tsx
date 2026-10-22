"use client";

// Main app shell (DESIGN.md §4 "Shared layout rule"): canvas is the base
// layer, full-bleed; the export sidebar and the node editor are both
// toggleable overlay panels from opposite edges, never a permanent third
// column — DESIGN.md's rule explicitly, not just a narrow-viewport nicety.
// On narrow viewports opening one closes the other, since both can't fit.
import { useRef, useState } from "react";
import { useGraph } from "@/lib/storage/useGraph";
import { useSession } from "@/lib/supabase/useSession";
import EmptyState from "@/components/EmptyState";
import GraphView from "@/components/GraphView";
import NodeEditor, { type NodeEditorHandle } from "@/components/NodeEditor";
import ExportPanel from "@/components/ExportPanel";

// Sign-in/account corner affordance (auth module). Additive only: guest
// mode (below) never reads from this — it renders independently in its own
// free corner (bottom-left; top-left is "Export", top-right is "+ New
// node"). Signing in now happens on /login (landing page's job) — signed
// out, this is just a minimal text link back there, not a full button.
function AuthCorner() {
  const { user, loading, signOut } = useSession();
  const [deleting, setDeleting] = useState(false);
  // Synchronous guard (same pattern as ExportPanel's draft-submit guard):
  // the `deleting` disabled state relies on React committing a re-render
  // before a second trigger lands, which is timing, not a lock.
  const deleteInFlightRef = useRef(false);

  async function handleDeleteAccount() {
    if (deleteInFlightRef.current) return;
    if (!window.confirm("Delete your account? This can't be undone.")) return;
    deleteInFlightRef.current = true;
    setDeleting(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (res.ok) {
        await signOut();
      } else {
        window.alert("Failed to delete account. Please try again.");
        setDeleting(false);
      }
    } finally {
      deleteInFlightRef.current = false;
    }
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="absolute left-4 bottom-4 z-10 flex flex-col items-start gap-1.5">
        <a href="/login" className="pl-1 text-[13px] font-medium text-[var(--ink-muted)] underline">
          Sign in
        </a>
        <a href="/privacy" className="pl-1 text-[12px] text-[var(--ink-muted)] underline">
          Privacy Policy
        </a>
      </div>
    );
  }

  return (
    <div className="absolute left-4 bottom-4 z-10 flex items-center gap-3 rounded-[6px] border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-2 text-sm">
      <span className="text-[var(--ink-muted)]">{user.email}</span>
      <button
        type="button"
        onClick={() => signOut()}
        className="font-medium text-[var(--ink)] transition-transform active:scale-[0.98]"
      >
        Sign out
      </button>
      <button
        type="button"
        onClick={handleDeleteAccount}
        disabled={deleting}
        className="font-medium text-[var(--danger,#A23B2E)] transition-transform active:scale-[0.98] disabled:opacity-50"
      >
        {deleting ? "Deleting…" : "Delete account"}
      </button>
    </div>
  );
}

export default function Home() {
  const { graph, loading } = useGraph();

  // undefined = editor closed, null = editor open for a new node,
  // string = editor open for that node's id. Distinguishing "closed" from
  // "new" (both would otherwise be falsy) is why this isn't just
  // `string | null`.
  const [editorTarget, setEditorTarget] = useState<string | null | undefined>(undefined);
  // Parent for a brand-new node opened via "Add a sub-node". Separate
  // from editorTarget because that already encodes three states
  // (closed / new / editing id) and a fourth would make every read of
  // it a puzzle.
  const [newParentId, setNewParentId] = useState<string | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const editorRef = useRef<NodeEditorHandle>(null);

  const NARROW_VIEWPORT = 768; // DESIGN.md's "narrow viewports" breakpoint

  // Changing editorTarget changes NodeEditor's `key`, which remounts it —
  // bypassing its own Cancel button entirely. Without this check, clicking
  // a different node (or "+ New node") while mid-edit silently discards
  // whatever wasn't saved yet.
  function requestEditorTarget(next: string | null | undefined, parentId?: string) {
    if (editorRef.current?.isDirty() && !window.confirm("Discard unsaved changes?")) {
      return;
    }
    setNewParentId(next === null ? parentId : undefined);
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
            // The key has to include the preset parent: going from one
            // "Add a sub-node" straight to another keeps editorTarget at
            // null, and without this the panel would not remount and
            // would keep the previous parent in its state.
            key={editorTarget ?? `new:${newParentId ?? ""}`}
            nodeId={editorTarget}
            initialParentId={newParentId}
            onAddChild={(id) => requestEditorTarget(null, id)}
            onClose={() => setEditorTarget(undefined)}
          />
        </div>
      )}

      <AuthCorner />
    </div>
  );
}
