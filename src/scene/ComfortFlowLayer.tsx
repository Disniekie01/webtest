import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { getScenario, useAscStore } from "../state/ascStore";
import { useSumoActors } from "./useSumoActors";
import {
  buildComfortGrid,
  comfortBand,
  comfortColor,
  countPedsPerCell,
  depositsFromDrafts,
  liveComfortBreakdown,
  mockPedPositions,
  scenarioCellToWorld,
  type ComfortBand,
  type ComfortCell,
} from "./comfortHeat";

type ZoneSnap = {
  id: string;
  score: number;
  band: ComfortBand;
  peopleAvg: number;
  congestion: number;
  pedCount: number;
  x: number;
  z: number;
};

type PersonaSnap = {
  name: string;
  score: number;
  band: ComfortBand;
};

type ComfortSnap = {
  district: number;
  band: ComfortBand;
  calmPct: number;
  stressPct: number;
  avgCongestion: number;
  avoidZones: number;
  trending: "rising" | "falling" | "steady";
  zones: ZoneSnap[];
  personas: PersonaSnap[];
};

type Listener = (s: ComfortSnap | null) => void;

export const comfortBus = {
  snap: null as ComfortSnap | null,
  listeners: new Set<Listener>(),
  publish(s: ComfortSnap | null) {
    this.snap = s;
    this.listeners.forEach((l) => l(s));
  },
  subscribe(l: Listener) {
    this.listeners.add(l);
    l(this.snap);
    return () => this.listeners.delete(l);
  },
};

function HeatTile({ cell, score }: { cell: ComfortCell; score: number }) {
  const color = comfortColor(score);
  const opacity = 0.14 + (1 - score) * 0.4;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cell.x, 0.15, cell.z]} renderOrder={2}>
      <planeGeometry args={[cell.hs * 2.05, cell.hs * 2.05]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function PersonaBeacon({
  x,
  z,
  name,
  score,
}: {
  x: number;
  z: number;
  name: string;
  score: number;
}) {
  const color = comfortColor(score);
  return (
    <group position={[x, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.18, 0]}>
        <ringGeometry args={[2.2, 2.9, 28]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.45}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <Html distanceFactor={40} position={[0, 3.2, 0]} center style={{ pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontSize: 10,
            color: "#eef2f0",
            background: "rgba(8,12,14,0.84)",
            border: `1px solid ${color}`,
            padding: "2px 7px",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          {name.split(" ")[0]}
          <span style={{ color, marginLeft: 6 }}>{Math.round(score * 100)}</span>
        </div>
      </Html>
    </group>
  );
}

/**
 * Comfort heat = people avg in area × congestion penalty.
 * Crowded plazas (Sofia lunch) read as low robot-sendability.
 */
export function ComfortFlowLayer() {
  const on = useAscStore((s) => s.activeLayers.includes("comfort"));
  const drafts = useAscStore((s) => s.comfortDrafts);
  const scenarioId = useAscStore((s) => s.activeScenarioId);
  const scenario = getScenario(scenarioId);
  const sumo = useSumoActors(400);

  const grid = useMemo(() => buildComfortGrid(), []);
  const deposits = useMemo(() => depositsFromDrafts(drafts), [drafts]);
  const scenarioBoosts = useMemo(
    () => (scenario?.comfortCells ?? []).map(scenarioCellToWorld),
    [scenario],
  );

  const [scores, setScores] = useState(() => grid.map((c) => c.base));
  const prevDistrict = useRef(0.7);
  const uiAccum = useRef(0);

  useFrame((state, dt) => {
    if (!on) return;
    uiAccum.current += Math.min(dt, 0.05);
    if (uiAccum.current < 0.28) return;
    uiAccum.current = 0;

    const t = state.clock.elapsedTime;
    const humans = sumo.live
      ? sumo.pedestrians.filter((p) => p.cls !== "robot")
      : mockPedPositions(t);
    const pedCounts = countPedsPerCell(grid, humans);

    const breakdowns = grid.map((c, i) =>
      liveComfortBreakdown(c, deposits, pedCounts[i], scenarioBoosts),
    );
    const next = breakdowns.map((b) => b.score);
    setScores(next);

    const district = next.reduce((a, b) => a + b, 0) / next.length;
    const calmPct = Math.round((next.filter((s) => s >= 0.7).length / next.length) * 100);
    const stressPct = Math.round((next.filter((s) => s < 0.35).length / next.length) * 100);
    const avgCongestion =
      breakdowns.reduce((a, b) => a + b.congestion, 0) / Math.max(1, breakdowns.length);
    const avoidZones = breakdowns.filter((b) => b.score < 0.4 || b.congestion > 0.55).length;

    const delta = district - prevDistrict.current;
    prevDistrict.current = district;
    const trending = Math.abs(delta) < 0.004 ? "steady" : delta > 0 ? "rising" : "falling";

    const ranked = breakdowns
      .map((b, i) => ({ b, cell: grid[i] }))
      .sort((a, c) => a.b.score - c.b.score);
    const focus = [...ranked.slice(0, 3), ...ranked.slice(-2).reverse()];

    comfortBus.publish({
      district,
      band: comfortBand(district),
      calmPct,
      stressPct,
      avgCongestion,
      avoidZones,
      trending,
      zones: focus.map(({ b, cell }) => ({
        id: cell.id,
        score: b.score,
        band: comfortBand(b.score),
        peopleAvg: b.peopleAvg,
        congestion: b.congestion,
        pedCount: b.pedCount,
        x: cell.x,
        z: cell.z,
      })),
      personas: deposits.map((d) => ({
        name: d.name,
        score: d.score,
        band: comfortBand(d.score),
      })),
    });
  });

  useEffect(() => {
    if (!on) comfortBus.publish(null);
  }, [on]);

  if (!on) return null;

  return (
    <group>
      {grid.map((c, i) => (
        <HeatTile key={c.id} cell={c} score={scores[i]} />
      ))}
      {deposits.map((d) => (
        <PersonaBeacon key={d.name} x={d.x} z={d.z} name={d.name} score={d.score} />
      ))}
    </group>
  );
}
