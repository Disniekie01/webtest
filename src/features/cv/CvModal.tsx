import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { LEVEL_NAME } from "../../data/mockTracks";
import type { ConflictSnapshot } from "../../data/types";
import { useLabStore } from "../../state/store";
import { useAscStore } from "../../state/ascStore";
import { drawCityMap, getCityHeatmap } from "../../cv/cityMap";
import {
  collectComfortDeposits,
  getComfortZoneGrid,
  publishComfortZones,
  type ComfortZoneSnapshot,
} from "../../cv/comfortZones";
import {
  calibrateYardline,
  conflictFromYardline,
  fetchKitActors,
  fetchOrchestrator,
  fetchYardlineBriefing,
  fetchYardlineIncidents,
  getYardlineClient,
  postYardlineLabel,
  TWIN_FEED_URL,
  trackAimUv,
  type KitActorsPayload,
  type OrchestratorPayload,
  type YardlineBriefing,
  type YardlineFrame,
  type YardlineIncident,
  type YardlineStatus,
} from "../../cv/yardlineClient";
import "./CvModal.css";

const TRACK_COLORS: Record<string, string> = {
  worker: "#8ec3d4",
  person: "#8ec3d4",
  machine: "#e0a05a",
  vehicle: "#e0a05a",
  robot: "#e0a05a",
};

function drawHeadingArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const mag = Math.hypot(dx, dy);
  if (mag < 6) return;
  const ang = Math.atan2(dy, dx);
  const head = Math.min(12, mag * 0.28);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
  ctx.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}

/**
 * Full-screen Yardline CV workspace (hero menu → CV).
 * Twin JPEG + city map + tools (PII, calibrate, pairs, briefing, incidents, labels).
 */
