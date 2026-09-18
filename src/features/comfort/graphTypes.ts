import type { ComfortDraft } from "../../data/ascTypes";
import { citizens } from "../../state/ascStore";
import {
  CITY_EVENTS,
  GOAL_LIBRARY,
  ISSUE_LIBRARY,
  JUNCTION_PINS,
  POLICY_PRESETS,
  PREF_LIBRARY,
  TRAIT_LIBRARY,
} from "./issueLibrary";

export type GraphNodeKind =
  | "agent"
  | "trait"
  | "goal"
  | "preference"
  | "issue"
  | "routineStart"
  | "routineStop"
  | "routineEnd"
  | "cityEvent"
  | "policy"
  | "report";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  x: number;
  y: number;
  /** Optional payload key (library id, scenario id, pin id, score…) */
  ref?: string;
  score?: number;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
};

export type AgentGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type ExperienceReport = {
  agentName: string;
  goalLabels: string[];
  issueLabels: string[];
  eventLabel: string | null;
  policyLabel: string | null;
  routeLabels: string[];
  comfortStart: number;
  comfortEnd: number;
  blurb: string;
  generatedAt: string;
};

const KIND_COLOR: Record<GraphNodeKind, string> = {
  agent: "#5eb8b0",
  trait: "#7ec8a0",
  goal: "#4aa8c8",
  preference: "#6ab8b0",
  issue: "#c4a05a",
  routineStart: "#8a9aa0",
  routineStop: "#7a8a90",
  routineEnd: "#8a9aa0",
  cityEvent: "#c45c4a",
  policy: "#d4a15a",
  report: "#c8d4d0",
};

export function nodeColor(kind: GraphNodeKind) {
  return KIND_COLOR[kind];
}

export function canConnect(fromKind: GraphNodeKind, toKind: GraphNodeKind): boolean {
  const rules: Record<GraphNodeKind, GraphNodeKind[]> = {
    trait: ["agent"],
    goal: ["agent"],
    preference: ["agent"],
    issue: ["agent", "cityEvent"],
    agent: ["routineStart", "cityEvent", "report"],
    routineStart: ["routineStop", "routineEnd"],
    routineStop: ["routineStop", "routineEnd"],
    routineEnd: ["report"],
    cityEvent: ["policy", "report"],
    policy: ["report"],
    report: [],
  };
  return rules[fromKind]?.includes(toKind) ?? false;
}

