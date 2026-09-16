/** Same-origin Yardline WS bridge (:8010 via Vite /yardline). */

import type { ConflictSnapshot, PairRisk, YardTrack } from "../data/types";
import { LEVEL_NAME } from "../data/mockTracks";

export type YardlineTrackMsg = {
  id: number | string;
  class_name: string;
  confirmed?: boolean;
  bbox: [number, number, number, number];
  conf?: number;
  foot?: [number, number];
  /** Camera UV heading segment [u0,v0,u1,v1] from Yardline (plane or px velocity). */
  aim_uv?: [number, number, number, number] | null;
  hx?: number;
  hy?: number;
  heading_ready?: boolean;
  vx_px?: number;
  vy_px?: number;
  x_m?: number | null;
  y_m?: number | null;
  vx_mps?: number;
  vy_mps?: number;
  speed_mps?: number;
  history_m?: [number, number][];
};

export type YardlineFrame = {
  type: "frame";
  frame_index: number;
  width: number;
  height: number;
  jpeg: string;
  calibrated: boolean;
  pii_redacted?: boolean;
  latency_ms?: number;
  n_workers?: number;
  n_vehicles?: number;
  n_machines?: number;
  events?: Array<{ kind?: string; text?: string; alarm?: string; t?: number }>;
  tracks: YardlineTrackMsg[];
  risk?: {
    pairs?: Array<{
      track_a: number | string;
      track_b: number | string;
      class_a: string;
      class_b: string;
      distance_m: number;
      ttc_s: number | null;
      closing: boolean;
      clearance_m?: number;
    }>;
    alarm?: string;
    alarm_level?: number;
    min_ttc_s?: number | null;
    min_distance_m?: number | null;
    min_clearance_m?: number | null;
  };
  detections?: Array<{ class_name: string; conf: number; bbox: number[] }>;
};

export type YardlineStatus = {
  connected: boolean;
  playing: boolean;
  calibrated: boolean;
  piiRedacted: boolean;
  error: string | null;
  lastFrame: YardlineFrame | null;
};

type Listener = (status: YardlineStatus) => void;

const TWIN_SOURCE = "http://127.0.0.1:5175/viewport/frame.jpg";

function mapCls(name: string): YardTrack["cls"] {
  const n = name.toLowerCase();
  if (n === "worker" || n === "person" || n === "pedestrian") return "person";
  if (n.includes("taxi") || n.includes("robotaxi")) return "robotaxi";
  if (n.includes("assist")) return "assistive";
  return "robot";
}

/** Map Yardline risk packet → City Lab ConflictSnapshot (when calibrated). */
export function conflictFromYardline(frame: YardlineFrame): ConflictSnapshot | null {
  const risk = frame.risk;
  if (!frame.calibrated || !risk) return null;
  const tracks: YardTrack[] = (frame.tracks || [])
    .filter((t) => t.x_m != null && t.y_m != null)
    .map((t) => ({
      id: String(t.id),
      cls: mapCls(t.class_name),
      x: Number(t.x_m),
      y: Number(t.y_m),
      vx: t.vx_mps ?? 0,
      vy: t.vy_mps ?? 0,
      speed: t.speed_mps ?? 0,
      history: (t.history_m || []) as [number, number][],
    }));
  const pairs: PairRisk[] = (risk.pairs || []).map((p) => {
    const level = ((): 0 | 1 | 2 | 3 => {
      const d = p.clearance_m ?? p.distance_m;
      if (d < 0.5 || (p.ttc_s != null && p.closing && p.ttc_s < 1.5)) return 3;
      if (d < 2 || (p.ttc_s != null && p.closing && p.ttc_s < 3)) return 2;
      if (d < 4 || (p.ttc_s != null && p.closing && p.ttc_s < 5)) return 1;
      return 0;
    })();
    return {
      track_a: String(p.track_a),
      track_b: String(p.track_b),
      class_a: p.class_a,
      class_b: p.class_b,
      distance_m: p.distance_m,
      ttc_s: p.ttc_s,
      closing: p.closing,
      level,
    };
  });
  const alarm = (Math.min(3, Math.max(0, risk.alarm_level ?? 0)) as 0 | 1 | 2 | 3);
  return {
    tracks,
    pairs,
    alarm,
    alarm_name: LEVEL_NAME[alarm] ?? risk.alarm ?? "clear",
  };
}

