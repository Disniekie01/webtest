import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mainJunctions, STREET_W } from "../data/cityGrid";
import { useAscStore } from "../state/ascStore";
import { HtmlLabel } from "./HtmlLabel";

const POLE_H = 6.4;
const ARM = 0.85;
/** NE curb of each junction — clear of traffic-light poles. */
const CORNER = STREET_W * 0.95;

type CamSpec = {
  id: string;
  x: number;
  z: number;
  yaw: number;
};

function buildCams(): CamSpec[] {
  return mainJunctions().map((j, i) => ({
    id: `cctv-${j.id}`,
    x: j.x + CORNER,
    z: j.z + CORNER,
    // Face toward junction center
    yaw: -Math.PI * 0.75 + (i % 4) * 0.05,
  }));
}

function CctvUnit({
  spec,
  showLabel,
}: {
  spec: CamSpec;
  showLabel: boolean;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const lens = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ring.current) {
      const s = 1 + (t % 2.4) * 0.35;
      ring.current.scale.setScalar(s);
      const mat = ring.current.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.55 - (t % 2.4) * 0.22);
    }
    if (lens.current) {
      lens.current.emissiveIntensity = 0.7 + Math.sin(t * 3.2) * 0.35;
    }
  });

  return (
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.yaw, 0]}>
      {/* Pole */}
      <mesh position={[0, POLE_H / 2, 0]}>
        <cylinderGeometry args={[0.06, 0.08, POLE_H, 8]} />
        <meshStandardMaterial color="#2e363c" roughness={0.65} metalness={0.4} />
      </mesh>
      {/* Arm toward junction */}
      <mesh position={[0, POLE_H - 0.15, ARM * 0.4]} rotation={[0.35, 0, 0]}>
        <boxGeometry args={[0.08, 0.08, ARM]} />
        <meshStandardMaterial color="#3a4248" roughness={0.55} metalness={0.35} />
      </mesh>
      {/* Camera block body */}
      <group position={[0, POLE_H - 0.35, ARM * 0.85]} rotation={[0.25, 0, 0]}>
        <mesh>
          <boxGeometry args={[0.42, 0.28, 0.55]} />
          <meshStandardMaterial color="#1c2428" roughness={0.45} metalness={0.5} />
        </mesh>
        {/* Lens */}
        <mesh position={[0, 0, 0.3]}>
          <cylinderGeometry args={[0.11, 0.13, 0.12, 16]} />
          <meshStandardMaterial
            ref={lens}
            color="#5eb8b0"
            emissive="#5eb8b0"
            emissiveIntensity={0.9}
            roughness={0.25}
            metalness={0.2}
          />
        </mesh>
        {/* Status LED */}
        <mesh position={[0.14, 0.1, -0.1]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial color="#7ec8c0" emissive="#5eb8b0" emissiveIntensity={1.4} />
        </mesh>
      </group>
      {/* Ground footprint ping — same language as old HUD .lo-cam */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={3}>
        <ringGeometry args={[0.55, 0.72, 28]} />
        <meshBasicMaterial
          color="#5eb8b0"
          transparent
          opacity={0.4}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} renderOrder={3}>
        <ringGeometry args={[0.28, 0.42, 4]} />
        <meshBasicMaterial
          color="#7ec8c0"
          transparent
          opacity={0.55}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {showLabel && (
        <HtmlLabel distanceFactor={38} maxDist={85} position={[0, POLE_H + 0.6, 0]}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#e8f4f0",
              background: "rgba(8,14,16,0.82)",
              border: "1px solid rgba(94,184,176,0.55)",
              padding: "2px 6px",
              borderRadius: 5,
              whiteSpace: "nowrap",
            }}
          >
            CCTV · {spec.id.replace("cctv-", "")}
          </div>
        </HtmlLabel>
      )}
    </group>
  );
}

/**
 * Surveillance layer — CCTV camera blocks on Harbor intersections (twin space, not HUD).
 */
export function Cameras() {
  const on = useAscStore((s) => s.activeLayers.includes("sensors"));
  const cams = useMemo(() => buildCams(), []);

  if (!on) return null;

  // Labels only on a sparse subset so the grid stays readable
  const labelIds = new Set(
    cams.filter((_, i) => i % 5 === 2).map((c) => c.id),
  );

  return (
    <group>
      {cams.map((c) => (
        <CctvUnit key={c.id} spec={c} showLabel={labelIds.has(c.id)} />
      ))}
    </group>
  );
}
