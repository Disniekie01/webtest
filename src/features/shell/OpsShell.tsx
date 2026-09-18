import { useEffect, useState } from "react";
import type { DataLayer } from "../../data/ascTypes";
import {
  LAYER_LABELS,
  citizens,
  getScenario,
  telemetry,
  useAscStore,
} from "../../state/ascStore";
import { useSumoActors } from "../../scene/useSumoActors";
import { LayerOverlay } from "../ops/LayerOverlay";
import { LiveFeeds } from "../ops/LiveFeeds";
import { MetricsDock } from "../ops/MetricsDock";
import { TelemetryDrawer } from "../ops/TelemetryDrawer";
import { CitizenPanel } from "../citizens/CitizenPanel";
import { ComfortMap } from "../comfort/ComfortMap";
import "./OpsShell.css";
import "../ops/MetricsDock.css";

/** DMF-style module rail — maps to our data layers */
const MODULES: { id: DataLayer; label: string; hint: string }[] = [
  { id: "sensors", label: "Surveillance", hint: "CCTV · CV" },
  { id: "traffic", label: "Traffic", hint: "flow · density" },
  { id: "pedestrians", label: "Pedestrians", hint: "crowd · paths" },
  { id: "robots", label: "Fleet", hint: "physical AI" },
  { id: "transit", label: "Transit", hint: "lines · delay" },
  { id: "activity", label: "AQ / Pulse", hint: "breath · AQI" },
  { id: "comfort", label: "Comfort", hint: "heat · opt-in" },
];

const LAYER_ORDER: DataLayer[] = [
  "traffic",
  "pedestrians",
  "robots",
  "sensors",
  "comfort",
  "transit",
  "activity",
];

function useLiveClock() {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }),
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const n = new Date();
      setClock(n.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setDate(n.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return { clock, date };
}

function useLinkProbe() {
  const setLinkHealth = useAscStore((s) => s.setLinkHealth);
  const sumo = useSumoActors(1000);
  const [kitHint, setKitHint] = useState("");

  useEffect(() => {
    setLinkHealth(sumo.live ? "live" : useAscStore.getState().linkHealth, sumo.live);
  }, [sumo.live, setLinkHealth]);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch("/api/stream-status", {
          cache: "no-store",
          signal: AbortSignal.timeout(1200),
        });
        if (!res.ok) throw new Error("status");
        const data = (await res.json()) as { appReady?: boolean; signal?: boolean };
        if (cancelled) return;
        const kitUp = Boolean(data.appReady && data.signal);
        setKitHint(kitUp ? "LIVE" : data.appReady ? "…" : "offline");
        const sumoLive = useAscStore.getState().sumoLive;
        if (sumoLive || kitUp) setLinkHealth("live", sumoLive);
        else if (data.appReady) setLinkHealth("degraded", false);
        else setLinkHealth("offline", false);
      } catch {
        if (!cancelled) {
          setKitHint("offline");
          if (!useAscStore.getState().sumoLive) setLinkHealth("offline", false);
        }
      }
    };
    void probe();
    const id = window.setInterval(() => void probe(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [setLinkHealth]);

  return { kitHint };
}