export class YardlineClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private status: YardlineStatus = {
    connected: false,
    playing: false,
    calibrated: false,
    piiRedacted: true,
    error: null,
    lastFrame: null,
  };
  private sourcePath = TWIN_SOURCE;
  private wantPlay = false;
  private wantPii = true;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.status);
  }

  private set(partial: Partial<YardlineStatus>) {
    this.status = { ...this.status, ...partial };
    this.emit();
  }

  connect(sourcePath = TWIN_SOURCE) {
    this.sourcePath = sourcePath;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/yardline/ws/stream`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.set({ connected: true, error: null });
      void setPiiRedaction(this.wantPii).then((on) => this.set({ piiRedacted: on }));
      this.send({ action: "open", path: this.sourcePath });
    };
    ws.onclose = () => {
      this.ws = null;
      this.set({ connected: false, playing: false });
      if (this.wantPlay) {
        window.setTimeout(() => this.connect(this.sourcePath), 2000);
      }
    };
    ws.onerror = () => {
      this.set({ error: "Yardline WS error — is :8010 running?" });
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        if (msg.type === "error") {
          this.set({ error: String(msg.detail ?? "Yardline error") });
          return;
        }
        if (msg.type === "opened") {
          this.set({ error: null });
          if (this.wantPlay) this.send({ action: "play" });
          return;
        }
        if (msg.type === "frame") {
          const frame = msg as unknown as YardlineFrame;
          this.set({
            lastFrame: frame,
            calibrated: Boolean(frame.calibrated),
            piiRedacted: frame.pii_redacted !== false,
            playing: true,
            error: null,
          });
        }
      } catch {
        /* ignore malformed */
      }
    };
  }

  play(sourcePath = TWIN_SOURCE) {
    this.wantPlay = true;
    this.sourcePath = sourcePath;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect(sourcePath);
      return;
    }
    void setPiiRedaction(this.wantPii).then((on) => this.set({ piiRedacted: on }));
    this.send({ action: "open", path: sourcePath });
  }

  async setPii(enabled: boolean): Promise<boolean> {
    this.wantPii = enabled;
    const on = await setPiiRedaction(enabled);
    this.set({ piiRedacted: on });
    return on;
  }

  pause() {
    this.wantPlay = false;
    this.send({ action: "pause" });
    this.set({ playing: false });
  }

  resumePlay() {
    this.wantPlay = true;
    this.send({ action: "play" });
    this.set({ playing: true });
  }

  step() {
    this.wantPlay = false;
    this.send({ action: "step" });
    this.set({ playing: false });
  }

  restart() {
    this.send({ action: "restart" });
  }

  stop() {
    this.wantPlay = false;
    this.send({ action: "stop" });
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.set({ connected: false, playing: false, lastFrame: null });
  }

  private send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

let singleton: YardlineClient | null = null;

export function getYardlineClient(): YardlineClient {
  if (!singleton) singleton = new YardlineClient();
  return singleton;
}

export async function calibrateYardline(
  imagePoints: [number, number][],
  worldPoints: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ],
): Promise<{ ok: boolean; rms_px?: number; detail?: string }> {
  try {
    const res = await fetch("/yardline/api/calibrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_points: imagePoints, world_points: worldPoints }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, detail };
    }
    const j = (await res.json()) as { ok?: boolean; rms_px?: number };
    return { ok: true, rms_px: j.rms_px };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

/** Yardline FaceRedactor on worker/person boxes (baked into JPEG). */
export async function setPiiRedaction(enabled: boolean): Promise<boolean> {
  try {
    const res = await fetch("/yardline/api/privacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) return enabled;
    const j = (await res.json()) as { pii_redacted?: boolean };
    return j.pii_redacted !== false;
  } catch {
    return enabled;
  }
}

/** Resolve cam-space heading tip; prefers Yardline aim_uv, else px velocity / bbox. */
export function trackAimUv(t: YardlineTrackMsg): [number, number, number, number] | null {
  if (t.aim_uv && t.aim_uv.length === 4) {
    const [a, b, c, d] = t.aim_uv;
    if (Math.hypot(c - a, d - b) >= 8) return [a, b, c, d];
  }
  const foot = t.foot ?? (t.bbox ? ([0.5 * (t.bbox[0] + t.bbox[2]), t.bbox[3]] as [number, number]) : null);
  if (!foot) return null;
  const vx = t.vx_px ?? 0;
  const vy = t.vy_px ?? 0;
  const mag = Math.hypot(vx, vy);
  if (mag >= 8) {
    return [foot[0], foot[1], foot[0] + vx * 0.55, foot[1] + vy * 0.55];
  }
  return null;
}

export type KitActor = {
  id: string;
  x: number;
  z: number;
  yaw?: number;
  cls: string;
  type?: string;
};

export type KitActorsPayload = {
  updatedAt: number;
  span_m: number;
  vehicles: KitActor[];
  pedestrians: KitActor[];
};

export async function fetchKitActors(): Promise<KitActorsPayload | null> {
  try {
    const res = await fetch("/viewport/api/actors", { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    return (await res.json()) as KitActorsPayload;
  } catch {
    return null;
  }
}

export type YardlineBriefing = {
  title?: string;
  body?: string;
  bullets?: string[];
};

export async function fetchYardlineBriefing(): Promise<YardlineBriefing | null> {
  try {
    const res = await fetch("/yardline/api/briefing", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    return (await res.json()) as YardlineBriefing;
  } catch {
    return null;
  }
}

export type YardlineIncident = {
  id?: string;
  alarm?: string;
  created_at?: string;
  min_ttc_s?: number | null;
  min_clearance_m?: number | null;
  source?: string;
};

export async function fetchYardlineIncidents(): Promise<YardlineIncident[]> {
  try {
    const res = await fetch("/yardline/api/incidents?limit=12", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    const j = (await res.json()) as { incidents?: YardlineIncident[]; live?: YardlineIncident[] };
    return [...(j.live || []), ...(j.incidents || [])].slice(0, 12);
  } catch {
    return [];
  }
}

export async function postYardlineLabel(
  kind: "near_miss" | "false_alarm" | "controlled",
  note = "",
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch("/yardline/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, note }),
    });
    if (!res.ok) return { ok: false, detail: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}
