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

// Ancestors in, descendants out. The asymmetry is the decision, not an
// oversight: a child's body is often illegible without its parent, while a
// parent's is self-contained without its children.
describe("exportContext and the hierarchy", () => {
  function n(id: string, parentId?: string) {
    return {
      id,
      title: id.toUpperCase(),
      domain: "life",
      body: `body of ${id}`,
      position: { x: 0, y: 0 },
      ...(parentId ? { parentId } : {}),
    };
  }

  // acme > sprint > standup, plus an unrelated gym linked to sprint.
  const g: PersonaGraph = {
    nodes: [n("acme"), n("sprint", "acme"), n("standup", "sprint"), n("gym")],
    edges: [{ fromId: "sprint", toId: "gym" }],
  };

  it("pulls the whole ancestor chain for a selected child", () => {
    // A half-chain is exactly the dangling reference the rule prevents.
    const md = exportContext(g, ["standup"])!.markdown;
    expect(md).toContain("body of standup");
    expect(md).toContain("body of sprint");
    expect(md).toContain("body of acme");
  });

  it("does NOT pull descendants for a selected parent", () => {
    // Selecting Acme must not silently export its whole subtree — the
    // panel ticks the children instead, so the list stays truthful.
    const md = exportContext(g, ["acme"])!.markdown;
    expect(md).toContain("body of acme");
    expect(md).not.toContain("body of sprint");
    expect(md).not.toContain("body of standup");
  });

  it("orders an ancestor before the node that pulled it in", () => {
    const md = exportContext(g, ["standup"])!.markdown;
    expect(md.indexOf("body of acme")).toBeLessThan(md.indexOf("body of sprint"));
    expect(md.indexOf("body of sprint")).toBeLessThan(md.indexOf("body of standup"));
  });

  it("does not expand through ancestors or neighbours transitively", () => {
    // gym is a neighbour of sprint, but selecting standup must not reach
    // it via standup -> sprint(ancestor) -> gym(neighbour). Hierarchy
    // makes the graph dense enough that any transitive rule swallows it.
    expect(exportContext(g, ["standup"])!.markdown).not.toContain("body of gym");
  });

  it("still expands one hop from the selection itself", () => {
    expect(exportContext(g, ["sprint"])!.markdown).toContain("body of gym");
  });

  it("labels a nested node with its path, root first", () => {
    expect(exportContext(g, ["standup"])!.markdown).toContain("*Under: ACME / SPRINT*");
  });

  it("gives a top-level node no path line of its own", () => {
    // Scoped to gym's own section on purpose: selecting gym also pulls in
    // its neighbour sprint, which IS nested, so the document as a whole
    // legitimately contains a path line.
    const gymSection = exportContext(g, ["gym"])!
      .markdown.split("---")
      .find((section) => section.includes("body of gym"))!;
    expect(gymSection).not.toContain("*Under:");
  });
});
