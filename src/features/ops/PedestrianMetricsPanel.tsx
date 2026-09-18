import { useEffect, useState } from "react";
import { useAscStore } from "../../state/ascStore";
import { crowdLabel, crowdTone, usePedestrianMetrics } from "./usePedestrianMetrics";
import "./TrafficMetricsPanel.css";
import "./PedestrianMetricsPanel.css";

/** Ops panel: sidewalk + plaza crowd metrics for the Pedestrians layer. */
export function PedestrianMetricsPanel() {
  const on = useAscStore((s) => s.activeLayers.includes("pedestrians"));
  const [open, setOpen] = useState(true);
  const metrics = usePedestrianMetrics(500);

  useEffect(() => {
    if (on) setOpen(true);
  }, [on]);

  if (!on) return null;

  const topWalks = metrics.walks.slice(0, 4);
  const topPlazas = metrics.plazas.slice(0, 4);

  return (
    <aside
      className={`traffic-metrics ped-metrics ${open ? "open" : "collapsed"}`}
      aria-label="Pedestrian metrics"
    >
      <header className="traffic-metrics__head">
        <div>
          <h2>Pedestrian metrics</h2>
          <p className="mono muted">
            {metrics.live ? "SUMO live" : "Mock district"} · sidewalks · plazas
          </p>
        </div>
        <button type="button" className="traffic-metrics__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </header>

      {open && (
        <>
          <div className="traffic-metrics__kpis">
            <Kpi label="Pedestrians" value={String(metrics.pedestrians)} hint="in view" />
            <Kpi label="Walk speed" value={`${metrics.avgSpeedKmh}`} hint="km/h" />
            <Kpi label="Crowded" value={String(metrics.crowdedWalks)} hint="walks" />
            <Kpi label="Dense plazas" value={String(metrics.densePlazas)} hint="of 25" />
          </div>

          <section className="traffic-metrics__section">
            <h3 className="mono">Busiest sidewalks</h3>
            <ul className="traffic-metrics__list">
              {topWalks.map((w) => (
                <li key={w.id}>
                  <span className="name mono">{w.label}</span>
                  <span className={`tone tone-${crowdTone(w.density)}`}>{crowdLabel(w.density)}</span>
                  <i className="bar ped-bar" aria-hidden>
                    <i style={{ width: `${Math.round(w.density * 100)}%` }} />
                  </i>
                  <span className="count mono">{w.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="traffic-metrics__section">
            <h3 className="mono">Busiest plazas</h3>
            <ul className="traffic-metrics__list">
              {topPlazas.map((p) => (
                <li key={p.id}>
                  <span className="name mono">{p.label}</span>
                  <span className={`tone tone-${crowdTone(p.load)}`}>{crowdLabel(p.load)}</span>
                  <i className="bar ped-bar" aria-hidden>
                    <i style={{ width: `${Math.round(p.load * 100)}%` }} />
                  </i>
                  <span className="count mono">{p.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <footer className="traffic-metrics__legend mono ped-legend">
            <span className="tone-ok">quiet</span>
            <span className="tone-warn">active</span>
            <span className="tone-hot">crowded</span>
            <span className="tone-crit">dense</span>
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
