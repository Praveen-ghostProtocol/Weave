"use client";

// Shared client-side graph state container (plan.md: "One shared
// client-side graph state container ... the single source of truth the
// node editor, graph view, and export panel all read/write"). Loads from
// Dexie on mount, persists every change back to IndexedDB. Graph mutation
// logic itself stays in the pure lib/graph functions — this hook only wires
// them to state + storage.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PersonaGraph, PersonaNode } from "@/lib/graph/types";
import { linkNodes } from "@/lib/graph/linkNodes";
import { unlinkNodes } from "@/lib/graph/unlinkNodes";
import { deleteNode as deleteNodeFromGraph } from "@/lib/graph/deleteNode";
import { loadGraph, saveGraph } from "./db";

const EMPTY_GRAPH: PersonaGraph = { nodes: [], edges: [] };

interface GraphContextValue {
  graph: PersonaGraph;
  loading: boolean;
  addNode: (node: Omit<PersonaNode, "id">) => void;
  updateNode: (id: string, patch: Partial<Omit<PersonaNode, "id">>) => void;
  deleteNode: (id: string) => void;
  linkNodes: (fromId: string, toId: string) => void;
  unlinkNodes: (fromId: string, toId: string) => void;
}

const GraphContext = createContext<GraphContextValue | null>(null);

export function GraphProvider({ children }: { children: ReactNode }) {
  const [graph, setGraph] = useState<PersonaGraph>(EMPTY_GRAPH);
  const [loading, setLoading] = useState(true);
  // True once any mutation has happened, so a slow initial Dexie read
  // can't resolve later and stomp newer in-memory/already-saved state.
  const hasMutatedRef = useRef(false);

  // Guarded by typeof window (plan.md's #1 risk: IndexedDB during
  // Next.js SSR/build). This effect only ever runs client-side anyway,
  // but the check keeps the intent explicit and makes the file safe to
  // read in isolation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    loadGraph().then((loaded) => {
      if (cancelled) return;
      if (!hasMutatedRef.current) setGraph(loaded);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Derives `next` from the latest state via the setGraph updater form,
  // not a `graph` closed over at render time — two mutations in the same
  // tick (React batches state updates) would otherwise both read the same
  // stale `graph` and the second call's write would silently discard the
  // first.
  const persist = useCallback((updater: (prev: PersonaGraph) => PersonaGraph) => {
    hasMutatedRef.current = true;
    setGraph((prev) => {
      const next = updater(prev);
      if (typeof window !== "undefined") void saveGraph(next);
      return next;
    });
  }, []);

  const value: GraphContextValue = {
    graph,
    loading,
    addNode: (node) =>
      persist((prev) => ({
        ...prev,
        nodes: [...prev.nodes, { ...node, id: crypto.randomUUID() }],
      })),
    updateNode: (id, patch) =>
      persist((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      })),
    deleteNode: (id) => persist((prev) => deleteNodeFromGraph(prev, id)),
    linkNodes: (fromId, toId) => persist((prev) => linkNodes(prev, fromId, toId)),
    unlinkNodes: (fromId, toId) => persist((prev) => unlinkNodes(prev, fromId, toId)),
  };

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

export function useGraph(): GraphContextValue {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error("useGraph must be used within a GraphProvider");
  return ctx;
}
