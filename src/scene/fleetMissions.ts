import { JUNCTION_XS } from "../data/cityGrid";

export type CurbStop = {
  id: string;
  x: number;
  z: number;
  label: string;
};

export type FleetBotState = {
  id: string;
  name: string;
  kind: string;
  policy: string;
  task: string;
  pickup: CurbStop;
  dropoff: CurbStop;
  path: [number, number][];
  /** 0..1 along path */
  progress: number;
  phase: "to_pickup" | "loading" | "to_dropoff" | "unloading";
  phaseT: number;
  speed: number;
};

const POLICIES = ["proceed", "reroute", "stagger", "hold", "slow"] as const;
const TASKS = [
  "Pharmacy parcel",
  "Grocery tote",
  "Document pouch",
  "Hot meal bag",
  "Lab sample",
  "Retail restock",
  "Accessibility assist kit",
  "Hub transfer crate",
];

const NAMES = [
  "Harbor Runner",
  "Edge Walker",
  "Hub Courier",
  "Plaza Scout",
  "Curb Hopper",
  "Block Flyer",
  "Lane Keeper",
  "Dock Runner",
];

function hash01(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

function curb(x: number, z: number, side: "n" | "s" | "e" | "w"): [number, number] {
  if (side === "n") return [x + 5.5, z];
  if (side === "s") return [x - 5.5, z];
  if (side === "e") return [x, z + 5.5];
  return [x, z - 5.5];
}

/** All curb pickup/dropoff nodes on the 5×5 grid. */
export function buildCurbStops(): CurbStop[] {
  const sides: Array<"n" | "s" | "e" | "w"> = ["n", "s", "e", "w"];
  const out: CurbStop[] = [];
  let n = 0;
  for (const x of JUNCTION_XS) {
    for (const z of JUNCTION_XS) {
      const side = sides[n % 4];
      const [cx, cz] = curb(x, z, side);
      out.push({
        id: `stop-${n}`,
        x: cx,
        z: cz,
        label: `${side.toUpperCase()}${Math.round((x + 80) / 40)}${Math.round((z + 80) / 40)}`,
      });
      n += 1;
    }
  }
  return out;
}

const STOPS = buildCurbStops();

/** Manhattan sidewalk path hugging junction corridors between two curb points. */
export function routeBetween(a: CurbStop, b: CurbStop): [number, number][] {
  const path: [number, number][] = [[a.x, a.z]];
  // Snap to nearest junction axes for a readable L / Z route
  const ax = nearestJunction(a.x);
  const az = nearestJunction(a.z);
  const bx = nearestJunction(b.x);
  const bz = nearestJunction(b.z);

  // Prefer curb-offset along axes
  const mid1: [number, number] = [a.x, az];
  const mid2: [number, number] = [bx, az];
  const mid3: [number, number] = [bx, b.z];

  const push = (p: [number, number]) => {
    const last = path[path.length - 1];
    if (Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.8) path.push(p);
  };

  // If mostly same corridor, keep it simple
  if (Math.abs(ax - bx) < 1) {
    push([a.x, bz]);
    push([b.x, b.z]);
  } else if (Math.abs(az - bz) < 1) {
    push([bx, a.z]);
    push([b.x, b.z]);
  } else {
    push(mid1);
    push(mid2);
    push(mid3);
    push([b.x, b.z]);
  }
  return path;
}

function nearestJunction(v: number): (typeof JUNCTION_XS)[number] {
  let best: (typeof JUNCTION_XS)[number] = JUNCTION_XS[0];
  let bestD = Infinity;
  for (const j of JUNCTION_XS) {
    const d = Math.abs(j - v);
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

function pickStop(exclude?: string, seed = Math.random()): CurbStop {
  let pool = STOPS;
  if (exclude) pool = STOPS.filter((s) => s.id !== exclude);
  const i = Math.floor(seed * pool.length) % pool.length;
  return pool[i];
}

function taskFor(drop: CurbStop, seed: number) {
  const t = TASKS[Math.floor(seed * TASKS.length) % TASKS.length];
  return `${t} — ${drop.label}`;
}

export function createFleetBots(count = 6): FleetBotState[] {
  return Array.from({ length: count }, (_, i) => {
    const seed = hash01(`fleet-${i}`);
    const pickup = pickStop(undefined, seed);
    const dropoff = pickStop(pickup.id, hash01(`drop-${i}`));
    const spawn = pickStop(pickup.id, hash01(`spawn-${i}`));
    const policy = POLICIES[i % POLICIES.length];
    const goingToDrop = seed > 0.45;
    return {
      id: `fleet_${i}`,
      name: `${NAMES[i % NAMES.length]} ${i + 1}`,
      kind: "delivery",
      policy,
      task: taskFor(dropoff, seed),
      pickup,
      dropoff,
      path: goingToDrop ? routeBetween(pickup, dropoff) : routeBetween(spawn, pickup),
      progress: 0.05 + seed * 0.4,
      phase: goingToDrop ? ("to_dropoff" as const) : ("to_pickup" as const),
      phaseT: 0,
      speed: 0.035 + seed * 0.025,
    };
  });
}

/** Advance one bot; returns true if mission rolled over. */
export function stepFleetBot(bot: FleetBotState, dt: number): boolean {
  let rolled = false;
  const dwell = 1.4;

  if (bot.phase === "loading" || bot.phase === "unloading") {
    bot.phaseT += dt;
    if (bot.phaseT >= dwell) {
      bot.phaseT = 0;
      if (bot.phase === "loading") {
        bot.phase = "to_dropoff";
        bot.progress = 0;
        bot.path = routeBetween(bot.pickup, bot.dropoff);
      } else {
        // New mission from current curb: travel to a fresh pickup, then new dropoff
        rolled = true;
        const here = bot.dropoff;
        const nextPickup = pickStop(here.id, Math.random());
        const nextDrop = pickStop(nextPickup.id, Math.random());
        bot.pickup = nextPickup;
        bot.dropoff = nextDrop;
        bot.task = taskFor(nextDrop, Math.random());
        bot.policy = POLICIES[Math.floor(Math.random() * POLICIES.length)];
        bot.path = routeBetween(here, nextPickup);
        bot.progress = 0;
        bot.phase = "to_pickup";
      }
    }
    return rolled;
  }

  // Hold policy crawls
  const spd =
    bot.policy === "hold"
      ? bot.speed * 0.15
      : bot.policy === "slow"
        ? bot.speed * 0.55
        : bot.policy === "stagger"
          ? bot.speed * (0.7 + 0.3 * Math.sin(performance.now() / 400))
          : bot.speed;

  bot.progress += spd * dt;
  if (bot.progress >= 1) {
    bot.progress = 1;
    bot.phaseT = 0;
    bot.phase = bot.phase === "to_pickup" ? "loading" : "unloading";
  }
  return rolled;
}

export function positionOnPath(path: [number, number][], t: number): [number, number] {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  const capped = Math.max(0, Math.min(0.999, t));
  // Distance-weighted
  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const len = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    segLens.push(len);
    total += len;
  }
  if (total < 1e-3) return path[0];
  let remain = capped * total;
  for (let i = 0; i < segLens.length; i++) {
    if (remain <= segLens[i]) {
      const u = segLens[i] < 1e-6 ? 0 : remain / segLens[i];
      return [
        path[i][0] + (path[i + 1][0] - path[i][0]) * u,
        path[i][1] + (path[i + 1][1] - path[i][1]) * u,
      ];
    }
    remain -= segLens[i];
  }
  return path[path.length - 1];
}

export function progressIndex(path: [number, number][], t: number): number {
  if (path.length < 2) return 0;
  return Math.round(Math.max(0, Math.min(1, t)) * (path.length - 1));
}

/** Attach / retarget a live SUMO bot toward the nearest unfinished stop. */
export function syncLiveBot(bot: FleetBotState, x: number, z: number) {
  const target = bot.phase === "to_pickup" || bot.phase === "loading" ? bot.pickup : bot.dropoff;
  const d = Math.hypot(target.x - x, target.z - z);
  // Rebuild path from current live position to target
  const from: CurbStop = { id: "live", x, z, label: "now" };
  bot.path = routeBetween(from, target);
  bot.progress = Math.max(0, Math.min(0.95, 1 - d / 120));
  if (d < 3.5 && bot.phase === "to_pickup") {
    bot.phase = "loading";
    bot.phaseT = 0;
  } else if (d < 3.5 && bot.phase === "to_dropoff") {
    bot.phase = "unloading";
    bot.phaseT = 0;
  }
}
