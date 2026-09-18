import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useAscStore } from "../state/ascStore";
import {
  aqiBand,
  aqiColor,
  bandLabel,
  buildAqCells,
  buildAqSensors,
  liveAqi,
  windAt,
  type AqBand,
  type AqCell,
} from "./aqPulse";

type CellSnap = {
  id: string;
  aqi: number;
  pulse: number;
  band: AqBand;
};

type SensorSnap = {
  id: string;
  label: string;
  aqi: number;
  band: AqBand;
};

type AqSnap = {
  districtAqi: number;
  band: AqBand;
  pm25: number;
  windDeg: number;
  windMps: number;
  hotspots: number;
  breathPhase: number;
  cells: CellSnap[];
  sensors: SensorSnap[];
};

type Listener = (s: AqSnap | null) => void;

export const aqBus = {
  snap: null as AqSnap | null,
  listeners: new Set<Listener>(),
  publish(s: AqSnap | null) {
    this.snap = s;
    this.listeners.forEach((l) => l(s));
  },
  subscribe(l: Listener) {
    this.listeners.add(l);
    l(this.snap);
    return () => this.listeners.delete(l);
  },
};

/** Flat block haze — no volumetric bloom / breath columns. */
function BlockHaze({ cell, aqi }: { cell: AqCell; aqi: number }) {
  const color = aqiColor(aqi);
  const opacity = 0.1 + (aqi / 180) * 0.28;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cell.x, 0.16, cell.z]} renderOrder={2}>
      <planeGeometry args={[cell.hw * 1.85, cell.hd * 1.85]} />
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

function SensorMote({
  x,
  z,
  label,
  aqi,
}: {
  x: number;
  z: number;
  label: string;
  aqi: number;
}) {
  const color = aqiColor(aqi);
  const band = aqiBand(aqi);

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 4.2, 0]}>
        <octahedronGeometry args={[0.55, 0]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh position={[0, 2.1, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 4, 5]} />
        <meshBasicMaterial color="#2a3438" transparent opacity={0.65} />
      </mesh>
      <Html distanceFactor={44} position={[0, 5.6, 0]} center style={{ pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontSize: 10,
            color: "#eef2f0",
            background: "rgba(8,12,14,0.82)",
            border: `1px solid ${color}`,
            padding: "2px 6px",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color, fontWeight: 600 }}>{Math.round(aqi)}</span>
          <span style={{ opacity: 0.6, marginLeft: 5 }}>{bandLabel(band)}</span>
          <span style={{ opacity: 0.4, marginLeft: 5 }}>{label.split(" ")[0]}</span>
        </div>
      </Html>
    </group>
  );
}

/**
 * AQ / Pulse — toned down: flat block haze + sensors only.
 * No wind motes, pulse rings, or breathing volumes.
 */
export function AqPulseLayer() {
  const on = useAscStore((s) => s.activeLayers.includes("activity"));
  const cells = useMemo(() => buildAqCells(), []);
  const sensors = useMemo(() => buildAqSensors(), []);

  const [aqis, setAqis] = useState(() => cells.map((c) => c.baseAqi));
  const uiAccum = useRef(0);

  useFrame((state, dt) => {
    if (!on) return;
    uiAccum.current += Math.min(dt, 0.05);
    if (uiAccum.current < 0.35) return; // ~3 Hz
    uiAccum.current = 0;

    const t = state.clock.elapsedTime;
    const w = windAt(t);
    const nextAqi = cells.map((c) => liveAqi(c.baseAqi, t, c.seed, w));
    setAqis(nextAqi);

    const district = nextAqi.reduce((a, b) => a + b, 0) / nextAqi.length;
    const hotspots = nextAqi.filter((a) => a >= 80).length;
    const sensorSnaps = sensors.map((s) => {
      let best = nextAqi[0];
      let bestD = Infinity;
      cells.forEach((c, i) => {
        const d = Math.hypot(c.x - s.x, c.z - s.z);
        if (d < bestD) {
          bestD = d;
          best = nextAqi[i];
        }
      });
      return {
        id: s.id,
        label: s.label,
        aqi: Math.round(best),
        band: aqiBand(best),
      };
    });

    aqBus.publish({
      districtAqi: Math.round(district),
      band: aqiBand(district),
      pm25: Math.round(district * 0.42),
      windDeg: Math.round(((w.heading * 180) / Math.PI + 360) % 360),
      windMps: Number((w.speed * 2.4).toFixed(1)),
      hotspots,
      breathPhase: 0.5 + 0.5 * Math.sin(t * 0.4),
      cells: cells.map((c, i) => ({
        id: c.id,
        aqi: Math.round(nextAqi[i]),
        pulse: c.pulse,
        band: aqiBand(nextAqi[i]),
      })),
      sensors: sensorSnaps,
    });
  });

  useEffect(() => {
    if (!on) aqBus.publish(null);
  }, [on]);

  if (!on) return null;

  return (
    <group>
      {cells.map((c, i) => (
        <BlockHaze key={c.id} cell={c} aqi={aqis[i]} />
      ))}
      {sensors.map((s) => {
        let best = aqis[0] ?? 40;
        let bestD = Infinity;
        cells.forEach((c, i) => {
          const d = Math.hypot(c.x - s.x, c.z - s.z);
          if (d < bestD) {
            bestD = d;
            best = aqis[i];
          }
        });
        return <SensorMote key={s.id} x={s.x} z={s.z} label={s.label} aqi={best} />;
      })}
    </group>
  );
}
