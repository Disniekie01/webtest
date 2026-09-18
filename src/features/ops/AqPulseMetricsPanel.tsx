import { useEffect, useState } from "react";
import { useAscStore } from "../../state/ascStore";
import { aqBus } from "../../scene/AqPulseLayer";
import { bandLabel, type AqBand } from "../../scene/aqPulse";
import "./TrafficMetricsPanel.css";
import "./AqPulseMetricsPanel.css";

function tone(b: AqBand): "ok" | "warn" | "hot" | "crit" {
  if (b === "good") return "ok";
  if (b === "moderate") return "warn";
  if (b === "unhealthy") return "hot";
  return "crit";
}

/** Ops panel: breathing district air quality + activity pulse. */
export function AqPulseMetricsPanel() {
  const on = useAscStore((s) => s.activeLayers.includes("activity"));
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState(() => aqBus.snap);

  useEffect(() => {
    if (on) setOpen(true);
  }, [on]);

  useEffect(() => aqBus.subscribe(setSnap), []);

  if (!on || !snap) return null;

  const worst = [...snap.cells].sort((a, b) => b.aqi - a.aqi).slice(0, 5);

  return (
    <aside
      className={`traffic-metrics aq-metrics ${open ? "open" : "collapsed"}`}
      aria-label="AQ pulse metrics"
    >
      <header className="traffic-metrics__head">
        <div>
          <h2>AQ · city breath</h2>
          <p className="mono muted">
            pulse {(snap.breathPhase * 100).toFixed(0)}% · wind {snap.windDeg}°
          </p>
        </div>
        <button type="button" className="traffic-metrics__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </header>

      {open && (
        <>
          <div className="traffic-metrics__kpis">
            <Kpi label="AQI" value={String(snap.districtAqi)} hint={bandLabel(snap.band)} />
            <Kpi label="PM2.5" value={String(snap.pm25)} hint="µg/m³" />
            <Kpi label="Wind" value={`${snap.windMps}`} hint="m/s" />
            <Kpi label="Hotspots" value={String(snap.hotspots)} hint="blocks" />
          </div>

          <div className="aq-breath" aria-hidden>
            <i style={{ transform: `scaleX(${0.35 + snap.breathPhase * 0.65})` }} />
          </div>

          <section className="traffic-metrics__section">
            <h3 className="mono">Sensors</h3>
            <ul className="traffic-metrics__list aq-list">
              {snap.sensors.map((s) => (
                <li key={s.id}>
                  <span className="name mono">{s.label.split(" ")[0]}</span>
                  <span className={`tone tone-${tone(s.band)}`}>{bandLabel(s.band)}</span>
                  <i className="bar aq-bar" aria-hidden>
                    <i style={{ width: `${Math.min(100, (s.aqi / 140) * 100)}%` }} />
                  </i>
                  <span className="count mono">{s.aqi}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="traffic-metrics__section">
            <h3 className="mono">Heaviest blocks</h3>
            <ul className="traffic-metrics__list aq-list">
              {worst.map((c) => (
                <li key={c.id}>
                  <span className="name mono">{c.id.replace("aq-", "B")}</span>
                  <span className={`tone tone-${tone(c.band)}`}>{bandLabel(c.band)}</span>
                  <i className="bar aq-bar" aria-hidden>
                    <i style={{ width: `${Math.min(100, c.pulse * 100)}%` }} />
                  </i>
                  <span className="count mono">{c.aqi}</span>
                </li>
              ))}
            </ul>
          </section>

          <footer className="traffic-metrics__legend mono aq-legend">
            <span className="tone-ok">good</span>
            <span className="tone-warn">moderate</span>
            <span className="tone-hot">unhealthy</span>
            <span className="tone-crit">hazard</span>
          </footer>
        </>
      )}
    </aside>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="traffic-kpi">
      <span className="traffic-kpi__label mono">{label}</span>
      <strong className="traffic-kpi__value mono">{value}</strong>
      <span className="traffic-kpi__hint muted">{hint}</span>
    </div>
  );
}
