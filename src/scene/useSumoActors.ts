import { useEffect, useRef, useState } from "react";
import { CITY_SPAN_M } from "../data/twinCamera";

export type SumoActor = {
  id: string;
  x: number;
  z: number;
  y?: number;
  yaw?: number;
  /** m/s when Kit publishes TraCI speed. */
  speed?: number;
  cls?: string;
  type?: string;
};

export type TrafficLightState = {
  id: string;
  /** North–south approach lamp. */
  ns: "G" | "Y" | "R";
  /** East–west approach lamp. */
  ew: "G" | "Y" | "R";
};

export type SumoActorsSnapshot = {
  live: boolean;
  span_m: number;
  vehicles: SumoActor[];
  pedestrians: SumoActor[];
  lights: TrafficLightState[];
  updatedAt: number;
};

const EMPTY: SumoActorsSnapshot = {
  live: false,
  span_m: CITY_SPAN_M,
  vehicles: [],
  pedestrians: [],
  lights: [],
  updatedAt: 0,
};

function parseLamp(ch: string | undefined): "G" | "Y" | "R" {
  if (!ch) return "R";
  if (ch === "G" || ch === "g") return "G";
  if (ch === "Y" || ch === "y") return "Y";
  return "R";
}

/** Normalize Kit TLS payload or leave empty for mock cycle. */
function normalizeLights(raw: unknown): TrafficLightState[] {
  if (!Array.isArray(raw)) return [];
  const out: TrafficLightState[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || "");
    if (!id) continue;
    if (row.ns && row.ew) {
      out.push({
        id,
        ns: parseLamp(String(row.ns)),
        ew: parseLamp(String(row.ew)),
      });
      continue;
    }
    // Raw SUMO state string e.g. GGgrrrGGgrrr → ns from [0], ew from mid
    const state = String(row.state || "");
    if (state.length >= 2) {
      const mid = Math.floor(state.length / 2);
      out.push({
        id,
        ns: parseLamp(state[0]),
        ew: parseLamp(state[mid]),
      });
    }
  }
  return out;
}

/** Poll Kit TraCI mirror — same SUMO that drives Isaac actors. */
export function useSumoActors(pollMs = 120): SumoActorsSnapshot {
  const [snap, setSnap] = useState<SumoActorsSnapshot>(EMPTY);
  const failStreak = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/viewport/api/actors", {
          cache: "no-store",
          signal: AbortSignal.timeout(800),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          updatedAt?: number;
          span_m?: number;
          vehicles?: SumoActor[];
          pedestrians?: SumoActor[];
          lights?: unknown;
        };
        if (cancelled) return;
        const updatedAt = Number(data.updatedAt || 0);
        const age = Date.now() / 1000 - updatedAt;
        const live = updatedAt > 0 && age < 3.5;
        failStreak.current = 0;
        setSnap({
          live,
          span_m: Number(data.span_m) || CITY_SPAN_M,
          vehicles: Array.isArray(data.vehicles) ? data.vehicles : [],
          pedestrians: Array.isArray(data.pedestrians) ? data.pedestrians : [],
          lights: normalizeLights(data.lights),
          updatedAt,
        });
      } catch {
        failStreak.current += 1;
        if (!cancelled && failStreak.current > 2) {
          setSnap((s) => (s.live ? { ...EMPTY } : s));
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pollMs]);

  return snap;
}
