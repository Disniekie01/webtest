import { useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { mainJunctions, STREET_W } from "../data/cityGrid";
import { useAscStore } from "../state/ascStore";
import { useSumoActors, type TrafficLightState } from "./useSumoActors";

const POLE_H = 5.2;
const HEAD_Y = 4.6;
const CORNER = STREET_W * 0.72;

type Approach = "ns" | "ew";
type Lamp = "G" | "Y" | "R";

type PoleSpec = {
  key: string;
  jid: string;
  x: number;
  z: number;
  approach: Approach;
  yaw: number;
};

function polesForJunction(id: string, jx: number, jz: number): PoleSpec[] {
  return [
    { key: `${id}-n`, jid: id, x: jx + CORNER, z: jz + CORNER, approach: "ns", yaw: Math.PI },
    { key: `${id}-s`, jid: id, x: jx - CORNER, z: jz - CORNER, approach: "ns", yaw: 0 },
    { key: `${id}-e`, jid: id, x: jx + CORNER, z: jz - CORNER, approach: "ew", yaw: -Math.PI / 2 },
    { key: `${id}-w`, jid: id, x: jx - CORNER, z: jz + CORNER, approach: "ew", yaw: Math.PI / 2 },
  ];
}

/** SUMO-like cycle: NS 42s green + 3s yellow, EW 42s + 3s yellow. */
export function phaseAt(tSec: number, offsetSec = 0): { ns: Lamp; ew: Lamp } {
  const cycle = 90;
  const u = ((tSec + offsetSec) % cycle + cycle) % cycle;
  if (u < 42) return { ns: "G", ew: "R" };
  if (u < 45) return { ns: "Y", ew: "R" };
  if (u < 87) return { ns: "R", ew: "G" };
  return { ns: "R", ew: "Y" };
}

function lampColor(state: Lamp, which: Lamp): string {
  if (state !== which) return "#1a1e22";
  if (which === "G") return "#3dcf7a";
  if (which === "Y") return "#e0b34a";
  return "#e05545";
}

function SignalHead({ state }: { state: Lamp }) {
  const lamps: Lamp[] = ["R", "Y", "G"];
  return (
    <group position={[0, 0, 0.12]}>
      <mesh>
        <boxGeometry args={[0.28, 0.85, 0.22]} />
        <meshStandardMaterial color="#1c2228" roughness={0.55} metalness={0.25} />
      </mesh>
      {lamps.map((which, i) => (
        <mesh key={which} position={[0, 0.28 - i * 0.28, 0.08]}>
          <sphereGeometry args={[0.09, 10, 10]} />
          <meshStandardMaterial
            color={lampColor(state, which)}
            emissive={state === which ? lampColor(state, which) : "#000000"}
            emissiveIntensity={state === which ? 1.35 : 0}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  );
}

function TrafficPole({ spec, state }: { spec: PoleSpec; state: Lamp }) {
  return (
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.yaw, 0]}>
      <mesh position={[0, POLE_H / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.09, POLE_H, 8]} />
        <meshStandardMaterial color="#3a4248" roughness={0.7} metalness={0.35} />
      </mesh>
      <mesh position={[0, HEAD_Y, 0.05]}>
        <boxGeometry args={[0.12, 0.12, 0.35]} />
        <meshStandardMaterial color="#2a3238" roughness={0.6} />
      </mesh>
      <group position={[0, HEAD_Y, 0.22]}>
        <SignalHead state={state} />
      </group>
    </group>
  );
}

function resolvePhase(
  jid: string,
  jx: number,
  jz: number,
  tSec: number,
  liveMap: Map<string, TrafficLightState>,
): { ns: Lamp; ew: Lamp } {
  const live = liveMap.get(jid);
  if (live) return { ns: live.ns, ew: live.ew };
  const off = (Math.abs(jx) + Math.abs(jz)) * 0.04;
  return phaseAt(tSec, off);
}

/**
 * Traffic lights at the 5×5 SUMO junctions.
 * Live Kit TraCI states when present; otherwise a timed mock cycle.
 */
export function TrafficLights() {
  const on = useAscStore((s) => s.activeLayers.includes("traffic"));
  const sumo = useSumoActors(500);
  const junctions = useMemo(() => mainJunctions(), []);
  const poles = useMemo(
    () => junctions.flatMap((j) => polesForJunction(j.id, j.x, j.z)),
    [junctions],
  );
  const liveMap = useMemo(() => {
    const m = new Map<string, TrafficLightState>();
    for (const tl of sumo.lights ?? []) m.set(tl.id, tl);
    return m;
  }, [sumo.lights, sumo.updatedAt]);

  const [tSec, setTSec] = useState(0);
  const last = useMemo(() => ({ t: 0 }), []);
  useFrame((state) => {
    if (!on) return;
    if (state.clock.elapsedTime - last.t < 0.2) return;
    last.t = state.clock.elapsedTime;
    setTSec(state.clock.elapsedTime);
  });

  if (!on) return null;

  const jPhase = new Map<string, { ns: Lamp; ew: Lamp }>();
  for (const j of junctions) {
    jPhase.set(j.id, resolvePhase(j.id, j.x, j.z, tSec, liveMap));
  }

  return (
    <group>
      {poles.map((p) => {
        const ph = jPhase.get(p.jid) ?? { ns: "R" as const, ew: "R" as const };
        const state = p.approach === "ns" ? ph.ns : ph.ew;
        return <TrafficPole key={p.key} spec={p} state={state} />;
      })}
    </group>
  );
}
