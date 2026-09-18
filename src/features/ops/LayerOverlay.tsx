import { useAscStore } from "../../state/ascStore";
import "./LayerOverlay.css";

const SENSOR_NODES = [
  [0.18, 0.28],
  [0.52, 0.22],
  [0.74, 0.34],
  [0.38, 0.48],
  [0.66, 0.44],
  [0.28, 0.62],
];

/** Decorative layer indicators still drawn as HUD (sensors only). */
export function LayerOverlay() {
  const layers = useAscStore((s) => s.activeLayers);

  return (
    <div className="layer-overlay" aria-hidden>
      {/* Scenario impact / replan zones removed — twin layers own that story now. */}

      {layers.includes("sensors") && (
        <div className="lo lo-sensors">
          {SENSOR_NODES.map(([x, y], i) => (
            <span
              key={i}
              className="lo-cam"
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, animationDelay: `${i * 0.35}s` }}
            />
          ))}
        </div>
      )}

      <div className="lo-scanline" />
      <div className="lo-grid" />
    </div>
  );
}
