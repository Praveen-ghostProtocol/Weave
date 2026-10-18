import type { PersonaGraph } from "./types";

// Deleting a non-existent id is a no-op (not an error) — matches linkNodes'
// relink-is-a-no-op precedent in SPEC.md, and callers (e.g. delete buttons)
// shouldn't need to guard against stale ids.
export function deleteNode(graph: PersonaGraph, nodeId: string): PersonaGraph {
  return {
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.fromId !== nodeId && e.toId !== nodeId),
  };
}
