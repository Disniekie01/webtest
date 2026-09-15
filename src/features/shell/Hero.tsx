import { useLabStore } from "../../state/store";
import "./Hero.css";

export function Hero() {
  const enterLab = useLabStore((s) => s.enterLab);
  const playAssistiveArc = useLabStore((s) => s.playAssistiveArc);

  return (
    <div className="hero">
      <div className="hero-veil" />
      <div className="hero-copy">
        <h1 className="hero-brand">City Lab</h1>
        <p className="hero-line">
          Live Kit city stream behind the console — comfort, stories, and CV on top.
        </p>
        <div className="hero-ctas">
          <button type="button" className="cta primary" onClick={() => enterLab("elena_voss")}>
            Play story
          </button>
          <button
            type="button"
            className="cta"
            onClick={() => {
              useLabStore.setState({ showOptIn: true });
              enterLab("noor_rahman");
            }}
          >
            Comfort opt-in
          </button>
          <button type="button" className="cta ghost" onClick={playAssistiveArc}>
            Assistive arc
          </button>
        </div>
      </div>
    </div>
  );
}
