import { useEffect, useRef } from "react";
import type { LiveRobot } from "./useLiveTelemetry";

/** Animated top-down LiDAR occupancy / scan sweep. */
export function LidarMapView({ robot }: { robot: LiveRobot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let start = performance.now();
    const obstacles = buildObstacles(robot.id);

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.fillStyle = "#060a0e";
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = "rgba(94,184,176,0.08)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const r = ((i + 1) / 8) * Math.min(cx, cy) * 0.92;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, 8);
      ctx.lineTo(cx, h - 8);
      ctx.moveTo(8, cy);
      ctx.lineTo(w - 8, cy);
      ctx.stroke();

      // Occupancy blobs
      for (const o of obstacles) {
        const pulse = 0.85 + 0.15 * Math.sin(t * 2 + o.phase);
        ctx.fillStyle = `rgba(196,160,90,${0.18 * pulse})`;
        ctx.beginPath();
        ctx.ellipse(cx + o.x, cy + o.z, o.rw * pulse, o.rh * pulse, o.rot, 0, Math.PI * 2);
        ctx.fill();
      }

      // Scan sweep
      const sweep = (t * robot.lidarHz * 0.35) % (Math.PI * 2);
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, Math.min(cx, cy) * 0.9);
      grad.addColorStop(0, "rgba(94,184,176,0.35)");
      grad.addColorStop(1, "rgba(94,184,176,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, Math.min(cx, cy) * 0.9, sweep - 0.45, sweep + 0.05);
      ctx.closePath();
      ctx.fill();

      // Point returns
      const range = Math.min(cx, cy) * 0.88;
      for (let i = 0; i < 120; i++) {
        const ang = (i / 120) * Math.PI * 2 + t * 0.15;
        let hit = range * (0.55 + ((i * 17) % 40) / 100);
        for (const o of obstacles) {
          const dx = Math.cos(ang) * hit - o.x;
          const dz = Math.sin(ang) * hit - o.z;
          if ((dx * dx) / (o.rw * o.rw) + (dz * dz) / (o.rh * o.rh) < 1.1) {
            hit *= 0.72;
            break;
          }
        }
        const px = cx + Math.cos(ang) * hit;
        const pz = cy + Math.sin(ang) * hit;
        const nearSweep = Math.abs(((ang - sweep + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5;
        ctx.fillStyle = nearSweep ? "rgba(126,200,192,0.95)" : "rgba(94,184,176,0.35)";
        ctx.fillRect(px, pz, nearSweep ? 2.2 : 1.4, nearSweep ? 2.2 : 1.4);
      }

      // Robot
      ctx.fillStyle = "#7ec8c0";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(238,244,242,0.7)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweep) * 14, cy + Math.sin(sweep) * 14);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [robot.id, robot.lidarHz]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={360}
      className="robot-sense__canvas"
      aria-label={`${robot.name} LiDAR map`}
    />
  );
}

function buildObstacles(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const n = 5 + (Math.abs(h) % 4);
  const out: { x: number; z: number; rw: number; rh: number; rot: number; phase: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (h % 7) * 0.1;
    const d = 55 + ((h + i * 13) % 90);
    out.push({
      x: Math.cos(a) * d,
      z: Math.sin(a) * d * 0.85,
      rw: 18 + ((h + i) % 20),
      rh: 12 + ((h + i * 3) % 16),
      rot: ((h + i) % 10) * 0.2,
      phase: i * 0.7,
    });
  }
  return out;
}
