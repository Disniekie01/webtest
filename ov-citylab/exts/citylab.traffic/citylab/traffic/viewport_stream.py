"""Serve live Kit viewport frames as MJPEG (Isaac 5.1 browser WebRTC SDP fallback)."""
from __future__ import annotations

import io
import json
import os
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

import carb
import numpy as np


class ViewportStreamState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.jpeg = b""
        self.frame = 0
        self.width = 0
        self.height = 0
        self.vehicles = 0
        self.pedestrians = 0
        self.detail = "booting"
        self.actors: dict = {
            "updatedAt": 0.0,
            "span_m": 160.0,
            "vehicles": [],
            "pedestrians": [],
        }
        self.comfort_zones: dict = {
            "updatedAt": 0.0,
            "span_m": 160.0,
            "cell_m": 4.0,
            "cells": [],
            "deposits": [],
        }
        self.orchestrator: dict = {
            "updatedAt": 0.0,
            "enabled": False,
            "tick": 0,
            "actions": [],
            "log": None,
        }
        self.camera: dict = {
            "eye": [90.0, 120.0, 160.0],
            "target": [0.0, 0.0, 0.0],
            "fov": 40.0,
            "pending": False,
            "updatedAt": 0.0,
        }

    def publish(self, jpeg: bytes, width: int, height: int, vehicles: int, pedestrians: int) -> None:
        with self.lock:
            self.jpeg = jpeg
            self.frame += 1
            self.width = width
            self.height = height
            self.vehicles = vehicles
            self.pedestrians = pedestrians
            self.detail = f"Kit viewport · {vehicles} veh · {pedestrians} ped"

    def publish_actors(
        self,
        vehicles: list[dict],
        pedestrians: list[dict],
        span_m: float = 160.0,
        lights: list[dict] | None = None,
    ) -> None:
        with self.lock:
            self.actors = {
                "updatedAt": time.time(),
                "span_m": float(span_m),
                "vehicles": vehicles,
                "pedestrians": pedestrians,
                "lights": list(lights or []),
            }

    def actors_snapshot(self) -> dict:
        with self.lock:
            return dict(self.actors)

    def set_comfort_zones(self, payload: dict) -> None:
        with self.lock:
            self.comfort_zones = dict(payload)
            self.comfort_zones["updatedAt"] = time.time()

    def comfort_zones_snapshot(self) -> dict:
        with self.lock:
            return dict(self.comfort_zones)

    def publish_orchestrator(self, payload: dict) -> None:
        with self.lock:
            self.orchestrator = dict(payload)
            self.orchestrator["updatedAt"] = time.time()

    def orchestrator_snapshot(self) -> dict:
        with self.lock:
            return dict(self.orchestrator)

    def camera_snapshot(self) -> dict:
        with self.lock:
            return {
                "eye": list(self.camera.get("eye") or [90.0, 120.0, 160.0]),
                "target": list(self.camera.get("target") or [0.0, 0.0, 0.0]),
                "fov": float(self.camera.get("fov") or 40.0),
                "updatedAt": float(self.camera.get("updatedAt") or 0.0),
            }

    def set_camera(self, payload: dict) -> dict:
        eye = payload.get("eye") or [90.0, 120.0, 160.0]
        target = payload.get("target") or [0.0, 0.0, 0.0]
        fov = float(payload.get("fov") or 40.0)
        with self.lock:
            self.camera = {
                "eye": [float(eye[0]), float(eye[1]), float(eye[2])],
                "target": [float(target[0]), float(target[1]), float(target[2])],
                "fov": fov,
                "pending": True,
                "updatedAt": time.time(),
            }
            return self.camera_snapshot()

    def take_camera_pending(self) -> dict | None:
        with self.lock:
            if not self.camera.get("pending"):
                return None
            self.camera["pending"] = False
            return {
                "eye": list(self.camera["eye"]),
                "target": list(self.camera["target"]),
                "fov": float(self.camera["fov"]),
            }

    def status(self) -> dict:
        with self.lock:
            return {
                "phase": "streaming" if self.jpeg else "warming",
                "detail": self.detail,
                "frame": self.frame,
                "has_image": bool(self.jpeg),
                "vehicles": self.vehicles,
                "pedestrians": self.pedestrians,
                "width": self.width,
                "height": self.height,
                "source": "kit-viewport",
                "actorsAt": self.actors.get("updatedAt", 0),
            }


