import { useLabStore } from "../../state/store";
import "./Transport.css";

export function Transport() {
  const playing = useLabStore((s) => s.playing);
  const timeS = useLabStore((s) => s.timeS);
  const durationS = useLabStore((s) => s.durationS);
  const setPlaying = useLabStore((s) => s.setPlaying);
  const setTime = useLabStore((s) => s.setTime);
  const toggleCv = useLabStore((s) => s.toggleCv);
  const toggleOptIn = useLabStore((s) => s.toggleOptIn);
  const showCv = useLabStore((s) => s.showCv);
  const showOptIn = useLabStore((s) => s.showOptIn);
  const arcMode = useLabStore((s) => s.arcMode);

  const pct = durationS > 0 ? (timeS / durationS) * 100 : 0;

  return (
    <div className="transport panel">
      <button
        type="button"
        className="play-btn"
        onClick={() => setPlaying(!playing)}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <input
        className="scrub"
        type="range"
        min={0}
        max={durationS}
        step={0.05}
        value={timeS}
        onChange={(e) => {
          setPlaying(false);
          setTime(Number(e.target.value));
        }}
      />
      <span className="mono time">
        {timeS.toFixed(1)}s / {durationS.toFixed(1)}s
      </span>
      <div className="progress" style={{ width: `${pct}%` }} />
      <button
        type="button"
        className={`chip-toggle ${showCv ? "on" : ""}`}
        onClick={toggleCv}
      >
        Yardline CV
      </button>
      <button
        type="button"
        className={`chip-toggle ${showOptIn ? "on" : ""}`}
        onClick={toggleOptIn}
      >
        Comfort opt-in
      </button>
      {arcMode && <span className="mono arc-flag">ASSISTIVE ARC</span>}
    </div>
  );
}
