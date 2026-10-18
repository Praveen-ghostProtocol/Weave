import { describe, expect, it } from "vitest";
import { linkNodes } from "../lib/graph/linkNodes";
import type { PersonaGraph } from "../lib/graph/types";

function makeGraph(): PersonaGraph {
  return {
    nodes: [
      { id: "a", title: "A", domain: "work", body: "", position: { x: 0, y: 0 } },
      { id: "b", title: "B", domain: "work", body: "", position: { x: 0, y: 0 } },
    ],
    edges: [],
  };
}

describe("linkNodes", () => {
  it("adds a new edge", () => {
    const result = linkNodes(makeGraph(), "a", "b");
    expect(result.edges).toEqual([{ fromId: "a", toId: "b" }]);
  });

  it("no-ops on duplicate link, same direction", () => {
    const graph: PersonaGraph = { ...makeGraph(), edges: [{ fromId: "a", toId: "b" }] };
    const result = linkNodes(graph, "a", "b");
    expect(result.edges).toEqual([{ fromId: "a", toId: "b" }]);
  });

  it("no-ops on duplicate link, reverse direction", () => {
    const graph: PersonaGraph = { ...makeGraph(), edges: [{ fromId: "a", toId: "b" }] };
    const result = linkNodes(graph, "b", "a");
    expect(result.edges).toEqual([{ fromId: "a", toId: "b" }]);
  });

  it("throws on self-link", () => {
    expect(() => linkNodes(makeGraph(), "a", "a")).toThrow();
  });
});
