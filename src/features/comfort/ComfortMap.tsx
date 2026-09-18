import { useEffect, useMemo, useState } from "react";
import { scenarios, useAscStore } from "../../state/ascStore";
import { AgentGraph, PALETTE } from "./AgentGraph";
import {
  CITY_EVENTS,
  GOAL_LIBRARY,
  ISSUE_LIBRARY,
  JUNCTION_PINS,
  POLICY_PRESETS,
  PREF_LIBRARY,
  TRAIT_LIBRARY,
} from "./issueLibrary";
import {
  buildMockReport,
  graphToComfortDrafts,
  seedAgentGraph,
  spawnNode,
  type AgentGraph as Graph,
  type ExperienceReport,
  type GraphNode,
  type GraphNodeKind,
} from "./graphTypes";
import "./ComfortMap.css";
import "./AgentStudio.css";

/** Storytelling Agent Studio — Blueprint/ComfyUI graph (wire-up only; not live sim). */
export function ComfortMap() {
  const setMode = useAscStore((s) => s.setMode);
  const upsert = useAscStore((s) => s.upsertComfortDraft);
  const setScenario = useAscStore((s) => s.setScenario);
  const activeScenarioId = useAscStore((s) => s.activeScenarioId);

  const [graph, setGraph] = useState<Graph>(() => seedAgentGraph());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [report, setReport] = useState<ExperienceReport | null>(null);
  const [showReport, setShowReport] = useState(false);

  const selected = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.nodes, selectedId],
  );

  // Keep twin comfort heat in sync with agent nodes (storytelling → heat layer)
  useEffect(() => {
    graphToComfortDrafts(graph).forEach((d) => upsert(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on graph identity
  }, [graph.nodes, graph.edges]);

  const patchNode = (id: string, patch: Partial<GraphNode>) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
  };

  const addKind = (kind: GraphNodeKind) => {
    const node = spawnNode(kind, { x: 420 + Math.random() * 80, y: 200 + Math.random() * 120 });
    setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
    setSelectedId(node.id);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => n.id !== selectedId),
      edges: g.edges.filter((e) => e.from !== selectedId && e.to !== selectedId),
    }));
    setSelectedId(null);
  };

  const runDay = () => {
    const agentId =
      selected?.kind === "agent"
        ? selected.id
        : graph.nodes.find((n) => n.kind === "agent")?.id;
    const r = buildMockReport(graph, agentId);
    setReport(r);
    setShowReport(true);
    if (!agentId) return;
    const evId = graph.edges
      .filter((e) => e.from === agentId)
      .map((e) => graph.nodes.find((n) => n.id === e.to))
      .find((n) => n?.kind === "cityEvent")?.ref;
    if (evId) setScenario(evId);
  };

  return (
    <section className="comfort-map agent-studio" aria-label="Personality agent studio">
      <div className="comfort-map__toolbar">
        <button type="button" onClick={() => setMode("ops")}>
          Back to ops
        </button>
        <h2>Agent Studio</h2>
        <span className="agent-studio__badge mono">storytelling wire-up</span>
        <button type="button" className="primary" onClick={() => addKind("agent")}>
          + Agent
        </button>
        <button type="button" className="primary" onClick={runDay}>
          Run day
        </button>
        <button type="button" onClick={() => setShowReport(true)} disabled={!report}>
          Report
        </button>
      </div>

      <div className="agent-studio__layout">
        <aside className="agent-studio__palette">
          {PALETTE.map((g) => (
            <div key={g.group}>
              <h3>{g.group}</h3>
              <ul>
                {g.items.map((it) => (
                  <li key={it.kind + it.label}>
                    <button type="button" onClick={() => addKind(it.kind)}>
                      {it.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <AgentGraph
          graph={graph}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={setGraph}
          linkingFrom={linkingFrom}
          onLinkFrom={setLinkingFrom}
        />

        <aside className="agent-studio__inspector">
          <h3>Inspector</h3>
          {!selected && <p className="muted">Select a node to edit. Wire ports to compose a day.</p>}
          {selected && (
            <Inspector
              node={selected}
              onPatch={(p) => patchNode(selected.id, p)}
              onRemove={removeSelected}
            />
          )}

          <div className="agent-studio__scenarios">
            <h3>City events</h3>
            <div className="agent-studio__chips">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={activeScenarioId === s.id ? "on" : ""}
                  onClick={() => setScenario(s.id)}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {showReport && report && (
        <div className="agent-report" role="dialog" aria-label="Experience report">
          <div className="agent-report__panel">
            <header>
              <div>
                <h2>Experience report</h2>
                <p className="mono muted">Storytelling pass · {report.generatedAt}</p>
              </div>
              <button type="button" onClick={() => setShowReport(false)}>
                Close
              </button>
            </header>
            <p className="agent-report__blurb">{report.blurb}</p>
            <div className="agent-report__grid">
              <div>
                <h4 className="mono">Agent</h4>
                <p>{report.agentName}</p>
              </div>
              <div>
                <h4 className="mono">Comfort arc</h4>
                <p className="mono">
                  {(report.comfortStart * 100).toFixed(0)} → {(report.comfortEnd * 100).toFixed(0)}
                </p>
                <i className="agent-report__arc" aria-hidden>
                  <i
                    style={{
                      width: `${Math.round(report.comfortEnd * 100)}%`,
                    }}
                  />
                </i>
              </div>
              <div>
                <h4 className="mono">Goals</h4>
                <ul>
                  {report.goalLabels.length ? report.goalLabels.map((g) => <li key={g}>{g}</li>) : <li className="muted">—</li>}
                </ul>
              </div>
              <div>
                <h4 className="mono">Issues</h4>
                <ul>
                  {report.issueLabels.length ? report.issueLabels.map((g) => <li key={g}>{g}</li>) : <li className="muted">—</li>}
                </ul>
              </div>
              <div>
                <h4 className="mono">Route</h4>
                <ul>
                  {report.routeLabels.length ? report.routeLabels.map((g) => <li key={g}>{g}</li>) : <li className="muted">—</li>}
                </ul>
              </div>
              <div>
                <h4 className="mono">Event / policy</h4>
                <p>
                  {report.eventLabel ?? "—"} · {report.policyLabel ?? "—"}
                </p>
              </div>
            </div>
            <p className="agent-report__note muted mono">
              Wire-up only — later this can drive twin sims / LLM agents (e.g. NemoClaw).
            </p>
          </div>
          <button type="button" className="agent-report__backdrop" aria-label="Close" onClick={() => setShowReport(false)} />
        </div>
      )}
    </section>
  );
}

function Inspector({
  node,
  onPatch,
  onRemove,
}: {
  node: GraphNode;
  onPatch: (p: Partial<GraphNode>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="agent-inspector">
      <label>
        Label
        <input type="text" value={node.label} onChange={(e) => onPatch({ label: e.target.value })} />
      </label>

      {node.kind === "agent" && (
        <label>
          Comfort score
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={node.score ?? 0.5}
            onChange={(e) => onPatch({ score: Number(e.target.value) })}
          />
          <span className="mono">{(node.score ?? 0.5).toFixed(2)}</span>
        </label>
      )}

      {node.kind === "trait" && (
        <label>
          Trait
          <select
            value={node.ref}
            onChange={(e) => {
              const t = TRAIT_LIBRARY.find((x) => x.id === e.target.value);
              if (t) onPatch({ ref: t.id, label: t.label });
            }}
          >
            {TRAIT_LIBRARY.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {node.kind === "goal" && (
        <label>
          Goal
          <select
            value={node.ref}
            onChange={(e) => {
              const g = GOAL_LIBRARY.find((x) => x.id === e.target.value);
              if (g) onPatch({ ref: g.id, label: g.label });
            }}
          >
            {GOAL_LIBRARY.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {node.kind === "preference" && (
        <label>
          Preference
          <select
            value={node.label}
            onChange={(e) => onPatch({ label: e.target.value, ref: e.target.value })}
          >
            {PREF_LIBRARY.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}

      {node.kind === "issue" && (
        <label>
          Issue
          <select
            value={node.ref}
            onChange={(e) => {
              const iss = ISSUE_LIBRARY.find((x) => x.id === e.target.value);
              if (iss) onPatch({ ref: iss.id, label: iss.label });
            }}
          >
            {ISSUE_LIBRARY.map((iss) => (
              <option key={iss.id} value={iss.id}>
                {iss.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {node.kind === "cityEvent" && (
        <label>
          Event
          <select
            value={node.ref}
            onChange={(e) => {
              const ev = CITY_EVENTS.find((x) => x.id === e.target.value);
              if (ev) onPatch({ ref: ev.id, label: ev.label });
            }}
          >
            {CITY_EVENTS.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {node.kind === "policy" && (
        <label>
          Policy
          <select
            value={node.ref}
            onChange={(e) => onPatch({ ref: e.target.value, label: e.target.value })}
          >
            {POLICY_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}

      {(node.kind === "routineStart" || node.kind === "routineStop" || node.kind === "routineEnd") && (
        <label>
          Twin pin
          <select
            value={node.ref}
            onChange={(e) => {
              const pin = JUNCTION_PINS.find((p) => p.id === e.target.value);
              if (!pin) return;
              const tag =
                node.kind === "routineStart" ? "Start" : node.kind === "routineEnd" ? "End" : "Stop";
              onPatch({ ref: pin.id, label: `${tag} · ${pin.label}` });
            }}
          >
            {JUNCTION_PINS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <button type="button" className="danger" onClick={onRemove}>
        Remove node
      </button>
    </div>
  );
}
