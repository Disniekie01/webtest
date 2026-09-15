import { useLabStore } from "./state/store";
import { Hero } from "./features/shell/Hero";
import { AppShell } from "./features/shell/AppShell";
import { KitStreamBackground } from "./scene/KitStreamBackground";
import "./App.css";

/** City Lab UI overlays a single embedded Kit WebRTC client (:8210 iframe). */
export default function App() {
  const mode = useLabStore((s) => s.mode);
  return (
    <div className="app-root">
      <div className="app-viewport">
        <KitStreamBackground />
      </div>
      <div className="app-chrome">{mode === "hero" ? <Hero /> : <AppShell />}</div>
    </div>
  );
}
