import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { HtmlLabel } from "./HtmlLabel";
import * as THREE from "three";
import { useAscStore } from "../state/ascStore";
import {
  TRANSIT_DEPTH,
  TRANSIT_LINES,
  TRANSIT_STATIONS,
  hubStations,
  liveStationLoad,
  pathPoint,
  pingPong,
  type TransitLine,
  type TransitStation,
} from "./transitNetwork";

type StationSnap = {
  id: string;
  code: string;
  name: string;
  load: number;
  dwell: boolean;
  lines: string[];
  hub?: boolean;
};

type LineSnap = {
  id: string;
  short: string;
  color: string;
  trains: number;
};

type TransitSnap = {
  trains: number;
  headwaySec: number;
  onTimePct: number;
  ridership: number;
  stations: StationSnap[];
  lines: LineSnap[];
  lineName: string;
};

type Listener = (s: TransitSnap | null) => void;

export const transitBus = {
  snap: null as TransitSnap | null,
  listeners: new Set<Listener>(),
  publish(s: TransitSnap | null) {
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

function GhostMat({
  color,
  opacity,
  emissive,
  emissiveIntensity = 0,
}: {
  color: string;
  opacity: number;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  return (
    <meshStandardMaterial
      color={color}
      transparent
      opacity={opacity}
      depthWrite={false}
      depthTest={false}
      roughness={0.55}
      metalness={0.15}
      emissive={emissive ?? color}
      emissiveIntensity={emissiveIntensity}
      side={THREE.DoubleSide}
    />
  );
}

function primaryColor(station: TransitStation) {
  const line = TRANSIT_LINES.find((l) => station.lines.includes(l.id));
  return line?.color ?? "#4aa8c8";
}

/** Surface portal + shaft; hubs show multi-line badges. */
function StationPortal({ station, load }: { station: TransitStation; load: number }) {
  const pulse = useRef<THREE.Mesh>(null);
  const color = primaryColor(station);
  const isHub = !!station.hub;

  useFrame((state) => {
    if (!pulse.current) return;
    const s = 1 + Math.sin(state.clock.elapsedTime * 2.2 + load * 4) * 0.08;
    pulse.current.scale.setScalar(s);
  });

  const y0 = 0.02;
  const yBot = TRANSIT_DEPTH.platformY;
  const platformW = isHub ? 18 : 12;
  const platformD = isHub ? 12 : 7;

  return (
    <group position={[station.x, 0, station.z]}>
      <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]} position={[0, y0, 0]} renderOrder={4}>
        <ringGeometry args={[isHub ? 2.8 : 2.2, isHub ? 3.8 : 3.1, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.35 + load * 0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {isHub && (
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} position={[0, y0 + 0.01, 0]} renderOrder={4}>
          <ringGeometry args={[1.4, 1.85, 4]} />
          <meshBasicMaterial
            color="#e8f0f2"
            transparent
            opacity={0.35}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
      <mesh position={[0, isHub ? 1.35 : 1.1, 0]}>
        <boxGeometry args={[isHub ? 3.2 : 2.4, isHub ? 2.6 : 2.2, isHub ? 3.2 : 2.4]} />
        <GhostMat color="#1a2830" opacity={0.55} emissive={color} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, isHub ? 2.8 : 2.35, 0]}>
        <boxGeometry args={[isHub ? 3.6 : 2.8, 0.25, isHub ? 3.6 : 2.8]} />
        <GhostMat color={color} opacity={0.7} emissive={color} emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, (y0 + yBot) / 2, 0]}>
        <cylinderGeometry args={[1.4, 1.6, Math.abs(yBot - y0), 16, 1, true]} />
        <GhostMat color={color} opacity={0.12} emissive={color} emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0, yBot, 0]}>
        <boxGeometry args={[platformW, isHub ? 3.8 : 3.2, platformD]} />
        <GhostMat color="#152028" opacity={0.45} emissive={color} emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, yBot + 1.4, 0]}>
        <boxGeometry args={[platformW - 2, 0.15, platformD - 2.5]} />
        <GhostMat color={color} opacity={0.5} emissive={color} emissiveIntensity={0.4} />
      </mesh>
      <HtmlLabel distanceFactor={42} maxDist={110} position={[0, isHub ? 3.8 : 3.2, 0]}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "#e8f4f8",
            background: "rgba(8,14,18,0.85)",
            border: `1px solid ${color}`,
            padding: "3px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          <strong style={{ color }}>{station.code}</strong>
          <span style={{ opacity: 0.75, marginLeft: 6 }}>{station.name}</span>
          {station.lines.length > 1 && (
            <span style={{ marginLeft: 8 }}>
              {station.lines.map((lid) => {
                const ln = TRANSIT_LINES.find((l) => l.id === lid);
                if (!ln) return null;
                return (
                  <span
                    key={lid}
                    style={{
                      display: "inline-block",
                      marginLeft: 3,
                      padding: "0 4px",
                      borderRadius: 3,
                      background: ln.color,
                      color: "#0a1014",
                      fontSize: 9,
                      fontWeight: 600,
                    }}
                  >
                    {ln.short}
                  </span>
                );
              })}
            </span>
          )}
        </div>
      </HtmlLabel>
    </group>
  );
}