let _seq = 0;
export function uid(prefix: string) {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq}`;
}

/** Seed storytelling graph from ops citizens. */
export function seedAgentGraph(): AgentGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const layouts: Record<string, { ax: number; ay: number }> = {
    margaret: { ax: 80, ay: 80 },
    amir: { ax: 80, ay: 320 },
    sofia: { ax: 80, ay: 560 },
  };

  citizens.forEach((c) => {
    const L = layouts[c.id] ?? { ax: 80, ay: 80 };
    const agentId = `agent_${c.id}`;
    nodes.push({
      id: agentId,
      kind: "agent",
      label: c.name,
      x: L.ax,
      y: L.ay,
      ref: c.id,
      score: c.comfortScore,
    });

    // Traits (heuristic from role)
    const trait =
      c.id === "margaret"
        ? TRAIT_LIBRARY.find((t) => t.id === "independent")!
        : c.id === "amir"
          ? TRAIT_LIBRARY.find((t) => t.id === "time_pressed")!
          : TRAIT_LIBRARY.find((t) => t.id === "crowd_sensitive")!;
    const traitId = uid("trait");
    nodes.push({
      id: traitId,
      kind: "trait",
      label: trait.label,
      x: L.ax - 200,
      y: L.ay - 40,
      ref: trait.id,
    });
    edges.push({ id: uid("e"), from: traitId, to: agentId });

    const goal =
      c.id === "margaret"
        ? GOAL_LIBRARY.find((g) => g.id === "reach_clinic")!
        : c.id === "amir"
          ? GOAL_LIBRARY.find((g) => g.id === "catch_transfer")!
          : GOAL_LIBRARY.find((g) => g.id === "lunch_with_child")!;
    const goalId = uid("goal");
    nodes.push({
      id: goalId,
      kind: "goal",
      label: goal.label,
      x: L.ax - 200,
      y: L.ay + 40,
      ref: goal.id,
    });
    edges.push({ id: uid("e"), from: goalId, to: agentId });

    c.preferences.slice(0, 2).forEach((p, i) => {
      const id = uid("pref");
      nodes.push({
        id,
        kind: "preference",
        label: p,
        x: L.ax - 200,
        y: L.ay + 100 + i * 50,
        ref: p,
      });
      edges.push({ id: uid("e"), from: id, to: agentId });
    });

    c.triggers.slice(0, 2).forEach((t, i) => {
      const match =
        ISSUE_LIBRARY.find((x) => x.label.toLowerCase() === t.toLowerCase()) ??
        ISSUE_LIBRARY.find((x) => t.toLowerCase().includes(x.label.toLowerCase().slice(0, 10)));
      const id = uid("issue");
      nodes.push({
        id,
        kind: "issue",
        label: match?.label ?? t,
        x: L.ax + 220,
        y: L.ay - 20 + i * 55,
        ref: match?.id ?? t,
      });
      edges.push({ id: uid("e"), from: id, to: agentId });
    });
  });

  // Shared story column
  CITY_EVENTS.forEach((ev, i) => {
    nodes.push({
      id: `event_${ev.id}`,
      kind: "cityEvent",
      label: ev.label,
      x: 520,
      y: 60 + i * 90,
      ref: ev.id,
    });
  });

  POLICY_PRESETS.slice(0, 4).forEach((p, i) => {
    nodes.push({
      id: `policy_${p}`,
      kind: "policy",
      label: p,
      x: 760,
      y: 80 + i * 70,
      ref: p,
    });
  });

  // Example routines
  const mkPin = (kind: GraphNode["kind"], pinId: string, x: number, y: number) => {
    const pin = JUNCTION_PINS.find((p) => p.id === pinId)!;
    const id = uid(kind);
    nodes.push({ id, kind, label: `${kind === "routineStart" ? "Start" : kind === "routineEnd" ? "End" : "Stop"} · ${pin.label}`, x, y, ref: pinId });
    return id;
  };

  const mStart = mkPin("routineStart", "A2", 320, 80);
  const mEnd = mkPin("routineEnd", "D2", 320, 160);
  edges.push({ id: uid("e"), from: "agent_margaret", to: mStart });
  edges.push({ id: uid("e"), from: mStart, to: mEnd });

  const aStart = mkPin("routineStart", "C1", 320, 320);
  const aEnd = mkPin("routineEnd", "C0", 320, 400);
  edges.push({ id: uid("e"), from: "agent_amir", to: aStart });
  edges.push({ id: uid("e"), from: aStart, to: aEnd });

  const sStart = mkPin("routineStart", "D2", 320, 560);
  const sStop = mkPin("routineStop", "C2", 320, 620);
  const sEnd = mkPin("routineEnd", "D2", 320, 680);
  edges.push({ id: uid("e"), from: "agent_sofia", to: sStart });
  edges.push({ id: uid("e"), from: sStart, to: sStop });
  edges.push({ id: uid("e"), from: sStop, to: sEnd });

  // Wire story beats (storytelling only)
  edges.push({ id: uid("e"), from: "agent_margaret", to: "event_margaret_sidewalk" });
  edges.push({ id: uid("e"), from: "event_margaret_sidewalk", to: "policy_reroute" });
  edges.push({ id: uid("e"), from: "agent_amir", to: "event_amir_delay" });
  edges.push({ id: uid("e"), from: "event_amir_delay", to: "policy_hold" });
  edges.push({ id: uid("e"), from: "agent_sofia", to: "event_sofia_lunch" });
  edges.push({ id: uid("e"), from: "event_sofia_lunch", to: "policy_stagger" });

  const reportId = "report_main";
  nodes.push({
    id: reportId,
    kind: "report",
    label: "Experience report",
    x: 1000,
    y: 300,
  });
  edges.push({ id: uid("e"), from: mEnd, to: reportId });
  edges.push({ id: uid("e"), from: "policy_reroute", to: reportId });

  return { nodes, edges };
}

/** Focused graph for one citizen — used on persona dossier. */
export function buildPersonaGraph(citizenId: string): AgentGraph | null {
  const c = citizens.find((x) => x.id === citizenId);
  if (!c) return null;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const agentId = `agent_${c.id}`;

  const trait =
    c.id === "margaret"
      ? TRAIT_LIBRARY.find((t) => t.id === "independent")!
      : c.id === "amir"
        ? TRAIT_LIBRARY.find((t) => t.id === "time_pressed")!
        : TRAIT_LIBRARY.find((t) => t.id === "crowd_sensitive")!;
  const goal =
    c.id === "margaret"
      ? GOAL_LIBRARY.find((g) => g.id === "reach_clinic")!
      : c.id === "amir"
        ? GOAL_LIBRARY.find((g) => g.id === "catch_transfer")!
        : GOAL_LIBRARY.find((g) => g.id === "lunch_with_child")!;

  const eventMap: Record<string, { event: string; policy: string; start: string; end: string; mid?: string }> = {
    margaret: { event: "margaret_sidewalk", policy: "reroute", start: "A2", end: "D2" },
    amir: { event: "amir_delay", policy: "hold", start: "C1", end: "C0" },
    sofia: { event: "sofia_lunch", policy: "stagger", start: "D2", mid: "C2", end: "D2" },
  };
  const story = eventMap[c.id] ?? { event: "clear_evening", policy: "proceed", start: "C2", end: "E2" };

  // Layout: left stack → agent center → routine → event/policy → report
  nodes.push({
    id: agentId,
    kind: "agent",
    label: c.name.split(" ")[0],
    x: 200,
    y: 140,
    ref: c.id,
    score: c.comfortScore,
  });

  const leftItems: { kind: GraphNodeKind; label: string; ref: string }[] = [
    { kind: "trait", label: trait.label, ref: trait.id },
    { kind: "goal", label: goal.label, ref: goal.id },
    ...c.preferences.slice(0, 2).map((p) => ({ kind: "preference" as const, label: p, ref: p })),
  ];
  leftItems.forEach((item, i) => {
    const id = `${c.id}_${item.kind}_${i}`;
    nodes.push({ id, kind: item.kind, label: item.label, x: 16, y: 20 + i * 72, ref: item.ref });
    edges.push({ id: `e_${id}`, from: id, to: agentId });
  });

  c.triggers.slice(0, 2).forEach((t, i) => {
    const match =
      ISSUE_LIBRARY.find((x) => x.label.toLowerCase() === t.toLowerCase()) ??
      ISSUE_LIBRARY.find((x) => t.toLowerCase().includes(x.label.toLowerCase().slice(0, 10)));
    const id = `${c.id}_issue_${i}`;
    nodes.push({
      id,
      kind: "issue",
      label: match?.label ?? t,
      x: 16,
      y: 20 + (leftItems.length + i) * 72,
      ref: match?.id ?? t,
    });
    edges.push({ id: `e_${id}`, from: id, to: agentId });
  });

  const pin = (kind: GraphNodeKind, pinId: string, x: number, y: number, key: string) => {
    const p = JUNCTION_PINS.find((j) => j.id === pinId)!;
    const tag = kind === "routineStart" ? "Start" : kind === "routineEnd" ? "End" : "Stop";
    const id = `${c.id}_${key}`;
    nodes.push({ id, kind, label: `${tag} · ${p.label}`, x, y, ref: pinId });
    return id;
  };

  const startId = pin("routineStart", story.start, 400, 80, "start");
  edges.push({ id: `e_${c.id}_to_start`, from: agentId, to: startId });
  let prev = startId;
  if (story.mid) {
    const midId = pin("routineStop", story.mid, 400, 160, "mid");
    edges.push({ id: `e_${c.id}_mid`, from: prev, to: midId });
    prev = midId;
  }
  const endId = pin("routineEnd", story.end, 400, story.mid ? 240 : 160, "end");
  edges.push({ id: `e_${c.id}_end`, from: prev, to: endId });

  const ev = CITY_EVENTS.find((e) => e.id === story.event)!;
  const eventId = `${c.id}_event`;
  nodes.push({ id: eventId, kind: "cityEvent", label: ev.label, x: 600, y: 100, ref: ev.id });
  edges.push({ id: `e_${c.id}_ev`, from: agentId, to: eventId });

  const policyId = `${c.id}_policy`;
  nodes.push({ id: policyId, kind: "policy", label: story.policy, x: 600, y: 200, ref: story.policy });
  edges.push({ id: `e_${c.id}_pol`, from: eventId, to: policyId });

  const reportId = `${c.id}_report`;
  nodes.push({ id: reportId, kind: "report", label: "Day report", x: 800, y: 140 });
  edges.push({ id: `e_${c.id}_rep1`, from: endId, to: reportId });
  edges.push({ id: `e_${c.id}_rep2`, from: policyId, to: reportId });

  return { nodes, edges };
}

export function spawnNode(kind: GraphNodeKind, at: { x: number; y: number }): GraphNode {
  const id = uid(kind);
  if (kind === "agent") {
    return { id, kind, label: "New agent", x: at.x, y: at.y, score: 0.5, ref: id };
  }
  if (kind === "trait") {
    const t = TRAIT_LIBRARY[0];
    return { id, kind, label: t.label, x: at.x, y: at.y, ref: t.id };
  }
  if (kind === "goal") {
    const g = GOAL_LIBRARY[0];
    return { id, kind, label: g.label, x: at.x, y: at.y, ref: g.id };
  }
  if (kind === "preference") {
    return { id, kind, label: PREF_LIBRARY[0], x: at.x, y: at.y, ref: PREF_LIBRARY[0] };
  }
  if (kind === "issue") {
    const iss = ISSUE_LIBRARY[0];
    return { id, kind, label: iss.label, x: at.x, y: at.y, ref: iss.id };
  }
  if (kind === "cityEvent") {
    const ev = CITY_EVENTS[0];
    return { id, kind, label: ev.label, x: at.x, y: at.y, ref: ev.id };
  }
  if (kind === "policy") {
    return { id, kind, label: "reroute", x: at.x, y: at.y, ref: "reroute" };
  }
  if (kind === "routineStart" || kind === "routineStop" || kind === "routineEnd") {
    const pin = JUNCTION_PINS[2];
    const tag = kind === "routineStart" ? "Start" : kind === "routineEnd" ? "End" : "Stop";
    return { id, kind, label: `${tag} · ${pin.label}`, x: at.x, y: at.y, ref: pin.id };
  }
  return { id, kind, label: "Experience report", x: at.x, y: at.y };
}

/** Sync agent nodes → comfort drafts (for twin heat). */
export function graphToComfortDrafts(graph: AgentGraph): ComfortDraft[] {
  return graph.nodes
    .filter((n) => n.kind === "agent")
    .map((agent) => {
      const incoming = graph.edges.filter((e) => e.to === agent.id).map((e) => graph.nodes.find((n) => n.id === e.from)!).filter(Boolean);
      return {
        id: agent.ref ?? agent.id,
        name: agent.label,
        score: agent.score ?? 0.5,
        preferences: incoming.filter((n) => n.kind === "preference").map((n) => n.label),
        triggers: incoming.filter((n) => n.kind === "issue").map((n) => n.label),
      };
    });
}

/** Storytelling-only “run” — builds a narrative report from wired nodes. */
export function buildMockReport(graph: AgentGraph, agentId?: string): ExperienceReport | null {
  const agents = graph.nodes.filter((n) => n.kind === "agent");
  const agent = agentId ? agents.find((a) => a.id === agentId) : agents[0];
  if (!agent) return null;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outs = (id: string) => graph.edges.filter((e) => e.from === id).map((e) => byId.get(e.to)!).filter(Boolean);
  const ins = (id: string) => graph.edges.filter((e) => e.to === id).map((e) => byId.get(e.from)!).filter(Boolean);

  const incoming = ins(agent.id);
  const goalLabels = incoming.filter((n) => n.kind === "goal").map((n) => n.label);
  const issueLabels = incoming.filter((n) => n.kind === "issue").map((n) => n.label);

  // Follow routine chain
  const routeLabels: string[] = [];
  let cur = outs(agent.id).find((n) => n.kind === "routineStart");
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    routeLabels.push(cur.label);
    cur = outs(cur.id).find((n) => n.kind === "routineStop" || n.kind === "routineEnd");
  }

  const eventNode = outs(agent.id).find((n) => n.kind === "cityEvent");
  const policyNode = eventNode ? outs(eventNode.id).find((n) => n.kind === "policy") : null;

  const comfortStart = agent.score ?? 0.5;
  const hit = issueLabels.length + (eventNode ? 1 : 0);
  const comfortEnd = Math.max(0.08, comfortStart - hit * 0.08 + (policyNode ? 0.05 : 0));

  const blurb = [
    `${agent.label} sets out`,
    goalLabels[0] ? `to ${goalLabels[0].toLowerCase()}` : "through the district",
    routeLabels.length ? `via ${routeLabels.map((r) => r.replace(/^(Start|Stop|End) · /, "")).join(" → ")}` : "",
    eventNode ? `When “${eventNode.label}” hits` : "As the day unfolds",
    issueLabels.length ? `— ${issueLabels[0].toLowerCase()} surfaces` : "",
    policyNode ? `— fleet policy shifts to ${policyNode.label}` : "",
    `. Storytelling pass ends near comfort ${(comfortEnd * 100).toFixed(0)} (from ${(comfortStart * 100).toFixed(0)}).`,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");

  return {
    agentName: agent.label,
    goalLabels,
    issueLabels,
    eventLabel: eventNode?.label ?? null,
    policyLabel: policyNode?.label ?? null,
    routeLabels,
    comfortStart,
    comfortEnd,
    blurb,
    generatedAt: new Date().toLocaleTimeString(),
  };
}
