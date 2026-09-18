import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import cityMapJson from "../data/cityMap2d.json";
import { CITY_SPAN_M, JUNCTION_XS } from "../data/cityGrid";
import { useAscStore } from "../state/ascStore";
import { useSumoActors, type SumoActor } from "./useSumoActors";
import { HumanAgent } from "./Agents";

const HEAT_Y = 0.18;
const HOTSPOT_Y = 0.28;

type SidewalkRibbon = {
  x: number;
  z: number;
  w: number;
  h: number;
  dir: string;
};

type WalkSeg = {
  id: string;
  label: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  dir: "NS" | "EW";
};

type PlazaLoad = {
  id: string;
  x: number;
  z: number;
  load: number;
  count: number;
};

function ribbons(): SidewalkRibbon[] {
  return (cityMapJson as { sidewalk_ribbons?: SidewalkRibbon[] }).sidewalk_ribbons ?? [];
}

/** Split long sidewalk ribbons into ~40 m walk segments. */
function buildWalkSegs(): WalkSeg[] {
  const out: WalkSeg[] = [];
  for (const r of ribbons()) {
    const dir = r.dir === "EW" ? "EW" : "NS";
    if (dir === "NS") {
      const x = r.x + r.w / 2;
      for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
        const z0 = JUNCTION_XS[i];
        const z1 = JUNCTION_XS[i + 1];
        const cz = (z0 + z1) / 2;
        // Only if ribbon covers this span
        if (cz < r.z || cz > r.z + r.h) continue;
        out.push({
          id: `ns-${Math.round(x)}-${z0}`,
          label: `Walk ${Math.round(x)},${z0}→${z1}`,
          cx: x,
          cz,
          w: r.w * 0.92,
          d: 32,
          dir: "NS",
        });
      }
    } else {
      const z = r.z + r.h / 2;
      for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
        const x0 = JUNCTION_XS[i];
        const x1 = JUNCTION_XS[i + 1];
        const cx = (x0 + x1) / 2;
        if (cx < r.x || cx > r.x + r.w) continue;
        out.push({
          id: `ew-${Math.round(z)}-${x0}`,
          label: `Walk ${x0}→${x1},${Math.round(z)}`,
          cx,
          cz: z,
          w: 32,
          d: r.h * 0.92,
          dir: "EW",
        });
      }
    }
  }
  return out;
}

