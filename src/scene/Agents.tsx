import { Html, useGLTF } from "@react-three/drei";
import { useMemo } from "react";

useGLTF.preload("/models/cars/ferrari.glb");

export function HumanAgent({
  position,
  comfort,
  name,
  wheelchair,
}: {
  position: [number, number, number];
  comfort: number;
  name?: string;
  wheelchair?: boolean;
}) {
  const body =
    comfort < 0.3 ? "#c45c4a" : comfort < 0.55 ? "#d4a15a" : "#7ec8c0";
  return (
    <group position={position}>
      {wheelchair ? (
        <>
          <mesh position={[0, 0.35, 0]} castShadow>
            <boxGeometry args={[0.55, 0.45, 0.7]} />
            <meshStandardMaterial color="#4a555c" metalness={0.45} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.85, -0.05]} castShadow>
            <sphereGeometry args={[0.18, 16, 16]} />
            <meshStandardMaterial color={body} />
          </mesh>
          <mesh position={[-0.28, 0.22, 0.1]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.16, 0.16, 0.08, 16]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          <mesh position={[0.28, 0.22, 0.1]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.16, 0.16, 0.08, 16]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[0, 0.55, 0]} castShadow>
            <capsuleGeometry args={[0.18, 0.55, 6, 12]} />
            <meshStandardMaterial color={body} roughness={0.55} />
          </mesh>
          <mesh position={[0, 1.05, 0]} castShadow>
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshStandardMaterial color="#e8dcd0" />
          </mesh>
        </>
      )}
      {name && (
        <Html distanceFactor={18} position={[0, 1.45, 0]} center>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 11,
              color: "#eef2f0",
              background: "rgba(14,22,24,0.72)",
              padding: "2px 8px",
              border: "1px solid rgba(120,190,188,0.35)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {name}
          </div>
        </Html>
      )}
    </group>
  );
}

function Ferrari({ scale = 0.55 }: { scale?: number }) {
  const { scene } = useGLTF("/models/cars/ferrari.glb");
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} scale={scale} />;
}

export function RobotAgent({
  position,
  kind,
}: {
  position: [number, number, number];
  kind: string;
}) {
  const k = kind.toLowerCase();
  const isTaxi = ["robotaxi", "taxi", "av", "driverless"].includes(k);
  const isAssist = ["assistive", "companion", "aide", "assist_cart", "guide"].includes(k);

  if (isTaxi) {
    return (
      <group position={position} rotation={[0, Math.PI, 0]}>
        <Ferrari scale={0.5} />
      </group>
    );
  }

  const color = isAssist ? "#7ec8c0" : "#e0a05a";
  const size: [number, number, number] = isAssist
    ? [0.55, 0.42, 0.8]
    : [0.65, 0.4, 0.9];

  return (
    <group position={position}>
      <mesh position={[0, size[1] / 2, 0]} castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} metalness={0.4} roughness={0.3} />
      </mesh>
      <mesh position={[0, size[1] + 0.06, size[2] * 0.12]}>
        <boxGeometry args={[size[0] * 0.7, 0.1, size[2] * 0.35]} />
        <meshStandardMaterial
          color="#101820"
          emissive={color}
          emissiveIntensity={0.45}
        />
      </mesh>
    </group>
  );
}
