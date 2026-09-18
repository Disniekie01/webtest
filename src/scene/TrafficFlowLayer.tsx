import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { CITY_SPAN_M, JUNCTION_XS, STREET_W } from "../data/cityGrid";
import { useAscStore } from "../state/ascStore";
import { useSumoActors, type SumoActor } from "./useSumoActors";

const HEAT_Y = 0.24;
const RING_Y = 0.32;
const BLOCK = 40;

type RoadSeg = {
  id: string;
  axis: "ew" | "ns";
  cx: number;
  cz: number;
  length: number;
};

type JunctionLoad = {
  id: string;
  x: number;
  z: number;
  load: number;
  count: number;
};

function buildSegments(): RoadSeg[] {
  const segs: RoadSeg[] = [];
  for (const z of JUNCTION_XS) {
    for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
      const x0 = JUNCTION_XS[i];
      const x1 = JUNCTION_XS[i + 1];
      segs.push({
        id: `ew-${z}-${x0}`,
        axis: "ew",
        cx: (x0 + x1) / 2,
        cz: z,
        length: BLOCK - STREET_W,
      });
    }
  }
  for (const x of JUNCTION_XS) {
    for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
      const z0 = JUNCTION_XS[i];
      const z1 = JUNCTION_XS[i + 1];
      segs.push({
        id: `ns-${x}-${z0}`,
        axis: "ns",
        cx: x,
        cz: (z0 + z1) / 2,
        length: BLOCK - STREET_W,
      });
    }
  }
  return segs;
}

function segDensity(seg: RoadSeg, vehicles: SumoActor[]): { density: number; count: number } {
  const halfL = seg.length * 0.5;
  const halfW = STREET_W * 0.55;
  let n = 0;
  let slow = 0;
  for (const v of vehicles) {
    if (seg.axis === "ew") {
      if (Math.abs(v.z - seg.cz) > halfW) continue;
      if (Math.abs(v.x - seg.cx) > halfL) continue;
    } else {
      if (Math.abs(v.x - seg.cx) > halfW) continue;
      if (Math.abs(v.z - seg.cz) > halfL) continue;
    }
    n += 1;
    if ((v.speed ?? 5) < 3) slow += 1;
  }
  return { density: Math.min(1, n / 5 + slow * 0.12), count: n };
}

function junctionLoad(jx: number, jz: number, vehicles: SumoActor[]): JunctionLoad {
  const r = 14;
  let n = 0;
  let slow = 0;
  for (const v of vehicles) {
    if (Math.hypot(v.x - jx, v.z - jz) > r) continue;
    n += 1;
    if ((v.speed ?? 5) < 2.5) slow += 1;
  }
  return {
    id: `${jx}:${jz}`,
    x: jx,
    z: jz,
    load: Math.min(1, n / 8 + slow * 0.15),
    count: n,
  };
}

function loadColor(t: number): THREE.Color {
  const c = new THREE.Color();
  if (t < 0.35) {
    c.set("#4a9e96").lerp(new THREE.Color("#c4a05a"), t / 0.35);
  } else {
    c.set("#c4a05a").lerp(new THREE.Color("#c45c4a"), (t - 0.35) / 0.65);
  }
  return c;
}

function busyLabel(load: number): string {
  if (load < 0.25) return "light";
  if (load < 0.5) return "busy";
  if (load < 0.75) return "heavy";
  return "jam";
}

