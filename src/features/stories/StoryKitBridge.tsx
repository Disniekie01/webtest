/** Prefer live Kit delivery robots for story playback; fall back to journey keyframes. */

import { useEffect, useMemo, useRef } from "react";
import { cityProximityConflict } from "../../cv/cityMap";
import {
  fetchKitActors,
  fetchOrchestrator,
  type KitActorsPayload,
} from "../../cv/yardlineClient";
import { buildConflict } from "../../data/mockTracks";
import type { YardTrack } from "../../data/types";
import {
  buildTimeline,
  robotKeyframes,
  sampleTimeline,
} from "../../lib/journeyMath";
import { packs, resolveComfort, useLabStore } from "../../state/store";

const SIDEWALK_Y = 0.05;

/** Map TraCI orch actions → story policy labels (Phase 4 chip). */
export function policyLabel(action: string | null | undefined): string | null {
  if (!action) return null;
  const a = action.toLowerCase();
  if (a === "hold") return "yield";
  if (a === "slow") return "detour";
  if (a === "proceed") return "proceed";
  return a;
}

function pickKitRobot(
  payload: KitActorsPayload | null,
  near: [number, number, number] | null,
) {
  if (!payload) return null;
  const bots = payload.pedestrians.filter(
    (p) => p.cls === "robot" || p.type === "delivery_robot",
  );
  if (!bots.length) return null;
  if (!near) return bots[0];
  let best = bots[0];
  let bestD = Infinity;
  for (const b of bots) {
    const d = Math.hypot(b.x - near[0], b.z - near[2]);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * Headless story clock (CityCanvas PlaybackDriver is not mounted under Kit stream).
 * Advances beats/comfort; prefers Kit cls=robot poses when actors are live.
 */
export function StoryKitBridge() {
  const mode = useLabStore((s) => s.mode);
  const selectedId = useLabStore((s) => s.selectedId);
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

  const kitRef = useRef<KitActorsPayload | null>(null);
  const lastPos = useRef({ px: 0, pz: 0, rx: 0, rz: 0, t: 0 });

  useEffect(() => {
    if (mode !== "lab") return;
    const dur = personTimeline.length
      ? personTimeline[personTimeline.length - 1].t
      : 1;
    useLabStore.getState().setDuration(dur);
    useLabStore.getState().setTime(0);
  }, [mode, personTimeline, selectedId]);

  // Kit actors + orchestrator (~2.5 Hz)
  useEffect(() => {
    if (mode !== "lab") return;
    let alive = true;
    const tick = async () => {
      const [actors, orch] = await Promise.all([
        fetchKitActors(),
        fetchOrchestrator(),
      ]);
      if (!alive) return;
      if (actors) kitRef.current = actors;
      const actions = orch?.actions || [];
      const raw =
        actions.find((a) => a.action === "hold")?.action ||
        actions.find((a) => a.action === "slow")?.action ||
        actions[0]?.action ||
        null;
      useLabStore.getState().setOrchPolicy({
        action: raw,
        label: policyLabel(raw),
        live: Boolean(orch?.enabled && actions.length),
        kitRobotLive: Boolean(
          actors?.pedestrians.some(
            (p) => p.cls === "robot" || p.type === "delivery_robot",
          ),
        ),
      });
    };
    tick();
    const id = window.setInterval(tick, 400);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [mode]);

  // Story clock
  useEffect(() => {
    if (mode !== "lab") return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const store = useLabStore.getState();
      store.tick(dt);

      if (journey && personTimeline.length) {
        const person = sampleTimeline(personTimeline, store.timeS);
        const storyRobot = robotTimeline.length
          ? sampleTimeline(robotTimeline, store.timeS)
          : null;
        const kind =
          journey.stops.find((s) => s.spawn_robot)?.spawn_robot?.kind ||
          "delivery";

        const kitBot = pickKitRobot(kitRef.current, person.pos);
        const robotPos: [number, number, number] | null = kitBot
          ? [kitBot.x, SIDEWALK_Y, kitBot.z]
          : (storyRobot?.pos ?? null);
        const robotKind = robotPos ? (kitBot ? "delivery" : kind) : null;

        const t = store.timeS;
        const dtSafe = Math.max(t - lastPos.current.t, 1 / 60);
        const pvx = (person.pos[0] - lastPos.current.px) / dtSafe;
        const pvz = (person.pos[2] - lastPos.current.pz) / dtSafe;
        let rvx = 0;
        let rvz = 0;
        if (robotPos) {
          rvx = (robotPos[0] - lastPos.current.rx) / dtSafe;
          rvz = (robotPos[2] - lastPos.current.rz) / dtSafe;
        }
        lastPos.current = {
          px: person.pos[0],
          pz: person.pos[2],
          rx: robotPos?.[0] ?? 0,
          rz: robotPos?.[2] ?? 0,
          t,
        };

        let conflict = null;
        if (kitRef.current && kitBot) {
          conflict = cityProximityConflict(kitRef.current);
        } else {
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
          if (robotPos) {
            tracks.push({
              id: "robot",
              cls: "robot",
              x: robotPos[0],
              y: robotPos[2],
              vx: rvx,
              vy: rvz,
              speed: Math.hypot(rvx, rvz),
              history: [],
            });
          }
          conflict = buildConflict(tracks);
        }

        // Prefer opt-in / store comfort when the selected persona has an override.
        const hasOptIn = Boolean(selectedId && overrides[selectedId]);
        const score = hasOptIn
          ? (comfort?.score ?? 0.5)
          : (person.comfort ?? comfort?.score ?? 0.5);
        store.setPlaybackFrame({
          personPos: person.pos,
          robotPos,
          robotKind,
          beat: person.beat || null,
          comfort: score,
          label: person.label || null,
          conflict,
          kitHighlightRobotId: kitBot?.id ?? null,
        });
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, journey, personTimeline, robotTimeline, comfort, overrides, selectedId]);

  return null;
}
