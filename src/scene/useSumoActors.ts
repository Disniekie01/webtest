import { useEffect, useState } from "react";
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

type Listener = (s: SumoActorsSnapshot) => void;

/** One shared Kit TraCI poll for every layer / metrics hook. */
const actorsBus = {
  snap: EMPTY as SumoActorsSnapshot,
  listeners: new Set<Listener>(),
  failStreak: 0,
  timer: 0 as number,
  inFlight: false,
  refs: 0,
  pollMs: 150,

  publish(s: SumoActorsSnapshot) {
    this.snap = s;
    this.listeners.forEach((l) => l(s));
  },

  async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
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
      const updatedAt = Number(data.updatedAt || 0);
      const age = Date.now() / 1000 - updatedAt;
      const live = updatedAt > 0 && age < 3.5;
      this.failStreak = 0;
      this.publish({
        live,
        span_m: Number(data.span_m) || CITY_SPAN_M,
        vehicles: Array.isArray(data.vehicles) ? data.vehicles : [],
        pedestrians: Array.isArray(data.pedestrians) ? data.pedestrians : [],
        lights: normalizeLights(data.lights),
        updatedAt,
      });
    } catch {
      this.failStreak += 1;
      if (this.failStreak > 2 && this.snap.live) {
        this.publish({ ...EMPTY });
      }
    } finally {
      this.inFlight = false;
    }
  },

  ensure() {
    if (this.timer) return;
    void this.tick();
    this.timer = window.setInterval(() => void this.tick(), this.pollMs);
  },

  release() {
    if (this.refs > 0) return;
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  },
};

/** Poll Kit TraCI mirror — shared singleton (same SUMO that drives Isaac actors). */
export function useSumoActors(_pollMs = 150): SumoActorsSnapshot {
  const [snap, setSnap] = useState<SumoActorsSnapshot>(() => actorsBus.snap);

  useEffect(() => {
    const listener: Listener = (s) => setSnap(s);
    actorsBus.listeners.add(listener);
    actorsBus.refs += 1;
    actorsBus.ensure();
    setSnap(actorsBus.snap);
    return () => {
      actorsBus.listeners.delete(listener);
      actorsBus.refs = Math.max(0, actorsBus.refs - 1);
      actorsBus.release();
    };
  }, []);

  return snap;
}

/** Imperative read for non-React callers (badges, health). */
export function getSumoActorsSnap() {
  return actorsBus.snap;
}
