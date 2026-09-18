import "./StillBackdrop.css";

/** Full-bleed cinematic city still for UI development (no Kit stream). */
export function StillBackdrop() {
  return (
    <div className="still-backdrop" aria-hidden>
      <img
        className="still-backdrop__img"
        src="/backdrop/city-still.jpg"
        alt=""
        draggable={false}
      />
      <div className="still-backdrop__veil" />
      <div className="still-backdrop__vignette" />
    </div>
  );
}