export function OpsShell() {
  const mode = useAscStore((s) => s.mode);
  const activeLayers = useAscStore((s) => s.activeLayers);
  const toggleLayer = useAscStore((s) => s.toggleLayer);
  const backHero = useAscStore((s) => s.backHero);
  const openCitizen = useAscStore((s) => s.openCitizen);
  const openComfort = useAscStore((s) => s.openComfort);
  const setMode = useAscStore((s) => s.setMode);
  const toggleTelemetry = useAscStore((s) => s.toggleTelemetry);
  const telemetryOpen = useAscStore((s) => s.telemetryOpen);
  const activeScenarioId = useAscStore((s) => s.activeScenarioId);
  const selectedCitizenId = useAscStore((s) => s.selectedCitizenId);
  const viewportMode = useAscStore((s) => s.viewportMode);
  const switchViewport = useAscStore((s) => s.switchViewport);
  const transitioning = useAscStore((s) => s.viewportTransitioning);
  const openCv = useAscStore((s) => s.openCv);
  const linkHealth = useAscStore((s) => s.linkHealth);
  const sumoLive = useAscStore((s) => s.sumoLive);
  const storyPulse = useAscStore((s) => s.storyPulse);
  const clearStoryPulse = useAscStore((s) => s.clearStoryPulse);
  const { clock, date } = useLiveClock();
  const { kitHint } = useLinkProbe();

  useEffect(() => {
    if (!storyPulse) return;
    const id = window.setTimeout(() => clearStoryPulse(), 14000);
    return () => window.clearTimeout(id);
  }, [storyPulse, clearStoryPulse]);

  const scenario = getScenario(activeScenarioId);

  const liveLabel =
    linkHealth === "live"
      ? sumoLive
        ? "LIVE · SUMO"
        : "LIVE"
      : linkHealth === "degraded"
        ? "DEGRADED"
        : linkHealth === "checking"
          ? "…"
          : "OFFLINE";

  const liveClass =
    linkHealth === "live"
      ? "ops-live"
      : linkHealth === "offline"
        ? "ops-live ops-live--offline"
        : "ops-live ops-live--degraded";

  return (
    <div className={`ops-shell dmf${viewportMode === "kit" ? " ops-shell--kit" : ""}`}>
      <header className="ops-top">
        <div className="ops-top__left">
          <button type="button" className="ops-brand" onClick={backHero}>
            Adaptive Smart City
          </button>
          <nav className="ops-crumb mono" aria-label="Location">
            <span>Demo</span>
            <i>/</i>
            <span>Harbor District</span>
            <i>/</i>
            <span className="current">Ops</span>
          </nav>
        </div>

        <div className="ops-top__center mono">
          <span className="ops-wx">22°C</span>
          <span className="ops-sep" />
          <span>
            {date} · {clock}
          </span>
          <span className="ops-sep" />
          <span className={liveClass}>{liveLabel}</span>
        </div>

        <div className="ops-top__actions">
          <button
            type="button"
            className={`ops-action ${telemetryOpen ? "on" : ""}`}
            onClick={toggleTelemetry}
          >
            Fleet · {telemetry.length}
          </button>
          <button type="button" className="ops-action" onClick={openComfort}>
            Agent Studio
          </button>
          {mode !== "ops" && (
            <button type="button" className="ops-action ghost" onClick={() => setMode("ops")}>
              Close
            </button>
          )}
        </div>
      </header>

      <LayerOverlay />

      <aside className="ops-modules" aria-label="City modules">
        <div className="ops-modules__tabs mono">
          <span className="on">Layers</span>
          <span>Outliner</span>
          <span>Functions</span>
        </div>
        <ul className="ops-modules__list">
          {MODULES.map((m) => {
            const on =
              m.id === "comfort"
                ? activeLayers.includes("comfort") || mode === "comfort"
                : activeLayers.includes(m.id as DataLayer);
            return (
              <li key={m.label}>
                <button
                  type="button"
                  className={`ops-mod ${on ? "on" : ""}`}
                  onClick={() => {
                    if (m.id === "comfort") {
                      toggleLayer("comfort");
                    } else if (m.id === "robots") {
                      toggleLayer("robots");
                      if (!telemetryOpen) toggleTelemetry();
                    } else {
                      toggleLayer(m.id as DataLayer);
                    }
                  }}
                >
                  <i className={`ops-mod__dot layer-${m.id}`} />
                  <span className="ops-mod__text">
                    <strong>{m.label}</strong>
                    <em>{m.hint}</em>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="ops-modules__quick">
          {LAYER_ORDER.map((layer) => (
            <button
              key={layer}
              type="button"
              className={`ops-chip ${activeLayers.includes(layer) ? "on" : ""}`}
              onClick={() => toggleLayer(layer)}
              title={LAYER_LABELS[layer]}
            >
              {LAYER_LABELS[layer].split(" ")[0]}
            </button>
          ))}
        </div>
      </aside>

      <LiveFeeds />
      <MetricsDock />

      <aside className="ops-personas" aria-label="Citizen personas">
        <header className="ops-personas__head">
          <span className="mono">Personas</span>
          <span className="muted mono">opt-in</span>
        </header>
        {citizens.map((c) => {
          const active = selectedCitizenId === c.id && mode === "citizen";
          return (
            <button
              key={c.id}
              type="button"
              className={`ops-persona ${active ? "active" : ""}`}
              onClick={() => openCitizen(c.id)}
            >
              <div className="ops-persona__photo">
                <img src={c.portrait} alt="" />
              </div>
              <div className="ops-persona__meta">
                <strong>{c.name}</strong>
                <span>{c.role}</span>
                <span className="score mono">comfort {(c.comfortScore * 100).toFixed(0)}</span>
              </div>
            </button>
          );
        })}
      </aside>

      {scenario && mode === "ops" && (
        <div className="ops-scenario-chip">
          <span className="mono muted">Scenario</span>
          <strong>{scenario.title}</strong>
          <span className="muted">{scenario.summary}</span>
        </div>
      )}

      {storyPulse && mode === "ops" && (
        <div className="ops-story-pulse" role="status">
          <div className="ops-story-pulse__top">
            <strong>
              Day run · {storyPulse.agentName}
              {storyPulse.policy ? ` · ${storyPulse.policy}` : ""}
            </strong>
            <button type="button" className="ops-story-pulse__dismiss" onClick={clearStoryPulse}>
              Dismiss
            </button>
          </div>
          <p>{storyPulse.blurb}</p>
        </div>
      )}

      <div className="ops-dock" aria-label="View tools">
        <button
          type="button"
          className={`ops-dock__btn ${viewportMode === "ops3d" ? "on" : ""}`}
          disabled={transitioning}
          onClick={() => void switchViewport("ops3d")}
        >
          Twin
        </button>
        <button
          type="button"
          className={`ops-dock__btn ${viewportMode === "kit" ? "on" : ""}`}
          disabled={transitioning}
          onClick={() => void switchViewport("kit")}
        >
          High fidelity{kitHint ? ` · ${kitHint}` : ""}
        </button>
        <span className="ops-dock__sep" />
        <button type="button" className="ops-dock__btn" onClick={toggleTelemetry}>
          Telemetry
        </button>
        <button type="button" className="ops-dock__btn" onClick={openCv}>
          Yardline
        </button>
        <button type="button" className="ops-dock__btn" onClick={openComfort}>
          Agent Studio
        </button>
      </div>

      <TelemetryDrawer />
      {mode === "citizen" && <CitizenPanel />}
      {mode === "comfort" && <ComfortMap />}
    </div>
  );
}
