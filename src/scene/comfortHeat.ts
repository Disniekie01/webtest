import { CITY_SPAN_M, HALF_SPAN_M, JUNCTION_XS } from "../data/cityGrid";
import type { ComfortDraft, MapCell } from "../data/ascTypes";

export type ComfortCell = {
  id: string;
  ix: number;
  iz: number;
  x: number;
  z: number;
  hs: number;
  base: number;
};

export type ComfortBand = "calm" | "ok" | "tense" | "stress";

/** How many pedestrians saturate a cell (robot-avoid threshold). */
export const CONGESTION_CAP = 8;

const GRID = 8;

export function buildComfortGrid(): ComfortCell[] {
  const cells: ComfortCell[] = [];
  const step = CITY_SPAN_M / GRID;
  const hs = step * 0.48;
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const x = -HALF_SPAN_M + step * (ix + 0.5);
      const z = -HALF_SPAN_M + step * (iz + 0.5);
      const distCore = Math.hypot(x, z) / 90;
      const nearRoad =
        JUNCTION_XS.some((j) => Math.abs(x - j) < 6 || Math.abs(z - j) < 6) ? 0.08 : 0;
      const base = Math.max(0.35, Math.min(0.88, 0.72 - distCore * 0.15 - nearRoad));
      cells.push({ id: `c-${ix}-${iz}`, ix, iz, x, z, hs, base });
    }
  }
  return cells;
}

export function scenarioCellToWorld(c: MapCell) {
  const x = (c.x + c.w / 2) * CITY_SPAN_M - HALF_SPAN_M;
  const z = (c.y + c.h / 2) * CITY_SPAN_M - HALF_SPAN_M;
  const rx = (c.w * CITY_SPAN_M) / 2;
  const rz = (c.h * CITY_SPAN_M) / 2;
  return { x, z, rx, rz, level: c.level ?? 0.5 };
}

export type ComfortDeposit = {
  x: number;
  z: number;
  score: number;
  radius: number;
  name: string;
};

/** Persona anchors across Harbor — influence discs for area averages. */
export function depositsFromDrafts(drafts: ComfortDraft[]): ComfortDeposit[] {
  const anchors: [number, number][] = [
    [JUNCTION_XS[0], JUNCTION_XS[2]], // Margaret — Harbor
    [JUNCTION_XS[2], JUNCTION_XS[1]], // Amir — North corridor
    [JUNCTION_XS[3], JUNCTION_XS[3]], // Sofia — mixed-use / plaza lunch
    [JUNCTION_XS[1], JUNCTION_XS[4]],
    [JUNCTION_XS[4], JUNCTION_XS[2]],
    [0, 0],
  ];
  return drafts.map((d, i) => {
    const [x, z] = anchors[i % anchors.length];
    // Low-comfort people cast a wider “needs space” disc
    const radius = 22 + (1 - d.score) * 18;
    return { x, z, score: d.score, radius, name: d.name };
  });
}

export function comfortBand(score: number): ComfortBand {
  if (score >= 0.7) return "calm";
  if (score >= 0.5) return "ok";
  if (score >= 0.35) return "tense";
  return "stress";
}

export function comfortColor(score: number): string {
  const t = 1 - Math.max(0, Math.min(1, score));
  if (t < 0.35) return lerpHex("#5eb8a0", "#a8c47a", t / 0.35);
  if (t < 0.65) return lerpHex("#a8c47a", "#c4a05a", (t - 0.35) / 0.3);
  return lerpHex("#c4a05a", "#c45c4a", (t - 0.65) / 0.35);
}

