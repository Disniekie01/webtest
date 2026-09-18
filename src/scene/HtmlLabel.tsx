import { useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

const _tmp = new THREE.Vector3();

/**
 * Distance-gated Html label — hides DOM overlays far from camera.
 * Keeps the twin readable when many junctions / bots are active.
 */
export function HtmlLabel({
  position,
  distanceFactor = 40,
  maxDist = 95,
  children,
}: {
  position?: [number, number, number];
  distanceFactor?: number;
  maxDist?: number;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [visible, setVisible] = useState(true);
  const last = useRef(true);
  const accum = useRef(0);

  useFrame((_, dt) => {
    accum.current += dt;
    if (accum.current < 0.2) return;
    accum.current = 0;
    const g = group.current;
    if (!g) return;
    const d = camera.position.distanceTo(g.getWorldPosition(_tmp));
    const next = d < maxDist;
    if (next !== last.current) {
      last.current = next;
      setVisible(next);
    }
  });

  return (
    <group ref={group} position={position}>
      {visible && (
        <Html distanceFactor={distanceFactor} center style={{ pointerEvents: "none" }}>
          {children}
        </Html>
      )}
    </group>
  );
}
