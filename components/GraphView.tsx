"use client";

// Graph canvas: renders the shared graph as an @xyflow/react flow, persists
// manual layout (drag-stop + the library's own built-in arrow-key nudge both
// land in the same onNodesChange "dragging: false" signal, debounced per
// node id before it reaches IndexedDB — see onNodesChange below), and wires
// native drag-from-handle connect/disconnect to linkNodes/unlinkNodes
// (tasks/plan.md Open Question 3's resolution — no separate "Link" button).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  MarkerType,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeChange,
  type EdgeProps,
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

type PersonaEdgeData = { highlighted: boolean };
type PersonaFlowEdge = Edge<PersonaEdgeData, "persona">;

// Links carry real meaning here — export pulls in every node one hop from
// the selection — so removing one has to be as discoverable as making one.
//
// Before this, deletion worked only by clicking the 1.5px line and pressing
// Delete, with nothing on screen saying so, and a selected edge looked
// identical to an edge merely touching a selected node (DESIGN.md colours
// both `--accent`). Users linked things by accident and concluded it was
// permanent. The fix is an explicit control, not a documented keystroke:
// hovering or selecting a link reveals a small x at its midpoint.
function PersonaEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  source,
  target,
}: EdgeProps<PersonaFlowEdge>) {
  const { unlinkNodes } = useGraph();
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const active = Boolean(hovered || selected);
  // DESIGN.md's rule stands: an edge touching a selected node goes accent.
  // What is new is that the edge's OWN state is now legible too — width,
  // not just colour, so "I have hold of this link" is distinguishable from
  // "this link happens to touch what I picked".
  const stroke = active || data?.highlighted ? "var(--accent)" : "var(--line)";

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke, strokeWidth: active ? 2.5 : 1.5 }} />
      {/* Invisible, generously wide hit area: a 1.5px line is near
          impossible to hover deliberately. */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={20}
        stroke="transparent"
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label="Remove this link"
          title="Remove this link"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            unlinkNodes(source, target);
          }}
          className="nodrag nopan flex h-5 w-5 items-center justify-center rounded-full border text-[12px] leading-none transition-opacity"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            opacity: active ? 1 : 0,
            borderColor: "var(--line)",
            backgroundColor: "var(--surface-raised, var(--surface))",
            color: "var(--ink-muted)",
          }}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}


// Containment, drawn from `parentId` at render time and NEVER stored in
// graph.edges. Keeping it out of the edge list is what stops it being
// deletable, exportable as a link, or counted as a one-hop neighbour.
//
// react-flow's native container nesting was rejected for this (see
// plan.md): it makes child positions RELATIVE to the parent, so the
// meaning of the one field already persisted would change the moment a
// node gained a parent — a data change disguised as a rendering choice —
// and a container surface could cover the link remove control's hit area.
//
// Distinguished from a link by geometry, not colour: dashed, with an
// arrowhead at the child end. It never turns --accent, because structure
// must not look like a link at the exact moment someone is inspecting one.
function ContainmentEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{ stroke: "var(--line)", strokeWidth: 1.5, strokeDasharray: "4 4" }}
    />
  );
}

// Prefix on derived edge ids. onEdgesChange calls unlinkNodes on ANY
// removal, so without something to recognise these by, a stray removal
// would fire an unlink for a link that does not exist.
const CONTAINMENT_PREFIX = "contains:";

const edgeTypes = {
  persona: PersonaEdgeComponent,
  containment: ContainmentEdgeComponent,
};

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
          type: "persona",
          source: e.fromId,
          target: e.toId,
          selected: prevById.get(id)?.selected ?? false,
          data: { highlighted: false },
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
          // Containment edges are derived, so there is no link to unlink.
          // They are already selectable:false and deletable:false; this is
          // the belt to that braces, because the cost of being wrong is an
          // unlink firing for an edge that was never in graph.edges.
          if (change.id.startsWith(CONTAINMENT_PREFIX)) continue;
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
  // Derived fresh from the graph every render. Not held in `edges` state,
  // so nothing can select, delete or persist one.
  const containmentEdges = useMemo<Edge[]>(
    () =>
      graph.nodes
        .filter((n) => n.parentId)
        .map((n) => ({
          id: `${CONTAINMENT_PREFIX}${n.parentId}->${n.id}`,
          type: "containment",
          source: n.parentId as string,
          target: n.id,
          selectable: false,
          deletable: false,
          focusable: false,
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--line)", width: 14, height: 14 },
        })),
    [graph.nodes]
  );

  const displayEdges = useMemo(
    () => [
      ...containmentEdges,
      ...edges.map((e) => ({
        ...e,
        data: {
          highlighted: selectedNodeIds.has(e.source) || selectedNodeIds.has(e.target),
        },
      })),
    ],
    [containmentEdges, edges, selectedNodeIds]
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
