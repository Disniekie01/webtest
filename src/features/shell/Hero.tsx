import { useAscStore } from "../../state/ascStore";
import "./Hero.css";

export function Hero() {
  const enterOps = useAscStore((s) => s.enterOps);

  return (
    <div className="asc-hero">
      <div className="asc-hero__copy">
        <p className="asc-hero__eyebrow mono">Intelligence layer</p>
        <h1 className="asc-hero__brand">Adaptive Smart City</h1>
        <p className="asc-hero__line">A city that understands.</p>
        <div className="asc-hero__ctas">
          <button type="button" className="asc-cta primary" onClick={enterOps}>
            Enter
          </button>
        </div>
      </div>
    </div>
  );
}
