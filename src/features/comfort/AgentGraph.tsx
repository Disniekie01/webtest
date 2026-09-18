import { useCallback, useMemo, useRef, useState, type PointerEvent as REPointerEvent } from "react";
import {
  canConnect,
  nodeColor,
  type GraphEdge,
  type GraphNode,
  type GraphNodeKind,
  type AgentGraph,
} from "./graphTypes";
import "./AgentGraph.css";

type Props = {
  graph: AgentGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (g: AgentGraph) => void;
  linkingFrom: string | null;
  onLinkFrom: (id: string | null) => void;
};

const NODE_W = 168;
const NODE_H = 64;

function portOut(n: GraphNode) {
  return { x: n.x + NODE_W, y: n.y + NODE_H / 2 };
}
function portIn(n: GraphNode) {
  return { x: n.x, y: n.y + NODE_H / 2 };
}

function bezier(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** Blueprint / ComfyUI-style storytelling graph canvas. */
export function AgentGraph({
  graph,
  selectedId,
  onSelect,
  onChange,
  linkingFrom,
  onLinkFrom,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 40, y: 20 });
  const [zoom, setZoom] = useState(0.85);
  const drag = useRef<{
    mode: "pan" | "node";
    id?: string;
    ox: number;
    oy: number;
    sx: number;
    sy: number;
  } | null>(null);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.45, Math.min(1.4, z - e.deltaY * 0.001)));
  }, []);

  const clientToWorld = (cx: number, cy: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: (cx - rect.left - pan.x) / zoom,
      y: (cy - rect.top - pan.y) / zoom,
    };
  };

  const onPointerDownBg = (e: REPointerEvent) => {
    if (e.button === 1 || e.button === 2 || e.altKey || e.buttons === 4) {
      drag.current = { mode: "pan", ox: e.clientX, oy: e.clientY, sx: pan.x, sy: pan.y };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    if ((e.target as HTMLElement).dataset.canvas === "1") {
      onSelect(null);
      onLinkFrom(null);
      drag.current = { mode: "pan", ox: e.clientX, oy: e.clientY, sx: pan.x, sy: pan.y };
    }
  };

  const onPointerMove = (e: REPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      setPan({ x: d.sx + (e.clientX - d.ox), y: d.sy + (e.clientY - d.oy) });
      return;
    }
    if (d.mode === "node" && d.id) {
      const w = clientToWorld(e.clientX, e.clientY);
      onChange({
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === d.id ? { ...n, x: w.x - NODE_W / 2, y: w.y - NODE_H / 2 } : n,
        ),
      });
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const startNodeDrag = (e: REPointerEvent, id: string) => {
    e.stopPropagation();
    onSelect(id);
    drag.current = {
      mode: "node",
      id,
      ox: e.clientX,
      oy: e.clientY,
      sx: 0,
      sy: 0,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const clickOutPort = (e: REPointerEvent, id: string) => {
    e.stopPropagation();
    onLinkFrom(id);
  };

  const clickInPort = (e: REPointerEvent, toId: string) => {
    e.stopPropagation();
    if (!linkingFrom || linkingFrom === toId) return;
    const from = byId.get(linkingFrom);
    const to = byId.get(toId);
    if (!from || !to) return;
    if (!canConnect(from.kind, to.kind)) {
      onLinkFrom(null);
      return;
    }
    const exists = graph.edges.some((ed) => ed.from === linkingFrom && ed.to === toId);
    if (exists) {
      onLinkFrom(null);
      return;
    }
    const edge: GraphEdge = {
      id: `e_${linkingFrom}_${toId}`,
      from: linkingFrom,
      to: toId,
    };
    onChange({ ...graph, edges: [...graph.edges, edge] });
    onLinkFrom(null);
  };

  const linkPreview = linkingFrom ? byId.get(linkingFrom) : null;

  return (
    <div
      ref={wrapRef}
      className="agent-graph"
      onWheel={onWheel}
      onPointerDown={onPointerDownBg}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="agent-graph__world"
        data-canvas="1"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <svg className="agent-graph__wires" width={2000} height={1400}>
          <defs>
            <pattern id="agGrid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(126,200,192,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="2000" height="1400" fill="url(#agGrid)" data-canvas="1" />
          {graph.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const p0 = portOut(a);
            const p1 = portIn(b);
            return (
              <path
                key={e.id}
                d={bezier(p0, p1)}
                className="agent-graph__wire"
                stroke={nodeColor(a.kind)}
              />
            );
          })}
          {linkPreview && (
            <path
              d={bezier(portOut(linkPreview), {
                x: portOut(linkPreview).x + 80,
                y: portOut(linkPreview).y,
              })}
              className="agent-graph__wire agent-graph__wire--preview"
              stroke={nodeColor(linkPreview.kind)}
            />
          )}
        </svg>

        {graph.nodes.map((n) => (
          <GraphCard
            key={n.id}
            node={n}
            selected={selectedId === n.id}
            linking={linkingFrom === n.id}
            onDragStart={startNodeDrag}
            onOut={clickOutPort}
            onIn={clickInPort}
          />
        ))}
      </div>
      <div className="agent-graph__hint mono">
        Drag nodes · Alt-drag pan · Wheel zoom · Click out→in port to wire
        {linkingFrom ? " · linking…" : ""}
      </div>
    </div>
  );
}

function GraphCard({
  node,
  selected,
  linking,
  onDragStart,
  onOut,
  onIn,
}: {
  node: GraphNode;
  selected: boolean;
  linking: boolean;
  onDragStart: (e: REPointerEvent, id: string) => void;
  onOut: (e: REPointerEvent, id: string) => void;
  onIn: (e: REPointerEvent, id: string) => void;
}) {
  const color = nodeColor(node.kind);
  return (
    <div
      className={`agent-node ${selected ? "on" : ""} ${linking ? "linking" : ""}`}
      style={{
        left: node.x,
        top: node.y,
        width: NODE_W,
        borderColor: color,
      }}
      onPointerDown={(e) => onDragStart(e, node.id)}
    >
      <header style={{ background: `${color}22`, color }}>
        <span className="kind">{node.kind}</span>
        {node.score != null && <span className="mono score">{node.score.toFixed(2)}</span>}
      </header>
      <div className="agent-node__body">{node.label}</div>
      <button
        type="button"
        className="agent-node__port in"
        title="Input"
        onPointerDown={(e) => onIn(e, node.id)}
      />
      <button
        type="button"
        className="agent-node__port out"
        title="Output"
        style={{ background: color }}
        onPointerDown={(e) => onOut(e, node.id)}
      />
    </div>
  );
}

export type PaletteItem = { kind: GraphNodeKind; label: string };

export const PALETTE: { group: string; items: PaletteItem[] }[] = [
  {
    group: "Agent",
    items: [
      { kind: "agent", label: "Personality agent" },
      { kind: "trait", label: "Trait" },
      { kind: "goal", label: "Goal" },
      { kind: "preference", label: "Preference" },
    ],
  },
  {
    group: "Story",
    items: [
      { kind: "issue", label: "Issue / trigger" },
      { kind: "cityEvent", label: "City event" },
      { kind: "policy", label: "Fleet policy" },
      { kind: "report", label: "Report sink" },
    ],
  },
  {
    group: "Routine",
    items: [
      { kind: "routineStart", label: "Start pin" },
      { kind: "routineStop", label: "Waypoint" },
      { kind: "routineEnd", label: "End pin" },
    ],
  },
];
