import { useCallback, useEffect, useState } from "react";
import "./KitStreamBackground.css";

/**
 * Single WebRTC client: NVIDIA viewer (:8210) embedded full-bleed under City Lab UI.
 * Do not also open a separate :8210 tab — that steals the NVST slot.
 * Note: /ov-stream proxy breaks the viewer (absolute /src and /stream-config
 * paths hit the webtest Vite root instead of the viewer).
 */
const VIEWER = "http://127.0.0.1:8210/";

type Phase = "checking" | "ready" | "connecting" | "live" | "offline";

type Step = { id: string; label: string; done: boolean };

type StatusPayload = {
  ok?: boolean;
  signal?: boolean;
  viewer?: boolean;
  appReady?: boolean;
  percent?: number;
  steps?: Step[];
  boot?: { label?: string };
};

export function KitStreamBackground() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [detail, setDetail] = useState("Checking Kit…");
  const [percent, setPercent] = useState(0);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [showIframe, setShowIframe] = useState(false);

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/stream-status", { cache: "no-store" });
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as StatusPayload;
      if (typeof data.percent === "number") setPercent(data.percent);
      if (Array.isArray(data.steps)) setSteps(data.steps);
      if (data.boot?.label && phase !== "live" && phase !== "connecting") {
        setDetail(data.boot.label);
      }

      if (phase === "live" || phase === "connecting") return;

      if (data.appReady && data.signal && data.viewer) {
        setPhase("ready");
        setDetail("Kit ready — connect stream under this UI (one client)");
        return;
      }
      if (data.viewer && data.signal) {
        setPhase("checking");
        setDetail("City up — waiting for streaming app…");
        return;
      }
      setPhase(data.viewer ? "checking" : "offline");
      if (!data.viewer) setDetail("Start: ov-citylab/scripts/run_isaac6_streaming.sh");
    } catch {
      if (phase === "live" || phase === "connecting") return;
      setPhase("offline");
      setDetail("Start Isaac streaming + web viewer on :8210");
    }
  }, [phase]);

  const connectHere = useCallback(async () => {
    // Never TCP-kill the NVST slot here — that wedges StreamSDK (INVALID_STATE).
    // Only embed the single iframe client.
    setBusy(true);
    setPhase("connecting");
    setShowIframe(false);
    setDetail("Embedding Kit stream under City Lab…");
    try {
      await new Promise((r) => window.setTimeout(r, 400));
      setIframeKey((k) => k + 1);
      setShowIframe(true);
      setDetail("Connecting WebRTC under City Lab…");
      window.setTimeout(() => {
        setPhase("live");
        setDetail("Live — City Lab UI over Kit stream");
        setBusy(false);
      }, 2500);
    } catch (err) {
      setPhase("ready");
      setDetail(`Connect failed: ${String(err)}`);
      setBusy(false);
    }
  }, []);
  const releaseSlot = useCallback(async () => {
    setBusy(true);
    setDetail("Freeing WebRTC slot…");
    setShowIframe(false);
    setPhase("ready");
    try {
      await fetch("/api/release-stream-slot", { method: "POST" });
      setDetail("Slot free — click Connect stream here");
    } catch (err) {
      setDetail(`Release failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void probe();
    const id = window.setInterval(() => void probe(), 2500);
    return () => window.clearInterval(id);
  }, [probe]);

  // Auto-connect once Kit is ready (single embedded client).
  useEffect(() => {
    if (phase === "ready" && !showIframe && !busy) {
      void connectHere();
    }
  }, [phase, showIframe, busy, connectHere]);

  // Release NVST slot when leaving high-fidelity viewport (unmount).
  useEffect(() => {
    return () => {
      void fetch("/api/release-stream-slot", { method: "POST" }).catch(() => undefined);
    };
  }, []);

  return (
    <div className="kit-bg kit-bg--webrtc-host">
      {showIframe && (
        <iframe
          key={iframeKey}
          className="kit-bg__iframe"
          src={`${VIEWER}?embed=1&t=${iframeKey}`}
          title="Isaac Sim WebRTC"
          allow="autoplay; fullscreen; clipboard-read; clipboard-write; display-capture"
          referrerPolicy="no-referrer"
        />
      )}

      {phase === "live" ? (
        <button
          type="button"
          className="kit-bg__release"
          onClick={() => void releaseSlot()}
          disabled={busy}
        >
          Free stream slot
        </button>
      ) : (
        <div className={`kit-bg__boot${showIframe ? " kit-bg__boot--overlay" : ""}`}>
          <div className="kit-bg__card">
            {phase !== "ready" && <div className="kit-bg__spin" />}
            <div className="kit-bg__title">City Lab</div>
            <div className="kit-bg__detail">{detail}</div>

            <div className="kit-bg__progress" aria-label={`Loading ${percent}%`}>
              <div className="kit-bg__progress-track">
                <div
                  className="kit-bg__progress-fill"
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
              <div className="kit-bg__progress-pct mono">
                {Math.min(100, Math.round(percent))}%
              </div>
            </div>

            <ul className="kit-bg__steps">
              {steps.map((s) => (
                <li key={s.id} className={s.done ? "is-done" : ""}>
                  <span className="kit-bg__step-mark" aria-hidden>
                    {s.done ? "✓" : "·"}
                  </span>
                  {s.label}
                </li>
              ))}
            </ul>

            <div className="kit-bg__meta mono">Stream under UI · one client · {VIEWER}</div>
            <div className="kit-bg__actions">
              <button
                type="button"
                className="kit-bg__retry"
                onClick={() => void connectHere()}
                disabled={busy || phase === "connecting"}
              >
                Connect stream here
              </button>
              <button
                type="button"
                className="kit-bg__retry kit-bg__retry--ghost"
                onClick={() => void releaseSlot()}
                disabled={busy}
                title="Only if reconnect is stuck — may require Kit restart"
              >
                Free stream slot
              </button>
            </div>
            <p className="kit-bg__hint">
              One page only. Do not open :8210 separately. Prefer Connect over Free — Free can
              wedge StreamSDK until Kit restarts.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
