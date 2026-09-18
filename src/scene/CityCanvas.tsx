import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { CityScene } from "./CityScene";
import { HumanAgent, RobotAgent } from "./Agents";
import { Cameras } from "./Cameras";
import { TrafficFlowLayer } from "./TrafficFlowLayer";
import { TrafficLights } from "./TrafficLights";
import { PedestrianFlowLayer } from "./PedestrianFlowLayer";
import { FleetFlowLayer } from "./FleetFlowLayer";
import { TransitFlowLayer } from "./TransitFlowLayer";
import { AqPulseLayer } from "./AqPulseLayer";
import { ComfortFlowLayer } from "./ComfortFlowLayer";
import { citizens, telemetry, useAscStore } from "../state/ascStore";
import { CITY_SPAN_M, DEFAULT_TWIN_CAMERA } from "../data/twinCamera";
import { useSumoActors } from "./useSumoActors";
import "./CityCanvas.css";

type MockAgent = {
  id: string;
  kind: "human" | "robot";
  robotKind?: string;
  name: string;
  comfort: number;
  wheelchair?: boolean;
  base: [number, number, number];
  amp: number;
  phase: number;
  speed: number;
};

function buildMockAgents(): MockAgent[] {
  const humanAnchors: [number, number, number][] = [
    [-18, 0, 12],
    [24, 0, -8],
    [6, 0, 32],
  ];
  const robotAnchors: [number, number, number][] = [
    [-32, 0, -20],
    [36, 0, 18],
    [-8, 0, -40],
    [20, 0, 44],
    [-44, 0, 24],
    [40, 0, -28],
    [0, 0, 0],
    [-24, 0, 36],
  ];

  const humans: MockAgent[] = citizens.map((c, i) => ({
    id: c.id,
    kind: "human",
    name: c.name.split(" ")[0],
    comfort: c.comfortScore,
    wheelchair: c.id === "margaret",
    base: humanAnchors[i % humanAnchors.length],
    amp: 6 + (i % 3) * 2,
    phase: i * 1.7,
    speed: 0.12 + i * 0.03,
  }));

  const robots: MockAgent[] = telemetry.slice(0, 8).map((r, i) => ({
    id: r.id,
    kind: "robot",
    robotKind: r.kind,
    name: r.name,
    comfort: 0.5,
    base: robotAnchors[i % robotAnchors.length],
    amp: 10 + (i % 4) * 3,
    phase: i * 0.9 + 0.5,
    speed: 0.08 + (i % 3) * 0.04,
  }));

  return [...humans, ...robots];
}

function OpsAgentsLive() {
  const layers = useAscStore((s) => s.activeLayers);
  const sumo = useSumoActors(120);
  const mocks = useMemo(() => buildMockAgents(), []);
  const accum = useRef(0);
  const [, setTick] = useState(0);

  useFrame((_, dt) => {
    accum.current += dt;
    if (accum.current > 1 / 20) {
      accum.current = 0;
      setTick((n) => n + 1);
    }
  });

  const showHumans =
    layers.includes("pedestrians") ||
    layers.includes("activity") ||
    layers.includes("comfort");
  const showRobots = layers.includes("robots") || layers.includes("activity");
  // Vehicles are drawn by TrafficFlowLayer when the traffic module is on.

  if (sumo.live) {
    const peds = showHumans ? sumo.pedestrians.filter((p) => p.cls !== "robot") : [];
    const robots = showRobots
      ? [
          ...sumo.pedestrians.filter((p) => p.cls === "robot"),
          // Keep non-car fleet markers off the traffic layer path
        ]
      : [];
    return (
      <>
        {peds.slice(0, 80).map((p) => (
          <HumanAgent
            key={`p-${p.id}`}
            position={[p.x, 0, p.z]}
            comfort={0.55}
          />
        ))}
        {robots.slice(0, 60).map((r) => (
          <RobotAgent
            key={`r-${r.id}`}
            position={[r.x, 0, r.z]}
            kind="delivery"
          />
        ))}
      </>
    );
  }

  const t = performance.now() / 1000;
  return (
    <>
      {mocks.map((a) => {
        if (a.kind === "human" && !showHumans) return null;
        // FleetFlowLayer owns offline delivery bots when Fleet layer is on
        if (a.kind === "robot" && (!showRobots || layers.includes("robots"))) return null;
        const x = a.base[0] + Math.sin(t * a.speed + a.phase) * a.amp;
        const z = a.base[2] + Math.cos(t * a.speed * 0.85 + a.phase) * a.amp * 0.7;
        const pos: [number, number, number] = [x, 0, z];
        if (a.kind === "human") {
          return (
            <HumanAgent
              key={a.id}
              position={pos}
              comfort={a.comfort}
              name={a.name}
              wheelchair={a.wheelchair}
            />
          );
        }
        return (
          <RobotAgent key={a.id} position={pos} kind={a.robotKind || "delivery"} />
        );
      })}
    </>
  );
}

