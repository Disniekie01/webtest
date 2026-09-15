#!/usr/bin/env python3
"""
OVRTX city viewport + SUMO traffic/peds → MJPEG for City Lab webapp.

Blacknode viewer-ovrtx streaming pattern + SUMO TraCI actor sync.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import ovrtx
import ovstage
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_USD = ROOT / "assets" / "stage" / "city_lab.usda"
SUMO_CFG = ROOT / "assets" / "sumo" / "city.sumocfg"
RENDER_PRODUCT = "/Render/Camera"
TRAFFIC_ROOT = "/World/DynamicTraffic"

# City USD footprint ≈ 56 m; SUMO grid is 280×280 → scale into the district
CITY_SPAN_M = 160.0
SUMO_SPAN_M = 160.0
COORD_SCALE = CITY_SPAN_M / SUMO_SPAN_M


class SharedState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.frame_ready = threading.Condition(self.lock)
        self.phase = "starting"
        self.detail = "Booting OVRTX"
        self.error = ""
        self.jpeg = b""
        self.frame_number = 0
        self.vehicles = 0
        self.pedestrians = 0
        self.sumo_time = 0.0
        self.stop = False

    def status(self) -> dict:
        with self.lock:
            return {
                "phase": self.phase,
                "detail": self.detail,
                "error": self.error,
                "frame": self.frame_number,
                "has_image": bool(self.jpeg),
                "vehicles": self.vehicles,
                "pedestrians": self.pedestrians,
                "sumo_time": self.sumo_time,
            }

    def set_phase(self, phase: str, detail: str = "") -> None:
        with self.lock:
            self.phase = phase
            self.detail = detail or self.detail

    def fail(self, message: str) -> None:
        with self.lock:
            self.phase = "error"
            self.error = message
            self.detail = message

    def publish(self, jpeg: bytes, vehicles: int, pedestrians: int, sumo_time: float) -> None:
        with self.frame_ready:
            self.jpeg = jpeg
            self.frame_number += 1
            self.vehicles = vehicles
            self.pedestrians = pedestrians
            self.sumo_time = sumo_time
            self.phase = "streaming"
            self.detail = f"OVRTX + SUMO · {vehicles} veh · {pedestrians} ped"
            self.error = ""
            self.frame_ready.notify_all()


STATE = SharedState()


def _setup_sumo_path() -> Path:
    sumo_home = (
        ROOT
        / ".venv"
        / "lib"
        / f"python{sys.version_info.major}.{sys.version_info.minor}"
        / "site-packages"
        / "sumo"
    )
    sys.path.insert(0, str(sumo_home / "tools"))
    os.environ["SUMO_HOME"] = str(sumo_home)
    os.environ["PATH"] = f"{sumo_home / 'bin'}:{os.environ.get('PATH', '')}"
    return sumo_home


def _sumo_to_usd(sx: float, sy: float, net_w: float, net_h: float) -> tuple[float, float]:
    """SUMO (x,y) → USD (x,z) Y-up, city centered."""
    ux = (sx - net_w * 0.5) * COORD_SCALE
    uz = -(sy - net_h * 0.5) * COORD_SCALE
    return ux, uz


def _traffic_usda(vehicles: list[dict], pedestrians: list[dict]) -> str:
    """Bright proxy actors — oversized colored cubes so motion is obvious."""
    parts = [
        "#usda 1.0",
        "(",
        '    upAxis = "Y"',
        "    metersPerUnit = 1",
        ")",
        "",
        'def Xform "DynamicTraffic"',
        "{",
        '    def Xform "Vehicles"',
        "    {",
    ]
    for i, v in enumerate(vehicles):
        yaw = float(v["yaw"])
        parts.append(
            f'''        def Xform "car_{i}"
        {{
            double3 xformOp:translate = ({v["x"]:.4f}, {v["y"]:.4f}, {v["z"]:.4f})
            float3 xformOp:rotateXYZ = (0, {yaw:.3f}, 0)
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ"]

            def Cube "Body"
            {{
                double size = 1
                color3f[] primvars:displayColor = [({v["r"]:.3f}, {v["g"]:.3f}, {v["b"]:.3f})]
                float3 xformOp:scale = (5.5, 1.8, 2.2)
                uniform token[] xformOpOrder = ["xformOp:scale"]
            }}
        }}'''
        )
    parts.append("    }")
    parts.append('    def Xform "Pedestrians"')
    parts.append("    {")
    for i, p in enumerate(pedestrians):
        parts.append(
            f'''        def Xform "ped_{i}"
        {{
            double3 xformOp:translate = ({p["x"]:.4f}, {p["y"]:.4f}, {p["z"]:.4f})
            uniform token[] xformOpOrder = ["xformOp:translate"]

            def Cube "Body"
            {{
                double size = 1
                color3f[] primvars:displayColor = [(0.15, 0.9, 1.0)]
                float3 xformOp:scale = (0.7, 1.9, 0.7)
                uniform token[] xformOpOrder = ["xformOp:scale"]
            }}
        }}'''
        )
    parts.append("    }")
    parts.append("}")
    return "\n".join(parts)


def _encode_jpeg(pixels: np.ndarray, quality: int, width: int, height: int) -> bytes:
    img = Image.fromarray(pixels)
    if img.mode != "RGB":
        img = img.convert("RGB")
    if img.size != (width, height):
        img = img.resize((width, height), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def _map_ldr(frame) -> np.ndarray:
    key = "LdrColor"
    if key not in frame.render_vars:
        for k in frame.render_vars:
            if str(k).endswith("LdrColor") or str(k) == "LdrColor":
                key = k
                break
        else:
            key = next(iter(frame.render_vars))
    var = frame.render_vars[key].map(device=ovrtx.Device.CPU)
    try:
        return np.from_dlpack(var).copy()
    finally:
        var.unmap()


def _car_color(seed: str) -> tuple[float, float, float]:
    h = abs(hash(seed)) % 360
    # simple HSV→RGB-ish accents
    palette = [
        (0.92, 0.55, 0.22),
        (0.25, 0.45, 0.85),
        (0.85, 0.25, 0.28),
        (0.2, 0.7, 0.45),
        (0.75, 0.75, 0.78),
        (0.15, 0.15, 0.18),
    ]
    return palette[h % len(palette)]


def render_loop(
    usd_path: Path,
    width: int,
    height: int,
    quality: int,
    fps: float,
    max_vehicles: int,
    max_peds: int,
) -> None:
    sumo_home = _setup_sumo_path()
    import traci  # noqa: E402 — needs SUMO_HOME/tools on path first

    traffic_handle: int | None = None
    try:
        STATE.set_phase("initializing", "Creating OVRTX renderer…")
        print("[ovrtx] creating renderer…", flush=True)
        renderer = ovrtx.Renderer()
        stage = ovstage.Stage("citylab.viewport")
        renderer.attach_ovstage(stage)

        ordinal = 1
        STATE.set_phase("loading", f"Opening {usd_path.name}")
        ovstage.population.open_usd(stage, str(usd_path.resolve()), ordinal=ordinal)
        stage.advance_write_floor(ordinal, ovstage.Scope.ALL).wait()

        STATE.set_phase("sumo", "Starting SUMO TraCI…")
        sumo_bin = str(sumo_home / "bin" / "sumo")
        traci.start(
            [
                sumo_bin,
                "-c",
                str(SUMO_CFG),
                "--start",
                "--no-step-log",
                "true",
            ]
        )
        bounds = traci.simulation.getNetBoundary()
        net_w = bounds[1][0] - bounds[0][0]
        net_h = bounds[1][1] - bounds[0][1]
        print(f"[sumo] net {net_w:.0f}×{net_h:.0f} m → city scale {COORD_SCALE:.3f}", flush=True)

        # Warm-up render
        STATE.set_phase("warming", "Warm-up renders…")
        for _ in range(2):
            products = renderer.step(
                render_products={RENDER_PRODUCT},
                delta_time=1.0 / 60.0,
                ordinal=ordinal,
            )
            for product in products.values():
                for frame in product.frames:
                    _ = _map_ldr(frame)
            del products

        STATE.set_phase("streaming", "Live traffic")
        print("[ovrtx] streaming with SUMO actors", flush=True)
        dt = 1.0 / max(1.0, fps)
        # SUMO step is 0.05s; take enough steps to match wall fps
        sumo_steps = max(1, int(round(0.05 / 0.05 * (1.0 / fps) / 0.05)))
        # Actually: each display frame advance sim by dt
        sumo_dt = 0.05
        steps_per_frame = max(1, int(round(dt / sumo_dt)))

        while not STATE.stop:
            t0 = time.time()
            for _ in range(steps_per_frame):
                traci.simulationStep()

            vehicles: list[dict] = []
            for vid in list(traci.vehicle.getIDList())[:max_vehicles]:
                sx, sy = traci.vehicle.getPosition(vid)
                angle = traci.vehicle.getAngle(vid)  # degrees, 0=north, CW
                ux, uz = _sumo_to_usd(sx, sy, net_w, net_h)
                # USD Y-up: yaw around Y; SUMO 0° = +Y in 2D → map to -Z in our layout
                yaw = -(angle - 90.0)
                r, g, b = _car_color(vid)
                vehicles.append(
                    {"x": ux, "y": 1.1, "z": uz, "yaw": yaw, "r": r, "g": g, "b": b}
                )

            pedestrians: list[dict] = []
            for pid in list(traci.person.getIDList())[:max_peds]:
                sx, sy = traci.person.getPosition(pid)
                ux, uz = _sumo_to_usd(sx, sy, net_w, net_h)
                pedestrians.append({"x": ux, "y": 1.0, "z": uz})

            # Keep traffic alive if SUMO drains (shouldn't with flows)
            if not vehicles and not pedestrians and traci.simulation.getMinExpectedNumber() == 0:
                print("[sumo] restarting continuous flows…", flush=True)
                traci.load(["-c", str(SUMO_CFG), "--start", "--no-step-log", "true"])
                continue

            usda = _traffic_usda(vehicles, pedestrians)
            try:
                if traffic_handle is not None:
                    ovstage.population.remove_usd(stage, traffic_handle)
                    traffic_handle = None
                traffic_handle = ovstage.population.add_usd_reference_from_string(
                    stage, usda, TRAFFIC_ROOT
                )
                ordinal += 1
                ovstage.population.apply_usd_changes(stage, ordinal)
                stage.advance_write_floor(ordinal, ovstage.Scope.ALL).wait()
            except Exception as sync_exc:
                print(f"[sumo] sync skip: {sync_exc}", flush=True)
                # Keep rendering the city even if actor sync fails this frame
                ordinal += 1
                try:
                    stage.advance_write_floor(ordinal, ovstage.Scope.ALL).wait()
                except Exception:
                    pass

            products = renderer.step(
                render_products={RENDER_PRODUCT},
                delta_time=dt,
                ordinal=ordinal,
            )
            product = products[RENDER_PRODUCT]
            frame = product.frames[0]
            pixels = _map_ldr(frame)
            jpeg = _encode_jpeg(pixels, quality, width, height)
            STATE.publish(
                jpeg,
                len(vehicles),
                len(pedestrians),
                float(traci.simulation.getTime()),
            )
            del frame, product, products

            sleep = dt - (time.time() - t0)
            if sleep > 0:
                time.sleep(sleep)

    except Exception as exc:
        STATE.fail(f"{type(exc).__name__}: {exc}")
        print(f"[ovrtx] FAILED: {exc}", flush=True)
        raise
    finally:
        try:
            import traci as _traci

            _traci.close()
        except Exception:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "CityLabOVRTX/0.2"

    def log_message(self, fmt: str, *args) -> None:
        if "/stream.mjpg" in str(args[0] if args else ""):
            return
        super().log_message(fmt, *args)

    def _headers(self, code: int, content_type: str, length: int | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        if length is not None:
            self.send_header("Content-Length", str(length))
            self.send_header("Connection", "close")
        else:
            self.send_header("Connection", "keep-alive")
        self.end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/", "/index.html"}:
            body = (
                b"<!doctype html><title>City Lab OVRTX</title>"
                b"<img src='/stream.mjpg' style='width:100%;height:100%;object-fit:cover;"
                b"position:fixed;inset:0;background:#0c121a'>"
            )
            self._headers(HTTPStatus.OK, "text/html; charset=utf-8", len(body))
            self.wfile.write(body)
            return
        if path == "/api/status":
            body = json.dumps(STATE.status()).encode("utf-8")
            self._headers(HTTPStatus.OK, "application/json", len(body))
            self.wfile.write(body)
            return
        if path == "/snapshot.jpg":
            with STATE.lock:
                frame = STATE.jpeg
            if not frame:
                self._headers(HTTPStatus.SERVICE_UNAVAILABLE, "text/plain", 0)
                return
            self._headers(HTTPStatus.OK, "image/jpeg", len(frame))
            self.wfile.write(frame)
            return
        if path == "/stream.mjpg":
            self._headers(HTTPStatus.OK, "multipart/x-mixed-replace; boundary=frame")
            seen = -1
            try:
                while not STATE.stop:
                    with STATE.frame_ready:
                        STATE.frame_ready.wait_for(
                            lambda: STATE.frame_number != seen or STATE.stop,
                            timeout=2.0,
                        )
                        if STATE.stop:
                            return
                        seen = STATE.frame_number
                        frame = STATE.jpeg
                    if not frame:
                        continue
                    self.wfile.write(
                        b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + str(len(frame)).encode("ascii")
                        + b"\r\n\r\n"
                        + frame
                        + b"\r\n"
                    )
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
            return
        self._headers(HTTPStatus.NOT_FOUND, "text/plain", 0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--usd", type=Path, default=DEFAULT_USD)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--fps", type=float, default=10.0)
    ap.add_argument("--max-vehicles", type=int, default=48)
    ap.add_argument("--max-peds", type=int, default=36)
    args = ap.parse_args()

    if not args.usd.exists():
        print(f"USD missing: {args.usd}", file=sys.stderr)
        return 1
    if not SUMO_CFG.exists():
        print("SUMO config missing — run: python tools/build_sumo_net.py", file=sys.stderr)
        return 1

    worker = threading.Thread(
        target=render_loop,
        kwargs={
            "usd_path": args.usd,
            "width": args.width,
            "height": args.height,
            "quality": args.quality,
            "fps": args.fps,
            "max_vehicles": args.max_vehicles,
            "max_peds": args.max_peds,
        },
        daemon=True,
        name="ovrtx-sumo-render",
    )
    worker.start()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[ovrtx] MJPEG+SUMO at http://{args.host}:{args.port}/stream.mjpg", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        STATE.stop = True
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
