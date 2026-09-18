import { useAscStore } from "./state/ascStore";
import { Hero } from "./features/shell/Hero";
import { OpsShell } from "./features/shell/OpsShell";
import { CvModal } from "./features/cv/CvModal";
import { CityCanvas } from "./scene/CityCanvas";
import { KitStreamBackground } from "./scene/KitStreamBackground";
import { StillBackdrop } from "./scene/StillBackdrop";
import "./App.css";

/** Adaptive Smart City — low-fi twin by default; High fidelity swaps to Isaac Kit. */
export default function App() {
  const mode = useAscStore((s) => s.mode);
  const viewportMode = useAscStore((s) => s.viewportMode);
  const transitioning = useAscStore((s) => s.viewportTransitioning);

  return (
    <div className="app-root">
      <div className="app-viewport">
        {viewportMode === "ops3d" && <CityCanvas />}
        {viewportMode === "kit" && <KitStreamBackground />}
        {viewportMode === "still" && <StillBackdrop />}
      </div>
      <div
        className={`fidelity-veil${transitioning ? " fidelity-veil--on" : ""}`}
        aria-hidden
      />
      <div className="app-chrome">{mode === "hero" ? <Hero /> : <OpsShell />}</div>
      {mode === "cv" && <CvModal />}
    </div>
  );
}
