import { useEffect, useState } from "react";
import { telemetry } from "../../state/ascStore";
import type { RobotTelemetry } from "../../data/ascTypes";

export type LiveRobot = RobotTelemetry & {
  batterySeries: number[];
  cpu: number;
  thermal: number;
  linkPct: number;
  rangeM: number;
  lidarHz: number;
};

const HISTORY = 24;

function seedSeries(base: number, id: string): number[] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const out: number[] = [];
  let v = base;
  for (let i = 0; i < HISTORY; i++) {
    const n = ((Math.abs(h + i * 17) % 100) / 100 - 0.5) * 0.04;
    v = Math.max(0.08, Math.min(0.98, v + n - 0.003));
    out.push(v);
  }
  return out;
}

function stepRobot(r: LiveRobot, t: number): LiveRobot {
  const drain = r.kind === "drone" ? 0.004 : r.speedMps > 0.2 ? 0.0025 : 0.001;
  const wobble = Math.sin(t * 0.7 + r.battery * 10) * 0.008;
  const nextBat = Math.max(0.05, Math.min(0.99, r.battery - drain * 0.15 + wobble * 0.02));
  const series = [...r.batterySeries.slice(1), nextBat];
  return {
    ...r,
    battery: nextBat,
    speedMps: Math.max(0, r.speedMps + Math.sin(t * 1.1 + r.cpu) * 0.15),
    cpu: Math.max(12, Math.min(92, r.cpu + Math.sin(t * 0.9 + r.thermal) * 3)),
    thermal: Math.max(28, Math.min(68, r.thermal + Math.sin(t * 0.5) * 1.2)),
    linkPct: Math.max(70, Math.min(99, r.linkPct + Math.sin(t * 1.4) * 2)),
    rangeM: Math.max(12, Math.min(48, r.rangeM + Math.sin(t * 0.6) * 1.5)),
    batterySeries: series,
    lastUpdate: "live",
  };
}

function init(): LiveRobot[] {
  return telemetry.map((r, i) => ({
    ...r,
    batterySeries: seedSeries(r.battery, r.id),
    cpu: 35 + (i * 11) % 40,
    thermal: 34 + (i * 5) % 18,
    linkPct: 88 + (i % 10),
    rangeM: 22 + (i % 7) * 2,
    lidarHz: r.kind === "drone" ? 20 : 15,
  }));
}

/** Live-updating fleet telemetry with battery history for sparklines. */
export function useLiveTelemetry(active: boolean, intervalMs = 700) {
  const [robots, setRobots] = useState(init);

  useEffect(() => {
    if (!active) return;
    let t = 0;
    const id = window.setInterval(() => {
      t += intervalMs / 1000;
      setRobots((prev) => prev.map((r) => stepRobot(r, t)));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  return robots;
}
