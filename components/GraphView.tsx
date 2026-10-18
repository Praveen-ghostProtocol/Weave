"use client";

// Graph canvas: renders the shared graph as an @xyflow/react flow, persists
// manual layout (drag-stop + the library's own built-in arrow-key nudge both
// land in the same onNodesChange "dragging: false" signal, debounced per
// node id before it reaches IndexedDB — see onNodesChange below), and wires
// native drag-from-handle connect/disconnect to linkNodes/unlinkNodes
// (tasks/plan.md Open Question 3's resolution — no separate "Link" button).
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useGraph } from "@/lib/storage/useGraph";

type PersonaNodeData = { title: string; domain: string };
type FlowNode = Node<PersonaNodeData, "persona">;

// DESIGN.md §4: flat card, 8px radius, 1px border, 2px accent on
// hover/selected, no shadow. --surface-raised isn't in globals.css yet
// (only the editor/export panels need it so far) so this falls back to
// --surface rather than touching that file out of scope.
function PersonaNodeComponent({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div
      className={`motion-safe:transition-colors rounded-[8px] border px-3 py-2 min-w-[140px] max-w-[220px] ${
        selected ? "border-2 border-[var(--accent)]" : "border border-[var(--line)] hover:border-[var(--accent)]"
      }`}
      style={{ backgroundColor: "var(--surface-raised, var(--surface))" }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ width: 8, height: 8, background: "var(--accent)", border: "none" }}
      />
      <p className="truncate text-[14px] font-semibold leading-snug text-[var(--ink)]">
        {data.title}
      </p>
      {data.domain && (
        <span className="mt-1 inline-block rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[12px] font-medium tracking-wide text-[var(--ink-muted)]">
          {data.domain}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ width: 8, height: 8, background: "var(--accent)", border: "none" }}
      />
    </div>
  );
}

const nodeTypes = { persona: PersonaNodeComponent };

interface GraphViewProps {
  onNodeClick: (nodeId: string) => void;
}

export default function GraphView({ onNodeClick }: GraphViewProps) {
  const { graph, updateNode, linkNodes, unlinkNodes } = useGraph();

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([]);

  // Resync from the shared graph (source of truth) whenever it changes,
  // preserving each node/edge's live selection state rather than clobbering
  // it. Position comes from the graph, not from react-flow's own state.
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n): FlowNode => ({
        id: n.id,
        type: "persona",
        position: n.position,
        selected: prevById.get(n.id)?.selected ?? false,
        deletable: false, // node deletion is NodeEditor's cascade-delete, not this view's
        data: { title: n.title, domain: n.domain },
      }));
    });
  }, [graph.nodes, setNodes]);

  useEffect(() => {
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]));
      return graph.edges.map((e): Edge => {
        const id = `${e.fromId}->${e.toId}`;
        return {
          id,
          source: e.fromId,
          target: e.toId,
          selected: prevById.get(id)?.selected ?? false,
        };
      });
    });
  }, [graph.edges, setEdges]);

  // Drag-stop emits exactly one position change with dragging:false, so
  // filtering on that flag is enough debouncing for mouse drag. Arrow-key
  // nudge (@xyflow/react's own built-in a11y feature, nothing custom
  // needed for the movement itself) ALSO emits dragging:false, but once
  // per keydown — holding a key (OS auto-repeat, ~20-30/sec) would hit
  // IndexedDB that often with no coalescing. pendingWritesRef debounces
  // the actual persist call per node id; react-flow's own local state
  // (setNodes above) already reflects every tick immediately, so this
  // only delays the IndexedDB write, not what the user sees.
  const pendingWritesRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = pendingWritesRef.current;
    return () => {
      for (const timeout of pending.values()) clearTimeout(timeout);
    };
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      onNodesChangeBase(changes);
      for (const change of changes) {
        if (change.type === "position" && change.position && change.dragging === false) {
          const { id, position } = change;
          const pending = pendingWritesRef.current;
          const existingTimeout = pending.get(id);
          if (existingTimeout) clearTimeout(existingTimeout);
          pending.set(
            id,
            setTimeout(() => {
              pending.delete(id);
              updateNode(id, { position });
            }, 250)
          );
        }
      }
    },
    [onNodesChangeBase, updateNode]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChangeBase(changes);
      for (const change of changes) {
        if (change.type === "remove") {
          const edge = edges.find((e) => e.id === change.id);
          if (edge) unlinkNodes(edge.source, edge.target);
        }
      }
    },
    [onEdgesChangeBase, edges, unlinkNodes]
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      linkNodes(connection.source, connection.target);
    },
    [linkNodes]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => onNodeClick(node.id),
    [onNodeClick]
  );

  // DESIGN.md §4: edges turn --accent when either endpoint is selected
  // (not only when the edge itself is selected).
  const selectedNodeIds = useMemo(
    () => new Set(nodes.filter((n) => n.selected).map((n) => n.id)),
    [nodes]
  );
  const displayEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        style: {
          stroke:
            e.selected || selectedNodeIds.has(e.source) || selectedNodeIds.has(e.target)
              ? "var(--accent)"
              : "var(--line)",
          strokeWidth: 1.5,
        },
      })),
    [edges, selectedNodeIds]
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        className="!bg-transparent"
      />
    </div>
  );
}
