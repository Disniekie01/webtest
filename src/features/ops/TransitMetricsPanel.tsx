import { useEffect, useState } from "react";
import { useAscStore } from "../../state/ascStore";
import { transitBus } from "../../scene/TransitFlowLayer";
import "./TrafficMetricsPanel.css";
import "./TransitMetricsPanel.css";

function loadTone(load: number): "ok" | "warn" | "hot" | "crit" {
  if (load < 0.4) return "ok";
  if (load < 0.6) return "warn";
  if (load < 0.8) return "hot";
  return "crit";
}

function loadLabel(load: number) {
  if (load < 0.4) return "light";
  if (load < 0.6) return "steady";
  if (load < 0.8) return "busy";
  return "packed";
}

/** Ops panel: branched metro — trunk + split-offs. */
export function TransitMetricsPanel() {
  const on = useAscStore((s) => s.activeLayers.includes("transit"));
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState(() => transitBus.snap);

  useEffect(() => {
    if (on) setOpen(true);
  }, [on]);

  useEffect(() => transitBus.subscribe(setSnap), []);

  if (!on || !snap) return null;

  return (
    <aside
      className={`traffic-metrics transit-metrics ${open ? "open" : "collapsed"}`}
      aria-label="Transit metrics"
    >
      <header className="traffic-metrics__head">
        <div>
          <h2>Transit · under map</h2>
          <p className="mono muted">
            {snap.lineName} · {snap.stations.length} stations
          </p>
        </div>
        <button type="button" className="traffic-metrics__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </header>

      {open && (
        <>
          <div className="traffic-metrics__kpis">
            <Kpi label="Trains" value={String(snap.trains)} hint="active" />
            <Kpi label="Headway" value={`${snap.headwaySec}s`} hint="avg" />
            <Kpi label="On time" value={`${snap.onTimePct}%`} hint="net" />
            <Kpi label="Riders" value={String(snap.ridership)} hint="est / hr" />
          </div>

          <section className="traffic-metrics__section">
            <h3 className="mono">Lines</h3>
            <ul className="traffic-metrics__list transit-lines">
              {snap.lines.map((l) => (
                <li key={l.id}>
                  <span className="name mono" style={{ color: l.color }}>
                    {l.short}
                  </span>
                  <span className="tone tone-ok">{l.id === "m1" ? "trunk" : "spur"}</span>
                  <i className="bar transit-bar" aria-hidden>
                    <i style={{ width: `${Math.min(100, l.trains * 40)}%`, background: l.color }} />
                  </i>
                  <span className="count mono">{l.trains} car</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="traffic-metrics__section">
            <h3 className="mono">Stations</h3>
            <ul className="traffic-metrics__list transit-list">
              {snap.stations.map((s) => (
                <li key={s.id}>
                  <span className="name mono" title={s.name}>
                    {s.hub ? "◈ " : ""}
                    {s.code}
                  </span>
                  <span className={`tone tone-${loadTone(s.load)}`}>
                    {s.dwell ? "dwell" : loadLabel(s.load)}
                  </span>
                  <i className="bar transit-bar" aria-hidden>
                    <i style={{ width: `${Math.round(s.load * 100)}%` }} />
                  </i>
                  <span className="count mono">{s.lines.map((x) => x.slice(1).toUpperCase()).join("")}</span>
                </li>
              ))}
            </ul>
          </section>

          <footer className="traffic-metrics__legend mono transit-legend">
            <span className="tone-ok">M1 trunk</span>
            <span className="tone-warn">M2 dock</span>
            <span className="tone-hot">M3 north</span>
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
