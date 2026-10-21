import { describe, expect, it } from "vitest";
import { deleteNode } from "../lib/graph/deleteNode";
import type { PersonaGraph, PersonaNode } from "../lib/graph/types";

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

// Re-parenting rather than cascading. Weave has no undo, no history and no
// trash, so a cascade would destroy a subtree behind one confirm. These
// cases pin the "rises exactly one level" rule.
describe("deleteNode re-parents children", () => {
  function node(id: string, parentId?: string): PersonaNode {
    return {
      id,
      title: id,
      domain: "",
      body: "",
      position: { x: 0, y: 0 },
      ...(parentId ? { parentId } : {}),
    };
  }

  it("leaves a deleted top-level node's children at top level", () => {
    const g: PersonaGraph = { nodes: [node("a"), node("b", "a")], edges: [] };
    const after = deleteNode(g, "a");
    const b = after.nodes.find((n) => n.id === "b");
    expect(b?.parentId).toBeUndefined();
    // Key removed, not set to undefined: one spelling of "top level".
    expect(Object.prototype.hasOwnProperty.call(b as object, "parentId")).toBe(false);
  });

  it("moves a mid-level node's children up to the grandparent, leaving grandchildren alone", () => {
    // a > b > c > d. Deleting b should put c under a and leave d under c.
    const g: PersonaGraph = {
      nodes: [node("a"), node("b", "a"), node("c", "b"), node("d", "c")],
      edges: [],
    };
    const after = deleteNode(g, "b");
    expect(after.nodes.find((n) => n.id === "c")?.parentId).toBe("a");
    expect(after.nodes.find((n) => n.id === "d")?.parentId).toBe("c");
  });

  it("re-parents and removes edges in the same call", () => {
    const g: PersonaGraph = {
      nodes: [node("a"), node("b", "a"), node("c")],
      edges: [
        { fromId: "b", toId: "c" },
        { fromId: "a", toId: "c" },
      ],
    };
    const after = deleteNode(g, "b");
    expect(after.nodes.find((n) => n.id === "c")?.parentId).toBeUndefined();
    // b's own edge is gone; it is NOT re-pointed to b's parent, which
    // would invent a relationship the user never drew.
    expect(after.edges).toEqual([{ fromId: "a", toId: "c" }]);
  });

  it("leaves unrelated nodes' parents untouched", () => {
    const g: PersonaGraph = {
      nodes: [node("a"), node("b", "a"), node("x"), node("y", "x")],
      edges: [],
    };
    const after = deleteNode(g, "b");
    expect(after.nodes.find((n) => n.id === "y")?.parentId).toBe("x");
  });
});
