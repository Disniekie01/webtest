import { useEffect, useMemo, useState } from "react";
import cityMapJson from "../../data/cityMap2d.json";
import { JUNCTION_XS, mainJunctions } from "../../data/cityGrid";
import { useSumoActors, type SumoActor } from "../../scene/useSumoActors";

type SidewalkRibbon = {
  x: number;
  z: number;
  w: number;
  h: number;
  dir: string;
};

export type WalkSegMetric = {
  id: string;
  label: string;
  density: number;
  count: number;
};

export type PlazaMetric = {
  id: string;
  label: string;
  load: number;
  count: number;
};

export type PedestrianMetrics = {
  live: boolean;
  pedestrians: number;
  avgSpeedKmh: number;
  crowdedWalks: number;
  densePlazas: number;
  walks: WalkSegMetric[];
  plazas: PlazaMetric[];
  updatedAt: number;
};

type WalkSeg = {
  id: string;
  label: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
};

function hash01(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

function ribbons(): SidewalkRibbon[] {
  return (cityMapJson as { sidewalk_ribbons?: SidewalkRibbon[] }).sidewalk_ribbons ?? [];
}

function buildWalkSegs(): WalkSeg[] {
  const out: WalkSeg[] = [];
  const col = ["A", "B", "C", "D", "E"];
  for (const r of ribbons()) {
    if (r.dir === "NS") {
      const x = r.x + r.w / 2;
      for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
        const z0 = JUNCTION_XS[i];
        const z1 = JUNCTION_XS[i + 1];
        const cz = (z0 + z1) / 2;
        if (cz < r.z || cz > r.z + r.h) continue;
        out.push({
          id: `ns-${Math.round(x)}-${z0}`,
          label: `NS ${col[Math.max(0, Math.min(4, Math.round((x + 80) / 40)))]}${i}`,
          cx: x,
          cz,
          w: r.w * 0.92,
          d: 32,
        });
      }
    } else {
      const z = r.z + r.h / 2;
      for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
        const x0 = JUNCTION_XS[i];
        const x1 = JUNCTION_XS[i + 1];
        const cx = (x0 + x1) / 2;
        if (cx < r.x || cx > r.x + r.w) continue;
        out.push({
          id: `ew-${Math.round(z)}-${x0}`,
          label: `EW ${col[i]}${Math.max(0, Math.min(4, Math.round((z + 80) / 40)))}`,
          cx,
          cz: z,
          w: 32,
          d: r.h * 0.92,
        });
      }
    }
  }
  return out;
}

const SEGS = buildWalkSegs();
const JUNCTIONS = mainJunctions();

function humans(peds: SumoActor[]) {
  return peds.filter((p) => p.cls !== "robot");
}

function segStats(seg: WalkSeg, peds: SumoActor[]) {
  let n = 0;
  for (const p of peds) {
    if (Math.abs(p.x - seg.cx) > seg.w * 0.55) continue;
    if (Math.abs(p.z - seg.cz) > seg.d * 0.55) continue;
    n += 1;
  }
  return { density: Math.min(1, n / 6), count: n };
}

function plazaStats(jx: number, jz: number, peds: SumoActor[]) {
  let n = 0;
  for (const p of peds) {
    if (Math.hypot(p.x - jx, p.z - jz) < 12) n += 1;
  }
  return { load: Math.min(1, n / 10), count: n };
}

export function crowdLabel(load: number): string {
  if (load < 0.25) return "quiet";
  if (load < 0.5) return "active";
  if (load < 0.75) return "crowded";
  return "dense";
}

export function crowdTone(load: number): "ok" | "warn" | "hot" | "crit" {
  if (load < 0.25) return "ok";
  if (load < 0.5) return "warn";
  if (load < 0.75) return "hot";
  return "crit";
}

export function usePedestrianMetrics(tickMs = 500): PedestrianMetrics {
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
      const peds = humans(sumo.pedestrians);
      const speeds = peds.map((p) => p.speed ?? 1.2);
      const avgMs =
        speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 1.2;
      const walks = SEGS.map((seg) => {
        const s = segStats(seg, peds);
        return { id: seg.id, label: seg.label, ...s };
      }).sort((a, b) => b.density - a.density);

      const plazas = JUNCTIONS.map((j) => {
        const s = plazaStats(j.x, j.z, peds);
        return { id: j.id, label: j.id, ...s };
      }).sort((a, b) => b.load - a.load);

      return {
        live: true,
        pedestrians: peds.length,
        avgSpeedKmh: Number((avgMs * 3.6).toFixed(1)),
        crowdedWalks: walks.filter((w) => w.density >= 0.35).length,
        densePlazas: plazas.filter((p) => p.load >= 0.5).length,
        walks,
        plazas,
        updatedAt: sumo.updatedAt,
      };
    }

    const walks = SEGS.map((seg) => {
      const base = hash01(seg.id);
      const pulse = 0.55 + 0.45 * Math.sin(t * 0.4 + base * 6);
      const density = 0.08 + base * 0.75 * pulse;
      return {
        id: seg.id,
        label: seg.label,
        density,
        count: Math.round(density * 7),
      };
    }).sort((a, b) => b.density - a.density);

    const plazas = JUNCTIONS.map((j) => {
      const h = hash01(`p-${j.id}`);
      const pulse = 0.6 + 0.4 * Math.sin(t * 0.45 + h * 5);
      const load = 0.05 + h * 0.85 * pulse;
      return {
        id: j.id,
        label: j.id,
        load,
        count: Math.round(load * 12),
      };
    }).sort((a, b) => b.load - a.load);

    const pedestrians = 86 + Math.round(14 * Math.sin(t * 0.35));
    return {
      live: false,
      pedestrians,
      avgSpeedKmh: Number((4.2 + Math.sin(t * 0.5) * 0.6).toFixed(1)),
      crowdedWalks: walks.filter((w) => w.density >= 0.35).length,
      densePlazas: plazas.filter((p) => p.load >= 0.5).length,
      walks,
      plazas,
      updatedAt: t,
    };
  }, [sumo.live, sumo.updatedAt, sumo.pedestrians, tick]);
}
