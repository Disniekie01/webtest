import { useEffect, useRef, useState } from "react";
import type { LiveRobot } from "./useLiveTelemetry";

/** Robot ego camera — Kit twin JPEG when available, else synthetic HUD feed. */
export function RobotCameraView({ robot }: { robot: LiveRobot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<"kit" | "sim">("sim");
  const kitImg = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch("/viewport/frame.jpg", { cache: "no-store" });
        if (!cancelled && res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            kitImg.current = img;
            setSource("kit");
            URL.revokeObjectURL(url);
          };
          img.src = url;
        }
      } catch {
        /* stay on sim */
      }
    };
    void probe();
    const id = window.setInterval(probe, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [robot.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const w = canvas.width;
      const h = canvas.height;

      if (source === "kit" && kitImg.current?.complete) {
        ctx.drawImage(kitImg.current, 0, 0, w, h);
        ctx.fillStyle = "rgba(4,8,12,0.28)";
        ctx.fillRect(0, 0, w, h);
      } else {
        // Synthetic street-level feed
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#1a2830");
        g.addColorStop(0.45, "#243038");
        g.addColorStop(0.45, "#2a3438");
        g.addColorStop(1, "#12181c");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        // Moving sidewalk / road bands
        ctx.fillStyle = "#1c2428";
        ctx.fillRect(0, h * 0.55, w, h * 0.45);
        ctx.strokeStyle = "rgba(212,161,90,0.35)";
        ctx.setLineDash([18, 16]);
        ctx.lineWidth = 3;
        const scroll = (t * 80) % 34;
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.55 - scroll);
        ctx.lineTo(w * 0.5, h + 20);
        ctx.stroke();
        ctx.setLineDash([]);

        // Soft building masses
        for (let i = 0; i < 5; i++) {
          const bx = ((i * 97 + t * 30) % (w + 80)) - 40;
          const bh = 60 + ((i * 37) % 90);
          ctx.fillStyle = `rgba(70,90,100,${0.25 + (i % 3) * 0.08})`;
          ctx.fillRect(bx, h * 0.55 - bh, 50 + (i % 3) * 20, bh);
        }

        // Pedestrian blips
        for (let i = 0; i < 4; i++) {
          const px = w * (0.2 + i * 0.18) + Math.sin(t + i) * 12;
          const py = h * 0.62 + Math.cos(t * 0.8 + i) * 8;
          ctx.fillStyle = "rgba(126,200,192,0.7)";
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // HUD chrome
      ctx.strokeStyle = "rgba(94,184,176,0.45)";
      ctx.lineWidth = 1;
      ctx.strokeRect(12, 12, w - 24, h - 24);
      ctx.fillStyle = "rgba(8,12,14,0.72)";
      ctx.fillRect(16, 16, 168, 44);
      ctx.fillStyle = "#7ec8c0";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.fillText(`CAM · ${robot.id}`, 24, 34);
      ctx.fillStyle = "#a8b8b4";
      ctx.fillText(`${robot.kind} · ${robot.speedMps.toFixed(1)} m/s`, 24, 50);

      ctx.fillStyle = "rgba(8,12,14,0.72)";
      ctx.fillRect(w - 140, 16, 120, 44);
      ctx.fillStyle = robot.battery > 0.3 ? "#5eb8a0" : "#c45c4a";
      ctx.fillText(`BAT ${Math.round(robot.battery * 100)}%`, w - 128, 34);
      ctx.fillStyle = "#a8b8b4";
      ctx.fillText(source === "kit" ? "KIT LIVE" : "SIM FEED", w - 128, 50);

      // Crosshair
      ctx.strokeStyle = "rgba(238,244,242,0.35)";
      ctx.beginPath();
      ctx.moveTo(w / 2 - 14, h / 2);
      ctx.lineTo(w / 2 + 14, h / 2);
      ctx.moveTo(w / 2, h / 2 - 14);
      ctx.lineTo(w / 2, h / 2 + 14);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [robot, source]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={360}
      className="robot-sense__canvas"
      aria-label={`${robot.name} camera feed`}
    />
  );
}
