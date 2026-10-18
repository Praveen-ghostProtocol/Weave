"use client";

// Temporary debug form proving useGraph + Dexie persistence end-to-end.
// Replaced by the real node-editor/graph-view components in later tasks.
import { useRef, useState } from "react";
import { useGraph } from "@/lib/storage/useGraph";
import EmptyState from "@/components/EmptyState";

export default function Home() {
  const { graph, loading, addNode } = useGraph();
  const [title, setTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  return (
    <main className="dot-grid flex flex-1 flex-col items-center justify-center gap-6 p-8">
      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : (
        <>
          {graph.nodes.length === 0 && (
            // Focuses the debug input rather than opening a real editor —
            // half-measure, acceptable only until the node-editor task
            // replaces this whole debug form.
            <EmptyState onAddFirstNode={() => titleInputRef.current?.focus()} />
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              addNode({ title, domain: "debug", body: "", position: { x: 0, y: 0 } });
              setTitle("");
            }}
          >
            <input
              ref={titleInputRef}
              className="rounded-[6px] border border-[var(--line)] px-2 py-1 text-sm text-[var(--ink)]"
              placeholder="Node title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-[6px] border border-[var(--line)] px-2 py-1 text-sm text-[var(--ink)]"
            >
              Add node
            </button>
          </form>

          {graph.nodes.length > 0 && (
            <ul className="text-sm text-[var(--ink)]">
              {graph.nodes.map((n) => (
                <li key={n.id}>{n.title}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
