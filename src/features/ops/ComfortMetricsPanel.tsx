import { useEffect, useState } from "react";
import { useAscStore } from "../../state/ascStore";
import { comfortBus } from "../../scene/ComfortFlowLayer";
import { bandLabel, type ComfortBand } from "../../scene/comfortHeat";
import "./TrafficMetricsPanel.css";
import "./ComfortMetricsPanel.css";

function tone(b: ComfortBand): "ok" | "warn" | "hot" | "crit" {
  if (b === "calm") return "ok";
  if (b === "ok") return "warn";
  if (b === "tense") return "hot";
  return "crit";
}

/** Ops panel: people-avg + congestion → robot-sendability heat. */
export function ComfortMetricsPanel() {
  const on = useAscStore((s) => s.activeLayers.includes("comfort"));
  const openComfort = useAscStore((s) => s.openComfort);
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState(() => comfortBus.snap);

  useEffect(() => {
    if (on) setOpen(true);
  }, [on]);

  useEffect(() => comfortBus.subscribe(setSnap), []);

  if (!on || !snap) return null;

  return (
    <aside
      className={`traffic-metrics comfort-metrics ${open ? "open" : "collapsed"}`}
      aria-label="Comfort metrics"
    >
      <header className="traffic-metrics__head">
        <div>
          <h2>Comfort heat</h2>
          <p className="mono muted">
            people avg × congestion · {snap.trending}
          </p>
        </div>
        <div className="metrics-head-actions">
          <button type="button" className="traffic-metrics__toggle" onClick={openComfort}>
            Edit
          </button>
          <button type="button" className="traffic-metrics__toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </header>

      {open && (
        <>
          <div className="traffic-metrics__kpis">
            <Kpi
              label="Sendability"
              value={(snap.district * 100).toFixed(0)}
              hint={bandLabel(snap.band)}
            />
            <Kpi label="Crowd" value={`${Math.round(snap.avgCongestion * 100)}%`} hint="avg load" />
            <Kpi label="Avoid" value={String(snap.avoidZones)} hint="cells" />
            <Kpi label="Calm" value={`${snap.calmPct}%`} hint="cells" />
          </div>

          <div className="comfort-spectrum" aria-hidden>
            <i />
          </div>

          <section className="traffic-metrics__section">
            <h3 className="mono">Opt-in people</h3>
            <ul className="traffic-metrics__list comfort-list">
              {snap.personas.map((p) => (
                <li key={p.name}>
                  <span className="name mono">{p.name.split(" ")[0]}</span>
                  <span className={`tone tone-${tone(p.band)}`}>{bandLabel(p.band)}</span>
                  <i className="bar comfort-bar" aria-hidden>
                    <i style={{ width: `${Math.round(p.score * 100)}%` }} />
                  </i>
                  <span className="count mono">{Math.round(p.score * 100)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="traffic-metrics__section">
            <h3 className="mono">Zones · people / crowd</h3>
            <ul className="traffic-metrics__list comfort-list comfort-zones">
              {snap.zones.map((z) => (
                <li key={z.id}>
                  <span className="name mono">{z.id.replace("c-", "")}</span>
                  <span className={`tone tone-${tone(z.band)}`}>
                    {z.congestion > 0.55 ? "crowd" : bandLabel(z.band)}
                  </span>
                  <i className="bar comfort-bar" aria-hidden>
                    <i style={{ width: `${Math.round(z.score * 100)}%` }} />
                  </i>
                  <span className="count mono" title={`people ${Math.round(z.peopleAvg * 100)} · peds ${z.pedCount}`}>
                    {z.pedCount}p
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <footer className="traffic-metrics__legend mono comfort-legend">
            <span className="tone-ok">send ok</span>
            <span className="tone-warn">caution</span>
            <span className="tone-crit">avoid robots</span>
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
