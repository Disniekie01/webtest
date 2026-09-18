import { useMemo } from "react";
import { CITY_SPAN_M } from "../data/twinCamera";

export function Cameras() {
  const half = CITY_SPAN_M * 0.42;
  const cams = useMemo(
    () =>
      [
        { pos: [-half, 8, -half] as [number, number, number], yaw: 0.8 },
        { pos: [half, 8, half] as [number, number, number], yaw: -2.4 },
        { pos: [0, 9, half * 1.05] as [number, number, number], yaw: Math.PI },
      ],
    [half],
  );

  return (
    <group>
      {cams.map((c, i) => (
        <group key={i} position={c.pos} rotation={[0, c.yaw, 0]}>
          <mesh>
            <boxGeometry args={[0.35, 0.25, 0.5]} />
            <meshStandardMaterial color="#2a3034" metalness={0.55} />
          </mesh>
          <mesh position={[0, 0, 0.28]}>
            <sphereGeometry args={[0.11, 12, 12]} />
            <meshStandardMaterial
              color="#5eb8b0"
              emissive="#2f6f6c"
              emissiveIntensity={0.9}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
