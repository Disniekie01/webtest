import { comfortColor } from "../../lib/journeyMath";
import { packs, useLabStore } from "../../state/store";
import "./BeatPanel.css";

export function BeatPanel() {
  const selectedId = useLabStore((s) => s.selectedId);
  const beat = useLabStore((s) => s.currentBeat);
  const comfort = useLabStore((s) => s.currentComfort);
  const label = useLabStore((s) => s.currentLabel);
  const orchPolicy = useLabStore((s) => s.orchPolicy);
  const orchLive = useLabStore((s) => s.orchLive);
  const kitRobotLive = useLabStore((s) => s.kitRobotLive);
  const pack = selectedId ? packs[selectedId] : null;

  if (!pack) {
    return (
      <aside className="beat-panel panel">
        <p className="muted">Select a person to open their story.</p>
      </aside>
    );
  }

  const story = pack.story;
  const activeBeat =
    story?.beats?.find((b) => b.id === beat) || story?.beats?.[0];
  const policy = orchPolicy || "—";
  const policyClass =
    policy === "yield"
      ? "yield"
      : policy === "detour"
        ? "detour"
        : policy === "proceed"
          ? "proceed"
          : "idle";

  return (
    <aside className="beat-panel panel">
      <div className="beat-kicker mono muted">STORY</div>
      <h2 className="beat-title">{story?.title || pack.catalog.name}</h2>
      <p className="beat-summary">{story?.summary}</p>

      <div className="comfort-meter">
        <div className="comfort-meter-head">
          <span>Comfort</span>
          <span className="mono" style={{ color: comfortColor(comfort) }}>
            {comfort.toFixed(2)}
          </span>
        </div>
        <div className="comfort-bar">
          <div
            className="comfort-fill"
            style={{
              width: `${Math.min(100, comfort * 100)}%`,
              background: comfortColor(comfort),
            }}
          />
        </div>
        <div className="muted mono beat-label">{label || "—"}</div>
      </div>

      <div className="policy-row">
        <span className="mono muted">Policy</span>
        <span className={`policy-chip policy-chip--${policyClass}`}>
          {orchLive ? policy : "off"}
        </span>
        <span className="mono muted policy-source">
          {kitRobotLive ? "kit robot" : "story path"}
        </span>
      </div>

      {activeBeat && (
        <div className="beat-block" key={activeBeat.id}>
          <div className="beat-id mono">{activeBeat.id}</div>
          <p>{activeBeat.text}</p>
        </div>
      )}

      <div className="beat-tags">
        {(pack.catalog.tags || []).map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
    </aside>
  );
}
