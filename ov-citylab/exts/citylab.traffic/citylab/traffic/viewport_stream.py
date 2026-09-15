"""Serve live Kit viewport frames as MJPEG (Isaac 5.1 browser WebRTC SDP fallback)."""
from __future__ import annotations

import io
import json
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

    def publish(self, jpeg: bytes, width: int, height: int, vehicles: int, pedestrians: int) -> None:
        with self.lock:
            self.jpeg = jpeg
            self.frame += 1
            self.width = width
            self.height = height
            self.vehicles = vehicles
            self.pedestrians = pedestrians
            self.detail = f"Kit viewport · {vehicles} veh · {pedestrians} ped"

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
            }


STATE = ViewportStreamState()
_httpd: Optional[ThreadingHTTPServer] = None


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        if "/stream.mjpg" in str(args[0] if args else ""):
            return
        carb.log_info("[citylab.view] " + (fmt % args))

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/api/status"):
            body = json.dumps(STATE.status()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        # Prefer short single-frame GETs — long MJPEG holds threads and wedges :8790
        if self.path.startswith("/frame.jpg") or self.path.startswith("/stream.mjpg"):
            with STATE.lock:
                frame = STATE.jpeg
            if not frame:
                self.send_response(HTTPStatus.SERVICE_UNAVAILABLE)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(frame)))
            self.end_headers()
            try:
                self.wfile.write(frame)
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
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
        img.save(buf, format="JPEG", quality=70)
        return buf.getvalue()
    except Exception as exc:
        carb.log_warn(f"[citylab.view] jpeg: {exc}")
        return None
