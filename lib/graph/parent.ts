import type { PersonaGraph } from "./types";

// Containment: the tree side of the graph, kept separate from `edges`
// because "Acme contains Sprint rituals" and "Sprint rituals relates to
// Gym" are different claims. See PersonaNode.parentId.
//
// EVERY walk in this file carries a `visited` set, and that is not
// defensive habit. A cycle would be written into the single JSON blob in
// IndexedDB, so it survives reload; an unguarded walk would then spin the
// main thread on every render and the user's graph becomes permanently
// unopenable with no UI left to repair it. setParent is the gate that stops
// a cycle being created, and the visited sets are what stop one already in
// storage from being fatal.

/**
 * Ancestors of `nodeId`, nearest first, ending at the root.
 *
 * Does triple duty: the cycle check in setParent, the export rule's
 * "ancestors in, descendants out", and the editor's path label. Stops at a
 * dangling parent id rather than throwing — a stored graph can always be
 * stale, and a lookup is the wrong place to fail on that.
 */
export function getAncestorIds(graph: PersonaGraph, nodeId: string): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ancestors: string[] = [];
  const visited = new Set<string>([nodeId]);

  let current = byId.get(nodeId)?.parentId;
  while (current && !visited.has(current)) {
    if (!byId.has(current)) break; // dangling parent id: stop, don't throw
    visited.add(current);
    ancestors.push(current);
    current = byId.get(current)?.parentId;
  }
  return ancestors;
}

/** Every node beneath `nodeId`, transitively. Excludes the node itself. */
export function getDescendants(graph: PersonaGraph, nodeId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    const siblings = childrenOf.get(n.parentId);
    if (siblings) siblings.push(n.id);
    else childrenOf.set(n.parentId, [n.id]);
  }

  const out: string[] = [];
  const visited = new Set<string>([nodeId]);
  const queue = [...(childrenOf.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    out.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

/**
 * Moves `nodeId` under `parentId`, or to the top level when `parentId` is
 * undefined.
 *
 * Throws on a self-parent or a cycle, following linkNodes' precedent that a
 * self-link is an error rather than a silent no-op: both are a caller bug,
 * not a user action worth absorbing. No-ops on an unknown node or parent
 * id, following deleteNode's precedent that a stale id from the UI should
 * not need guarding against at every call site.
 */
export function setParent(
  graph: PersonaGraph,
  nodeId: string,
  parentId: string | undefined
): PersonaGraph {
  if (parentId === nodeId) throw new Error("cannot make a node its own parent");

  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return graph;
  if (parentId !== undefined && !graph.nodes.some((n) => n.id === parentId)) return graph;

  // Already there. Covers both "same parent" and "already top level", so a
  // repeated call never churns the object and never triggers a save.
  if ((node.parentId ?? undefined) === parentId) return graph;

  // The cycle check: you cannot adopt one of your own descendants. Asked as
  // "is nodeId already an ancestor of the proposed parent?" so it reuses
  // the same walk the export rule uses.
  if (parentId !== undefined && getAncestorIds(graph, parentId).includes(nodeId)) {
    throw new Error("cannot move a node under its own descendant");
  }

  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      if (parentId === undefined) {
        // Delete the key rather than setting undefined, so "top level" has
        // one spelling on the way into IndexedDB too.
        const rest = { ...n };
        delete rest.parentId;
        return rest;
      }
      return { ...n, parentId };
    }),
  };
}
