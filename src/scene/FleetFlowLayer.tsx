import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { useAscStore } from "../state/ascStore";
import { useSumoActors, type SumoActor } from "./useSumoActors";
import { RobotAgent } from "./Agents";
import { HtmlLabel } from "./HtmlLabel";
import {
  createFleetBots,
  positionOnPath,
  progressIndex,
  stepFleetBot,
  syncLiveBot,
  type FleetBotState,
} from "./fleetMissions";

export type { FleetBotState };

const ROUTE_Y = 0.35;
const MARK_Y = 0.05;

function StopMarker({
  position,
  kind,
  label,
  showLabel = true,
}: {
  position: [number, number, number];
  kind: "pickup" | "dropoff";
  label: string;
  showLabel?: boolean;
}) {
  const color = kind === "pickup" ? "#5eb8b0" : "#e0a05a";
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.35, 0.45, 0.12, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 0.9, 8]} />
        <meshStandardMaterial color="#2a3238" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={2}>
        <ringGeometry args={[0.7, 1.15, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {showLabel && (
        <HtmlLabel distanceFactor={36} maxDist={70} position={[0, 1.6, 0]}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#eef2f0",
              background: "rgba(10,14,18,0.82)",
              border: `1px solid ${color}`,
              padding: "2px 7px",
              borderRadius: 6,
              whiteSpace: "nowrap",
            }}
          >
            {kind === "pickup" ? "P · " : "D · "}
            {label}
          </div>
        </HtmlLabel>
      )}
    </group>
  );
}

function RobotHighlight({
  position,
  name,
  policy,
  phase,
  showLabel = true,
}: {
  position: [number, number, number];
  name: string;
  policy: string;
  phase: FleetBotState["phase"];
  showLabel?: boolean;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const color =
    phase === "to_pickup" || phase === "loading"
      ? "#5eb8b0"
      : phase === "to_dropoff" || phase === "unloading"
        ? "#e0a05a"
        : "#8a9aa0";
  const phaseTxt =
    phase === "to_pickup"
      ? "→ pickup"
      : phase === "loading"
        ? "loading"
        : phase === "to_dropoff"
          ? "→ dropoff"
          : "unloading";

  useFrame((state) => {
    if (!ring.current) return;
    const pulse = phase === "loading" || phase === "unloading" ? 3.5 : 2.4;
    const s = 1 + Math.sin(state.clock.elapsedTime * pulse) * 0.1;
    ring.current.scale.setScalar(s);
  });

  return (
    <group position={position}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} renderOrder={3}>
        <ringGeometry args={[1.1, 1.55, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.55}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 1.8, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 2.2, 6]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 3.0, 0]}>
        <sphereGeometry args={[0.18, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
      </mesh>
      {showLabel && (
        <HtmlLabel distanceFactor={34} maxDist={80} position={[0, 3.5, 0]}>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 11,
              color: "#eef2f0",
              background: "rgba(10,14,18,0.82)",
              border: `1px solid ${color}`,
              padding: "3px 8px",
              borderRadius: 6,
              whiteSpace: "nowrap",
            }}
          >
            <strong style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{name}</strong>
            <span style={{ opacity: 0.7, marginLeft: 6, fontSize: 10 }}>
              {phaseTxt} · {policy}
            </span>
          </div>
        </HtmlLabel>
      )}
    </group>
  );
}

function MissionRoute({ bot, showLabels }: { bot: FleetBotState; showLabels: boolean }) {
  const idx = progressIndex(bot.path, bot.progress);
  const done = bot.path.slice(0, Math.max(1, idx + 1));
  const todo = bot.path.slice(Math.max(0, idx));
  const donePts = done.map(([x, z]) => [x, ROUTE_Y, z] as [number, number, number]);
  const todoPts = todo.map(([x, z]) => [x, ROUTE_Y, z] as [number, number, number]);

  return (
    <group>
      {donePts.length >= 2 && (
        <Line points={donePts} color="#5eb8b0" lineWidth={2.2} transparent opacity={0.85} />
      )}
      {todoPts.length >= 2 && (
        <Line
          points={todoPts}
          color="#e0a05a"
          lineWidth={2}
          dashed
          dashSize={1.2}
          gapSize={0.7}
          transparent
          opacity={0.7}
        />
      )}
      <StopMarker
        position={[bot.pickup.x, MARK_Y, bot.pickup.z]}
        kind="pickup"
        label={bot.pickup.label}
        showLabel={showLabels}
      />
      <StopMarker
        position={[bot.dropoff.x, MARK_Y, bot.dropoff.z]}
        kind="dropoff"
        label={bot.dropoff.label}
        showLabel={showLabels}
      />
    </group>
  );
}

