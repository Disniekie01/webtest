import { useEffect, useMemo, useRef, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { CityScene } from "./CityScene";
import { PathRibbon } from "./PathRibbon";
import { HumanAgent, RobotAgent } from "./Agents";
import { Cameras } from "./Cameras";
import { packs, resolveComfort, useLabStore } from "../state/store";
import {
  buildTimeline,
  robotKeyframes,
  sampleTimeline,
} from "../lib/journeyMath";
import { buildConflict } from "../data/mockTracks";
import type { YardTrack } from "../data/types";

function PlaybackDriver() {
  const selectedId = useLabStore((s) => s.selectedId);
  const playing = useLabStore((s) => s.playing);
  const overrides = useLabStore((s) => s.comfortOverrides);
  const pack = selectedId ? packs[selectedId] : null;
  const journey = pack?.journey || null;
  const comfort = resolveComfort(selectedId, overrides);
  const personId = selectedId || journey?.person_id;

  const personTimeline = useMemo(() => {
    if (!journey) return [];
    const speed = journey.person?.walk_speed_mps || 1.3;
    return buildTimeline(journey, speed, personId);
  }, [journey, personId]);

  const robotTimeline = useMemo(
    () => (journey ? robotKeyframes(journey, personId) : []),
    [journey, personId],
  );

  useEffect(() => {
    const dur = personTimeline.length
      ? personTimeline[personTimeline.length - 1].t
      : 1;
    useLabStore.getState().setDuration(dur);
    useLabStore.getState().setTime(0);
  }, [personTimeline]);

  const lastPos = useRef({ px: 0, pz: 0, rx: 0, rz: 0, t: 0 });

  useFrame((_, dt) => {
    const store = useLabStore.getState();
    store.tick(dt);
    if (!journey) return;

    const person = sampleTimeline(personTimeline, store.timeS);
    const robot = robotTimeline.length
      ? sampleTimeline(robotTimeline, store.timeS)
      : null;

    const t = store.timeS;
    const dtSafe = Math.max(t - lastPos.current.t, 1 / 60);
    const pvx = (person.pos[0] - lastPos.current.px) / dtSafe;
    const pvz = (person.pos[2] - lastPos.current.pz) / dtSafe;
    let rvx = 0;
    let rvz = 0;
    if (robot) {
      rvx = (robot.pos[0] - lastPos.current.rx) / dtSafe;
      rvz = (robot.pos[2] - lastPos.current.rz) / dtSafe;
    }
    lastPos.current = {
      px: person.pos[0],
      pz: person.pos[2],
      rx: robot?.pos[0] ?? 0,
      rz: robot?.pos[2] ?? 0,
      t,
    };

    const kind =
      journey.stops.find((s) => s.spawn_robot)?.spawn_robot?.kind || "delivery";

    const tracks: YardTrack[] = [
      {
        id: "person",
        cls: "person",
        x: person.pos[0],
        y: person.pos[2],
        vx: pvx,
        vy: pvz,
        speed: Math.hypot(pvx, pvz),
        history: [],
      },
    ];
    if (robot) {
      const cls = ["robotaxi", "taxi", "av", "driverless"].includes(
        kind.toLowerCase(),
      )
        ? "robotaxi"
        : ["assistive", "companion", "aide", "assist_cart"].includes(
              kind.toLowerCase(),
            )
          ? "assistive"
          : "robot";
      tracks.push({
        id: "robot",
        cls,
        x: robot.pos[0],
        y: robot.pos[2],
        vx: rvx,
        vy: rvz,
        speed: Math.hypot(rvx, rvz),
        history: [],
      });
    }

    const score = person.comfort ?? comfort?.score ?? 0.5;
    store.setPlaybackFrame({
      personPos: person.pos,
      robotPos: robot?.pos ?? null,
      robotKind: robot ? kind : null,
      beat: person.beat || null,
      comfort: score,
      label: person.label || null,
      conflict: buildConflict(tracks),
    });
  });

  const prefs = comfort?.preferences || [];
  const wantReplan =
    prefs.includes("accessible_bay_reroute") ||
    selectedId === "noor_rahman";

  const personPos = useLabStore((s) => s.personPos);
  const robotPos = useLabStore((s) => s.robotPos);
  const robotKind = useLabStore((s) => s.robotKind);
  const currentComfort = useLabStore((s) => s.currentComfort);
  const name = pack?.person?.name || pack?.catalog.name;
  const wheelchair =
    pack?.person?.mobility?.aid === "wheelchair" ||
    pack?.journey?.person?.mobility_aid === "wheelchair" ||
    pack?.catalog.tags?.includes("wheelchair");

  const camTarget = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    const pos = useLabStore.getState().personPos;
    const isPlaying = useLabStore.getState().playing;
    camTarget.current.lerp(new THREE.Vector3(pos[0], 1.4, pos[2]), 0.05);
    if (isPlaying) {
        const ideal = new THREE.Vector3(pos[0] - 8, 7, pos[2] + 10);
      camera.position.lerp(ideal, 0.035);
      camera.lookAt(camTarget.current);
    }
  });

  return (
    <>
      <PathRibbon
        journey={journey}
        personId={personId}
        showReplan={wantReplan && playing}
      />
      <HumanAgent
        position={personPos}
        comfort={currentComfort}
        name={name}
        wheelchair={Boolean(wheelchair)}
      />
      {robotPos && robotKind && (
        <RobotAgent position={robotPos} kind={robotKind} />
      )}
    </>
  );
}

function LoaderFallback() {
  return (
    <mesh position={[0, 1, 0]}>
      <boxGeometry args={[2, 0.2, 2]} />
      <meshBasicMaterial color="#5eb8b0" wireframe />
    </mesh>
  );
}

export function CityCanvas() {
  return (
    <Canvas shadows dpr={[1, 1.75]} gl={{ antialias: true }}>
      <PerspectiveCamera makeDefault position={[-22, 16, 28]} fov={40} />
      <Suspense fallback={<LoaderFallback />}>
        <CityScene />
        <Cameras />
        <PlaybackDriver />
      </Suspense>
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={6}
        maxDistance={80}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
