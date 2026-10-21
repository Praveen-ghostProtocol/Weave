import type { PersonaGraph, PersonaNode } from "./types";
import { getAncestorIds } from "./parent";

// Directly-linked nodes (one hop), either direction (edges are undirected).
export function getNeighbors(graph: PersonaGraph, nodeId: string): PersonaNode[] {
  const neighborIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.fromId === nodeId) neighborIds.add(edge.toId);
    else if (edge.toId === nodeId) neighborIds.add(edge.fromId);
  }
  return graph.nodes.filter((n) => neighborIds.has(n.id));
}

function renderNode(graph: PersonaGraph, node: PersonaNode): string {
  // Flat headings even for nested nodes: the export is pasted into a chat
  // box, where a deep heading tree reads worse than a one-line path. The
  // path line is what carries the containment.
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const path = getAncestorIds(graph, node.id)
    .map((id) => byId.get(id)?.title)
    .filter((t): t is string => Boolean(t))
    .reverse()
    .join(" / ");

  const meta = path ? `*Domain: ${node.domain}*\n*Under: ${path}*` : `*Domain: ${node.domain}*`;
  return `## ${node.title}\n${meta}\n\n${node.body}`;
}

export interface ExportResult {
  markdown: string;
  estimate: number; // rough token estimate, ~4 chars/token
}

/**
 * Selected nodes, their ancestors, and their one-hop neighbours, deduped,
 * as a markdown block. Empty selection returns null (the UI disables
 * export separately).
 *
 * Ancestors in, descendants out, and neither counts toward the one-hop
 * expansion, which stays link-only. The asymmetry is the decision: a
 * child's body is often illegible without its parent ("Sprint rituals"
 * means nothing without "Acme"), while a parent's body is self-contained
 * without its children. A selected child therefore pulls its whole chain
 * to the root, because a half-chain is exactly the dangling reference the
 * rule exists to prevent.
 *
 * Descendants are NOT added here even though selecting a parent should
 * get them — that happens by ticking them in the panel's checkbox list, so
 * what is exported is always what the list shows, and unticking one child
 * actually works. Doing it in this function would make that untick
 * silently ineffective.
 *
 * No neighbours-of-ancestors and no ancestors-of-neighbours. Hierarchy
 * makes the graph far more connected (a root is an ancestor of its whole
 * subtree), so any transitive rule here swallows the entire graph.
 */
export function exportContext(graph: PersonaGraph, selectedIds: string[]): ExportResult | null {
  if (selectedIds.length === 0) return null;

  const includedIds = new Set<string>();
  const orderedNodes: PersonaNode[] = [];
  const addNode = (id: string) => {
    if (includedIds.has(id)) return;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    includedIds.add(id);
    orderedNodes.push(node);
  };

  // Ancestors first, so a parent is already on the page by the time the
  // child that pulled it in appears.
  for (const id of selectedIds) {
    for (const ancestorId of getAncestorIds(graph, id).reverse()) addNode(ancestorId);
    addNode(id);
  }
  for (const id of selectedIds) {
    for (const neighbor of getNeighbors(graph, id)) addNode(neighbor.id);
  }

  const markdown = orderedNodes.map((n) => renderNode(graph, n)).join("\n\n---\n\n");
  return { markdown, estimate: Math.ceil(markdown.length / 4) };
}
