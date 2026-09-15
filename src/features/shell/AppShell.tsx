import { StoryRail } from "../stories/StoryRail";
import { BeatPanel } from "../stories/BeatPanel";
import { OptInPanel } from "../comfort/OptInPanel";
import { CameraPanel } from "../cv/CameraPanel";
import { Transport } from "../play/Transport";
import { useLabStore } from "../../state/store";
import "./AppShell.css";

export function AppShell() {
  const backHero = useLabStore((s) => s.backHero);
  const showOptIn = useLabStore((s) => s.showOptIn);

  return (
    <div className="lab-shell">
      <header className="lab-top">
        <button type="button" className="brand-mini" onClick={backHero}>
          <span className="brand-mark">City Lab</span>
          <span className="muted mono">Kit WebRTC</span>
        </button>
      </header>

      <div className="lab-left">
        <StoryRail />
      </div>

      <div className="lab-right">
        <BeatPanel />
        {showOptIn && <OptInPanel />}
        <CameraPanel />
      </div>

      <div className="lab-bottom">
        <Transport />
      </div>
    </div>
  );
}
