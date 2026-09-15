import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const WEBRTC_SCRIPT = path.join(REPO, "ov-citylab/scripts/run_webrtc_client.sh");
const RELEASE_SCRIPT = path.join(REPO, "ov-citylab/scripts/release_stream_slot.sh");

function probeTcp(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

/** True when Kit has opened the NVST media UDP port (client negotiated). */
function probeMediaUdp(port = 47998): boolean {
  try {
    const text = fs.readFileSync("/proc/net/udp", "utf8") + fs.readFileSync("/proc/net/udp6", "utf8");
    const hex = port.toString(16).toUpperCase().padStart(4, "0");
    return text.split("\n").some((line) => line.includes(`:${hex}`));
  } catch {
    return false;
  }
}

/** Kit is stream-connectable once city/SUMO boot finishes (Isaac 6 rarely logs "app ready"). */
function kitBootReady(boot: Record<string, unknown> | null): boolean {
  if (!boot) return false;
  if (boot.ticking) return true;
  const stage = String(boot.stage ?? "");
  return stage === "ready" || stage === "ticking" || stage === "ready_no_sumo";
}

function webrtcLauncherPlugin(): Plugin {
  return {
    name: "citylab-webrtc-launcher",
    configureServer(server) {
      server.middlewares.use("/api/stream-status", async (_req, res) => {
        // Isaac default 49100; keep 49102 as legacy probe
        const signal =
          (await probeTcp("127.0.0.1", 49100)) || (await probeTcp("127.0.0.1", 49102));
        let viewer = false;
        try {
          const r = await fetch("http://127.0.0.1:8210/", { signal: AbortSignal.timeout(800) });
          viewer = r.ok;
        } catch {
          viewer = false;
        }
        let boot: Record<string, unknown> | null = null;
        try {
          const r = await fetch("http://127.0.0.1:8791/api/boot-status", {
            signal: AbortSignal.timeout(800),
          });
          if (r.ok) {
            const j = (await r.json()) as { boot?: Record<string, unknown> };
            boot = j.boot ?? null;
          }
        } catch {
          boot = null;
        }
        const containerUp = await probeTcp("127.0.0.1", 8791);
        const appReady = kitBootReady(boot);
        const ticking = Boolean(boot?.ticking);
        const media = probeMediaUdp(47998);
        // Connect as soon as Kit reports ready — sim often won't tick until a WebRTC client joins
        const streamReady = Boolean(signal && viewer && appReady);
        let percent = Number(boot?.percent ?? (signal ? 30 : containerUp ? 15 : viewer ? 8 : 0));
        if (appReady) percent = Math.max(percent, 95);
        if (media) percent = 100;
        if (boot && media) {
          boot = {
            ...boot,
            stage: "streaming",
            label: "Stream live — city under City Lab UI",
            percent: 100,
          };
        }
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: streamReady,
            signal,
            viewer,
            media,
            containerUp,
            appReady,
            signalPort: signal ? 49100 : null,
            boot,
            percent,
            steps: [
              { id: "viewer", label: "Web viewer", done: viewer },
              { id: "control", label: "Kit control", done: containerUp },
              { id: "signal", label: "Signaling port", done: signal },
              { id: "city", label: "City loaded", done: Boolean(boot?.city) },
              { id: "lights", label: "Environment light", done: Boolean(boot?.lights) },
              { id: "sumo", label: "SUMO traffic", done: Boolean(boot?.sumo) },
              { id: "app", label: "Streaming app ready", done: appReady },
              { id: "ticking", label: "Sim ticking", done: ticking },
              { id: "media", label: "WebRTC media", done: media },
            ],
          }),
        );
      });
      server.middlewares.use("/api/release-stream-slot", (req, res, next) => {
        if (req.method !== "POST" && req.method !== "GET") {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        if (!fs.existsSync(RELEASE_SCRIPT)) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: `missing ${RELEASE_SCRIPT}` }));
          return;
        }
        try {
          const child = spawn("bash", [RELEASE_SCRIPT], {
            env: { ...process.env },
          });
          let out = "";
          let err = "";
          child.stdout?.on("data", (c) => {
            out += String(c);
          });
          child.stderr?.on("data", (c) => {
            err += String(c);
          });
          child.on("close", (code) => {
            const detail = (out || err).trim().split("\n").slice(-6).join(" | ");
            res.statusCode = code === 0 ? 200 : 500;
            res.end(
              JSON.stringify({
                ok: code === 0,
                detail: detail || `exit ${code}`,
                log: out || err,
              }),
            );
          });
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      server.middlewares.use("/api/open-chrome-stream", (req, res, next) => {
        if (req.method !== "POST" && req.method !== "GET") {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        try {
          const chrome =
            ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(
              (p) => fs.existsSync(p),
            ) || "google-chrome";
          const child = spawn(
            chrome,
            [
              "--new-window",
              "--autoplay-policy=no-user-gesture-required",
              "http://127.0.0.1:8210/",
            ],
            {
              detached: true,
              stdio: "ignore",
              env: { ...process.env, DISPLAY: process.env.DISPLAY || ":1" },
            },
          );
          child.unref();
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, detail: "Chrome → http://127.0.0.1:8210/", pid: child.pid }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      server.middlewares.use("/api/open-webrtc-client", (req, res, next) => {
        if (req.method !== "POST" && req.method !== "GET") {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        if (!fs.existsSync(WEBRTC_SCRIPT)) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: `missing ${WEBRTC_SCRIPT}` }));
          return;
        }
        try {
          const child = spawn("bash", [WEBRTC_SCRIPT], {
            detached: true,
            stdio: "ignore",
            env: { ...process.env, DISPLAY: process.env.DISPLAY || ":0" },
          });
          child.unref();
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              ok: true,
              detail: "Isaac WebRTC Streaming Client started — connect to 127.0.0.1 (no :port)",
              pid: child.pid,
            }),
          );
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), webrtcLauncherPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5175,
    proxy: {
      "/viewport": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/viewport/, ""),
      },
      "/kit-api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kit-api/, ""),
      },
      "/stream-ctl": {
        target: "http://127.0.0.1:8791",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stream-ctl/, ""),
      },
      // Same-origin embed so UI (:5175) is the only browser surface
      "/ov-stream": {
        target: "http://127.0.0.1:8210",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ov-stream/, "") || "/",
        ws: true,
      },
    },
  },
});
