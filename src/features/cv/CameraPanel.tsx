import { useEffect, useRef } from "react";
import { LEVEL_NAME } from "../../data/mockTracks";
import { useLabStore } from "../../state/store";
import "./CameraPanel.css";

/**
 * Yardline-inspired mock CV: live camera view + top-down clearance plan
 * with person/robot tracks and TTC when they close.
 */
export function CameraPanel() {
  const show = useLabStore((s) => s.showCv);
  const conflict = useLabStore((s) => s.conflict);
  const personPos = useLabStore((s) => s.personPos);
  const robotPos = useLabStore((s) => s.robotPos);
  const robotKind = useLabStore((s) => s.robotKind);
  const feedRef = useRef<HTMLCanvasElement>(null);
  const planRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!show) return;
    const feed = feedRef.current;
    const plan = planRef.current;
    if (!feed || !plan) return;

    const fctx = feed.getContext("2d");
    const pctx = plan.getContext("2d");
    if (!fctx || !pctx) return;

    const fw = feed.width;
    const fh = feed.height;
    // Fake CCTV feed
    const grd = fctx.createLinearGradient(0, 0, fw, fh);
    grd.addColorStop(0, "#1a2430");
    grd.addColorStop(1, "#2a3834");
    fctx.fillStyle = grd;
    fctx.fillRect(0, 0, fw, fh);
    fctx.strokeStyle = "rgba(94,184,176,0.25)";
    fctx.strokeRect(8, 8, fw - 16, fh - 16);
    fctx.fillStyle = "#9aa8a6";
    fctx.font = "11px IBM Plex Mono, monospace";
    fctx.fillText("CAM-03  PLAZA EDGE  ·  MOCK FEED", 16, 24);
    fctx.fillText(new Date().toISOString().slice(11, 19) + "Z", 16, 40);

    // Project agents as boxes on “camera”
    const px = fw * 0.45 + personPos[0] * 6;
    const py = fh * 0.55 - personPos[2] * 3;
    fctx.strokeStyle = "#8ec3d4";
    fctx.strokeRect(px - 18, py - 40, 36, 70);
    fctx.fillText("person", px - 18, py - 44);

    if (robotPos) {
      const rx = fw * 0.45 + robotPos[0] * 6;
      const ry = fh * 0.55 - robotPos[2] * 3;
      fctx.strokeStyle = "#e0a05a";
      fctx.strokeRect(rx - 28, ry - 22, 56, 40);
      fctx.fillText(robotKind || "robot", rx - 28, ry - 26);
    }

    // Top-down plan (Yardline plan canvas)
    const pw = plan.width;
    const ph = plan.height;
    pctx.fillStyle = "#12181a";
    pctx.fillRect(0, 0, pw, ph);
    pctx.strokeStyle = "rgba(242,239,232,0.1)";
    for (let i = 0; i < 8; i++) {
      pctx.beginPath();
      pctx.moveTo((i / 7) * pw, 0);
      pctx.lineTo((i / 7) * pw, ph);
      pctx.stroke();
      pctx.beginPath();
      pctx.moveTo(0, (i / 7) * ph);
      pctx.lineTo(pw, (i / 7) * ph);
      pctx.stroke();
    }

    const toPlan = (x: number, z: number) => [
      pw * 0.5 + x * 8,
      ph * 0.5 + z * 8,
    ] as const;

    const [ppx, ppy] = toPlan(personPos[0], personPos[2]);
    pctx.fillStyle = "#8ec3d4";
    pctx.beginPath();
    pctx.arc(ppx, ppy, 6, 0, Math.PI * 2);
    pctx.fill();

    if (robotPos) {
      const [rpx, rpy] = toPlan(robotPos[0], robotPos[2]);
      pctx.fillStyle = "#e0a05a";
      pctx.fillRect(rpx - 8, rpy - 5, 16, 10);

      // Clearance ring
      const dist = Math.hypot(personPos[0] - robotPos[0], personPos[2] - robotPos[2]);
      const alarm = conflict?.alarm ?? 0;
      pctx.strokeStyle =
        alarm >= 3
          ? "rgba(212,91,74,0.7)"
          : alarm >= 2
            ? "rgba(224,160,90,0.7)"
            : "rgba(142,195,212,0.45)";
      pctx.beginPath();
      pctx.arc(rpx, rpy, Math.max(12, dist * 8), 0, Math.PI * 2);
      pctx.stroke();

      pctx.strokeStyle = "rgba(242,239,232,0.35)";
      pctx.beginPath();
      pctx.moveTo(ppx, ppy);
      pctx.lineTo(rpx, rpy);
      pctx.stroke();
    }

    pctx.fillStyle = "#9c968b";
    pctx.font = "10px IBM Plex Mono, monospace";
    pctx.fillText("TOP-DOWN CLEARANCE  ·  YARDLINE MODEL", 10, 16);
  }, [show, conflict, personPos, robotPos, robotKind]);

  if (!show) return null;

  const alarm = conflict?.alarm ?? 0;
  const pair = conflict?.pairs[0];

  return (
    <aside className="camera-panel panel">
      <div className="cv-head">
        <span className="mono muted">YARDLINE CV</span>
        <span className={`alarm alarm-${alarm}`}>
          {LEVEL_NAME[alarm as 0 | 1 | 2 | 3]}
        </span>
      </div>
      <canvas ref={feedRef} width={320} height={160} className="cv-feed" />
      <canvas ref={planRef} width={320} height={160} className="cv-plan" />
      <div className="cv-kpis mono">
        <div>
          <span className="muted">dist</span>{" "}
          {pair ? `${pair.distance_m.toFixed(2)} m` : "—"}
        </div>
        <div>
          <span className="muted">ttc</span>{" "}
          {pair?.ttc_s != null ? `${pair.ttc_s.toFixed(1)} s` : "—"}
        </div>
        <div>
          <span className="muted">closing</span>{" "}
          {pair ? (pair.closing ? "yes" : "no") : "—"}
        </div>
      </div>
    </aside>
  );
}