function hash01(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

function humansOnly(peds: SumoActor[]) {
  return peds.filter((p) => p.cls !== "robot");
}

function segDensity(seg: WalkSeg, peds: SumoActor[]) {
  const halfW = seg.w * 0.55;
  const halfD = seg.d * 0.55;
  let n = 0;
  for (const p of peds) {
    if (Math.abs(p.x - seg.cx) > halfW) continue;
    if (Math.abs(p.z - seg.cz) > halfD) continue;
    n += 1;
  }
  return { density: Math.min(1, n / 6), count: n };
}

function plazaLoad(jx: number, jz: number, peds: SumoActor[]): PlazaLoad {
  let n = 0;
  for (const p of peds) {
    if (Math.hypot(p.x - jx, p.z - jz) < 12) n += 1;
  }
  return {
    id: `${jx}:${jz}`,
    x: jx,
    z: jz,
    load: Math.min(1, n / 10),
    count: n,
  };
}

function pedColor(t: number): THREE.Color {
  const c = new THREE.Color();
  // Calm teal → cyan → soft amber for crowds (not traffic red)
  if (t < 0.45) {
    c.set("#3a7a78").lerp(new THREE.Color("#5eb8b0"), t / 0.45);
  } else {
    c.set("#5eb8b0").lerp(new THREE.Color("#c4a05a"), (t - 0.45) / 0.55);
  }
  return c;
}

function crowdLabel(load: number): string {
  if (load < 0.25) return "quiet";
  if (load < 0.5) return "active";
  if (load < 0.75) return "crowded";
  return "dense";
}

function SidewalkHeat({ seg, density }: { seg: WalkSeg; density: number }) {
  if (density < 0.05) return null;
  const color = pedColor(density);
  return (
    <mesh position={[seg.cx, HEAT_Y, seg.cz]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry args={[seg.w, seg.d]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.16 + density * 0.4}
        depthWrite={false}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}

function PlazaHotspot({ p }: { p: PlazaLoad }) {
  const ring = useRef<THREE.Mesh>(null);
  const color = pedColor(Math.max(0.1, p.load));
  const radius = 4.5 + p.load * 6;

  useFrame((state) => {
    if (!ring.current || p.load < 0.15) return;
    const s = 0.95 + Math.sin(state.clock.elapsedTime * 2 + p.x * 0.03) * 0.05;
    ring.current.scale.setScalar(s);
  });

  if (p.load < 0.06 && p.count === 0) return null;

  return (
    <group position={[p.x, HOTSPOT_Y, p.z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[radius * 0.68, radius, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.1 + p.load * 0.4}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[radius * 0.5, 28]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.06 + p.load * 0.22}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Html distanceFactor={42} position={[0, 2.1, 0]} center style={{ pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.06em",
            color: "#eef2f0",
            background: "rgba(8,16,18,0.78)",
            border: `1px solid ${color.getStyle()}`,
            padding: "3px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          {p.count} · {crowdLabel(p.load)}
        </div>
      </Html>
    </group>
  );
}

/**
 * Pedestrian layer on sidewalks / plazas (not HUD).
 * Live SUMO walkers when Kit is up; mock sidewalk streams offline.
 */
export function PedestrianFlowLayer() {
  const on = useAscStore((s) => s.activeLayers.includes("pedestrians"));
  const sumo = useSumoActors(180);
  const segs = useMemo(() => buildWalkSegs(), []);
  const [tSec, setTSec] = useState(0);
  const last = useRef(0);

  useFrame((state) => {
    if (!on) return;
    if (state.clock.elapsedTime - last.current < 0.25) return;
    last.current = state.clock.elapsedTime;
    setTSec(state.clock.elapsedTime);
  });

  const { segLoads, plazas, livePeds } = useMemo(() => {
    if (!on) {
      return {
        segLoads: [] as { seg: WalkSeg; density: number }[],
        plazas: [] as PlazaLoad[],
        livePeds: [] as SumoActor[],
      };
    }

    if (sumo.live) {
      const peds = humansOnly(sumo.pedestrians).slice(0, 100);
      return {
        segLoads: segs.map((seg) => ({ seg, density: segDensity(seg, peds).density })),
        plazas: JUNCTION_XS.flatMap((jx) => JUNCTION_XS.map((jz) => plazaLoad(jx, jz, peds))),
        livePeds: peds,
      };
    }

    return {
      segLoads: segs.map((seg) => {
        const base = hash01(seg.id);
        const pulse = 0.55 + 0.45 * Math.sin(tSec * 0.4 + base * 6);
        return { seg, density: 0.08 + base * 0.75 * pulse };
      }),
      plazas: JUNCTION_XS.flatMap((jx) =>
        JUNCTION_XS.map((jz) => {
          const h = hash01(`p-${jx}:${jz}`);
          const pulse = 0.6 + 0.4 * Math.sin(tSec * 0.45 + h * 5);
          const load = 0.05 + h * 0.85 * pulse;
          return {
            id: `${jx}:${jz}`,
            x: jx,
            z: jz,
            load,
            count: Math.round(load * 12),
          };
        }),
      ),
      livePeds: [] as SumoActor[],
    };
  }, [on, segs, sumo.live, sumo.updatedAt, sumo.pedestrians, tSec]);

  if (!on) return null;

  // Live peds are also drawn by OpsAgentsLive — only add extras offline via MockWalkers
  return (
    <group>
      {segLoads.map(({ seg, density }) => (
        <SidewalkHeat key={seg.id} seg={seg} density={density} />
      ))}
      {plazas.map((p) => (
        <PlazaHotspot key={p.id} p={p} />
      ))}
      {!sumo.live && <MockWalkers />}
      {/* When live, heat uses livePeds; agents come from OpsAgentsLive */}
      {sumo.live && livePeds.length === 0 && null}
    </group>
  );
}

function MockWalkers() {
  const group = useRef<THREE.Group>(null);
  const walkers = useMemo(() => {
    const rs = ribbons();
    return Array.from({ length: 36 }, (_, i) => {
      const r = rs[i % rs.length];
      const alongNS = r.dir !== "EW";
      return {
        id: `pw-${i}`,
        alongNS,
        // Center of ribbon
        fixed: alongNS ? r.x + r.w / 2 : r.z + r.h / 2,
        lane: ((i % 3) - 1) * 0.7,
        phase: (i * 13.7) % CITY_SPAN_M,
        speed: 1.1 + (i % 5) * 0.25,
        comfort: 0.35 + hash01(`c${i}`) * 0.55,
      };
    });
  }, []);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const half = CITY_SPAN_M * 0.5;
    g.children.forEach((child, i) => {
      const w = walkers[i];
      if (!w) return;
      const u = ((state.clock.elapsedTime * w.speed + w.phase) % CITY_SPAN_M) - half;
      if (w.alongNS) {
        child.position.set(w.fixed + w.lane, 0, u);
      } else {
        child.position.set(u, 0, w.fixed + w.lane);
      }
    });
  });

  return (
    <group ref={group}>
      {walkers.map((w) => (
        <group key={w.id}>
          <HumanAgent position={[0, 0, 0]} comfort={w.comfort} />
        </group>
      ))}
    </group>
  );
}
