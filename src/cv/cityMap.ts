/** City-accurate 2D top-down map (SUMO roads + Kit actor poses + occupancy heat). */

import cityMap from "../data/cityMap2d.json";
import { buildConflict, LEVEL_NAME } from "../data/mockTracks";
import type { ConflictSnapshot, YardTrack } from "../data/types";
import type { KitActorsPayload } from "./yardlineClient";

export type CityMapData = {
  span_m: number;
  roads: [number, number][][];
  crossings: [number, number][][];
  sidewalk_ribbons: { x: number; z: number; w: number; h: number; dir: string }[];
};

export const CITY_MAP = cityMap as unknown as CityMapData;

const PROXIMITY_M = 4.0;

/** Rolling occupancy grid in USD XZ (pedestrian footfall on the 160 m city). */
export class CityOccupancyHeatmap {
  cellM: number;
  windowS: number;
  private half: number;
  private cols: number;
  private rows: number;
  private events: { t: number; x: number; z: number; w: number }[] = [];
  private grid: Float32Array;
  private peak = 0;

  constructor(spanM = 160, cellM = 2, windowS = 120) {
    this.cellM = cellM;
    this.windowS = windowS;
    this.half = spanM * 0.5;
    this.cols = Math.max(8, Math.ceil(spanM / cellM));
    this.rows = this.cols;
    this.grid = new Float32Array(this.cols * this.rows);
  }

  setWindow(windowS: number) {
    this.windowS = Math.max(0, windowS);
    this.reset();
  }

  reset() {
    this.events = [];
    this.grid.fill(0);
    this.peak = 0;
  }

  /** Deposit current Kit actors (people weighted higher than vehicles). */
  step(actors: KitActorsPayload | null, now = performance.now() / 1000) {
    if (!actors) return;
    for (const p of actors.pedestrians) {
      const isRobot = p.cls === "robot" || p.type === "delivery_robot";
      this.events.push({ t: now, x: p.x, z: p.z, w: isRobot ? 0.55 : 1 });
    }
    for (const v of actors.vehicles) {
      this.events.push({ t: now, x: v.x, z: v.z, w: 0.35 });
    }
    if (this.events.length > 40000) {
      this.events = this.events.slice(-28000);
    }
    this.rebuild(now);
  }

  private rebuild(now: number) {
    this.grid.fill(0);
    this.peak = 0;
    const cutoff = this.windowS > 0 ? now - this.windowS : -Infinity;
    let write = 0;
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.t < cutoff) continue;
      this.events[write++] = e;
      const ix = Math.floor((e.x + this.half) / this.cellM);
      const iz = Math.floor((e.z + this.half) / this.cellM);
      if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) continue;
      const idx = iz * this.cols + ix;
      this.grid[idx] += e.w;
      if (this.grid[idx] > this.peak) this.peak = this.grid[idx];
    }
    this.events.length = write;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    toPx: (x: number, z: number) => readonly [number, number],
    scale: number,
  ) {
    if (this.peak < 0.2) return;
    const cellPx = Math.max(2, this.cellM * scale);
    for (let iz = 0; iz < this.rows; iz++) {
      for (let ix = 0; ix < this.cols; ix++) {
        const v = this.grid[iz * this.cols + ix] / this.peak;
        if (v < 0.08) continue;
        const wx = -this.half + (ix + 0.5) * this.cellM;
        const wz = -this.half + (iz + 0.5) * this.cellM;
        const [px, pz] = toPx(wx - this.cellM * 0.5, wz - this.cellM * 0.5);
        // cool → hot: teal / amber / crit
        const a = Math.min(0.55, 0.08 + v * 0.5);
        let fill: string;
        if (v < 0.35) fill = `rgba(94, 184, 176, ${a})`;
        else if (v < 0.65) fill = `rgba(224, 160, 90, ${a})`;
        else fill = `rgba(212, 91, 74, ${a})`;
        ctx.fillStyle = fill;
        ctx.fillRect(px, pz, cellPx + 0.5, cellPx + 0.5);
      }
    }
  }

  get stats() {
    return { peak: this.peak, samples: this.events.length, windowS: this.windowS };
  }
}

let sharedHeat: CityOccupancyHeatmap | null = null;

export function getCityHeatmap(): CityOccupancyHeatmap {
  if (!sharedHeat) sharedHeat = new CityOccupancyHeatmap();
  return sharedHeat;
}

export function actorsToTracks(payload: KitActorsPayload): YardTrack[] {
  const tracks: YardTrack[] = [];
  for (const p of payload.pedestrians) {
    const isRobot = p.cls === "robot" || p.type === "delivery_robot";
    tracks.push({
      id: isRobot ? `bot:${p.id}` : `ped:${p.id}`,
      cls: isRobot ? "robot" : "person",
      x: p.x,
      y: p.z,
      vx: 0,
      vy: 0,
      speed: 0,
      history: [],
    });
  }
  for (const v of payload.vehicles) {
    tracks.push({
      id: `veh:${v.id}`,
      cls: "robot",
      x: v.x,
      y: v.z,
      vx: 0,
      vy: 0,
      speed: 0,
      history: [],
    });
  }
  return tracks;
}

