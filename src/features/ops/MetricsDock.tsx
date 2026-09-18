import { useEffect, useMemo, useState } from "react";
import type { DataLayer } from "../../data/ascTypes";
import { LAYER_LABELS, useAscStore } from "../../state/ascStore";
import { busyLabel, loadTone, useTrafficMetrics } from "./useTrafficMetrics";
import { crowdLabel, crowdTone, usePedestrianMetrics } from "./usePedestrianMetrics";
import { fleetBus, type FleetBotState } from "../../scene/FleetFlowLayer";
import { transitBus } from "../../scene/TransitFlowLayer";
import { aqBus } from "../../scene/AqPulseLayer";
import { comfortBus } from "../../scene/ComfortFlowLayer";
import { bandLabel as comfortBandLabel, type ComfortBand } from "../../scene/comfortHeat";
import { bandLabel as aqBandLabel, type AqBand } from "../../scene/aqPulse";
import "./TrafficMetricsPanel.css";
import "./MetricsDock.css";

const DOCK_LAYERS: DataLayer[] = [
  "traffic",
  "pedestrians",
  "robots",
  "transit",
  "activity",
  "comfort",
];

const TAB_SHORT: Record<string, string> = {
  traffic: "Traffic",
  pedestrians: "Peds",
  robots: "Fleet",
  transit: "Transit",
  activity: "AQ",
  comfort: "Comfort",
};

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="traffic-kpi">
      <span className="traffic-kpi__label mono">{label}</span>
      <strong className="traffic-kpi__value mono">{value}</strong>
      <span className="traffic-kpi__hint muted">{hint}</span>
    </div>
  );
}

function comfortTone(b: ComfortBand): "ok" | "warn" | "hot" | "crit" {
  if (b === "calm") return "ok";
  if (b === "ok") return "warn";
  if (b === "tense") return "hot";
  return "crit";
}

function aqTone(b: AqBand): "ok" | "warn" | "hot" | "crit" {
  if (b === "good") return "ok";
  if (b === "moderate") return "warn";
  if (b === "unhealthy") return "hot";
  return "crit";
}

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

function loadLabel(load: number) {
  if (load < 0.4) return "light";
  if (load < 0.6) return "steady";
  if (load < 0.8) return "busy";
  return "packed";
}

/** Single metrics dock — one panel, tabs for active layers. */
export function MetricsDock() {
  const activeLayers = useAscStore((s) => s.activeLayers);
  const metricsTab = useAscStore((s) => s.metricsTab);
  const setMetricsTab = useAscStore((s) => s.setMetricsTab);
  const openComfort = useAscStore((s) => s.openComfort);
  const sumoLive = useAscStore((s) => s.sumoLive);
  const [collapsed, setCollapsed] = useState(false);

  const tabs = useMemo(
    () => DOCK_LAYERS.filter((l) => activeLayers.includes(l)),
    [activeLayers],
  );

  const active = useMemo(() => {
    if (metricsTab && tabs.includes(metricsTab)) return metricsTab;
    return tabs[0] ?? null;
  }, [metricsTab, tabs]);

  useEffect(() => {
    if (!active && tabs[0]) setMetricsTab(tabs[0]);
    if (active && metricsTab !== active) setMetricsTab(active);
  }, [active, tabs, metricsTab, setMetricsTab]);

  if (!tabs.length || !active) return null;

  const source = sumoLive ? "SUMO live" : "Mock district";

  return (
    <aside className={`metrics-dock traffic-metrics ${collapsed ? "collapsed" : "open"}`} aria-label="City metrics">
      <header className="traffic-metrics__head">
        <div>
          <h2>City metrics</h2>
          <p className="mono muted">
            {source} · {LAYER_LABELS[active]}
          </p>
        </div>
        <div className="metrics-head-actions">
          {active === "comfort" && (
            <button type="button" className="traffic-metrics__toggle" onClick={openComfort}>
              Studio
            </button>
          )}
          <button type="button" className="traffic-metrics__toggle" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </header>

      <nav className="metrics-dock__tabs mono" aria-label="Metric layers">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            className={`metrics-dock__tab ${t === active ? "on" : ""}`}
            onClick={() => {
              setMetricsTab(t);
              setCollapsed(false);
            }}
          >
            {TAB_SHORT[t] ?? t}
          </button>
        ))}
      </nav>

      {!collapsed && (
        <div className="metrics-dock__body" key={active}>
          {active === "traffic" && <TrafficBody />}
          {active === "pedestrians" && <PedBody />}
          {active === "robots" && <FleetBody />}
          {active === "transit" && <TransitBody />}
          {active === "activity" && <AqBody />}
          {active === "comfort" && <ComfortBody />}
        </div>
      )}
    </aside>
  );
}