function CameraBridge() {
  const setCameraPose = useAscStore((s) => s.setCameraPose);
  const controls = useRef<{
    target: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    update: () => void;
  } | null>(null);
  const { camera } = useThree();

  // Seed from store once on mount (after Twin ← Kit handoff).
  useEffect(() => {
    const pose = useAscStore.getState().cameraPose;
    camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    if ("fov" in camera) {
      (camera as typeof camera & { fov: number }).fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    const id = window.requestAnimationFrame(() => {
      if (controls.current) {
        controls.current.target.set(pose.target[0], pose.target[1], pose.target[2]);
        controls.current.update();
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [camera]);

  useFrame(() => {
    if (!controls.current) return;
    const c = controls.current;
    const eye: [number, number, number] = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
    ];
    const target: [number, number, number] = [c.target.x, c.target.y, c.target.z];
    const fov =
      "fov" in camera ? (camera as typeof camera & { fov: number }).fov : DEFAULT_TWIN_CAMERA.fov;
    const prev = useAscStore.getState().cameraPose;
    if (
      Math.hypot(eye[0] - prev.eye[0], eye[1] - prev.eye[1], eye[2] - prev.eye[2]) > 0.2 ||
      Math.hypot(
        target[0] - prev.target[0],
        target[1] - prev.target[1],
        target[2] - prev.target[2],
      ) > 0.2
    ) {
      setCameraPose({ eye, target, fov });
    }
  });

  const initial = useAscStore.getState().cameraPose;

  return (
    <OrbitControls
      makeDefault
      ref={controls as never}
      enableDamping
      dampingFactor={0.08}
      enablePan
      enableZoom
      enableRotate
      maxPolarAngle={Math.PI / 2.05}
      minDistance={12}
      maxDistance={CITY_SPAN_M * 1.6}
      target={initial.target}
    />
  );
}

function LoaderFallback() {
  return (
    <mesh position={[0, 2, 0]}>
      <boxGeometry args={[4, 0.3, 4]} />
      <meshBasicMaterial color="#5eb8b0" wireframe />
    </mesh>
  );
}

function SumoLiveBadge() {
  const sumo = useSumoActors(1000);
  if (!sumo.live) return null;
  return (
    <div className="city-canvas__sumo mono">
      SUMO live · {sumo.vehicles.length} veh · {sumo.pedestrians.length} ped
    </div>
  );
}

/** Low-fi Adaptive Smart City twin — same 160 m City Generator + SUMO when Kit is up. */
export function CityCanvas() {
  // Seed once — do NOT bind position to live store or OrbitControls fights the React prop.
  const initial = useMemo(() => useAscStore.getState().cameraPose, []);

  return (
    <div className="city-canvas">
      <SumoLiveBadge />
      <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true }} style={{ touchAction: "none" }}>
        <PerspectiveCamera
          makeDefault
          position={initial.eye}
          fov={initial.fov}
          near={0.5}
          far={CITY_SPAN_M * 4}
        />
        <Suspense fallback={<LoaderFallback />}>
          <CityScene />
          <Cameras />
          <TrafficFlowLayer />
          <TrafficLights />
          <PedestrianFlowLayer />
          <FleetFlowLayer />
          <TransitFlowLayer />
          <AqPulseLayer />
          <ComfortFlowLayer />
          <OpsAgentsLive />
        </Suspense>
        <CameraBridge />
      </Canvas>
    </div>
  );
}
