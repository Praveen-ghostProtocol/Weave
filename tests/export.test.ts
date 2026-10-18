import { describe, expect, it } from "vitest";
import { exportContext, getNeighbors } from "../lib/graph/export";
import type { PersonaGraph } from "../lib/graph/types";

const node = (id: string, title: string) => ({
  id,
  title,
  domain: "work",
  body: `Body of ${title}`,
  position: { x: 0, y: 0 },
});

describe("getNeighbors", () => {
  it("returns directly-linked nodes in either direction", () => {
    const graph: PersonaGraph = {
      nodes: [node("a", "A"), node("b", "B"), node("c", "C")],
      edges: [{ fromId: "a", toId: "b" }, { fromId: "c", toId: "a" }],
    };
    const neighbors = getNeighbors(graph, "a").map((n) => n.id).sort();
    expect(neighbors).toEqual(["b", "c"]);
  });
});

describe("exportContext", () => {
  it("includes the full content of a single selected node and its neighbor", () => {
    const graph: PersonaGraph = {
      nodes: [node("a", "A"), node("b", "B")],
      edges: [{ fromId: "a", toId: "b" }],
    };
    const result = exportContext(graph, ["a"]);
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("Body of A");
    expect(result!.markdown).toContain("Body of B");
  });

  it("includes a shared neighbor only once when two selections share it", () => {
    const graph: PersonaGraph = {
      nodes: [node("a", "A"), node("b", "B"), node("shared", "Shared")],
      edges: [
        { fromId: "a", toId: "shared" },
        { fromId: "b", toId: "shared" },
      ],
    };
    const result = exportContext(graph, ["a", "b"]);
    expect(result).not.toBeNull();
    const occurrences = result!.markdown.split("Body of Shared").length - 1;
    expect(occurrences).toBe(1);
  });

  it("includes a node only once when its id is passed twice in selectedIds", () => {
    const graph: PersonaGraph = {
      nodes: [node("a", "A")],
      edges: [],
    };
    const result = exportContext(graph, ["a", "a"]);
    expect(result).not.toBeNull();
    const occurrences = result!.markdown.split("Body of A").length - 1;
    expect(occurrences).toBe(1);
  });

  it("returns a non-zero estimate for a non-empty export", () => {
    const graph: PersonaGraph = {
      nodes: [node("a", "A")],
      edges: [],
    };
    const result = exportContext(graph, ["a"]);
    expect(result).not.toBeNull();
    expect(result!.estimate).toBeGreaterThan(0);
  });

  it("returns null for an empty selection instead of throwing", () => {
    const graph: PersonaGraph = { nodes: [], edges: [] };
    expect(exportContext(graph, [])).toBeNull();
  });
});