function RoadHeat({ seg, density }: { seg: RoadSeg; density: number }) {
  if (density < 0.04) return null;
  const color = loadColor(density);
  const w = seg.axis === "ew" ? seg.length : STREET_W * 0.92;
  const d = seg.axis === "ew" ? STREET_W * 0.92 : seg.length;
  return (
    <mesh position={[seg.cx, HEAT_Y, seg.cz]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.2 + density * 0.48}
        depthWrite={false}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}

function IntersectionBusy({ j }: { j: JunctionLoad }) {
  const ring = useRef<THREE.Mesh>(null);
  const color = loadColor(Math.max(0.08, j.load));
  const radius = 5.5 + j.load * 7;
  const opacity = 0.12 + j.load * 0.48;

  useFrame((state) => {
    if (!ring.current || j.load < 0.12) return;
    const s = 0.94 + Math.sin(state.clock.elapsedTime * 2.4 + j.x * 0.04) * 0.06;
    ring.current.scale.setScalar(s);
  });

  if (j.load < 0.05 && j.count === 0) return null;

  return (
    <group position={[j.x, RING_Y, j.z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[radius * 0.7, radius, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[radius * 0.52, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.08 + j.load * 0.28}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Html distanceFactor={40} position={[0, 2.4, 0]} center style={{ pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.06em",
            color: "#eef2f0",
            background: "rgba(10,14,18,0.78)",
            border: `1px solid ${color.getStyle()}`,
            padding: "3px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          {j.count} · {busyLabel(j.load)}
        </div>
      </Html>
    </group>
  );
}

function speedColor(speedMs: number | undefined): string {
  const s = speedMs ?? 8;
  if (s < 0.6) return "#c45c4a";
  if (s < 4) return "#c4a05a";
  return "#7a8a92";
}

export function TrafficCar({
  position,
  yaw = 0,
  speed,
}: {
  position: [number, number, number];
  yaw?: number;
  speed?: number;
}) {
  const body = speedColor(speed);
  return (
    <group position={[position[0], 0.08, position[2]]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[1.7, 0.42, 0.8]} />
        <meshStandardMaterial color={body} roughness={0.65} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <boxGeometry args={[0.95, 0.28, 0.72]} />
        <meshStandardMaterial color="#1c262a" transparent opacity={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

/**
 * Per-block road heat + intersection load rings/labels.
 * Live SUMO when Kit is up; varied mock loads offline.
 */
export function TrafficFlowLayer() {
  const on = useAscStore((s) => s.activeLayers.includes("traffic"));
  const sumo = useSumoActors(180);
  const segments = useMemo(() => buildSegments(), []);
  const [tSec, setTSec] = useState(0);
  const last = useRef(0);

  useFrame((state) => {
    if (!on) return;
    if (state.clock.elapsedTime - last.current < 0.25) return;
    last.current = state.clock.elapsedTime;
    setTSec(state.clock.elapsedTime);
  });

  const { segLoads, junctions, vehicles } = useMemo(() => {
    if (!on) {
      return {
        segLoads: [] as { seg: RoadSeg; density: number }[],
        junctions: [] as JunctionLoad[],
        vehicles: [] as SumoActor[],
      };
    }

    if (sumo.live) {
      const veh = sumo.vehicles.slice(0, 80);
      return {
        segLoads: segments.map((seg) => ({
          seg,
          density: segDensity(seg, veh).density,
        })),
        junctions: JUNCTION_XS.flatMap((jx) =>
          JUNCTION_XS.map((jz) => junctionLoad(jx, jz, veh)),
        ),
        vehicles: veh,
      };
    }

    // Offline: clear busy vs quiet contrast across the grid
    return {
      segLoads: segments.map((seg) => {
        const base = hash01(seg.id);
        const pulse = 0.55 + 0.45 * Math.sin(tSec * 0.35 + base * 7);
        return { seg, density: 0.06 + base * 0.82 * pulse };
      }),
      junctions: JUNCTION_XS.flatMap((jx) =>
        JUNCTION_XS.map((jz) => {
          const h = hash01(`${jx}:${jz}`);
          const pulse = 0.6 + 0.4 * Math.sin(tSec * 0.4 + h * 5);
          const load = 0.05 + h * 0.9 * pulse;
          return {
            id: `${jx}:${jz}`,
            x: jx,
            z: jz,
            load,
            count: Math.max(0, Math.round(load * 10)),
          };
        }),
      ),
      vehicles: [] as SumoActor[],
    };
  }, [on, segments, sumo.live, sumo.updatedAt, sumo.vehicles, tSec]);

  if (!on) return null;

  return (
    <group>
      {segLoads.map(({ seg, density }) => (
        <RoadHeat key={seg.id} seg={seg} density={density} />
      ))}
      {junctions.map((j) => (
        <IntersectionBusy key={j.id} j={j} />
      ))}
      {vehicles.map((v) => (
        <TrafficCar
          key={`tv-${v.id}`}
          position={[v.x, 0, v.z]}
          yaw={((v.yaw ?? 0) * Math.PI) / 180}
          speed={v.speed}
        />
      ))}
      {!sumo.live && <MockTrafficCars />}
    </group>
  );
}

function MockTrafficCars() {
  const group = useRef<THREE.Group>(null);
  const cars = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: `mock-${i}`,
        alongEw: i % 2 === 0,
        line: JUNCTION_XS[i % JUNCTION_XS.length],
        phase: (i * 19.7) % 160,
        speed: 8 + (i % 5) * 2,
        lane: i % 2 === 0 ? -1.3 : 1.3,
      })),
    [],
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const half = CITY_SPAN_M * 0.5;
    g.children.forEach((child, i) => {
      const c = cars[i];
      if (!c) return;
      const u = ((state.clock.elapsedTime * c.speed + c.phase) % CITY_SPAN_M) - half;
      if (c.alongEw) {
        child.position.set(u, 0.08, c.line + c.lane);
        child.rotation.y = Math.PI / 2;
      } else {
        child.position.set(c.line + c.lane, 0.08, u);
        child.rotation.y = 0;
      }
    });
  });

  return (
    <group ref={group}>
      {cars.map((c, i) => (
        <group key={c.id}>
          <mesh position={[0, 0.35, 0]}>
            <boxGeometry args={[1.7, 0.42, 0.8]} />
            <meshStandardMaterial
              color={i % 4 === 0 ? "#c4a05a" : "#7a8a92"}
              roughness={0.65}
              metalness={0.12}
            />
          </mesh>
          <mesh position={[0, 0.62, 0]}>
            <boxGeometry args={[0.95, 0.28, 0.72]} />
            <meshStandardMaterial color="#1c262a" transparent opacity={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function hash01(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}
