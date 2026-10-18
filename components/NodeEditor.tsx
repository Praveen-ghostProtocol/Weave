"use client";

// Node editor panel (DESIGN.md §4 "Node editor"): fixed-width 420px panel,
// not a modal. Reads/writes via useGraph directly — no prop-drilled API,
// per the architecture decision that components talk to the shared state
// container themselves. Positioning this panel inside the app layout is the
// integration task's job, not this component's (it just assumes it gets
// slotted into a flex/grid parent at full height).
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useGraph } from "@/lib/storage/useGraph";

interface NodeEditorProps {
  nodeId: string | null;
  onClose: () => void;
}

// Exposed to the parent so it can check for unsaved changes before swapping
// which node this panel edits (e.g. clicking a different graph node, or
// "+ New node", while mid-edit) — a `key` change remounts this component
// directly, bypassing its own Cancel button and any state it holds, so the
// parent needs to ask *before* triggering that remount, not after.
export interface NodeEditorHandle {
  isDirty: () => boolean;
}

const NodeEditor = forwardRef<NodeEditorHandle, NodeEditorProps>(function NodeEditor(
  { nodeId, onClose },
  ref,
) {
  const { graph, addNode, updateNode, deleteNode } = useGraph();
  const existing = nodeId ? graph.nodes.find((n) => n.id === nodeId) ?? null : null;

  // IMPORTANT: this panel stays mounted (it's not a modal — DESIGN.md), so
  // switching which node is open changes the `nodeId` prop on an already-
  // mounted instance. useState's initializer only runs once per mount, so
  // without a remount the form would keep showing the previous node's text
  // and silently save it under the new node's id on Save. The caller MUST
  // render this with `key={nodeId ?? "new"}` so React remounts (and these
  // initializers re-run) whenever the edited node's identity changes —
  // this is React's own recommended fix for "reset state when a prop
  // changes" (see react.dev/learn/you-might-not-need-an-effect), not an
  // oversight. An effect-based resync was tried and reverted: it works but
  // trips the project's set-state-in-effect lint rule and is strictly more
  // code for the same result.
  const [title, setTitle] = useState(existing?.title ?? "");
  const [domain, setDomain] = useState(existing?.domain ?? "");
  const [body, setBody] = useState(existing?.body ?? "");

  const uid = useId();
  const titleId = `${uid}-title`;
  const domainId = `${uid}-domain`;
  const domainListId = `${uid}-domainlist`;
  const bodyId = `${uid}-body`;

  // Previously-used domain tags for the <datalist> autocomplete (DESIGN.md's
  // resolved Open Question 2: free-form text, not a closed enum).
  const knownDomains = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) {
      if (n.domain) set.add(n.domain);
    }
    return Array.from(set).sort();
  }, [graph.nodes]);

  const canSave = title.trim().length > 0;
  const isDirty =
    title !== (existing?.title ?? "") ||
    domain !== (existing?.domain ?? "") ||
    body !== (existing?.body ?? "");

  useImperativeHandle(ref, () => ({ isDirty: () => isDirty }), [isDirty]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const payload = { title: title.trim(), domain: domain.trim(), body };
    if (nodeId) {
      updateNode(nodeId, payload);
    } else {
      // Small random offset, not a fixed {0,0} — several new nodes added
      // back-to-back before any drag would otherwise stack exactly on top
      // of each other (and their connection handles with them).
      addNode({
        ...payload,
        position: { x: Math.random() * 200, y: Math.random() * 200 },
      });
    }
    onClose();
  }

  function handleCancel() {
    // DESIGN.md §7: warn before discarding an unsaved edit — the dirty
    // check the parent uses via the ref above, but Cancel is this
    // component's own button, so it can just check its own local state.
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  function handleDelete() {
    if (!nodeId) return;
    // DESIGN.md §7: delete cascades edges, destructive, requires a confirm
    // step. window.confirm is the native, lazy way to get that for v0.
    if (!window.confirm("Delete this node and its links? This can't be undone.")) {
      return;
    }
    deleteNode(nodeId);
    onClose();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex h-full w-[420px] flex-col gap-5 overflow-hidden rounded-[8px] p-6"
      style={{
        backgroundColor: "var(--surface-raised, #FFFFFF)",
        boxShadow: "0 1px 3px color-mix(in srgb, var(--ink) 15%, transparent)",
      }}
    >
      <h2 className="text-[15px] font-semibold text-[var(--ink)]">
        {nodeId ? "Edit node" : "New node"}
      </h2>

      <div className="flex flex-col gap-2">
        <label htmlFor={titleId} className="text-sm font-medium text-[var(--ink)]">
          Title
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] font-semibold text-[var(--ink)]"
        />
        {!canSave && (
          <p className="text-sm text-[var(--danger,#A23B2E)]">Title is required.</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={domainId} className="text-sm font-medium text-[var(--ink)]">
          Domain
        </label>
        <input
          id={domainId}
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          list={domainListId}
          className="rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] text-[var(--ink)]"
        />
        <datalist id={domainListId}>
          {knownDomains.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <label htmlFor={bodyId} className="text-sm font-medium text-[var(--ink)]">
          Notes
        </label>
        <textarea
          id={bodyId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="flex-1 resize-none rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] leading-normal text-[var(--ink)]"
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
        {nodeId ? (
          <button
            type="button"
            onClick={handleDelete}
            className="text-sm font-medium text-[var(--danger,#A23B2E)] transition-transform active:scale-[0.98]"
          >
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-[6px] border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-transform active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-[6px] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition-transform disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
          >
            Save
          </button>
        </div>
      </div>
    </form>
  );
});

export default NodeEditor;
