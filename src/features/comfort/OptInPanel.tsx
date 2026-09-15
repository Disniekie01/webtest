import { packs, resolveComfort, useLabStore } from "../../state/store";
import type { ComfortOverride } from "../../data/types";
import "./OptInPanel.css";

const PRESET_PREFS = [
  "accessible_bay_reroute",
  "paired_assist_robot",
  "soft_warning_chime",
  "audible_intent",
  "robot_free_sidewalks",
  "predictable_yield",
  "clear_passing_side",
];

const PRESET_TRIGGERS = [
  "silent_approach",
  "close_pass_under_1m",
  "inaccessible_dropoff",
  "blocked_curb_cut",
  "sudden_stop",
  "path_blocked_by_robot",
];

export function OptInPanel() {
  const selectedId = useLabStore((s) => s.selectedId);
  const show = useLabStore((s) => s.showOptIn);
  const toggle = useLabStore((s) => s.toggleOptIn);
  const setComfortOverride = useLabStore((s) => s.setComfortOverride);
  const overrides = useLabStore((s) => s.comfortOverrides);
  const override = resolveComfort(selectedId, overrides);
  const pack = selectedId ? packs[selectedId] : null;

  if (!show || !selectedId || !override) return null;

  const update = (patch: Partial<ComfortOverride>) => {
    setComfortOverride(selectedId, { ...override, ...patch });
  };

  const toggleList = (key: "triggers" | "preferences", value: string) => {
    const list = override[key];
    const next = list.includes(value)
      ? list.filter((x) => x !== value)
      : [...list, value];
    update({ [key]: next });
  };

  return (
    <aside className="optin-panel panel">
      <div className="optin-head">
        <div>
          <div className="mono muted optin-kicker">COMFORT OPT-IN</div>
          <h3>{pack?.catalog.name}</h3>
        </div>
        <button type="button" className="ghost" onClick={toggle}>
          Close
        </button>
      </div>
      <p className="muted optin-note">
        Residents set what they want robots to respect. Preferences change
        mock replans (e.g. accessible bay reroute).
      </p>

      <label className="score-label">
        Comfort score
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={override.score}
          onChange={(e) => update({ score: Number(e.target.value) })}
        />
        <span className="mono">{override.score.toFixed(2)}</span>
      </label>

      <div className="chip-block">
        <div className="chip-title mono">Preferences</div>
        <div className="chips">
          {PRESET_PREFS.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${override.preferences.includes(p) ? "on" : ""}`}
              onClick={() => toggleList("preferences", p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="chip-block">
        <div className="chip-title mono">Triggers</div>
        <div className="chips">
          {PRESET_TRIGGERS.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip warn ${override.triggers.includes(p) ? "on" : ""}`}
              onClick={() => toggleList("triggers", p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