/** Ped↔vehicle proximity on the city map (reuses mock TTC helpers). */
export function cityProximityConflict(payload: KitActorsPayload): ConflictSnapshot {
  return buildConflict(actorsToTracks(payload));
}

export type DrawCityMapOpts = {
  personPos: [number, number, number];
  robotPos: [number, number, number] | null;
  conflict: ConflictSnapshot | null;
  heatmap?: CityOccupancyHeatmap | null;
  showHeat?: boolean;
  comfortZones?: import("./comfortZones").ComfortZoneSnapshot | null;
  comfortGrid?: import("./comfortZones").ComfortZoneGrid | null;
  showComfort?: boolean;
  /** Always draw story persona ghost even when Kit actors are live. */
  storyGhost?: boolean;
  /** Kit robot id to ring-highlight (nearest story person). */
  highlightRobotId?: string | null;
};

export function drawCityMap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  actors: KitActorsPayload | null,
  mockFallback?: DrawCityMapOpts,
): ConflictSnapshot | null {
  const span = CITY_MAP.span_m || 160;
  const pad = 8;
  const scale = Math.min((w - pad * 2) / span, (h - pad * 2) / span);
  const ox = w * 0.5;
  const oz = h * 0.5;

  const toPx = (x: number, z: number) => [ox + x * scale, oz + z * scale] as const;

  ctx.fillStyle = "#12181a";
  ctx.fillRect(0, 0, w, h);

  // Sidewalk ribbons
  ctx.fillStyle = "rgba(90, 110, 100, 0.35)";
  for (const r of CITY_MAP.sidewalk_ribbons || []) {
    const [x0, z0] = toPx(r.x, r.z);
    ctx.fillRect(x0, z0, r.w * scale, r.h * scale);
  }

  // Roads
  ctx.strokeStyle = "rgba(60, 72, 70, 0.95)";
  ctx.lineWidth = Math.max(2, 3.2 * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const poly of CITY_MAP.roads || []) {
    if (poly.length < 2) continue;
    ctx.beginPath();
    const [sx, sz] = toPx(poly[0][0], poly[0][1]);
    ctx.moveTo(sx, sz);
    for (let i = 1; i < poly.length; i++) {
      const [px, pz] = toPx(poly[i][0], poly[i][1]);
      ctx.lineTo(px, pz);
    }
    ctx.stroke();
  }

  // Occupancy heat (under actors)
  if (mockFallback?.showHeat !== false && mockFallback?.heatmap) {
    mockFallback.heatmap.draw(ctx, toPx, scale);
  }

  // Comfort zones (opt-in / persona discs) — hatch over heat
  if (
    mockFallback?.showComfort !== false &&
    mockFallback?.comfortZones &&
    mockFallback?.comfortGrid
  ) {
    mockFallback.comfortGrid.draw(ctx, toPx, scale, mockFallback.comfortZones);
  }

  // Soft center grid
  ctx.strokeStyle = "rgba(242,239,232,0.06)";
  ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    const m = (i / 2) * (span * 0.5);
    const [ax, az] = toPx(m, -span * 0.5);
    const [, bz] = toPx(m, span * 0.5);
    ctx.beginPath();
    ctx.moveTo(ax, az);
    ctx.lineTo(ax, bz);
    ctx.stroke();
    const [cx, cz] = toPx(-span * 0.5, m);
    const [dx] = toPx(span * 0.5, m);
    ctx.beginPath();
    ctx.moveTo(cx, cz);
    ctx.lineTo(dx, cz);
    ctx.stroke();
  }

  let conflict: ConflictSnapshot | null = null;
  const peds: { id: string; x: number; z: number; yaw: number }[] = [];
  const bots: { id: string; x: number; z: number; yaw: number }[] = [];
  const vehs: { id: string; x: number; z: number; yaw: number }[] = [];

  if (actors && (actors.pedestrians.length || actors.vehicles.length)) {
    conflict = cityProximityConflict(actors);
    for (const p of actors.pedestrians) {
      const isRobot = p.cls === "robot" || p.type === "delivery_robot";
      if (isRobot) bots.push({ id: p.id, x: p.x, z: p.z, yaw: p.yaw ?? 0 });
      else peds.push({ id: p.id, x: p.x, z: p.z, yaw: p.yaw ?? 0 });
    }
    for (const v of actors.vehicles) {
      vehs.push({ id: v.id, x: v.x, z: v.z, yaw: v.yaw ?? 0 });
    }
  } else if (mockFallback) {
    conflict = mockFallback.conflict;
    peds.push({ id: "person", x: mockFallback.personPos[0], z: mockFallback.personPos[2], yaw: 0 });
    if (mockFallback.robotPos) {
      vehs.push({
        id: "robot",
        x: mockFallback.robotPos[0],
        z: mockFallback.robotPos[2],
        yaw: 0,
      });
    }
  }

  // Proximity links (person↔vehicle/robot within threshold)
  if (conflict?.pairs?.length) {
    const byTrack = new Map<string, { x: number; z: number }>();
    for (const p of peds) byTrack.set(`ped:${p.id}`, p);
    for (const b of bots) byTrack.set(`bot:${b.id}`, b);
    for (const v of vehs) byTrack.set(`veh:${v.id}`, v);
    for (const pair of conflict.pairs) {
      if (pair.distance_m > PROXIMITY_M) continue;
      const pa = byTrack.get(pair.track_a);
      const pb = byTrack.get(pair.track_b);
      if (!pa || !pb) continue;
      const [ax, az] = toPx(pa.x, pa.z);
      const [bx, bz] = toPx(pb.x, pb.z);
      const alarm = pair.level;
      ctx.strokeStyle =
        alarm >= 3
          ? "rgba(212,91,74,0.75)"
          : alarm >= 2
            ? "rgba(224,160,90,0.7)"
            : "rgba(142,195,212,0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, az);
      ctx.lineTo(bx, bz);
      ctx.stroke();
      const mx = (ax + bx) * 0.5;
      const mz = (az + bz) * 0.5;
      ctx.beginPath();
      ctx.arc(mx, mz, Math.max(10, pair.distance_m * scale * 0.5), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Vehicles + heading
  for (const v of vehs) {
    const [px, pz] = toPx(v.x, v.z);
    const yaw = ((v.yaw ?? 0) * Math.PI) / 180;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(yaw);
    ctx.fillStyle = "#e0a05a";
    ctx.fillRect(-5, -3, 10, 6);
    ctx.strokeStyle = "#e0a05a";
    ctx.fillStyle = "#e0a05a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(12, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(8, -3);
    ctx.lineTo(8, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Delivery robots (amber squares on sidewalk)
  const highlightId = mockFallback?.highlightRobotId ?? null;
  for (const b of bots) {
    const [px, pz] = toPx(b.x, b.z);
    const yaw = ((b.yaw ?? 0) * Math.PI) / 180;
    if (highlightId && b.id === highlightId) {
      ctx.beginPath();
      ctx.arc(px, pz, 11, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(242, 194, 122, 0.95)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, pz, 14, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(242, 194, 122, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(yaw);
    ctx.fillStyle = "#e0a05a";
    ctx.fillRect(-4, -4, 8, 8);
    ctx.strokeStyle = "#f2c27a";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.restore();
  }

  // Pedestrians + heading
  for (const p of peds) {
    const [px, pz] = toPx(p.x, p.z);
    const yaw = ((p.yaw ?? 0) * Math.PI) / 180;
    ctx.fillStyle = "#8ec3d4";
    ctx.beginPath();
    ctx.arc(px, pz, 3.5, 0, Math.PI * 2);
    ctx.fill();
    const len = 9;
    const tx = px + Math.cos(yaw) * len;
    const tz = pz + Math.sin(yaw) * len;
    ctx.strokeStyle = "#8ec3d4";
    ctx.fillStyle = "#8ec3d4";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px, pz);
    ctx.lineTo(tx, tz);
    ctx.stroke();
    const ang = Math.atan2(tz - pz, tx - px);
    ctx.beginPath();
    ctx.moveTo(tx, tz);
    ctx.lineTo(tx - 4 * Math.cos(ang - 0.5), tz - 4 * Math.sin(ang - 0.5));
    ctx.lineTo(tx - 4 * Math.cos(ang + 0.5), tz - 4 * Math.sin(ang + 0.5));
    ctx.closePath();
    ctx.fill();
  }

  // Story persona ghost — always when Kit actors live (spatial match to BeatPanel).
  const live = Boolean(actors && (actors.pedestrians.length || actors.vehicles.length));
  if (mockFallback && live) {
    const gx = mockFallback.personPos[0];
    const gz = mockFallback.personPos[2];
    const [px, pz] = toPx(gx, gz);
    ctx.beginPath();
    ctx.arc(px, pz, 7, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(142, 195, 212, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(px, pz, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(242, 239, 232, 0.9)";
    ctx.fill();
  }

  ctx.fillStyle = "#9c968b";
  ctx.font = "10px IBM Plex Mono, monospace";
  const alarmName = conflict ? LEVEL_NAME[conflict.alarm] : "—";
  const heat = mockFallback?.heatmap?.stats;
  const heatBit =
    mockFallback?.showHeat !== false && heat
      ? `  ·  heat ${heat.windowS}s n=${heat.samples}`
      : "";
  const zoneN = mockFallback?.comfortZones?.cells.length ?? 0;
  const zoneBit =
    mockFallback?.showComfort !== false && zoneN > 0 ? `  ·  zones ${zoneN}` : "";
  const nPed = peds.length;
  const nBot = bots.length;
  ctx.fillText(
    live
      ? `CITY 160 m  ·  ${nPed} ped  ${nBot} bot  ${actors!.vehicles.length} veh  ·  ${alarmName}${heatBit}${zoneBit}`
      : "CITY 160 m  ·  WAITING KIT ACTORS  ·  MOCK FALLBACK",
    10,
    16,
  );

  return conflict;
}
