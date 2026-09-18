import { useEffect, useState } from "react";
import { telemetry, useAscStore } from "../../state/ascStore";
import "./LiveFeeds.css";

type FeedSnap = {
  vehicles: number;
  pedestrians: number;
  robotsActive: number;
  avgSpeed: number;
  aqi: number;
  incidents: number;
  transitDelayMin: number;
  comfortIndex: number;
};

function jitter(base: number, amp: number, t: number, phase: number) {
  return Math.max(0, Math.round(base + Math.sin(t * 0.7 + phase) * amp + Math.cos(t * 1.3 + phase) * amp * 0.4));
}

function sample(t: number): FeedSnap {
  return {
    vehicles: jitter(842, 28, t, 0.2),
    pedestrians: jitter(1260, 55, t, 1.1),
    robotsActive: Math.min(telemetry.length, jitter(telemetry.length - 1, 1.2, t, 2.4) + 4),
    avgSpeed: Number((28 + Math.sin(t * 0.5) * 3.2 + Math.cos(t * 0.9) * 1.1).toFixed(1)),
    aqi: jitter(42, 4, t, 3.1),
    incidents: jitter(3, 1.4, t, 4.2),
    transitDelayMin: Number((4.2 + Math.sin(t * 0.35) * 2.4).toFixed(1)),
    comfortIndex: Number((0.72 + Math.sin(t * 0.25) * 0.06).toFixed(2)),
  };
}

const TICKER = [
  "CV cluster forming — North Hub platform B",
  "Delivery fleet policy: stagger plaza corridor",
  "Air quality nominal · AQI band good",
  "Sidewalk constriction — Harbor west block",
  "Ring shuttle 4 soft-yield at plaza crosswalk",
  "Comfort band tightened — mixed-use core",
];

export function LiveFeeds() {
  const layers = useAscStore((s) => s.activeLayers);
  const [snap, setSnap] = useState(() => sample(0));
  const [tick, setTick] = useState(0);
  const [tickerIdx, setTickerIdx] = useState(0);

  useEffect(() => {
    let t = 0;
    const id = window.setInterval(() => {
      t += 0.45;
      setTick((n) => n + 1);
      setSnap(sample(t));
      if (Math.floor(t * 2) % 7 === 0) {
        setTickerIdx((i) => (i + 1) % TICKER.length);
      }
    }, 900);
    return () => window.clearInterval(id);
  }, []);

  const cards = [
    {
      id: "traffic",
      label: "Traffic volume",
      value: snap.vehicles.toLocaleString(),
      unit: "veh",
      sub: `${snap.avgSpeed} km/h avg`,
      show: layers.includes("traffic") || layers.includes("activity"),
    },
    {
      id: "peds",
      label: "Pedestrian density",
      value: snap.pedestrians.toLocaleString(),
      unit: "pax",
      sub: "city-wide estimate",
      show: layers.includes("pedestrians") || layers.includes("activity"),
    },
    {
      id: "robots",
      label: "Autonomous fleet",
      value: String(snap.robotsActive),
      unit: "active",
      sub: `${telemetry.length} enrolled`,
      show: layers.includes("robots"),
    },
    {
      id: "transit",
      label: "Transit delay",
      value: String(snap.transitDelayMin),
      unit: "min",
      sub: snap.transitDelayMin > 5 ? "elevated" : "stable",
      show: layers.includes("transit"),
    },
    {
      id: "sensors",
      label: "Air quality",
      value: String(snap.aqi),
      unit: "AQI",
      sub: `${snap.incidents} open incidents`,
      show: layers.includes("sensors"),
    },
    {
      id: "comfort",
      label: "Comfort index",
      value: snap.comfortIndex.toFixed(2),
      unit: "idx",
      sub: "opt-in aggregate",
      show: layers.includes("comfort"),
    },
    {
      id: "aq-pulse",
      label: "District breath",
      value: String(snap.aqi),
      unit: "AQI",
      sub: snap.aqi < 50 ? "inhaling clean" : snap.aqi < 80 ? "mixed air" : "elevated load",
      show: layers.includes("activity"),
    },
  ].filter((c) => c.show);

  return (
    <aside className="live-feeds" aria-label="Live city feeds">
      <div className="live-feeds__head">
        <span className="live-dot" />
        <div>
          <h2>City pulse</h2>
          <p className="mono">Live feeds · mock stream #{tick}</p>
        </div>
      </div>

      <div className="live-feeds__ticker mono" key={tickerIdx}>
        {TICKER[tickerIdx]}
      </div>

      <div className="live-feeds__cards">
        {cards.length === 0 ? (
          <p className="live-feeds__empty muted">Enable a layer to surface feeds.</p>
        ) : (
          cards.map((c) => (
            <article key={c.id} className="feed-card">
              <header>
                <span>{c.label}</span>
                <span className="mono unit">{c.unit}</span>
              </header>
              <div className="feed-card__value mono">{c.value}</div>
              <footer>{c.sub}</footer>
              <div className="feed-card__wave" aria-hidden>
                <span style={{ animationDelay: "0ms" }} />
                <span style={{ animationDelay: "120ms" }} />
                <span style={{ animationDelay: "240ms" }} />
                <span style={{ animationDelay: "360ms" }} />
                <span style={{ animationDelay: "480ms" }} />
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
