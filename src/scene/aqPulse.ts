import { JUNCTION_XS } from "../data/cityGrid";

export type AqBand = "good" | "moderate" | "unhealthy" | "hazard";

export type AqCell = {
  id: string;
  /** Block center XZ */
  x: number;
  z: number;
  /** Half extents of the block footprint */
  hw: number;
  hd: number;
  /** Baseline AQI 0..200-ish */
  baseAqi: number;
  /** Activity / pulse energy 0..1 */
  pulse: number;
  seed: number;
};

export type AqSensor = {
  id: string;
  x: number;
  z: number;
  label: string;
};

export type WindState = {
  /** Radians, meteorological-ish */
  heading: number;
  speed: number;
};

const BLOCK = 40;

/** Interior block centers between the 5×5 junction grid. */
export function buildAqCells(): AqCell[] {
  const cells: AqCell[] = [];
  let n = 0;
  for (let i = 0; i < JUNCTION_XS.length - 1; i++) {
    for (let j = 0; j < JUNCTION_XS.length - 1; j++) {
      const x0 = JUNCTION_XS[i];
      const x1 = JUNCTION_XS[i + 1];
      const z0 = JUNCTION_XS[j];
      const z1 = JUNCTION_XS[j + 1];
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      // Harbor / plaza / dock get dirtier baselines
      const distPlaza = Math.hypot(cx, cz);
      const harborBias = cx < -20 ? 18 : 0;
      const dockBias = cz > 40 ? 22 : 0;
      const coreBias = distPlaza < 35 ? 12 : 0;
      const seed = ((n * 47) % 100) / 100;
      const baseAqi = 28 + seed * 35 + harborBias + dockBias + coreBias;
      const pulse = 0.25 + seed * 0.45 + (distPlaza < 40 ? 0.2 : 0);
      cells.push({
        id: `aq-${i}-${j}`,
        x: cx,
        z: cz,
        hw: (BLOCK - 10) / 2,
        hd: (BLOCK - 10) / 2,
        baseAqi,
        pulse: Math.min(1, pulse),
        seed,
      });
      n += 1;
    }
  }
  return cells;
}

/** Junction air sensors. */
export function buildAqSensors(): AqSensor[] {
  const labels = ["N", "E", "S", "W", "C"];
  const picks: Array<[number, number, string]> = [
    [JUNCTION_XS[0], JUNCTION_XS[2], "West Harbor"],
    [JUNCTION_XS[2], JUNCTION_XS[0], "North Ridge"],
    [JUNCTION_XS[2], JUNCTION_XS[2], "Civic Core"],
    [JUNCTION_XS[2], JUNCTION_XS[4], "South Dock"],
    [JUNCTION_XS[4], JUNCTION_XS[2], "East Gate"],
  ];
  return picks.map(([x, z, name], i) => ({
    id: `sens-${labels[i]}`,
    x,
    z,
    label: name,
  }));
}

/** Activity pulse emitters — plazas / hubs that beat. */
export function buildPulseEmitters() {
  return [
    { id: "pulse-plaza", x: 0, z: 0, strength: 1, period: 3.2 },
    { id: "pulse-market", x: JUNCTION_XS[1], z: 0, strength: 0.75, period: 2.6 },
    { id: "pulse-dock", x: JUNCTION_XS[1], z: JUNCTION_XS[4], strength: 0.85, period: 2.9 },
    { id: "pulse-uni", x: JUNCTION_XS[3], z: JUNCTION_XS[1], strength: 0.55, period: 3.8 },
  ];
}

export function aqiBand(aqi: number): AqBand {
  if (aqi < 50) return "good";
  if (aqi < 80) return "moderate";
  if (aqi < 120) return "unhealthy";
  return "hazard";
}

/** Soft creative palette — sage → amber → terracotta (no purple). */
export function aqiColor(aqi: number): string {
  const t = Math.max(0, Math.min(1, (aqi - 25) / 100));
  if (t < 0.35) {
    // good → mild
    return lerpHex("#5eb8a0", "#a8c47a", t / 0.35);
  }
  if (t < 0.65) {
    return lerpHex("#a8c47a", "#c4a05a", (t - 0.35) / 0.3);
  }
  return lerpHex("#c4a05a", "#c45c4a", (t - 0.65) / 0.35);
}

function lerpHex(a: string, b: string, t: number) {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function liveAqi(base: number, elapsed: number, seed: number, wind: WindState) {
  // Slow breath + wind-driven churn
  const breath = Math.sin(elapsed * 0.55 + seed * 8);
  const gust = Math.sin(elapsed * 1.1 + seed * 3) * wind.speed * 8;
  return Math.max(18, Math.min(160, base + breath * 10 + gust));
}

export function livePulse(base: number, elapsed: number, seed: number) {
  const beat = 0.5 + 0.5 * Math.sin(elapsed * (1.8 + seed) + seed * 5);
  return Math.max(0.1, Math.min(1, base * (0.65 + beat * 0.55)));
}

export function windAt(elapsed: number): WindState {
  // Slowly veering breeze
  const heading = elapsed * 0.12 + Math.sin(elapsed * 0.07) * 0.4;
  const speed = 0.55 + 0.35 * Math.sin(elapsed * 0.2);
  return { heading, speed };
}

export function bandLabel(b: AqBand) {
  if (b === "good") return "good";
  if (b === "moderate") return "moderate";
  if (b === "unhealthy") return "unhealthy";
  return "hazard";
}
