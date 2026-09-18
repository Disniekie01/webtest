import { useEffect, useMemo, useState } from "react";
import { JUNCTION_XS, STREET_W, mainJunctions } from "../../data/cityGrid";
import { useSumoActors, type SumoActor } from "../../scene/useSumoActors";

const BLOCK = 40;

export type RoadSegMetric = {
  id: string;
  label: string;
  axis: "ew" | "ns";
  density: number;
  count: number;
};

export type JunctionMetric = {
  id: string;
  label: string;
  load: number;
  count: number;
};

export type TrafficMetrics = {
  live: boolean;
  vehicles: number;
  avgSpeedKmh: number;
  stopped: number;
  busyRoads: number;
  heavyJunctions: number;
  roads: RoadSegMetric[];
  junctions: JunctionMetric[];
  updatedAt: number;
};

type RoadSeg = {
  id: string;
  label: string;
  axis: "ew" | "ns";
  cx: number;
  cz: number;
  length: number;
};

function buildSegments(): RoadSeg[] {
  const col = ["A", "B", "C", "D", "E"];
  const segs: RoadSeg[] = [];
  for (let zi = 0; zi < JUNCTION_XS.length; zi++) {
    const z = JUNCTION_XS[zi];
    for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
      const x0 = JUNCTION_XS[i];
      const x1 = JUNCTION_XS[i + 1];
      segs.push({
        id: `ew-${z}-${x0}`,
        label: `${col[i]}${zi}→${col[i + 1]}${zi}`,
        axis: "ew",
        cx: (x0 + x1) / 2,
        cz: z,
        length: BLOCK - STREET_W,
      });
    }
  }
  for (let xi = 0; xi < JUNCTION_XS.length; xi++) {
    const x = JUNCTION_XS[xi];
    for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
      const z0 = JUNCTION_XS[i];
      const z1 = JUNCTION_XS[i + 1];
      segs.push({
        id: `ns-${x}-${z0}`,
        label: `${col[xi]}${i}→${col[xi]}${i + 1}`,
        axis: "ns",
        cx: x,
        cz: (z0 + z1) / 2,
        length: BLOCK - STREET_W,
      });
    }
  }
  return segs;
}

const SEGMENTS = buildSegments();
const JUNCTIONS = mainJunctions();

function hash01(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

function segStats(seg: RoadSeg, vehicles: SumoActor[]) {
  const halfL = seg.length * 0.5;
  const halfW = STREET_W * 0.55;
  let n = 0;
  let slow = 0;
  for (const v of vehicles) {
    if (seg.axis === "ew") {
      if (Math.abs(v.z - seg.cz) > halfW || Math.abs(v.x - seg.cx) > halfL) continue;
    } else if (Math.abs(v.x - seg.cx) > halfW || Math.abs(v.z - seg.cz) > halfL) {
      continue;
    }
    n += 1;
    if ((v.speed ?? 5) < 3) slow += 1;
  }
  return { density: Math.min(1, n / 5 + slow * 0.12), count: n };
}

function juncStats(jx: number, jz: number, vehicles: SumoActor[]) {
  let n = 0;
  let slow = 0;
  for (const v of vehicles) {
    if (Math.hypot(v.x - jx, v.z - jz) > 14) continue;
    n += 1;
    if ((v.speed ?? 5) < 2.5) slow += 1;
  }
  return { load: Math.min(1, n / 8 + slow * 0.15), count: n };
}

export function busyLabel(load: number): string {
  if (load < 0.25) return "light";
  if (load < 0.5) return "busy";
  if (load < 0.75) return "heavy";
  return "jam";
}

export function loadTone(load: number): "ok" | "warn" | "hot" | "crit" {
  if (load < 0.25) return "ok";
  if (load < 0.5) return "warn";
  if (load < 0.75) return "hot";
  return "crit";
}

/** Shared traffic metrics for the twin panel (live SUMO or mock). */
export function useTrafficMetrics(tickMs = 500): TrafficMetrics {
  const sumo = useSumoActors(Math.max(tickMs, 160));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);

  return useMemo(() => {
    const t = Date.now() / 1000;
    void tick;

    if (sumo.live) {
      const veh = sumo.vehicles;
      const speeds = veh.map((v) => v.speed ?? 0);
      const avgMs =
        speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
      const roads = SEGMENTS.map((seg) => {
        const s = segStats(seg, veh);
        return { id: seg.id, label: seg.label, axis: seg.axis, ...s };
      }).sort((a, b) => b.density - a.density);

      const junctions = JUNCTIONS.map((j) => {
        const s = juncStats(j.x, j.z, veh);
        return { id: j.id, label: j.id, ...s };
      }).sort((a, b) => b.load - a.load);

      return {
        live: true,
        vehicles: veh.length,
        avgSpeedKmh: Number((avgMs * 3.6).toFixed(1)),
        stopped: veh.filter((v) => (v.speed ?? 0) < 0.6).length,
        busyRoads: roads.filter((r) => r.density >= 0.35).length,
        heavyJunctions: junctions.filter((j) => j.load >= 0.5).length,
        roads,
        junctions,
        updatedAt: sumo.updatedAt,
      };
    }

    const roads = SEGMENTS.map((seg) => {
      const base = hash01(seg.id);
      const pulse = 0.55 + 0.45 * Math.sin(t * 0.35 + base * 7);
      const density = 0.06 + base * 0.82 * pulse;
      return {
        id: seg.id,
        label: seg.label,
        axis: seg.axis,
        density,
        count: Math.round(density * 6),
      };
    }).sort((a, b) => b.density - a.density);

    const junctions = JUNCTIONS.map((j) => {
      const h = hash01(j.id);
      const pulse = 0.6 + 0.4 * Math.sin(t * 0.4 + h * 5);
      const load = 0.05 + h * 0.9 * pulse;
      return {
        id: j.id,
        label: j.id,
        load,
        count: Math.max(0, Math.round(load * 10)),
      };
    }).sort((a, b) => b.load - a.load);

    const vehicles = 42 + Math.round(8 * Math.sin(t * 0.4));
    return {
      live: false,
      vehicles,
      avgSpeedKmh: Number((22 + Math.sin(t * 0.5) * 4).toFixed(1)),
      stopped: Math.round(vehicles * 0.18),
      busyRoads: roads.filter((r) => r.density >= 0.35).length,
      heavyJunctions: junctions.filter((j) => j.load >= 0.5).length,
      roads,
      junctions,
      updatedAt: t,
    };
  }, [sumo.live, sumo.updatedAt, sumo.vehicles, tick]);
}
