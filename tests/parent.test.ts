import { describe, expect, it } from "vitest";
import { getAncestorIds, getDescendants, setParent } from "../lib/graph/parent";
import type { PersonaGraph, PersonaNode } from "../lib/graph/types";

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

/** a > b > c, plus an unrelated top-level d. */
function tree(): PersonaGraph {
  return {
    nodes: [node("a"), node("b", "a"), node("c", "b"), node("d")],
    edges: [],
  };
}

describe("setParent", () => {
  it("moves a top-level node under a parent", () => {
    const g = setParent(tree(), "d", "a");
    expect(g.nodes.find((n) => n.id === "d")?.parentId).toBe("a");
  });

  it("clears a parent with undefined, removing the key rather than nulling it", () => {
    // One spelling of "top level", all the way into the stored JSON blob.
    const g = setParent(tree(), "b", undefined);
    const b = g.nodes.find((n) => n.id === "b");
    expect(b?.parentId).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(b as object, "parentId")).toBe(false);
  });

  it("throws on making a node its own parent", () => {
    expect(() => setParent(tree(), "a", "a")).toThrow(/own parent/);
  });

  it("throws on a direct cycle", () => {
    expect(() => setParent(tree(), "a", "b")).toThrow(/own descendant/);
  });

  it("throws on an indirect cycle, two levels down", () => {
    // a > b > c, so putting a under c would close the loop.
    expect(() => setParent(tree(), "a", "c")).toThrow(/own descendant/);
  });

  it("no-ops on an unknown node or an unknown parent", () => {
    const g = tree();
    expect(setParent(g, "nope", "a")).toBe(g);
    expect(setParent(g, "d", "nope")).toBe(g);
  });

  it("no-ops when the parent is already what was asked for", () => {
    // Returning the same reference is what stops a repeated call churning
    // the object and triggering a pointless IndexedDB write.
    const g = tree();
    expect(setParent(g, "b", "a")).toBe(g);
    expect(setParent(g, "d", undefined)).toBe(g);
  });

  it("leaves edges untouched", () => {
    const g: PersonaGraph = { ...tree(), edges: [{ fromId: "a", toId: "d" }] };
    expect(setParent(g, "d", "a").edges).toEqual([{ fromId: "a", toId: "d" }]);
  });
});

describe("getAncestorIds", () => {
  it("returns nearest first, root last", () => {
    expect(getAncestorIds(tree(), "c")).toEqual(["b", "a"]);
  });

  it("is empty for a top-level node", () => {
    expect(getAncestorIds(tree(), "a")).toEqual([]);
    expect(getAncestorIds(tree(), "nope")).toEqual([]);
  });

  it("stops at a dangling parent id instead of throwing", () => {
    // A stored graph can always be stale; a lookup is the wrong place to
    // fail on that.
    const g: PersonaGraph = { nodes: [node("x", "ghost")], edges: [] };
    expect(getAncestorIds(g, "x")).toEqual([]);
  });
});

describe("getDescendants", () => {
  it("includes grandchildren and excludes the node itself", () => {
    expect(getDescendants(tree(), "a").sort()).toEqual(["b", "c"]);
  });

  it("is empty for a leaf", () => {
    expect(getDescendants(tree(), "c")).toEqual([]);
  });
});

// The reason both walks carry a visited set. A cycle cannot be created
// through setParent, but one could already sit in a stored blob from a
// hand-edit or a future bug — and that blob survives reload, so an
// unguarded walk would spin the main thread on every render and leave the
// graph permanently unopenable with no UI left to repair it.
describe("an already-cyclic stored graph", () => {
  const cyclic: PersonaGraph = {
    nodes: [node("a", "b"), node("b", "a")],
    edges: [],
  };

  it("terminates in getAncestorIds instead of hanging", () => {
    expect(getAncestorIds(cyclic, "a")).toEqual(["b"]);
  });

  it("terminates in getDescendants instead of hanging", () => {
    expect(getDescendants(cyclic, "a")).toEqual(["b"]);
  });

  it("terminates in a three-node cycle too", () => {
    const three: PersonaGraph = {
      nodes: [node("a", "c"), node("b", "a"), node("c", "b")],
      edges: [],
    };
    expect(getAncestorIds(three, "a")).toEqual(["c", "b"]);
    expect(getDescendants(three, "a").sort()).toEqual(["b", "c"]);
  });
});
