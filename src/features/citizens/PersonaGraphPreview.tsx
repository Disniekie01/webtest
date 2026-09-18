import { useMemo } from "react";
import { buildPersonaGraph, nodeColor, type GraphNode } from "../comfort/graphTypes";
import "./PersonaGraphPreview.css";

const NW = 132;
const NH = 52;

function portOut(n: GraphNode) {
  return { x: n.x + NW, y: n.y + NH / 2 };
}
function portIn(n: GraphNode) {
  return { x: n.x, y: n.y + NH / 2 };
}

function bezier(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = Math.max(36, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** Read-only Blueprint preview of one persona's agent graph. */
export function PersonaGraphPreview({ citizenId }: { citizenId: string }) {
  const graph = useMemo(() => buildPersonaGraph(citizenId), [citizenId]);
  if (!graph) return null;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const maxX = Math.max(...graph.nodes.map((n) => n.x + NW)) + 24;
  const maxY = Math.max(...graph.nodes.map((n) => n.y + NH)) + 24;

  return (
    <div className="persona-graph" aria-label="Personality agent graph">
      <div className="persona-graph__frame" style={{ minHeight: Math.min(360, maxY * 0.72) }}>
        <svg
          className="persona-graph__svg"
          viewBox={`0 0 ${maxX} ${maxY}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="pgGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(126,200,192,0.07)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={maxX} height={maxY} fill="url(#pgGrid)" />
          {graph.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            return (
              <path
                key={e.id}
                d={bezier(portOut(a), portIn(b))}
                fill="none"
                stroke={nodeColor(a.kind)}
                strokeWidth="2"
                opacity="0.7"
              />
            );
          })}
          {graph.nodes.map((n) => {
            const color = nodeColor(n.kind);
            return (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                <rect
                  width={NW}
                  height={NH}
                  rx="8"
                  fill="rgba(10,16,20,0.94)"
                  stroke={color}
                  strokeWidth="1.4"
                />
                <rect width={NW} height="16" rx="8" fill={`${color}33`} />
                <text x="8" y="11" fill={color} fontSize="7.5" fontFamily="JetBrains Mono, monospace">
                  {n.kind.toUpperCase()}
                  {n.score != null ? `  ${n.score.toFixed(2)}` : ""}
                </text>
                <text
                  x="8"
                  y="34"
                  fill="#eef4f2"
                  fontSize="10"
                  fontFamily="Outfit, system-ui, sans-serif"
                >
                  {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
                </text>
                <circle cx="0" cy={NH / 2} r="4" fill="#5a6a70" stroke="#0a1014" strokeWidth="1" />
                <circle cx={NW} cy={NH / 2} r="4" fill={color} stroke="#0a1014" strokeWidth="1" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
