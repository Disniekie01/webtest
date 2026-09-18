import { useMemo } from "react";
import { ContactShadows } from "@react-three/drei";
import { CITY_SPAN_M } from "../data/twinCamera";
import buildingsJson from "../data/sumoBuildings.json";
import cityMapJson from "../data/cityMap2d.json";

type BuildingParcel = {
  id: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Roof height in meters from Isaac City Generator instances. */
  height_m?: number;
};

type SidewalkRibbon = {
  x: number;
  z: number;
  w: number;
  h: number;
  dir: string;
};

type BuildingSpec = {
  id: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
  floors: number;
  color: string;
  accent: string;
  style: "tower" | "mid" | "low";
};

const HALF = CITY_SPAN_M / 2;
/** 5×5 junctions @ 40 m — matches SUMO / Isaac layout. */
const JUNCTION_XS = [-80, -40, 0, 40, 80] as const;
const STREET_W = 8;
const ROAD_Y = 0.04;
const SIDEWALK_Y = 0.08;
const BUILDING_OPACITY = 0.42;

const C = {
  ground: "#141a20",
  road: "#2c343c",
  sidewalk: "#3a444c",
  crossing: "#4a545c",
  building: "#6a7888",
  buildingAlt: "#7a8898",
  buildingTall: "#5a6a7a",
  accent: "#8aa0b4",
  window: "#c8e8f0",
  roof: "#3a4652",
  park: "#2a3e38",
  tree: "#3a5a48",
  trunk: "#3a3028",
};

function hash01(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

/** SUMO SW-corner meters → USD/R3F centered XZ. */
function sumoToCentered(sx: number, sy: number) {
  return { x: sx - HALF, z: sy - HALF };
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[CITY_SPAN_M + 20, CITY_SPAN_M + 20]} />
      <meshStandardMaterial color={C.ground} roughness={1} flatShading />
    </mesh>
  );
}

