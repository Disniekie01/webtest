import "./LayerOverlay.css";

/** Soft twin HUD chrome — CCTV icons live on intersections in the 3D scene. */
export function LayerOverlay() {
  return (
    <div className="layer-overlay" aria-hidden>
      <div className="lo-scanline" />
      <div className="lo-grid" />
    </div>
  );
}
