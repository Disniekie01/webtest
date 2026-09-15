/** Yardline-inspired clearance / TTC helpers for mock CV. */

import type { ConflictSnapshot, PairRisk, YardTrack } from "./types";

export const LEVEL_NAME = {
  0: "clear",
  1: "advisory",
  2: "warning",
  3: "critical",
} as const;

/** Constant-velocity disc TTC (simplified from Yardline risk.py). */
export function constantVelocityTtc(
  ax: number,
  ay: number,
  avx: number,
  avy: number,
  ar: number,
  bx: number,
  by: number,
  bvx: number,
  bvy: number,
  br: number,
  horizonS = 8,
  dtS = 0.1,
): { ttc: number | null; closing: boolean } {
  const r = ar + br;
  const relX = ax - bx;
  const relY = ay - by;
  const relVx = avx - bvx;
  const relVy = avy - bvy;
  const closing = relX * relVx + relY * relVy < 0;
  let t = 0;
  while (t <= horizonS + 1e-9) {
    const dx = relX + relVx * t;
    const dy = relY + relVy * t;
    if (dx * dx + dy * dy <= r * r) {
      return { ttc: t, closing };
    }
    t += dtS;
  }
  return { ttc: null, closing };
}

export function levelFromPair(distanceM: number, ttc: number | null, closing: boolean): 0 | 1 | 2 | 3 {
  if (distanceM < 1.2) return 3;
  if (ttc != null && closing && ttc < 1.5) return 3;
  if (ttc != null && closing && ttc < 3.0) return 2;
  if (distanceM < 2.5 || (ttc != null && closing && ttc < 5)) return 1;
  return 0;
}

export function buildConflict(tracks: YardTrack[]): ConflictSnapshot {
  const pairs: PairRisk[] = [];
  let alarm: 0 | 1 | 2 | 3 = 0;

  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i];
      const b = tracks[j];
      // Only care about person↔robot proximity (Yardline worker↔machine).
      const personRobot =
        (a.cls === "person" && b.cls !== "person") ||
        (b.cls === "person" && a.cls !== "person");
      if (!personRobot) continue;

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance_m = Math.hypot(dx, dy);
      const ra = a.cls === "person" ? 0.4 : 0.7;
      const rb = b.cls === "person" ? 0.4 : 0.7;
      const { ttc, closing } = constantVelocityTtc(
        a.x, a.y, a.vx, a.vy, ra,
        b.x, b.y, b.vx, b.vy, rb,
      );
      const level = levelFromPair(distance_m, ttc, closing);
      pairs.push({
        track_a: a.id,
        track_b: b.id,
        class_a: a.cls,
        class_b: b.cls,
        distance_m,
        ttc_s: ttc,
        closing,
        level,
      });
      if (level > alarm) alarm = level;
    }
  }

  return {
    tracks,
    pairs,
    alarm,
    alarm_name: LEVEL_NAME[alarm],
  };
}
