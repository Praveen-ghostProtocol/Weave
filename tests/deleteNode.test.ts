import { describe, expect, it } from "vitest";
import { deleteNode } from "../lib/graph/deleteNode";
import type { PersonaGraph } from "../lib/graph/types";

function makeGraph(): PersonaGraph {
  return {
    nodes: [
      { id: "a", title: "A", domain: "work", body: "", position: { x: 0, y: 0 } },
      { id: "b", title: "B", domain: "work", body: "", position: { x: 0, y: 0 } },
      { id: "c", title: "C", domain: "work", body: "", position: { x: 0, y: 0 } },
    ],
    edges: [
      { fromId: "a", toId: "b" },
      { fromId: "c", toId: "a" },
    ],
  };
}

describe("deleteNode", () => {
  it("removes the node and every edge referencing it from either side", () => {
    const result = deleteNode(makeGraph(), "a");

    expect(result.nodes.find((n) => n.id === "a")).toBeUndefined();
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);
    expect(result.edges.some((e) => e.fromId === "a" || e.toId === "a")).toBe(false);
  });

  it("is a no-op when deleting a non-existent id", () => {
    const graph = makeGraph();
    const result = deleteNode(graph, "does-not-exist");

    expect(result.nodes).toHaveLength(graph.nodes.length);
    expect(result.edges).toHaveLength(graph.edges.length);
  });
});
