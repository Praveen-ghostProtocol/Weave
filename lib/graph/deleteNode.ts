import type { PersonaGraph } from "./types";

// Deleting a non-existent id is a no-op (not an error) — matches linkNodes'
// relink-is-a-no-op precedent in SPEC.md, and callers (e.g. delete buttons)
// shouldn't need to guard against stale ids.
//
// Children are RE-PARENTED, not cascaded. Weave has no undo, no history and
// no trash, so a cascade would destroy a whole subtree behind one
// window.confirm — which DESIGN.md §7 prohibits outright. Re-parenting
// loses one level of grouping: visible immediately, two clicks to restore.
//
// They inherit the deleted node's OWN parent, so the subtree rises exactly
// one level and grandchildren are untouched. A deleted top-level node's
// children become top level.
//
// The deleted node's edges are all still removed, and deliberately NOT
// re-pointed to its parent. "Work contains Project X" and "Project X
// relates to Gym" does not make "Work relates to Gym" — inventing that
// link once would carry it into every later export.
export function deleteNode(graph: PersonaGraph, nodeId: string): PersonaGraph {
  const doomed = graph.nodes.find((n) => n.id === nodeId);
  const inheritedParent = doomed?.parentId;

  return {
    nodes: graph.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => {
        if (n.parentId !== nodeId) return n;
        if (inheritedParent === undefined) {
          // Drop the key rather than setting undefined, so "top level" has
          // exactly one spelling on the way into storage.
          const promoted = { ...n };
          delete promoted.parentId;
          return promoted;
        }
        return { ...n, parentId: inheritedParent };
      }),
    edges: graph.edges.filter((e) => e.fromId !== nodeId && e.toId !== nodeId),
  };
}
