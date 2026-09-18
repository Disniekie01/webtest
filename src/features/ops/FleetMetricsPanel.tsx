import { useEffect, useState } from "react";
import { useAscStore } from "../../state/ascStore";
import { fleetBus, type FleetBotState } from "../../scene/FleetFlowLayer";
import "./TrafficMetricsPanel.css";
import "./FleetMetricsPanel.css";

function phaseLabel(phase: FleetBotState["phase"]) {
  if (phase === "to_pickup") return "to pickup";
  if (phase === "loading") return "loading";
  if (phase === "to_dropoff") return "to dropoff";
  return "unloading";
}

function phaseTone(phase: FleetBotState["phase"]): "ok" | "warn" | "hot" | "crit" {
  if (phase === "to_pickup") return "ok";
  if (phase === "loading") return "hot";
  if (phase === "to_dropoff") return "warn";
  return "crit";
}

/** Ops panel: live dynamic fleet pickup / dropoff status. */
export function FleetMetricsPanel() {
  const on = useAscStore((s) => s.activeLayers.includes("robots"));
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState(() => fleetBus.snap);

  useEffect(() => {
    if (on) setOpen(true);
  }, [on]);

  useEffect(() => fleetBus.subscribe(setSnap), []);

  if (!on || !snap) return null;

  const bots = snap.bots;
  const toPickup = bots.filter((b) => b.phase === "to_pickup").length;
  const loading = bots.filter((b) => b.phase === "loading").length;
  const toDropoff = bots.filter((b) => b.phase === "to_dropoff").length;
  const unloading = bots.filter((b) => b.phase === "unloading").length;

  return (
    <aside
      className={`traffic-metrics fleet-metrics ${open ? "open" : "collapsed"}`}
      aria-label="Fleet metrics"
    >
      <header className="traffic-metrics__head">
        <div>
          <h2>Fleet missions</h2>
          <p className="mono muted">
            {snap.live ? "SUMO live" : "Simulated"} · {snap.completed} completed
          </p>
        </div>
        <button type="button" className="traffic-metrics__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </header>

      {open && (
        <>
          <div className="traffic-metrics__kpis">
            <Kpi label="Active" value={String(bots.length)} hint="bots" />
            <Kpi label="→ Pickup" value={String(toPickup + loading)} hint="P" />
            <Kpi label="→ Dropoff" value={String(toDropoff + unloading)} hint="D" />
            <Kpi label="Done" value={String(snap.completed)} hint="trips" />
          </div>

          <section className="traffic-metrics__section">
            <h3 className="mono">Live routes</h3>
            <ul className="traffic-metrics__list fleet-list">
              {bots.map((m) => (
                <li key={m.id}>
                  <span className="name mono" title={`${m.task} · ${m.pickup.label}→${m.dropoff.label}`}>
                    {m.name.split(" ").slice(0, 2).join(" ")}
                  </span>
                  <span className={`tone tone-${phaseTone(m.phase)}`}>{phaseLabel(m.phase)}</span>
                  <i className="bar fleet-bar" aria-hidden>
                    <i style={{ width: `${Math.round(m.progress * 100)}%` }} />
                  </i>
                  <span className="count mono">{m.policy}</span>
                </li>
              ))}
            </ul>
          </section>

          <footer className="traffic-metrics__legend mono fleet-legend">
            <span className="tone-ok">P pickup</span>
            <span className="tone-warn">D dropoff</span>
            <span className="tone-hot">load / unload</span>
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
