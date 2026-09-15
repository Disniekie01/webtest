import { useMemo } from "react";

export function Cameras() {
  const cams = useMemo(
    () =>
      [
        { pos: [-16, 5.5, -16] as [number, number, number], yaw: 0.8 },
        { pos: [16, 5.5, 16] as [number, number, number], yaw: -2.4 },
        { pos: [0, 6.2, 20] as [number, number, number], yaw: Math.PI },
      ],
    [],
  );

  return (
    <group>
      {cams.map((c, i) => (
        <group key={i} position={c.pos} rotation={[0, c.yaw, 0]}>
          <mesh>
            <boxGeometry args={[0.28, 0.2, 0.4]} />
            <meshStandardMaterial color="#2a3034" metalness={0.55} />
          </mesh>
          <mesh position={[0, 0, 0.24]}>
            <sphereGeometry args={[0.09, 12, 12]} />
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
