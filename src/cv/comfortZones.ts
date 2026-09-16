/** Comfort zone grid — opt-in / persona scores aggregated in city XZ. */

import { STREET_ROUTES } from "../lib/streetRoutes";
import type { ComfortOverride } from "../data/types";
import { packs, resolveComfort } from "../state/store";

export type ZoneLevel = 0 | 1 | 2 | 3;

export const ZONE_LEVEL_NAME = {
  0: "clear",
  1: "advisory",
  2: "caution",
  3: "avoid",
} as const;

export type ComfortDeposit = {
  id: string;
  x: number;
  z: number;
  score: number;
  /** Influence radius in metres (low comfort → wider). */
  radiusM: number;
};

export type ComfortZoneCell = {
  ix: number;
  iz: number;
  /** Mean comfort 0..1 (low = avoid). */
  comfort: number;
  level: ZoneLevel;
  n: number;
};

export type ComfortZoneSnapshot = {
  updatedAt: number;
  span_m: number;
  cell_m: number;
  cells: ComfortZoneCell[];
  deposits: Array<{ id: string; x: number; z: number; score: number; level: ZoneLevel }>;
};

export function levelFromComfort(score: number): ZoneLevel {
  if (score < 0.25) return 3;
  if (score < 0.45) return 2;
  if (score < 0.7) return 1;
  return 0;
}

export function radiusForComfort(score: number): number {
  // Avoidant people claim more sidewalk for robot standoff.
  return 4 + (1 - Math.min(1, Math.max(0, score))) * 10;
}

/** Anchor pose for a persona when not the live selected walker. */
export function personaAnchorXZ(
  personId: string,
  liveId: string | null,
  livePos: [number, number, number] | null,
): { x: number; z: number } | null {
  if (liveId === personId && livePos) {
    return { x: livePos[0], z: livePos[2] };
  }
  const pack = packs[personId];
  const stop = pack?.journey?.stops?.[0]?.location;
  if (stop && Number.isFinite(stop.x) && Number.isFinite(stop.z)) {
    return { x: stop.x, z: stop.z };
  }
  const route = STREET_ROUTES[personId];
  if (route?.length) return { x: route[0][0], z: route[0][1] };
  return null;
}

export function collectComfortDeposits(opts: {
  overrides: Record<string, ComfortOverride>;
  selectedId: string | null;
  personPos: [number, number, number];
  /** When true, only people with an explicit override deposit (strict opt-in). */
  optInOnly?: boolean;
}): ComfortDeposit[] {
  const { overrides, selectedId, personPos, optInOnly = false } = opts;
  const out: ComfortDeposit[] = [];
  for (const id of Object.keys(packs)) {
    if (optInOnly && !overrides[id]) continue;
    const comfort = resolveComfort(id, overrides);
    if (!comfort) continue;
    const anchor = personaAnchorXZ(id, selectedId, personPos);
    if (!anchor) continue;
    out.push({
      id,
      x: anchor.x,
      z: anchor.z,
      score: comfort.score,
      radiusM: radiusForComfort(comfort.score),
    });
  }
  return out;
}

/**
 * Fixed city grid: deposit soft discs of comfort, then classify cells.
 * Low mean comfort → avoid/caution for robots.
 */
export class ComfortZoneGrid {
  spanM: number;
  cellM: number;
  half: number;
  cols: number;
  rows: number;
  /** Sum of comfort * weight per cell. */
  private sum: Float32Array;
  private weight: Float32Array;

  constructor(spanM = 160, cellM = 4) {
    this.spanM = spanM;
    this.cellM = cellM;
    this.half = spanM * 0.5;
    this.cols = Math.max(8, Math.ceil(spanM / cellM));
    this.rows = this.cols;
    this.sum = new Float32Array(this.cols * this.rows);
    this.weight = new Float32Array(this.cols * this.rows);
  }

  clear() {
    this.sum.fill(0);
    this.weight.fill(0);
  }

  private idx(ix: number, iz: number) {
    return iz * this.cols + ix;
  }

  private worldToCell(x: number, z: number): [number, number] | null {
    const ix = Math.floor((x + this.half) / this.cellM);
    const iz = Math.floor((z + this.half) / this.cellM);
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return null;
    return [ix, iz];
  }

  deposit(d: ComfortDeposit) {
    const r = Math.max(this.cellM, d.radiusM);
    const i0 = this.worldToCell(d.x, d.z);
    if (!i0) return;
    const steps = Math.ceil(r / this.cellM);
    // Square footprint (Chebyshev) — grid zones, not circular blobs
    for (let dz = -steps; dz <= steps; dz++) {
      for (let dx = -steps; dx <= steps; dx++) {
        const ix = i0[0] + dx;
        const iz = i0[1] + dz;
        if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) continue;
        const distCell = Math.max(Math.abs(dx), Math.abs(dz));
        const falloff = 1 - distCell / (steps + 0.001);
        const w = Math.max(0.08, falloff * falloff);
        const i = this.idx(ix, iz);
        this.sum[i] += d.score * w;
        this.weight[i] += w;
      }
    }
  }

  rebuild(deposits: ComfortDeposit[]) {
    this.clear();
    for (const d of deposits) this.deposit(d);
  }

  snapshot(deposits: ComfortDeposit[]): ComfortZoneSnapshot {
    const cells: ComfortZoneCell[] = [];
    for (let iz = 0; iz < this.rows; iz++) {
      for (let ix = 0; ix < this.cols; ix++) {
        const i = this.idx(ix, iz);
        const w = this.weight[i];
        if (w < 0.15) continue;
        const comfort = this.sum[i] / w;
        const level = levelFromComfort(comfort);
        if (level === 0) continue; // omit clear cells to keep payload small
        cells.push({ ix, iz, comfort, level, n: w });
      }
    }
    return {
      updatedAt: Date.now() / 1000,
      span_m: this.spanM,
      cell_m: this.cellM,
      cells,
      deposits: deposits.map((d) => ({
        id: d.id,
        x: d.x,
        z: d.z,
        score: d.score,
        level: levelFromComfort(d.score),
      })),
    };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    toPx: (x: number, z: number) => readonly [number, number],
    scale: number,
    snap: ComfortZoneSnapshot,
  ) {
    const cellPx = Math.max(3, this.cellM * scale);
    for (const c of snap.cells) {
      const wx = -this.half + c.ix * this.cellM;
      const wz = -this.half + c.iz * this.cellM;
      const [px, pz] = toPx(wx, wz);
      const a = c.level >= 3 ? 0.42 : c.level >= 2 ? 0.3 : 0.16;
      ctx.fillStyle =
        c.level >= 3
          ? `rgba(212, 91, 74, ${a})`
          : c.level >= 2
            ? `rgba(224, 160, 90, ${a})`
            : `rgba(142, 195, 212, ${a})`;
      ctx.fillRect(px, pz, cellPx + 0.5, cellPx + 0.5);
    }
  }
}

let sharedZones: ComfortZoneGrid | null = null;

export function getComfortZoneGrid(): ComfortZoneGrid {
  if (!sharedZones) sharedZones = new ComfortZoneGrid();
  return sharedZones;
}

export async function publishComfortZones(
  snap: ComfortZoneSnapshot,
): Promise<boolean> {
  try {
    const res = await fetch("/api/comfort-zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snap),
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchComfortZones(): Promise<ComfortZoneSnapshot | null> {
  try {
    const res = await fetch("/api/comfort-zones", {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return null;
    return (await res.json()) as ComfortZoneSnapshot;
  } catch {
    return null;
  }
}