function lerpHex(a: string, b: string, t: number) {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function bandLabel(b: ComfortBand) {
  if (b === "calm") return "calm";
  if (b === "ok") return "steady";
  if (b === "tense") return "tense";
  return "stress";
}

export type ComfortBreakdown = {
  /** Final robot-sendability / zone comfort 0..1 */
  score: number;
  /** Aggregate avg of people influencing this cell */
  peopleAvg: number;
  /** 0..1 crowd load */
  congestion: number;
  peopleN: number;
  pedCount: number;
};

/**
 * Comfort for fleet policy:
 * 1) Average comfort of people whose zones overlap this cell
 * 2) Congestion penalty — lunchtime crowds (Sofia) → don’t send robots into packed areas
 */
export function liveComfortBreakdown(
  cell: ComfortCell,
  deposits: ComfortDeposit[],
  pedCount: number,
  scenarioBoosts: { x: number; z: number; rx: number; rz: number; level: number }[],
): ComfortBreakdown {
  // --- People aggregate ---
  let peopleSum = 0;
  let peopleW = 0;
  for (const d of deposits) {
    const dist = Math.hypot(cell.x - d.x, cell.z - d.z);
    if (dist > d.radius) continue;
    const w = 1 - dist / d.radius;
    const fall = w * w;
    peopleSum += d.score * fall;
    peopleW += fall;
  }
  const peopleAvg = peopleW > 0.05 ? peopleSum / peopleW : cell.base;
  const peopleN = peopleW > 0.05 ? Math.max(1, Math.round(peopleW * 2)) : 0;

  // Scenario soft bands (opt-in mapping) blend lightly into peopleAvg
  let blendedPeople = peopleAvg;
  for (const s of scenarioBoosts) {
    const dx = Math.abs(cell.x - s.x) / Math.max(1, s.rx);
    const dz = Math.abs(cell.z - s.z) / Math.max(1, s.rz);
    if (dx > 1 || dz > 1) continue;
    const w = (1 - dx) * (1 - dz) * 0.35;
    blendedPeople = blendedPeople * (1 - w) + s.level * w;
  }

  // --- Congestion (ped density) ---
  // Stories: dense plazas / station crowds → bad place for robots
  const congestion = Math.max(0, Math.min(1, pedCount / CONGESTION_CAP));

  // Robot-sendability: people comfort × free space, then extra congestion hit
  const score = Math.max(
    0.05,
    Math.min(0.98, blendedPeople * (1 - congestion * 0.7) - congestion * 0.12),
  );

  return {
    score,
    peopleAvg: blendedPeople,
    congestion,
    peopleN,
    pedCount,
  };
}

/** Count pedestrians falling in each comfort cell. */
export function countPedsPerCell(
  cells: ComfortCell[],
  peds: { x: number; z: number }[],
): number[] {
  const counts = cells.map(() => 0);
  const reach = cells[0]?.hs ?? 10;
  for (const p of peds) {
    let best = -1;
    let bestD = reach * 1.35;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) counts[best] += 1;
  }
  return counts;
}

/** Offline mock crowd — denser at plazas / lunch corridors (Sofia beat). */
export function mockPedPositions(elapsed: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  // Civic / lunch plaza cluster
  const plazaN = 10 + Math.round(4 * (0.5 + 0.5 * Math.sin(elapsed * 0.15)));
  for (let i = 0; i < plazaN; i++) {
    const a = (i / plazaN) * Math.PI * 2 + elapsed * 0.05;
    out.push({ x: Math.cos(a) * 12 + JUNCTION_XS[3] * 0.15, z: Math.sin(a) * 10 });
  }
  // Market / west sidewalk
  for (let i = 0; i < 6; i++) {
    out.push({
      x: JUNCTION_XS[1] + Math.sin(elapsed * 0.2 + i) * 8,
      z: Math.cos(elapsed * 0.15 + i * 0.7) * 6,
    });
  }
  // North transit approach (Amir)
  for (let i = 0; i < 5; i++) {
    out.push({
      x: Math.sin(elapsed * 0.12 + i) * 6,
      z: JUNCTION_XS[1] + i * 3 - 6,
    });
  }
  // Quiet harbor edge — few people
  out.push({ x: JUNCTION_XS[0] + 5, z: 4 });
  out.push({ x: JUNCTION_XS[0] - 3, z: -6 });
  return out;
}
