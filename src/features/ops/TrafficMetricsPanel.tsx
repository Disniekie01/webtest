import { useEffect, useState } from "react";
import { useAscStore } from "../../state/ascStore";
import { busyLabel, loadTone, useTrafficMetrics } from "./useTrafficMetrics";
import "./TrafficMetricsPanel.css";

/** Ops panel: road + intersection congestion metrics for the Traffic layer. */
export function TrafficMetricsPanel() {
  const trafficOn = useAscStore((s) => s.activeLayers.includes("traffic"));
  const [open, setOpen] = useState(true);
  const metrics = useTrafficMetrics(500);

  useEffect(() => {
    if (trafficOn) setOpen(true);
  }, [trafficOn]);

  if (!trafficOn) return null;

  const topRoads = metrics.roads.slice(0, 4);
  const topJunc = metrics.junctions.slice(0, 4);

  return (
    <aside className={`traffic-metrics ${open ? "open" : "collapsed"}`} aria-label="Traffic metrics">
      <header className="traffic-metrics__head">
        <div>
          <h2>Traffic metrics</h2>
          <p className="mono muted">
            {metrics.live ? "SUMO live" : "Mock district"} · Harbor grid
          </p>
        </div>
        <button type="button" className="traffic-metrics__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </header>

      {open && (
        <>
          <div className="traffic-metrics__kpis">
            <Kpi label="Vehicles" value={String(metrics.vehicles)} hint="in view" />
            <Kpi label="Avg speed" value={`${metrics.avgSpeedKmh}`} hint="km/h" />
            <Kpi label="Stopped" value={String(metrics.stopped)} hint="veh" />
            <Kpi label="Busy roads" value={String(metrics.busyRoads)} hint="blocks" />
            <Kpi label="Heavy jcts" value={String(metrics.heavyJunctions)} hint="of 25" />
          </div>

          <section className="traffic-metrics__section">
            <h3 className="mono">Busiest roads</h3>
            <ul className="traffic-metrics__list">
              {topRoads.map((r) => (
                <li key={r.id}>
                  <span className="name mono">{r.label}</span>
                  <span className={`tone tone-${loadTone(r.density)}`}>{busyLabel(r.density)}</span>
                  <i className="bar" aria-hidden>
                    <i style={{ width: `${Math.round(r.density * 100)}%` }} />
                  </i>
                  <span className="count mono">{r.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="traffic-metrics__section">
            <h3 className="mono">Busiest intersections</h3>
            <ul className="traffic-metrics__list">
              {topJunc.map((j) => (
                <li key={j.id}>
                  <span className="name mono">{j.label}</span>
                  <span className={`tone tone-${loadTone(j.load)}`}>{busyLabel(j.load)}</span>
                  <i className="bar" aria-hidden>
                    <i style={{ width: `${Math.round(j.load * 100)}%` }} />
                  </i>
                  <span className="count mono">{j.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <footer className="traffic-metrics__legend mono">
            <span className="tone-ok">light</span>
            <span className="tone-warn">busy</span>
            <span className="tone-hot">heavy</span>
            <span className="tone-crit">jam</span>
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