function TrafficBody() {
  const metrics = useTrafficMetrics(500);
  const topRoads = metrics.roads.slice(0, 4);
  const topJunc = metrics.junctions.slice(0, 4);
  return (
    <>
      <div className="traffic-metrics__kpis">
        <Kpi label="Vehicles" value={String(metrics.vehicles)} hint="in view" />
        <Kpi label="Avg speed" value={`${metrics.avgSpeedKmh}`} hint="km/h" />
        <Kpi label="Stopped" value={String(metrics.stopped)} hint="veh" />
        <Kpi label="Busy roads" value={String(metrics.busyRoads)} hint="blocks" />
      </div>
      <section className="traffic-metrics__section">
        <h3 className="mono">Busiest roads</h3>
        <ul className="traffic-metrics__list">
          {topRoads.slice(0, 3).map((r) => (
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
          {topJunc.slice(0, 3).map((j) => (
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
    </>
  );
}

function PedBody() {
  const metrics = usePedestrianMetrics(500);
  return (
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
          {metrics.walks.slice(0, 3).map((w) => (
            <li key={w.id}>
              <span className="name mono">{w.label}</span>
              <span className={`tone tone-${crowdTone(w.density)}`}>{crowdLabel(w.density)}</span>
              <i className="bar" aria-hidden>
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
          {metrics.plazas.slice(0, 3).map((p) => (
            <li key={p.id}>
              <span className="name mono">{p.label}</span>
              <span className={`tone tone-${crowdTone(p.load)}`}>{crowdLabel(p.load)}</span>
              <i className="bar" aria-hidden>
                <i style={{ width: `${Math.round(p.load * 100)}%` }} />
              </i>
              <span className="count mono">{p.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function FleetBody() {
  const [snap, setSnap] = useState(() => fleetBus.snap);
  useEffect(() => {
    return fleetBus.subscribe(setSnap);
  }, []);
  if (!snap) return <p className="muted mono metrics-dock__empty">Enable Fleet to see missions</p>;
  const bots = snap.bots;
  const toPickup = bots.filter((b) => b.phase === "to_pickup").length;
  const loading = bots.filter((b) => b.phase === "loading").length;
  const toDropoff = bots.filter((b) => b.phase === "to_dropoff").length;
  const unloading = bots.filter((b) => b.phase === "unloading").length;
  return (
    <>
      <div className="traffic-metrics__kpis">
        <Kpi label="Active" value={String(bots.length)} hint="bots" />
        <Kpi label="→ Pickup" value={String(toPickup + loading)} hint="P" />
        <Kpi label="→ Dropoff" value={String(toDropoff + unloading)} hint="D" />
        <Kpi label="Done" value={String(snap.completed)} hint="trips" />
      </div>
      <section className="traffic-metrics__section">
        <h3 className="mono">Live routes</h3>
        <ul className="traffic-metrics__list">
          {bots.slice(0, 4).map((m) => (
            <li key={m.id}>
              <span className="name mono">{m.name.split(" ").slice(0, 2).join(" ")}</span>
              <span className={`tone tone-${phaseTone(m.phase)}`}>{phaseLabel(m.phase)}</span>
              <i className="bar" aria-hidden>
                <i style={{ width: `${Math.round(m.progress * 100)}%` }} />
              </i>
              <span className="count mono">{m.policy}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function TransitBody() {
  const [snap, setSnap] = useState(() => transitBus.snap);
  useEffect(() => {
    return transitBus.subscribe(setSnap);
  }, []);
  if (!snap) return <p className="muted mono metrics-dock__empty">Enable Transit to see lines</p>;
  return (
    <>
      <div className="traffic-metrics__kpis">
        <Kpi label="Trains" value={String(snap.trains)} hint="active" />
        <Kpi label="Headway" value={`${snap.headwaySec}s`} hint="avg" />
        <Kpi label="On time" value={`${snap.onTimePct}%`} hint="net" />
        <Kpi label="Riders" value={String(snap.ridership)} hint="est / hr" />
      </div>
      <section className="traffic-metrics__section">
        <h3 className="mono">Stations</h3>
        <ul className="traffic-metrics__list">
          {snap.stations.slice(0, 5).map((s) => (
            <li key={s.id}>
              <span className="name mono">
                {s.hub ? "◈ " : ""}
                {s.code}
              </span>
              <span className={`tone tone-${loadTone(s.load)}`}>
                {s.dwell ? "dwell" : loadLabel(s.load)}
              </span>
              <i className="bar" aria-hidden>
                <i style={{ width: `${Math.round(s.load * 100)}%` }} />
              </i>
              <span className="count mono">{s.lines.map((x) => x.slice(1).toUpperCase()).join("")}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function AqBody() {
  const [snap, setSnap] = useState(() => aqBus.snap);
  useEffect(() => {
    return aqBus.subscribe(setSnap);
  }, []);
  if (!snap) return <p className="muted mono metrics-dock__empty">Enable AQ / Pulse</p>;
  const worst = [...snap.cells].sort((a, b) => b.aqi - a.aqi).slice(0, 4);
  return (
    <>
      <div className="traffic-metrics__kpis">
        <Kpi label="AQI" value={String(snap.districtAqi)} hint={aqBandLabel(snap.band)} />
        <Kpi label="PM2.5" value={String(snap.pm25)} hint="µg/m³" />
        <Kpi label="Wind" value={`${snap.windMps}`} hint="m/s" />
        <Kpi label="Hotspots" value={String(snap.hotspots)} hint="blocks" />
      </div>
      <section className="traffic-metrics__section">
        <h3 className="mono">Heaviest blocks</h3>
        <ul className="traffic-metrics__list">
          {worst.map((c) => (
            <li key={c.id}>
              <span className="name mono">{c.id.replace("aq-", "B")}</span>
              <span className={`tone tone-${aqTone(c.band)}`}>{aqBandLabel(c.band)}</span>
              <i className="bar" aria-hidden>
                <i style={{ width: `${Math.min(100, c.pulse * 100)}%` }} />
              </i>
              <span className="count mono">{c.aqi}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function ComfortBody() {
  const [snap, setSnap] = useState(() => comfortBus.snap);
  useEffect(() => {
    return comfortBus.subscribe(setSnap);
  }, []);
  if (!snap) return <p className="muted mono metrics-dock__empty">Enable Comfort heat</p>;
  return (
    <>
      <div className="traffic-metrics__kpis">
        <Kpi label="Sendability" value={(snap.district * 100).toFixed(0)} hint={comfortBandLabel(snap.band)} />
        <Kpi label="Crowd" value={`${Math.round(snap.avgCongestion * 100)}%`} hint="avg load" />
        <Kpi label="Avoid" value={String(snap.avoidZones)} hint="cells" />
        <Kpi label="Calm" value={`${snap.calmPct}%`} hint="cells" />
      </div>
      <section className="traffic-metrics__section">
        <h3 className="mono">Opt-in people</h3>
        <ul className="traffic-metrics__list">
          {snap.personas.map((p) => (
            <li key={p.name}>
              <span className="name mono">{p.name.split(" ")[0]}</span>
              <span className={`tone tone-${comfortTone(p.band)}`}>{comfortBandLabel(p.band)}</span>
              <i className="bar" aria-hidden>
                <i style={{ width: `${Math.round(p.score * 100)}%` }} />
              </i>
              <span className="count mono">{Math.round(p.score * 100)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="traffic-metrics__section">
        <h3 className="mono">Zones · people / crowd</h3>
        <ul className="traffic-metrics__list">
          {snap.zones.map((z) => (
            <li key={z.id}>
              <span className="name mono">{z.id.replace("c-", "")}</span>
              <span className={`tone tone-${comfortTone(z.band)}`}>
                {z.congestion > 0.55 ? "crowd" : comfortBandLabel(z.band)}
              </span>
              <i className="bar" aria-hidden>
                <i style={{ width: `${Math.round(z.score * 100)}%` }} />
              </i>
              <span className="count mono">{z.pedCount}p</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