STATE = ViewportStreamState()
_httpd: Optional[ThreadingHTTPServer] = None


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        if "/stream.mjpg" in str(args[0] if args else ""):
            return
        carb.log_info("[citylab.view] " + (fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/status"):
            body = json.dumps(STATE.status()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/api/actors"):
            body = json.dumps(STATE.actors_snapshot()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/api/comfort-zones"):
            body = json.dumps(STATE.comfort_zones_snapshot()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/api/orchestrator"):
            body = json.dumps(STATE.orchestrator_snapshot()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/api/camera"):
            body = json.dumps(STATE.camera_snapshot()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # Prefer short single-frame GETs — long MJPEG holds threads and wedges :8790
        if path.startswith("/frame.jpg") or path.startswith("/stream.mjpg"):
            with STATE.lock:
                frame = STATE.jpeg
            if not frame:
                self.send_response(HTTPStatus.SERVICE_UNAVAILABLE)
                self._cors()
                self.end_headers()
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.send_header("Content-Length", str(len(frame)))
            self.end_headers()
            try:
                self.wfile.write(frame)
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
            return
        self.send_response(HTTPStatus.NOT_FOUND)
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/camera"):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("expected object")
                snap = STATE.set_camera(payload)
            except Exception as exc:
                body = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json")
                self._cors()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            body = json.dumps({"ok": True, **snap}).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/api/comfort-zones"):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("expected object")
            except Exception as exc:
                body = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json")
                self._cors()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            STATE.set_comfort_zones(payload)
            body = json.dumps({"ok": True, "cells": len(payload.get("cells") or [])}).encode(
                "utf-8"
            )
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(HTTPStatus.NOT_FOUND)
        self.end_headers()


def start_viewport_http(port: int = 8790) -> None:
    global _httpd
    if _httpd is not None:
        return

    def _run() -> None:
        global _httpd
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        except OSError as exc:
            # Extension hot-reload: keep existing listener if port still held
            carb.log_warn(f"[citylab.view] bind :{port} failed ({exc}); assuming prior server still live")
            return
        _httpd = srv
        carb.log_info(f"[citylab.view] Kit viewport MJPEG http://127.0.0.1:{port}/stream.mjpg")
        _httpd.serve_forever()

    threading.Thread(target=_run, daemon=True, name="citylab-viewport-http").start()


def stop_viewport_http() -> None:
    global _httpd
    if _httpd is not None:
        try:
            _httpd.shutdown()
        except Exception:
            pass
        _httpd = None


def buffer_to_jpeg(buffer, size, width: int, height: int) -> bytes | None:
    try:
        from PIL import Image
    except Exception:
        return None
    try:
        import ctypes

        raw: bytes | bytearray | memoryview | None = None
        if isinstance(buffer, (bytes, bytearray, memoryview)):
            raw = buffer
        else:
            # Isaac 6 returns a PyCapsule pointing at RGBA8 bytes
            try:
                ctypes.pythonapi.PyCapsule_GetPointer.restype = ctypes.POINTER(
                    ctypes.c_ubyte * int(size)
                )
                ctypes.pythonapi.PyCapsule_GetPointer.argtypes = [
                    ctypes.py_object,
                    ctypes.c_char_p,
                ]
                ptr = ctypes.pythonapi.PyCapsule_GetPointer(buffer, None)
                raw = bytes(ptr.contents)
            except Exception:
                try:
                    raw = memoryview(buffer)
                except Exception:
                    raw = None
        if raw is None:
            return None

        arr = np.frombuffer(raw, dtype=np.uint8, count=int(size))
        need4 = int(width) * int(height) * 4
        need3 = int(width) * int(height) * 3
        if arr.size >= need4:
            img = Image.frombuffer(
                "RGBA", (int(width), int(height)), arr[:need4], "raw", "RGBA", 0, 1
            )
            img = img.convert("RGB")
        elif arr.size >= need3:
            img = Image.frombuffer(
                "RGB", (int(width), int(height)), arr[:need3], "raw", "RGB", 0, 1
            )
        else:
            return None
        buf = io.BytesIO()
        # Downscale for Yardline / MJPEG — WebRTC uses the live viewport, not this JPEG.
        max_w = int(os.environ.get("CITYLAB_VIEWPORT_JPEG_MAX_W", "960"))
        if max_w > 0 and img.width > max_w:
            nh = max(1, int(round(img.height * (max_w / float(img.width)))))
            img = img.resize((max_w, nh))
        quality = int(os.environ.get("CITYLAB_VIEWPORT_JPEG_QUALITY", "62"))
        img.save(buf, format="JPEG", quality=max(40, min(90, quality)))
        return buf.getvalue()
    except Exception as exc:
        carb.log_warn(f"[citylab.view] jpeg: {exc}")
        return None
