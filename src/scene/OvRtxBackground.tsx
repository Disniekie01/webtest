import { useEffect, useState } from "react";
import "./OvRtxBackground.css";

/**
 * Full-bleed OVRTX viewport — Blacknode viewer-ovrtx pattern:
 * GPU renders via ovrtx; browser shows live MJPEG (/ovrtx/stream.mjpg).
 */
export function OvRtxBackground() {
  const [status, setStatus] = useState<{
    phase: string;
    detail: string;
    error: string;
    has_image: boolean;
    frame: number;
    vehicles?: number;
    pedestrians?: number;
    sumo_time?: number;
  } | null>(null);
  const [imgOk, setImgOk] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/ovrtx/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = await res.json();
        if (alive) setStatus(json);
      } catch {
        if (alive) {
          setStatus({
            phase: "offline",
            detail: "Start OVRTX: python ov-citylab/scripts/ovrtx_stream_server.py",
            error: "",
            has_image: false,
            frame: 0,
          });
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 800);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // MJPEG <img> often never fires onLoad reliably — trust status.has_image once streaming.
  const streamingOk =
    status?.phase === "streaming" && Boolean(status?.has_image);
  const showBoot =
    !streamingOk &&
    (!status?.has_image ||
      status?.phase === "offline" ||
      status?.phase === "error" ||
      status?.phase === "starting" ||
      status?.phase === "initializing" ||
      status?.phase === "loading" ||
      status?.phase === "warming" ||
      status?.phase === "sumo" ||
      !imgOk);

  return (
    <div className="ovrtx-bg">
      <img
        className="ovrtx-bg__stream"
        src="/ovrtx/stream.mjpg"
        alt="OVRTX city viewport"
        draggable={false}
        onLoad={() => setImgOk(true)}
        onError={() => setImgOk(false)}
      />
      {showBoot && (
        <div className="ovrtx-bg__boot">
          <div className="ovrtx-bg__card">
            <div className="ovrtx-bg__spin" />
            <div className="ovrtx-bg__title">
              {status?.error
                ? "OVRTX failed"
                : status?.phase === "offline"
                  ? "OVRTX offline"
                  : "Starting NVIDIA OVRTX"}
            </div>
            <div className="ovrtx-bg__detail">
              {status?.error ||
                status?.detail ||
                "First frame compiles shaders and loads the city USD."}
            </div>
            {status?.phase === "streaming" && (
              <div className="ovrtx-bg__meta mono">
                frame {status.frame}
                {typeof status.vehicles === "number" &&
                  ` · ${status.vehicles} veh · ${status.pedestrians ?? 0} ped`}
              </div>
            )}
            {status && status.frame > 0 && status.phase !== "streaming" && (
              <div className="ovrtx-bg__meta mono">frame {status.frame}</div>
            )}
          </div>
        </div>
      )}
      {status?.phase === "streaming" && imgOk && (
        <div className="ovrtx-bg__hud mono">
          OVRTX · live
          {typeof status.vehicles === "number"
            ? ` · ${status.vehicles} veh · ${status.pedestrians ?? 0} ped`
            : ""}
          {` · f${status.frame}`}
        </div>
      )}
    </div>
  );
}
