import { Line } from "@react-three/drei";
import { pathPositions, replanRibbon } from "../lib/journeyMath";
import type { JourneyDoc } from "../data/types";

export function PathRibbon({
  journey,
  personId,
  showReplan,
}: {
  journey: JourneyDoc | null;
  personId?: string;
  showReplan?: boolean;
}) {
  if (!journey?.stops?.length) return null;
  const primary = pathPositions(journey, personId).map(
    (p) => [p[0], 0.12, p[2]] as [number, number, number],
  );
  const replan = replanRibbon(primary, Boolean(showReplan));

  return (
    <group>
      {primary.length >= 2 && (
        <Line points={primary} color="#5eb8b0" lineWidth={3} transparent opacity={0.9} />
      )}
      {replan.length >= 2 && (
        <Line
          points={replan}
          color="#d4a15a"
          lineWidth={2}
          dashed
          dashSize={0.45}
          gapSize={0.25}
          transparent
          opacity={0.75}
        />
      )}
      {primary
        .filter((_, i) => {
          // markers at journey stop density
          const n = journey.stops.length;
          const idx = Math.round((i / Math.max(primary.length - 1, 1)) * (n - 1));
          const atStop =
            Math.abs(i / Math.max(primary.length - 1, 1) - idx / Math.max(n - 1, 1)) <
            0.02;
          return i === 0 || i === primary.length - 1 || atStop;
        })
        .map((p, i) => (
          <mesh key={i} position={[p[0], 0.18, p[2]]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial
              color={i === 0 ? "#7ec8c0" : "#c4a574"}
              emissive={i === 0 ? "#2f6f6c" : "#5a4020"}
              emissiveIntensity={0.4}
            />
          </mesh>
        ))}
    </group>
  );
}
