import { JUNCTION_XS } from "../data/cityGrid";

export type TransitStation = {
  id: string;
  code: string;
  name: string;
  x: number;
  z: number;
  /** Line ids that serve this stop */
  lines: string[];
  /** Transfer / junction hub */
  hub?: boolean;
  baseLoad: number;
};

export type TransitLine = {
  id: string;
  name: string;
  short: string;
  color: string;
  /** Station ids in run order */
  stations: string[];
  /** Polyline XZ — includes curve points at split-offs */
  path: [number, number][];
  /** Seconds for a one-way run */
  periodSec: number;
};

const TUNNEL_Y = -9;
const PLATFORM_Y = -8.2;

export const TRANSIT_DEPTH = { tunnelY: TUNNEL_Y, platformY: PLATFORM_Y };

const J = JUNCTION_XS; // -80,-40,0,40,80

/**
 * Harbor metro — trunk + two split-offs (real network shape).
 *
 *   North Ridge
 *       │ M3
 *   University
 *       │
 * WH──MK══CP──EG     M1 trunk (══ = hubs)
 *       │
 *   South Quay       M2
 *       │
 *  Dock Terminal
 */
export const TRANSIT_STATIONS: TransitStation[] = [
  {
    id: "st-west",
    code: "WH",
    name: "West Harbor",
    x: J[0],
    z: 0,
    lines: ["m1"],
    baseLoad: 0.52,
  },
  {
    id: "st-market",
    code: "MK",
    name: "Market Row",
    x: J[1],
    z: 0,
    lines: ["m1", "m2"],
    hub: true,
    baseLoad: 0.78,
  },
  {
    id: "st-plaza",
    code: "CP",
    name: "Civic Plaza",
    x: J[3],
    z: 0,
    lines: ["m1", "m3"],
    hub: true,
    baseLoad: 0.74,
  },
  {
    id: "st-east",
    code: "EG",
    name: "East Gate",
    x: J[4],
    z: 0,
    lines: ["m1"],
    baseLoad: 0.46,
  },
  {
    id: "st-quay",
    code: "SQ",
    name: "South Quay",
    x: J[1],
    z: J[3],
    lines: ["m2"],
    baseLoad: 0.5,
  },
  {
    id: "st-dock",
    code: "DT",
    name: "Dock Terminal",
    x: J[1],
    z: J[4],
    lines: ["m2"],
    baseLoad: 0.58,
  },
  {
    id: "st-uni",
    code: "UN",
    name: "University",
    x: J[3],
    z: J[1],
    lines: ["m3"],
    baseLoad: 0.62,
  },
  {
    id: "st-north",
    code: "NR",
    name: "North Ridge",
    x: J[3],
    z: J[0],
    lines: ["m3"],
    baseLoad: 0.4,
  },
];

function st(id: string) {
  return TRANSIT_STATIONS.find((s) => s.id === id)!;
}

/** Build path through stations with a soft curve at the first split vertex. */
function linePath(stationIds: string[], splitAfter?: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < stationIds.length; i++) {
    const s = st(stationIds[i]);
    if (splitAfter !== undefined && i === splitAfter + 1) {
      // Curve leaving the trunk toward the branch
      const prev = st(stationIds[i - 1]);
      const mx = prev.x + (s.x - prev.x) * 0.28;
      const mz = prev.z + (s.z - prev.z) * 0.28;
      // Offset perpendicular so the peel-off reads as a Y-junction
      const dx = s.x - prev.x;
      const dz = s.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      const ox = (-dz / len) * 6;
      const oz = (dx / len) * 6;
      pts.push([mx + ox * 0.35, mz + oz * 0.35]);
      pts.push([prev.x + (s.x - prev.x) * 0.55 + ox * 0.15, prev.z + (s.z - prev.z) * 0.55]);
    }
    pts.push([s.x, s.z]);
  }
  return pts;
}

export const TRANSIT_LINES: TransitLine[] = [
  {
    id: "m1",
    name: "M1 Harbor",
    short: "M1",
    color: "#4aa8c8",
    stations: ["st-west", "st-market", "st-plaza", "st-east"],
    path: linePath(["st-west", "st-market", "st-plaza", "st-east"]),
    periodSec: 40,
  },
  {
    id: "m2",
    name: "M2 Dock Spur",
    short: "M2",
    color: "#c4a05a",
    // Shared hub then south split-off
    stations: ["st-market", "st-quay", "st-dock"],
    path: linePath(["st-market", "st-quay", "st-dock"], 0),
    periodSec: 34,
  },
  {
    id: "m3",
    name: "M3 North Spur",
    short: "M3",
    color: "#5eb8a0",
    // Shared hub then north split-off
    stations: ["st-plaza", "st-uni", "st-north"],
    path: linePath(["st-plaza", "st-uni", "st-north"], 0),
    periodSec: 36,
  },
];

export function stationById(id: string) {
  return st(id);
}

export function lineById(id: string) {
  return TRANSIT_LINES.find((l) => l.id === id)!;
}

/** Hub stations where lines split / transfer. */
export function hubStations() {
  return TRANSIT_STATIONS.filter((s) => s.hub);
}

/** Distance-weighted position along a 2D path, t in 0..1. */
export function pathPoint(path: [number, number][], t: number): [number, number] {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  const capped = Math.max(0, Math.min(0.9999, t));
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const len = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    lens.push(len);
    total += len;
  }
  if (total < 1e-4) return path[0];
  let remain = capped * total;
  for (let i = 0; i < lens.length; i++) {
    if (remain <= lens[i]) {
      const u = lens[i] < 1e-6 ? 0 : remain / lens[i];
      return [
        path[i][0] + (path[i + 1][0] - path[i][0]) * u,
        path[i][1] + (path[i + 1][1] - path[i][1]) * u,
      ];
    }
    remain -= lens[i];
  }
  return path[path.length - 1];
}

/** Ping-pong 0→1→0 from elapsed seconds and period. */
export function pingPong(elapsed: number, periodSec: number, phase = 0) {
  const u = ((elapsed / periodSec + phase) % 2 + 2) % 2;
  return u <= 1 ? u : 2 - u;
}

export function liveStationLoad(base: number, elapsed: number, seed: number) {
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.35 + seed * 6);
  return Math.max(0.12, Math.min(1, base * (0.75 + pulse * 0.45)));
}