export function CvModal() {
  const show = useAscStore((s) => s.mode === "cv");
  const closeCv = useAscStore((s) => s.closeCv);
  const storeConflict = useLabStore((s) => s.conflict);
  const personPos = useLabStore((s) => s.personPos);
  const robotPos = useLabStore((s) => s.robotPos);
  const kitHighlightRobotId = useLabStore((s) => s.kitHighlightRobotId);
  const selectedId = useLabStore((s) => s.selectedId);
  const comfortOverrides = useLabStore((s) => s.comfortOverrides);

  const feedRef = useRef<HTMLCanvasElement>(null);
  const planRef = useRef<HTMLCanvasElement>(null);
  const jpegImg = useRef<HTMLImageElement | null>(null);

  const [yl, setYl] = useState<YardlineStatus | null>(null);
  const [actors, setActors] = useState<KitActorsPayload | null>(null);
  const [orch, setOrch] = useState<OrchestratorPayload | null>(null);
  const [mapConflict, setMapConflict] = useState<ConflictSnapshot | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calClicks, setCalClicks] = useState<[number, number][]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<YardlineBriefing | null>(null);
  const [incidents, setIncidents] = useState<YardlineIncident[]>([]);
  const [sideTab, setSideTab] = useState<"pairs" | "brief" | "incidents">("pairs");
  const [showHeat, setShowHeat] = useState(true);
  const [showComfort, setShowComfort] = useState(true);
  const [heatWindow, setHeatWindow] = useState(120);
  const [zoneSnap, setZoneSnap] = useState<ComfortZoneSnapshot | null>(null);
  const heatRef = useRef(getCityHeatmap());
  const zoneRef = useRef(getComfortZoneGrid());


  useEffect(() => {
    if (!show) return;
    document.body.classList.add("cv-modal-open");
    return () => document.body.classList.remove("cv-modal-open");
  }, [show]);

  useEffect(() => {
    if (!show) {
      getYardlineClient().pause();
      return;
    }
    const client = getYardlineClient();
    const unsub = client.subscribe(setYl);
    client.play();
    return () => {
      unsub();
      client.pause();
    };
  }, [show]);

  // Kit actor poll for 2D map + heatmap deposit + orchestrator policy
  useEffect(() => {
    if (!show) return;
    let alive = true;
    const tick = async () => {
      const [payload, policy] = await Promise.all([fetchKitActors(), fetchOrchestrator()]);
      if (!alive) return;
      if (payload) {
        setActors(payload);
        if (showHeat) heatRef.current.step(payload);
      }
      if (policy) setOrch(policy);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [show, showHeat]);

  useEffect(() => {
    heatRef.current.setWindow(heatWindow);
  }, [heatWindow]);

  // Comfort zones from opt-in / personas → map + Kit API
  useEffect(() => {
    if (!show) return;
    const deposits = collectComfortDeposits({
      overrides: comfortOverrides,
      selectedId,
      personPos,
      optInOnly: true,
    });
    const grid = zoneRef.current;
    grid.rebuild(deposits);
    const snap = grid.snapshot(deposits);
    setZoneSnap(snap);
    void publishComfortZones(snap);
  }, [show, comfortOverrides, selectedId, personPos]);

  useEffect(() => {
    if (!show) return;
    let alive = true;
    const refresh = async () => {
      const [b, inc] = await Promise.all([fetchYardlineBriefing(), fetchYardlineIncidents()]);
      if (!alive) return;
      if (b) setBriefing(b);
      setIncidents(inc);
    };
    refresh();
    const id = window.setInterval(refresh, 8000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCv();
      if (e.key === " " && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        const c = getYardlineClient();
        if (yl?.playing) c.pause();
        else c.resumePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, closeCv, yl?.playing]);

  // Camera draw — Yardline tracks + Kit-projected delivery robots (YOLO misses amber cubes)
  useEffect(() => {
    if (!show) return;
    const feed = feedRef.current;
    if (!feed) return;
    const fctx = feed.getContext("2d");
    if (!fctx) return;
    const fw = feed.width;
    const fh = feed.height;
    const frame = yl?.lastFrame ?? null;

    const drawFallback = (label: string) => {
      fctx.fillStyle = "#12181a";
      fctx.fillRect(0, 0, fw, fh);
      fctx.fillStyle = "#9aa8a6";
      fctx.font = '14px "IBM Plex Mono", monospace';
      fctx.fillText(label, 20, 36);
    };

    if (!frame) {
      drawFallback(
        yl?.connected
          ? "Waiting for twin frames…"
          : yl?.error || "Yardline offline — start run_yardline_twin.sh",
      );
      return;
    }

    const src = frame.jpeg
      ? `data:image/jpeg;base64,${frame.jpeg}`
      : `${TWIN_FEED_URL}?t=${frame.frame_index}`;
    const img = jpegImg.current ?? new Image();
    jpegImg.current = img;
    const paint = (bmp: HTMLImageElement, f: YardlineFrame) => {
      const iw = bmp.naturalWidth || f.width;
      const ih = bmp.naturalHeight || f.height;
      const scale = Math.min(fw / iw, fh / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (fw - dw) * 0.5;
      const dy = (fh - dh) * 0.5;
      fctx.fillStyle = "#0e1618";
      fctx.fillRect(0, 0, fw, fh);
      fctx.drawImage(bmp, 0, 0, iw, ih, dx, dy, dw, dh);
      // Boxes are in Yardline's resized frame space — map onto displayed image.
      const mapX = (x: number) => dx + (x / Math.max(1, f.width)) * dw;
      const mapY = (y: number) => dy + (y / Math.max(1, f.height)) * dh;

      for (const t of f.tracks || []) {
        if (!t.bbox || t.bbox.length < 4 || t.confirmed === false) continue;
        // Skip coasting tracks (duplicate ghost at last seen spot).
        if (typeof t.time_since_update === "number" && t.time_since_update > 0) continue;
        const [x1, y1, x2, y2] = t.bbox;
        const color = TRACK_COLORS[t.class_name] || "#c4a574";
        fctx.strokeStyle = color;
        fctx.lineWidth = 2;
        fctx.strokeRect(mapX(x1), mapY(y1), mapX(x2) - mapX(x1), mapY(y2) - mapY(y1));
        fctx.fillStyle = color;
        fctx.font = '12px "IBM Plex Mono", monospace';
        fctx.fillText(`${t.class_name} #${t.id}`, mapX(x1), mapY(y1) - 6);
        const foot = t.foot ?? ([0.5 * (x1 + x2), y2] as [number, number]);
        fctx.beginPath();
        fctx.arc(mapX(foot[0]), mapY(foot[1]), 4, 0, Math.PI * 2);
        fctx.fill();
        const aim = trackAimUv(t);
        if (aim) drawHeadingArrow(fctx, mapX(aim[0]), mapY(aim[1]), mapX(aim[2]), mapY(aim[3]), color);
      }

      // Kit UV robot overlays disabled (were blank spots). Mesh is visible in the twin JPEG;
      // map pane still shows amber bot markers from Kit actors.
      void actors;

      if (calibrating && calClicks.length) {
        fctx.fillStyle = "#e0a05a";
        calClicks.forEach(([cx, cy], i) => {
          fctx.beginPath();
          fctx.arc(mapX(cx), mapY(cy), 6, 0, Math.PI * 2);
          fctx.fill();
          fctx.fillText(String(i + 1), mapX(cx) + 8, mapY(cy) - 4);
        });
      }
    };

    if (img.src === src && img.complete && img.naturalWidth > 0) paint(img, frame);
    else {
      img.onload = () => paint(img, frame);
      img.src = src;
    }
  }, [show, yl, calibrating, calClicks, actors]);

  // City map
  useEffect(() => {
    if (!show) return;
    const plan = planRef.current;
    if (!plan) return;
    const pctx = plan.getContext("2d");
    if (!pctx) return;
    const c = drawCityMap(pctx, plan.width, plan.height, actors, {
      personPos,
      robotPos,
      conflict: storeConflict,
      heatmap: heatRef.current,
      showHeat,
      comfortGrid: zoneRef.current,
      comfortZones: zoneSnap,
      showComfort,
      storyGhost: true,
      highlightRobotId: kitHighlightRobotId,
    });
    setMapConflict(c);
  }, [
    show,
    actors,
    personPos,
    robotPos,
    kitHighlightRobotId,
    storeConflict,
    showHeat,
    heatWindow,
    showComfort,
    zoneSnap,
  ]);

  const onFeedClick = async (e: MouseEvent<HTMLCanvasElement>) => {
    if (!calibrating || !yl?.lastFrame) return;
    const canvas = feedRef.current;
    const frame = yl.lastFrame;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top) * sy;
    const scale = Math.min(canvas.width / frame.width, canvas.height / frame.height);
    const dw = frame.width * scale;
    const dh = frame.height * scale;
    const dx = (canvas.width - dw) * 0.5;
    const dy = (canvas.height - dh) * 0.5;
    const ix = (cx - dx) / scale;
    const iy = (cy - dy) / scale;
    if (ix < 0 || iy < 0 || ix > frame.width || iy > frame.height) return;
    const next = [...calClicks, [ix, iy] as [number, number]];
    setCalClicks(next);
    if (next.length >= 4) {
      setNote("Calibrating plane…");
      const res = await calibrateYardline(next);
      setNote(res.ok ? `Plane OK · rms ${res.rms_px?.toFixed(1) ?? "?"} px` : res.detail || "Failed");
      setCalibrating(false);
      setCalClicks([]);
    } else setNote(`Ground point ${next.length}/4`);
  };

  if (!show) return null;

  const frame = yl?.lastFrame ?? null;
  const liveConflict = frame ? conflictFromYardline(frame) : null;
  const conflict = (() => {
    if (liveConflict && mapConflict) {
      const alarm = Math.max(liveConflict.alarm, mapConflict.alarm) as 0 | 1 | 2 | 3;
      return {
        tracks: [...liveConflict.tracks, ...mapConflict.tracks],
        pairs: [
          ...liveConflict.pairs,
          ...mapConflict.pairs.filter(
            (p) =>
              p.track_a.startsWith("bot:") ||
              p.track_b.startsWith("bot:") ||
              p.class_a === "robot" ||
              p.class_b === "robot",
          ),
        ],
        alarm,
        alarm_name: LEVEL_NAME[alarm],
      };
    }
    return liveConflict ?? mapConflict ?? storeConflict;
  })();
  const alarm = conflict?.alarm ?? 0;
  const risk = frame?.risk;
  const pairs = conflict?.pairs ?? [];
  const client = getYardlineClient();

  const ui = (
    <div className="cv-modal-backdrop" role="presentation" onClick={closeCv}>
      <div
        className="cv-modal panel"
        role="dialog"
        aria-modal="true"
        aria-label="Yardline CV"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cv-modal-head">
          <div className="cv-modal-title">
            <span className="brand-mark">Yardline</span>
            <span className="mono muted">CV · twin paused · JPEG only</span>
          </div>
          <div className="cv-kpi-bar mono">
            <span className={`alarm alarm-${alarm}`}>{LEVEL_NAME[alarm as 0 | 1 | 2 | 3]}</span>
            <span>
              TTC{" "}
              {risk?.min_ttc_s != null
                ? `${risk.min_ttc_s.toFixed(1)}s`
                : pairs[0]?.ttc_s != null
                  ? `${pairs[0].ttc_s.toFixed(1)}s`
                  : "—"}
            </span>
            <span>
              Clr{" "}
              {risk?.min_clearance_m != null
                ? `${risk.min_clearance_m.toFixed(2)}m`
                : pairs[0]
                  ? `${pairs[0].distance_m.toFixed(2)}m`
                  : "—"}
            </span>
            <span>
              P{" "}
              {actors
                ? actors.pedestrians.filter((p) => p.cls !== "robot").length
                : (frame?.n_workers ?? 0)}
            </span>
            <span>
              R{" "}
              {actors
                ? actors.pedestrians.filter(
                    (p) => p.cls === "robot" || p.type === "delivery_robot",
                  ).length
                : 0}
            </span>
            <span>V {frame?.n_vehicles ?? actors?.vehicles.length ?? 0}</span>
            <span>
              Policy{" "}
              {orch?.enabled === false
                ? "off"
                : orch?.actions?.length
                  ? [...new Set(orch.actions.map((a) => a.action))].join("/")
                  : "—"}
            </span>
            <span>{frame?.latency_ms != null ? `${Math.round(frame.latency_ms)} ms` : "—"}</span>
            <span>{yl?.calibrated ? "Plane" : "No plane"}</span>
            <span>{yl?.piiRedacted !== false ? "PII" : "RAW"}</span>
          </div>
          <button type="button" className="cv-close" onClick={closeCv} aria-label="Close">
            Close
          </button>
        </header>

        <div className="cv-modal-tools">
          <button
            type="button"
            className="chip-toggle on"
            onClick={() => (yl?.playing ? client.pause() : client.resumePlay())}
          >
            {yl?.playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="chip-toggle" onClick={() => client.step()}>
            Step
          </button>
          <button type="button" className="chip-toggle" onClick={() => client.restart()}>
            Restart
          </button>
          <button
            type="button"
            className={`chip-toggle ${yl?.piiRedacted !== false ? "on" : ""}`}
            onClick={() => void client.setPii(!(yl?.piiRedacted !== false))}
          >
            Redact PII
          </button>
          <button
            type="button"
            className={`chip-toggle ${calibrating ? "on" : ""}`}
            onClick={() => {
              setCalibrating((v) => !v);
              setCalClicks([]);
              setNote(calibrating ? null : "Click 4 ground points on the camera");
            }}
          >
            Calibrate
          </button>
          <button
            type="button"
            className="chip-toggle"
            onClick={async () => {
              const r = await postYardlineLabel("near_miss", "citylab cv modal");
              setNote(r.ok ? "Labeled near_miss" : r.detail || "Label failed");
            }}
          >
            Label near-miss
          </button>
          <button
            type="button"
            className="chip-toggle"
            onClick={async () => {
              const r = await postYardlineLabel("false_alarm");
              setNote(r.ok ? "Labeled false_alarm" : r.detail || "Label failed");
            }}
          >
            False alarm
          </button>
          <button
            type="button"
            className={`chip-toggle ${showHeat ? "on" : ""}`}
            onClick={() => setShowHeat((v) => !v)}
            title="Occupancy heat from Kit / SUMO poses"
          >
            Heatmap
          </button>
          <button
            type="button"
            className={`chip-toggle ${showComfort ? "on" : ""}`}
            onClick={() => setShowComfort((v) => !v)}
            title="Comfort zones from opt-in / personas"
          >
            Comfort zones
          </button>
          <select
            className="cv-heat-window mono"
            value={heatWindow}
            onChange={(e) => setHeatWindow(Number(e.target.value))}
            title="Heat window"
            aria-label="Heat window"
          >
            <option value={60}>Heat 60s</option>
            <option value={120}>Heat 120s</option>
            <option value={300}>Heat 300s</option>
          </select>
          <button
            type="button"
            className="chip-toggle"
            onClick={() => {
              heatRef.current.reset();
              setNote("Heatmap cleared");
            }}
          >
            Clear heat
          </button>
          <a className="chip-toggle link" href="/yardline/annotate" target="_blank" rel="noreferrer">
            Annotate
          </a>
          <a className="chip-toggle link" href="/yardline/api/report" target="_blank" rel="noreferrer">
            Report
          </a>
        </div>

        {(note || yl?.error) && <div className="cv-modal-note mono">{note || yl?.error}</div>}

        <div className="cv-modal-body">
          <div className="cv-stage">
            <div className="cv-stage-pane">
              <div className="cv-stage-label mono muted">Live cam · boxes · headings</div>
              <div className="cv-canvas-frame">
                <canvas
                  ref={feedRef}
                  width={1280}
                  height={720}
                  className={`cv-feed-lg ${calibrating ? "calibrating" : ""}`}
                  onClick={onFeedClick}
                />
              </div>
            </div>
            <div className="cv-stage-pane">
              <div className="cv-stage-label mono muted">
                City map · Kit / SUMO
                {showHeat ? ` · heat ${heatWindow}s` : ""}
                {showComfort
                  ? ` · comfort ${zoneSnap?.cells.length ?? 0} cells`
                  : ""}
              </div>
              <div className="cv-canvas-frame">
                <canvas ref={planRef} width={1280} height={720} className="cv-plan-lg" />
              </div>
            </div>
          </div>

          <aside className="cv-side">
            <div className="cv-side-tabs">
              <button
                type="button"
                className={`chip-toggle ${sideTab === "pairs" ? "on" : ""}`}
                onClick={() => setSideTab("pairs")}
              >
                Pairs
              </button>
              <button
                type="button"
                className={`chip-toggle ${sideTab === "brief" ? "on" : ""}`}
                onClick={() => setSideTab("brief")}
              >
                Briefing
              </button>
              <button
                type="button"
                className={`chip-toggle ${sideTab === "incidents" ? "on" : ""}`}
                onClick={() => setSideTab("incidents")}
              >
                Incidents
              </button>
            </div>

            {sideTab === "pairs" && (
              <div className="cv-table-wrap">
                <table className="cv-table mono">
                  <thead>
                    <tr>
                      <th>A</th>
                      <th>B</th>
                      <th>Dist</th>
                      <th>TTC</th>
                      <th>Lvl</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted">
                          No pairs yet — calibrate for vision TTC, or wait for Kit proximity.
                        </td>
                      </tr>
                    )}
                    {pairs.slice(0, 16).map((p) => (
                      <tr key={`${p.track_a}-${p.track_b}`}>
                        <td>
                          {p.class_a} {p.track_a}
                        </td>
                        <td>
                          {p.class_b} {p.track_b}
                        </td>
                        <td>{p.distance_m.toFixed(2)}</td>
                        <td>{p.ttc_s != null ? p.ttc_s.toFixed(1) : "—"}</td>
                        <td className={`alarm-${p.level}`}>{LEVEL_NAME[p.level]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {sideTab === "brief" && (
              <div className="cv-brief">
                <h3>{briefing?.title || "Shift note"}</h3>
                <p>{briefing?.body || "Play twin frames to assemble a briefing from the last inference."}</p>
                {briefing?.bullets && (
                  <ul>
                    {briefing.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {sideTab === "incidents" && (
              <div className="cv-incidents mono">
                {incidents.length === 0 && <p className="muted">No incidents yet.</p>}
                {incidents.map((inc, i) => (
                  <div key={inc.id || i} className="cv-incident">
                    <strong>{inc.alarm || "event"}</strong>
                    <span>
                      ttc {inc.min_ttc_s ?? "—"} · clr {inc.min_clearance_m ?? "—"}
                    </span>
                    <span className="muted">{inc.created_at || ""}</span>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}