function RoadGrid() {
  return (
    <group>
      {JUNCTION_XS.map((z) => (
        <mesh
          key={`ew-${z}`}
          position={[0, ROAD_Y, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[CITY_SPAN_M, STREET_W]} />
          <meshStandardMaterial color={C.road} roughness={0.95} flatShading />
        </mesh>
      ))}
      {JUNCTION_XS.map((x) => (
        <mesh
          key={`ns-${x}`}
          position={[x, ROAD_Y + 0.01, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[STREET_W, CITY_SPAN_M]} />
          <meshStandardMaterial color={C.road} roughness={0.95} flatShading />
        </mesh>
      ))}
      {JUNCTION_XS.map((x) =>
        JUNCTION_XS.map((z) => (
          <mesh
            key={`j-${x}-${z}`}
            position={[x, ROAD_Y + 0.02, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
          >
            <planeGeometry args={[STREET_W + 1.5, STREET_W + 1.5]} />
            <meshStandardMaterial color={C.crossing} roughness={0.9} flatShading />
          </mesh>
        )),
      )}
    </group>
  );
}

function Sidewalks({ ribbons }: { ribbons: SidewalkRibbon[] }) {
  return (
    <group>
      {ribbons.map((r, i) => (
        <mesh
          key={`sw-${i}`}
          position={[r.x + r.w / 2, SIDEWALK_Y, r.z + r.h / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[r.w, r.h]} />
          <meshStandardMaterial color={C.sidewalk} roughness={0.92} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function ShellMat({ color, opacity = BUILDING_OPACITY }: { color: string; opacity?: number }) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.72}
      metalness={0.08}
      transparent
      opacity={opacity}
      depthWrite={false}
      flatShading
    />
  );
}

function WindowStrip({
  w,
  d,
  y,
  floors,
  seed,
}: {
  w: number;
  d: number;
  y: number;
  floors: number;
  seed: number;
}) {
  const rows = Math.min(floors, 14);
  const colsW = Math.max(2, Math.floor(w / 2.4));
  const colsD = Math.max(2, Math.floor(d / 2.4));
  const winH = 0.55;
  const winW = Math.min(1.1, (w * 0.88) / colsW - 0.35);
  const winD = Math.min(1.1, (d * 0.88) / colsD - 0.35);
  const startY = y + 1.4;
  const stepY = Math.max(1.35, (floors * 3.2 - 2.5) / Math.max(rows, 1));

  const panes: { key: string; pos: [number, number, number]; args: [number, number, number] }[] =
    [];

  for (let r = 0; r < rows; r++) {
    const yy = startY + r * stepY;
    if (yy > y + floors * 3.1 - 1) break;
    const lit = ((seed * 17 + r * 3) % 10) > 3;
    if (!lit && r % 2 === 1) continue;
    for (let c = 0; c < colsW; c++) {
      const x = -w * 0.42 + (c + 0.5) * ((w * 0.84) / colsW);
      panes.push({
        key: `fw-${r}-${c}`,
        pos: [x, yy, d * 0.46 + 0.02],
        args: [winW, winH, 0.06],
      });
      panes.push({
        key: `bw-${r}-${c}`,
        pos: [x, yy, -d * 0.46 - 0.02],
        args: [winW, winH, 0.06],
      });
    }
    for (let c = 0; c < colsD; c++) {
      const z = -d * 0.42 + (c + 0.5) * ((d * 0.84) / colsD);
      panes.push({
        key: `lw-${r}-${c}`,
        pos: [-w * 0.46 - 0.02, yy, z],
        args: [0.06, winH, winD],
      });
      panes.push({
        key: `rw-${r}-${c}`,
        pos: [w * 0.46 + 0.02, yy, z],
        args: [0.06, winH, winD],
      });
    }
  }

  return (
    <group>
      {panes.map((p) => (
        <mesh key={p.key} position={p.pos}>
          <boxGeometry args={p.args} />
          <meshStandardMaterial
            color={C.window}
            emissive={C.window}
            emissiveIntensity={0.35}
            transparent
            opacity={0.55}
            depthWrite={false}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  );
}

function BuildingMass({ b }: { b: BuildingSpec }) {
  const podiumH = b.style === "low" ? 0 : 2.2;
  const shaftH = Math.max(4, b.h - podiumH - (b.style === "tower" ? 3.2 : 1.6));
  const roofH = b.style === "tower" ? 2.4 : 1.2;
  const inset = b.style === "tower" ? 0.82 : 0.9;
  const shaftW = b.w * inset;
  const shaftD = b.d * inset;
  const capW = shaftW * (b.style === "tower" ? 0.7 : 0.88);
  const capD = shaftD * (b.style === "tower" ? 0.7 : 0.88);

  return (
    <group position={[b.cx, 0, b.cz]}>
      {/* Footprint plinth */}
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[b.w * 0.98, 0.3, b.d * 0.98]} />
        <ShellMat color={b.accent} opacity={BUILDING_OPACITY + 0.12} />
      </mesh>

      {podiumH > 0 && (
        <mesh position={[0, podiumH / 2 + 0.3, 0]} castShadow>
          <boxGeometry args={[b.w * 0.94, podiumH, b.d * 0.94]} />
          <ShellMat color={b.accent} />
        </mesh>
      )}

      {/* Main shaft */}
      <mesh position={[0, podiumH + 0.3 + shaftH / 2, 0]} castShadow>
        <boxGeometry args={[shaftW, shaftH, shaftD]} />
        <ShellMat color={b.color} />
      </mesh>

      {/* Parapet / roof cap */}
      <mesh position={[0, podiumH + 0.3 + shaftH + roofH / 2, 0]} castShadow>
        <boxGeometry args={[capW, roofH, capD]} />
        <ShellMat color={C.roof} opacity={BUILDING_OPACITY + 0.08} />
      </mesh>

      {/* Slim roof antenna for towers */}
      {b.style === "tower" && (
        <mesh position={[0, podiumH + 0.3 + shaftH + roofH + 2.2, 0]}>
          <cylinderGeometry args={[0.12, 0.18, 4.2, 6]} />
          <ShellMat color={C.accent} opacity={0.7} />
        </mesh>
      )}

      {/* Vertical facade rib */}
      <mesh position={[shaftW * 0.48, podiumH + 0.3 + shaftH / 2, 0]}>
        <boxGeometry args={[0.18, shaftH * 0.92, shaftD * 0.12]} />
        <ShellMat color={b.accent} opacity={BUILDING_OPACITY + 0.15} />
      </mesh>

      <WindowStrip
        w={shaftW}
        d={shaftD}
        y={podiumH + 0.3}
        floors={b.floors}
        seed={hash01(b.id) * 1000}
      />
    </group>
  );
}

function Buildings({ parcels }: { parcels: BuildingParcel[] }) {
  const blocks = useMemo(() => {
    return parcels.map((p): BuildingSpec => {
      const a = sumoToCentered(p.x0, p.y0);
      const b = sumoToCentered(p.x1, p.y1);
      const w = Math.max(4, Math.abs(b.x - a.x) * 0.9);
      const d = Math.max(4, Math.abs(b.z - a.z) * 0.9);
      const cx = (a.x + b.x) / 2;
      const cz = (a.z + b.z) / 2;
      const t = hash01(p.id);
      // Prefer Isaac twin roof height (from City Generator floor instances).
      const h = Math.max(6, Math.min(80, p.height_m ?? 8 + t * 28));
      const style: BuildingSpec["style"] =
        h >= 55 ? "tower" : h >= 32 ? "mid" : "low";
      const floors = Math.max(2, Math.round(h / 3.2));
      const color = style === "tower" ? C.buildingTall : style === "mid" ? C.buildingAlt : C.building;
      return { id: p.id, cx, cz, w, d, h, floors, color, accent: C.accent, style };
    });
  }, [parcels]);

  return (
    <group>
      {blocks.map((b) => (
        <BuildingMass key={b.id} b={b} />
      ))}
    </group>
  );
}

function ParksAndTrees({ parcels }: { parcels: BuildingParcel[] }) {
  const trees = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (const p of parcels) {
      if (hash01(p.id + "park") < 0.22) {
        const c = sumoToCentered((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2);
        pts.push([c.x + 4, 0, c.z - 3]);
        pts.push([c.x - 3, 0, c.z + 4]);
      }
    }
    for (const x of [-60, 60]) {
      for (const z of [-60, 60]) {
        pts.push([x, 0, z]);
      }
    }
    return pts;
  }, [parcels]);

  return (
    <group>
      {trees.map((p, i) => (
        <group key={`t-${i}`} position={p}>
          <mesh position={[0, 0.6, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.22, 1.2, 6]} />
            <meshStandardMaterial color={C.trunk} flatShading />
          </mesh>
          <mesh position={[0, 1.7, 0]} castShadow>
            <coneGeometry args={[1.1, 2.2, 6]} />
            <meshStandardMaterial color={C.tree} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * DMF-style primitive district locked to the SUMO / Isaac 160 m grid.
 * Ghosted building masses so roads + agents stay readable underneath.
 */
export function PrimitiveCity() {
  const parcels = buildingsJson as BuildingParcel[];
  const ribbons = (cityMapJson as { sidewalk_ribbons?: SidewalkRibbon[] }).sidewalk_ribbons ?? [];

  return (
    <group>
      <color attach="background" args={["#0a1016"]} />
      <fog attach="fog" args={["#0a1016", 70, 220]} />
      <hemisphereLight args={["#a8b8c4", "#12161a", 0.55]} />
      <directionalLight
        castShadow
        position={[50, 80, 35]}
        intensity={1.1}
        color="#e8e4dc"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={200}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      />
      <directionalLight position={[-35, 20, -30]} intensity={0.35} color="#5eb8b0" />

      <Ground />
      <RoadGrid />
      <Sidewalks ribbons={ribbons} />
      <Buildings parcels={parcels} />
      <ParksAndTrees parcels={parcels} />

      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.28}
        scale={CITY_SPAN_M * 1.15}
        blur={2.2}
        far={36}
      />
    </group>
  );
}

export function CityScene() {
  return <PrimitiveCity />;
}
