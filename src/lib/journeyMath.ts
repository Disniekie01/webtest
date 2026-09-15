import type { JourneyDoc } from "../data/types";
import {
  getStreetRoute,
  offsetRoute,
  sampleRoute,
  xzToPos,
  SIDEWALK_Y,
  type XZ,
} from "./streetRoutes";

export type PathPoint = {
  t: number;
  pos: [number, number, number];
  beat?: string;
  comfort?: number;
  label?: string;
  stopIndex: number;
};

function densify(route: XZ[], every = 3.5): XZ[] {
  if (route.length < 2) return route;
  const out: XZ[] = [route[0]];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / every));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
  }
  return out;
}

/** Build timed path from street route + journey beat metadata. */
export function buildTimeline(
  journey: JourneyDoc,
  speedMps = 1.3,
  personId?: string,
): PathPoint[] {
  const stops = journey.stops || [];
  if (!stops.length) return [];

  const route = densify(getStreetRoute(personId || journey.person_id));
  const samples = sampleRoute(route, stops.length);

  const pts: PathPoint[] = [];
  let t = 0;
  let prev = xzToPos(samples[0]);
  pts.push({
    t: 0,
    pos: prev,
    beat: stops[0].beat,
    comfort: stops[0].comfort,
    label: stops[0].label,
    stopIndex: 0,
  });

  for (let i = 1; i < stops.length; i++) {
    const cur = xzToPos(samples[i] || samples[samples.length - 1]);
    const dist = Math.hypot(cur[0] - prev[0], cur[2] - prev[2]);
    t += Math.max(dist / speedMps, 0.5);
    pts.push({
      t,
      pos: cur,
      beat: stops[i].beat,
      comfort: stops[i].comfort,
      label: stops[i].label,
      stopIndex: i,
    });
    const hold = Number(stops[i].hold_s || 0);
    if (hold > 0) {
      t += hold;
      pts.push({
        t,
        pos: cur,
        beat: stops[i].beat,
        comfort: stops[i].comfort,
        label: stops[i].label,
        stopIndex: i,
      });
    }
    prev = cur;
  }
  return pts;
}

export function sampleTimeline(
  pts: PathPoint[],
  timeS: number,
): {
  pos: [number, number, number];
  beat?: string;
  comfort?: number;
  label?: string;
  stopIndex: number;
  done: boolean;
} {
  if (!pts.length) {
    return { pos: [0, SIDEWALK_Y, 0], stopIndex: 0, done: true };
  }
  if (timeS <= pts[0].t) return { ...pts[0], done: false };
  const last = pts[pts.length - 1];
  if (timeS >= last.t) return { ...last, done: true };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (timeS >= a.t && timeS <= b.t) {
      const u = (timeS - a.t) / Math.max(b.t - a.t, 1e-6);
      return {
        pos: [
          a.pos[0] + (b.pos[0] - a.pos[0]) * u,
          a.pos[1] + (b.pos[1] - a.pos[1]) * u,
          a.pos[2] + (b.pos[2] - a.pos[2]) * u,
        ],
        beat: u < 0.5 ? a.beat : b.beat,
        comfort: u < 0.5 ? a.comfort : b.comfort,
        label: u < 0.5 ? a.label : b.label,
        stopIndex: u < 0.5 ? a.stopIndex : b.stopIndex,
        done: false,
      };
    }
  }
  return { ...last, done: true };
}

export function robotKeyframes(
  journey: JourneyDoc,
  personId?: string,
  speedMps = 2.4,
): PathPoint[] {
  const stops = journey.stops || [];
  const hasRobot = stops.some((s) => s.spawn_robot || s.move_robot_to);
  if (!hasRobot) return [];

  const route = densify(
    offsetRoute(getStreetRoute(personId || journey.person_id), 1.8),
  );
  // Robot appears when first spawn_robot stop is reached
  let startIdx = stops.findIndex((s) => s.spawn_robot);
  if (startIdx < 0) startIdx = 0;
  const samples = sampleRoute(route, stops.length);
  const pts: PathPoint[] = [];
  let t = 0;
  let prev = xzToPos(samples[startIdx] || samples[0], 0.02);
  pts.push({ t: 0, pos: prev, stopIndex: startIdx, label: "spawn" });

  for (let i = startIdx + 1; i < stops.length; i++) {
    if (!stops[i].move_robot_to && !stops[i].spawn_robot && i < stops.length - 1) {
      // still advance along route for continuity
    }
    const cur = xzToPos(samples[i] || samples[samples.length - 1], 0.02);
    const dist = Math.hypot(cur[0] - prev[0], cur[2] - prev[2]);
    t += Math.max(dist / speedMps, 0.35);
    pts.push({ t, pos: cur, stopIndex: i, label: "move" });
    prev = cur;
  }
  return pts;
}

export function pathPositions(
  journey: JourneyDoc,
  personId?: string,
): [number, number, number][] {
  const route = densify(getStreetRoute(personId || journey.person_id), 2.5);
  return route.map((xz) => xzToPos(xz));
}

export function replanRibbon(
  primary: [number, number, number][],
  enabled: boolean,
): [number, number, number][] {
  if (!enabled || primary.length < 3) return [];
  // For Noor-style: show the south swing as amber dashed (already in route);
  // synthesize an "abandoned straight" ghost path for contrast.
  const ghost = primary.map((p, i) => {
    const u = i / (primary.length - 1);
    return [p[0], p[1] + 0.05, primary[0][2] + (primary[primary.length - 1][2] - primary[0][2]) * u] as [
      number,
      number,
      number,
    ];
  });
  return ghost;
}

export function comfortColor(score: number): string {
  if (score < 0.25) return "#c45c4a";
  if (score < 0.45) return "#d4a15a";
  if (score < 0.65) return "#9aa8a6";
  if (score < 0.85) return "#5eb8b0";
  return "#7ec8c0";
}

/** @deprecated kept for any CARLA leftover callers */
export function carlaToLocal(p: { x: number; y: number; z: number }): [number, number, number] {
  return [(p.x + 170) * 0.45, SIDEWALK_Y, (p.y - 523) * 0.45];
}

export function stopLocal(stop: { location: { x: number; y: number; z: number } }): [number, number, number] {
  return carlaToLocal(stop.location);
}
