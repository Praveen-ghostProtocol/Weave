import type { PersonaGraph } from "./types";

export function linkNodes(graph: PersonaGraph, fromId: string, toId: string): PersonaGraph {
  if (fromId === toId) throw new Error("cannot link a node to itself");
  const exists = graph.edges.some(
    (e) => (e.fromId === fromId && e.toId === toId) || (e.fromId === toId && e.toId === fromId)
  );
  if (exists) return graph; // edges are undirected and deduped
  return { ...graph, edges: [...graph.edges, { fromId, toId }] };
}
