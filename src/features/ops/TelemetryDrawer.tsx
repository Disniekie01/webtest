import { useState } from "react";
import { useAscStore } from "../../state/ascStore";
import { useLiveTelemetry, type LiveRobot } from "./useLiveTelemetry";
import { RobotSenseModal, type SenseMode } from "./RobotSenseModal";
import "./TelemetryDrawer.css";

function BatteryGraph({ series, pct }: { series: number[]; pct: number }) {
  const w = 120;
  const h = 36;
  const max = 1;
  const min = 0;
  const pts = series
    .map((v, i) => {
      const x = (i / Math.max(1, series.length - 1)) * w;
      const y = h - ((v - min) / (max - min)) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const fill = `${pts} ${w},${h} 0,${h}`;
  const stroke = pct > 0.35 ? "#5eb8a0" : pct > 0.18 ? "#c4a05a" : "#c45c4a";

  return (
    <svg className="telemetry-bat-graph" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden>
      <defs>
        <linearGradient id="batFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={fill} fill="url(#batFill)" />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function RobotCard({
  robot,
  onSense,
}: {
  robot: LiveRobot;
  onSense: (mode: SenseMode) => void;
}) {
  return (
    <li className="telemetry-card">
      <div className="telemetry-card__top">
        <strong>{robot.name}</strong>
        <span className={`policy policy-${robot.policy}`}>{robot.policy}</span>
      </div>
      <div className="telemetry-card__meta mono">
        <span>{robot.kind}</span>
        <span>{robot.district}</span>
        <span>{robot.lastUpdate}</span>
      </div>
      <p className="telemetry-card__task">{robot.task}</p>

      <div className="telemetry-card__bat">
        <div className="telemetry-card__bat-head">
          <span>Battery</span>
          <span className="mono">{Math.round(robot.battery * 100)}%</span>
        </div>
        <BatteryGraph series={robot.batterySeries} pct={robot.battery} />
      </div>

      <div className="telemetry-card__kpis">
        <div>
          <span className="lbl">Speed</span>
          <strong className="mono">{robot.speedMps.toFixed(1)}</strong>
          <span className="unit">m/s</span>
        </div>
        <div>
          <span className="lbl">CPU</span>
          <strong className="mono">{robot.cpu.toFixed(0)}</strong>
          <span className="unit">%</span>
        </div>
        <div>
          <span className="lbl">Temp</span>
          <strong className="mono">{robot.thermal.toFixed(0)}</strong>
          <span className="unit">°C</span>
        </div>
        <div>
          <span className="lbl">Link</span>
          <strong className="mono">{robot.linkPct.toFixed(0)}</strong>
          <span className="unit">%</span>
        </div>
      </div>

      <div className="telemetry-card__actions">
        <button type="button" onClick={() => onSense("lidar")}>
          LiDAR map
        </button>
        <button type="button" onClick={() => onSense("camera")}>
          Camera feed
        </button>
      </div>
    </li>
  );
}

export function TelemetryDrawer() {
  const open = useAscStore((s) => s.telemetryOpen);
  const setOpen = useAscStore((s) => s.setTelemetryOpen);
  const robots = useLiveTelemetry(open);
  const [sense, setSense] = useState<{ id: string; mode: SenseMode } | null>(null);

  if (!open) return null;

  const active = sense ? robots.find((r) => r.id === sense.id) : null;

  return (
    <>
      <aside className="telemetry-drawer" aria-label="Robot telemetry">
        <div className="telemetry-drawer__head">
          <div>
            <h2>Robot telemetry</h2>
            <p className="muted mono">Live fleet · {robots.length} agents</p>
          </div>
          <button type="button" className="telemetry-close" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        <ul className="telemetry-list">
          {robots.map((r) => (
            <RobotCard
              key={r.id}
              robot={r}
              onSense={(mode) => setSense({ id: r.id, mode })}
            />
          ))}
        </ul>
      </aside>

      {active && sense && (
        <RobotSenseModal
          robot={active}
          mode={sense.mode}
          onMode={(mode) => setSense({ id: sense.id, mode })}
          onClose={() => setSense(null)}
        />
      )}
    </>
  );
}
