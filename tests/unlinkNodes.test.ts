import { describe, expect, it } from "vitest";
import { unlinkNodes } from "../lib/graph/unlinkNodes";
import type { PersonaGraph } from "../lib/graph/types";

function makeGraph(): PersonaGraph {
  return {
    nodes: [
      { id: "a", title: "A", domain: "work", body: "", position: { x: 0, y: 0 } },
      { id: "b", title: "B", domain: "work", body: "", position: { x: 0, y: 0 } },
    ],
    edges: [{ fromId: "a", toId: "b" }],
  };
}

describe("unlinkNodes", () => {
  it("removes the edge regardless of stored direction", () => {
    const result = unlinkNodes(makeGraph(), "b", "a");
    expect(result.edges).toEqual([]);
  });

  it("leaves unrelated edges untouched in a multi-edge graph", () => {
    const graph: PersonaGraph = {
      nodes: [
        { id: "a", title: "A", domain: "work", body: "", position: { x: 0, y: 0 } },
        { id: "b", title: "B", domain: "work", body: "", position: { x: 0, y: 0 } },
        { id: "c", title: "C", domain: "work", body: "", position: { x: 0, y: 0 } },
      ],
      edges: [
        { fromId: "a", toId: "b" },
        { fromId: "b", toId: "c" },
      ],
    };
    const result = unlinkNodes(graph, "a", "b");
    expect(result.edges).toEqual([{ fromId: "b", toId: "c" }]);
  });
});
