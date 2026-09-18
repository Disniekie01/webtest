import { useState } from "react";
import {
  getCitizen,
  scenarios,
  useAscStore,
} from "../../state/ascStore";
import { PersonaGraphPreview } from "./PersonaGraphPreview";
import "./CitizenPanel.css";

export function CitizenPanel() {
  const id = useAscStore((s) => s.selectedCitizenId);
  const setMode = useAscStore((s) => s.setMode);
  const openComfort = useAscStore((s) => s.openComfort);
  const setScenario = useAscStore((s) => s.setScenario);
  const activeScenarioId = useAscStore((s) => s.activeScenarioId);
  const [dayOpen, setDayOpen] = useState(false);
  const citizen = getCitizen(id);
  if (!citizen) return null;

  const dayPlans = scenarios.filter(
    (s) => s.citizenId === citizen.id || s.citizenId === null,
  );
  const primaryScenario = scenarios.find((s) => s.citizenId === citizen.id);

  return (
    <section className="citizen-panel" aria-label={`${citizen.name} profile`}>
      <header className="citizen-panel__top">
        <button type="button" className="citizen-panel__close" onClick={() => setMode("ops")}>
          Back to ops
        </button>
        <div className="citizen-panel__actions">
          <button type="button" className="citizen-panel__btn ghost" onClick={openComfort}>
            Open in Studio
          </button>
          <button type="button" className="citizen-panel__btn primary" onClick={() => setDayOpen(true)}>
            View day
          </button>
        </div>
      </header>

      <div className="citizen-panel__layout">
        <aside className="citizen-panel__identity">
          <div className="citizen-panel__portrait">
            <img src={citizen.portrait} alt="" />
            <span className="citizen-panel__score mono">
              {(citizen.comfortScore * 100).toFixed(0)}
              <small>comfort</small>
            </span>
          </div>
          <p className="mono muted eyebrow">Personality agent</p>
          <h2>{citizen.name}</h2>
          <p className="tagline">{citizen.tagline}</p>
          <dl className="dossier-meta">
            <div>
              <dt>Age</dt>
              <dd className="mono">{citizen.age}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{citizen.role}</dd>
            </div>
            <div>
              <dt>District</dt>
              <dd>{citizen.district}</dd>
            </div>
          </dl>

          {citizen.accessibility.length > 0 && (
            <div className="chip-block">
              <h3>Accessibility</h3>
              <ul>
                {citizen.accessibility.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="chip-block">
            <h3>Preferences</h3>
            <ul>
              {citizen.preferences.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <div className="chip-block">
            <h3>Triggers</h3>
            <ul>
              {citizen.triggers.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="citizen-panel__graph-col">
          <div className="citizen-panel__section-head">
            <h3>Agent graph</h3>
            <span className="mono muted">traits · goals · routine · event</span>
          </div>
          <PersonaGraphPreview citizenId={citizen.id} />
        </div>

        <div className="citizen-panel__side">
          <div className="citizen-panel__journey">
            <h3>Journey beat</h3>
            <ol>
              {citizen.journey.map((j) => (
                <li key={j.t + j.label}>
                  <span className="mono time">{j.t}</span>
                  <div>
                    <strong>{j.label}</strong>
                    <p>{j.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="citizen-panel__planner">
            <h3>Story scenarios</h3>
            <div className="planner-slots">
              {dayPlans.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`planner-chip ${activeScenarioId === s.id ? "on" : ""}`}
                  onClick={() => setScenario(s.id)}
                >
                  <span className="mono slot">{s.slot}</span>
                  <strong>{s.title}</strong>
                  <span className="muted">{s.summary}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {dayOpen && (
        <div className="citizen-day" role="dialog" aria-label={`${citizen.name} day view`}>
          <button
            type="button"
            className="citizen-day__backdrop"
            aria-label="Close"
            onClick={() => setDayOpen(false)}
          />
          <div className="citizen-day__panel">
            <header className="citizen-day__head">
              <div>
                <p className="mono muted eyebrow">Day view · coming soon</p>
                <h2>{citizen.name}</h2>
                <p className="muted">
                  {primaryScenario?.title ?? "District day"} — story video will live here.
                </p>
              </div>
              <button type="button" className="citizen-panel__btn ghost" onClick={() => setDayOpen(false)}>
                Close
              </button>
            </header>
            <div className="citizen-day__stage">
              <div className="citizen-day__placeholder">
                <span className="mono">VIDEO</span>
                <p>Placeholder for the day narrative film / twin capture.</p>
              </div>
            </div>
            <ol className="citizen-day__beats">
              {citizen.journey.map((j) => (
                <li key={j.t + j.label}>
                  <span className="mono">{j.t}</span>
                  <strong>{j.label}</strong>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
