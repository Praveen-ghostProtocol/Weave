"use client";

// Temporary debug form proving useGraph + Dexie persistence end-to-end.
// Replaced by the real node-editor/graph-view components in later tasks.
import { useState } from "react";
import { useGraph } from "@/lib/storage/useGraph";

export default function Home() {
  const { graph, loading, addNode } = useGraph();
  const [title, setTitle] = useState("");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)]">
        Weave
      </h1>

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
          className="border px-2 py-1"
          placeholder="Node title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="border px-2 py-1">
          Add node
        </button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <ul className="text-sm">
          {graph.nodes.map((n) => (
            <li key={n.id}>{n.title}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
