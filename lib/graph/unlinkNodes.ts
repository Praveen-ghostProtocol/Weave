import type { PersonaGraph } from "./types";

export function unlinkNodes(graph: PersonaGraph, fromId: string, toId: string): PersonaGraph {
  return {
    ...graph,
    edges: graph.edges.filter(
      (e) => !((e.fromId === fromId && e.toId === toId) || (e.fromId === toId && e.toId === fromId))
    ),
  };
}
