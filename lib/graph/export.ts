import type { PersonaGraph, PersonaNode } from "./types";

// Directly-linked nodes (one hop), either direction (edges are undirected).
export function getNeighbors(graph: PersonaGraph, nodeId: string): PersonaNode[] {
  const neighborIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.fromId === nodeId) neighborIds.add(edge.toId);
    else if (edge.toId === nodeId) neighborIds.add(edge.fromId);
  }
  return graph.nodes.filter((n) => neighborIds.has(n.id));
}

function renderNode(node: PersonaNode): string {
  return `## ${node.title}\n*Domain: ${node.domain}*\n\n${node.body}`;
}

export interface ExportResult {
  markdown: string;
  estimate: number; // rough token estimate, ~4 chars/token
}

// Selected nodes + their one-hop neighbors, deduped by id, as a markdown
// block. Empty selection returns null (UI disables export separately).
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

  for (const id of selectedIds) addNode(id);
  for (const id of selectedIds) {
    for (const neighbor of getNeighbors(graph, id)) addNode(neighbor.id);
  }

  const markdown = orderedNodes.map(renderNode).join("\n\n---\n\n");
  return { markdown, estimate: Math.ceil(markdown.length / 4) };
}
