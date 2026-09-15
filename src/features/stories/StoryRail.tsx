import { comfortColor } from "../../lib/journeyMath";
import { peopleIndex, useLabStore } from "../../state/store";
import "./StoryRail.css";

export function StoryRail() {
  const selectedId = useLabStore((s) => s.selectedId);
  const selectPerson = useLabStore((s) => s.selectPerson);
  const playAssistiveArc = useLabStore((s) => s.playAssistiveArc);

  const sorted = [...peopleIndex].sort(
    (a, b) => a.comfort_score - b.comfort_score,
  );

  return (
    <aside className="story-rail panel">
      <div className="rail-head">
        <span className="rail-title">People</span>
        <span className="muted mono rail-sub">comfort ↑</span>
      </div>
      <button type="button" className="arc-btn" onClick={playAssistiveArc}>
        Assistive robotics arc
      </button>
      <ul className="rail-list">
        {sorted.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={`rail-item ${selectedId === p.id ? "active" : ""}`}
              onClick={() => selectPerson(p.id)}
            >
              <span
                className="comfort-dot"
                style={{ background: comfortColor(p.comfort_score) }}
              />
              <span className="rail-name">{p.name}</span>
              <span className="mono rail-score">
                {p.comfort_score.toFixed(2)}
              </span>
              <span className="muted rail-level">{p.comfort_level}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