/**
 * Dynamic fleet layer — bots loop pickup → load → dropoff → unload → new mission.
 * Live SUMO robots are highlighted and retargeted to the same mission loop.
 */
export function FleetFlowLayer() {
  const on = useAscStore((s) => s.activeLayers.includes("robots"));
  const sumo = useSumoActors(200);
  const botsRef = useRef<FleetBotState[]>(createFleetBots(6));
  const [, setTick] = useState(0);
  const completedRef = useRef(0);
  const uiAccum = useRef(0);

  const liveBots = useMemo(() => {
    if (!sumo.live) return [] as SumoActor[];
    return sumo.pedestrians.filter((p) => p.cls === "robot").slice(0, 8);
  }, [sumo.live, sumo.pedestrians, sumo.updatedAt]);

  useEffect(() => {
    if (!on) return;
    // Seed fresh missions when layer turns on
    botsRef.current = createFleetBots(Math.max(6, liveBots.length || 6));
    completedRef.current = 0;
    setTick((n) => n + 1);
  }, [on]);

  useFrame((_, dt) => {
    if (!on) return;
    const bots = botsRef.current;
    const clamped = Math.min(dt, 0.05);

    // Ensure we have a mission slot per live bot
    while (liveBots.length > 0 && bots.length < liveBots.length) {
      bots.push(...createFleetBots(1).map((b, i) => ({ ...b, id: `fleet_live_${bots.length + i}` })));
    }

    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      const live = liveBots[i];
      if (live) {
        syncLiveBot(bot, live.x, live.z);
        // Still advance dwell timers for load/unload → new missions
        if (bot.phase === "loading" || bot.phase === "unloading") {
          if (stepFleetBot(bot, clamped)) completedRef.current += 1;
        }
      } else if (stepFleetBot(bot, clamped)) {
        completedRef.current += 1;
      }
    }

    // ~12 Hz React refresh for routes / metrics (sim still runs at frame rate)
    uiAccum.current += clamped;
    if (uiAccum.current >= 1 / 12) {
      uiAccum.current = 0;
      setTick((n) => n + 1);
    }
  });

  // Publish snapshot for metrics panel (throttled via tick)
  useEffect(() => {
    if (!on) {
      fleetBus.publish(null);
      return;
    }
    fleetBus.publish({
      live: sumo.live,
      completed: completedRef.current,
      bots: botsRef.current.map((b) => ({
        ...b,
        pickup: { ...b.pickup },
        dropoff: { ...b.dropoff },
        path: b.path.map((p) => [...p] as [number, number]),
      })),
    });
  });

  if (!on) return null;

  const bots = botsRef.current;

  return (
    <group>
      {bots.map((bot, i) => {
        const live = liveBots[i];
        const xz = live
          ? ([live.x, live.z] as [number, number])
          : bot.phase === "loading"
            ? ([bot.pickup.x, bot.pickup.z] as [number, number])
            : bot.phase === "unloading"
              ? ([bot.dropoff.x, bot.dropoff.z] as [number, number])
              : positionOnPath(bot.path, bot.progress);
        const pos: [number, number, number] = [xz[0], 0, xz[1]];
        return (
          <group key={bot.id}>
            <MissionRoute bot={bot} showLabels={i < 3} />
            <RobotHighlight
              position={pos}
              name={bot.name}
              policy={bot.policy}
              phase={bot.phase}
              showLabel={i < 3}
            />
            {!sumo.live && <RobotAgent position={pos} kind={bot.kind} />}
          </group>
        );
      })}
    </group>
  );
}

/** Tiny pub/sub so the metrics panel can read live fleet state without prop drilling. */
type FleetSnap = {
  live: boolean;
  completed: number;
  bots: FleetBotState[];
};

type Listener = (s: FleetSnap | null) => void;

export const fleetBus = {
  snap: null as FleetSnap | null,
  listeners: new Set<Listener>(),
  publish(s: FleetSnap | null) {
    this.snap = s;
    this.listeners.forEach((l) => l(s));
  },
  subscribe(l: Listener) {
    this.listeners.add(l);
    l(this.snap);
    return () => {
      this.listeners.delete(l);
    };
  },
};

/** Keep buildFleetMissions export for any legacy imports. */
export function buildFleetMissions() {
  return createFleetBots(6).map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    policy: b.policy,
    task: b.task,
    path: b.path,
    pickupIdx: 0,
    dropoffIdx: b.path.length - 1,
  }));
}