/** Y-junction marker at hub — shows the split-off. */
function JunctionWye({ station }: { station: TransitStation }) {
  const y = TRANSIT_DEPTH.tunnelY;
  const colors = station.lines
    .map((id) => TRANSIT_LINES.find((l) => l.id === id)?.color)
    .filter(Boolean) as string[];

  return (
    <group position={[station.x, y, station.z]}>
      <mesh>
        <sphereGeometry args={[2.4, 16, 12]} />
        <GhostMat color="#1a2830" opacity={0.5} emissive={colors[0] ?? "#4aa8c8"} emissiveIntensity={0.2} />
      </mesh>
      {colors.map((c, i) => (
        <mesh key={c} rotation={[0, (i * Math.PI) / Math.max(1, colors.length - 1) - Math.PI / 4, 0]}>
          <boxGeometry args={[1.2, 1.2, 7]} />
          <GhostMat color={c} opacity={0.35} emissive={c} emissiveIntensity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/** Underground tunnel for one colored line. */
function TunnelRun({ line, width = 4.6 }: { line: TransitLine; width?: number }) {
  const path = line.path;
  const color = line.color;
  const y = TRANSIT_DEPTH.tunnelY;

  const pts3 = useMemo(
    () => path.map(([x, z]) => [x, y, z] as [number, number, number]),
    [path, y],
  );
  const railL = useMemo(
    () => path.map(([x, z]) => [x, y - 1.1, z - 0.9] as [number, number, number]),
    [path, y],
  );
  const railR = useMemo(
    () => path.map(([x, z]) => [x, y - 1.1, z + 0.9] as [number, number, number]),
    [path, y],
  );

  const segs = useMemo(() => {
    const out: { pos: [number, number, number]; len: number; rotY: number }[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, z0] = path[i];
      const [x1, z1] = path[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      out.push({
        pos: [(x0 + x1) / 2, y, (z0 + z1) / 2],
        len,
        rotY: Math.atan2(dx, dz),
      });
    }
    return out;
  }, [path, y]);

  const cutPts = useMemo(
    () => path.map(([x, z]) => [x, 0.04, z] as [number, number, number]),
    [path],
  );

  return (
    <group>
      {segs.map((s, i) => (
        <mesh key={i} position={s.pos} rotation={[0, s.rotY, 0]}>
          <boxGeometry args={[width, 3.8, s.len + 0.35]} />
          <GhostMat color="#0e1820" opacity={0.38} emissive={color} emissiveIntensity={0.1} />
        </mesh>
      ))}
      <Line points={pts3} color={color} lineWidth={2.6} transparent opacity={0.9} depthTest={false} />
      <Line points={railL} color="#6a8a98" lineWidth={1} transparent opacity={0.45} depthTest={false} />
      <Line points={railR} color="#6a8a98" lineWidth={1} transparent opacity={0.45} depthTest={false} />
      <Line points={cutPts} color={color} lineWidth={3.5} transparent opacity={0.2} depthTest={false} />
      {segs.map((s, i) => (
        <mesh key={`cut-${i}`} position={[s.pos[0], 0.03, s.pos[2]]} rotation={[-Math.PI / 2, 0, s.rotY]}>
          <planeGeometry args={[width * 0.85, s.len + 0.15]} />
          <meshBasicMaterial
            color="#061018"
            transparent
            opacity={0.28}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function MetroTrain({
  path,
  t,
  color,
}: {
  path: [number, number][];
  t: number;
  color: string;
}) {
  const [x, z] = pathPoint(path, t);
  const [x2, z2] = pathPoint(path, Math.min(0.999, t + 0.012));
  const yaw = Math.atan2(x2 - x, z2 - z);
  const y = TRANSIT_DEPTH.tunnelY - 0.35;

  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh>
        <boxGeometry args={[2.2, 1.7, 6.4]} />
        <GhostMat color="#1a3038" opacity={0.85} emissive={color} emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1.9, 0.32, 5.6]} />
        <GhostMat color={color} opacity={0.75} emissive={color} emissiveIntensity={0.95} />
      </mesh>
      <mesh position={[0, 0.15, 3.15]}>
        <boxGeometry args={[1.6, 1.1, 0.12]} />
        <GhostMat color="#c8e8f0" opacity={0.65} emissive="#c8e8f0" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

type TrainSlot = { lineId: string; t: number; phase: number };

/**
 * Transit layer — M1 trunk with M2 / M3 split-offs at Market & Civic hubs.
 */
export function TransitFlowLayer() {
  const on = useAscStore((s) => s.activeLayers.includes("transit"));
  const [loads, setLoads] = useState(() => TRANSIT_STATIONS.map((s) => s.baseLoad));
  const trainsRef = useRef<TrainSlot[]>([
    { lineId: "m1", t: 0.12, phase: 0 },
    { lineId: "m1", t: 0.62, phase: 0.5 },
    { lineId: "m2", t: 0.2, phase: 0.15 },
    { lineId: "m3", t: 0.35, phase: 0.3 },
  ]);
  const uiAccum = useRef(0);
  const [, setTick] = useState(0);

  useFrame((state, dt) => {
    if (!on) return;
    const elapsed = state.clock.elapsedTime;
    const clamped = Math.min(dt, 0.05);

    for (const slot of trainsRef.current) {
      const line = TRANSIT_LINES.find((l) => l.id === slot.lineId)!;
      slot.t = pingPong(elapsed, line.periodSec, slot.phase);
    }

    uiAccum.current += clamped;
    if (uiAccum.current >= 1 / 8) {
      uiAccum.current = 0;
      const nextLoads = TRANSIT_STATIONS.map((s, i) => liveStationLoad(s.baseLoad, elapsed, i * 0.37));
      setLoads(nextLoads);

      const avgLoad = nextLoads.reduce((a, b) => a + b, 0) / nextLoads.length;
      const nearStation = (s: TransitStation) =>
        trainsRef.current.some((slot) => {
          const line = TRANSIT_LINES.find((l) => l.id === slot.lineId);
          if (!line || !s.lines.includes(line.id)) return false;
          const [x, z] = pathPoint(line.path, slot.t);
          return Math.hypot(x - s.x, z - s.z) < 10;
        });

      transitBus.publish({
        trains: trainsRef.current.length,
        headwaySec: 18,
        onTimePct: Math.round(93 + Math.sin(elapsed * 0.2) * 4),
        ridership: Math.round(180 + avgLoad * 520),
        lineName: "M1 + M2 / M3 spurs",
        lines: TRANSIT_LINES.map((l) => ({
          id: l.id,
          short: l.short,
          color: l.color,
          trains: trainsRef.current.filter((t) => t.lineId === l.id).length,
        })),
        stations: TRANSIT_STATIONS.map((s, i) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          load: nextLoads[i],
          dwell: nearStation(s),
          lines: s.lines,
          hub: s.hub,
        })),
      });
      setTick((n) => n + 1);
    }
  });

  useEffect(() => {
    if (!on) transitBus.publish(null);
  }, [on]);

  if (!on) return null;

  const hubs = hubStations();

  return (
    <group>
      {TRANSIT_LINES.map((line) => (
        <TunnelRun key={line.id} line={line} width={line.id === "m1" ? 5.2 : 4.2} />
      ))}
      {hubs.map((h) => (
        <JunctionWye key={`wye-${h.id}`} station={h} />
      ))}
      {TRANSIT_STATIONS.map((s, i) => (
        <StationPortal key={s.id} station={s} load={loads[i]} />
      ))}
      {trainsRef.current.map((slot, i) => {
        const line = TRANSIT_LINES.find((l) => l.id === slot.lineId)!;
        return <MetroTrain key={i} path={line.path} t={slot.t} color={line.color} />;
      })}
    </group>
  );
}
