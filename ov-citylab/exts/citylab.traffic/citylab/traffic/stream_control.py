"""Always-on control plane: WebRTC slot release + boot progress for the UI."""
from __future__ import annotations

import json
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

import carb

_httpd: Optional[ThreadingHTTPServer] = None
_lock = threading.Lock()
_release_pending = False
_last_release: dict = {"ok": False, "detail": "never"}
_boot: dict[str, Any] = {
    "stage": "starting",
    "label": "Starting City Lab extension…",
    "percent": 5,
    "city": False,
    "lights": False,
    "sumo": False,
    "ticking": False,
    "updatedAt": 0.0,
}


def request_release() -> None:
    global _release_pending
    with _lock:
        _release_pending = True


def consume_release() -> bool:
    global _release_pending
    with _lock:
        if not _release_pending:
            return False
        _release_pending = False
        return True


def set_last_release(info: dict) -> None:
    global _last_release
    with _lock:
        _last_release = dict(info)


def get_last_release() -> dict:
    with _lock:
        return dict(_last_release)


def set_boot(**kwargs: Any) -> None:
    """Update boot progress fields shown by the web UI."""
    with _lock:
        _boot.update(kwargs)
        _boot["updatedAt"] = time.time()


def get_boot() -> dict:
    with _lock:
        return dict(_boot)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        carb.log_info("[citylab.stream] " + (fmt % args))

    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/boot-status") or path.startswith("/api/stream-slot"):
            boot = get_boot()
            self._json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "boot": boot,
                    "last": get_last_release(),
                    "hint": "POST /api/release-stream to free the NVST client slot",
                },
            )
            return
        self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/release-stream"):
            request_release()
            carb.log_warn(
                "[citylab.stream] release-stream requested (host will terminate clients + kill TCP)"
            )
            self._json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "queued": True,
                    "detail": "Release via viewer BroadcastChannel + TCP kill (see Free stream slot)",
                },
            )
            return
        self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})


def start_stream_control(port: int = 8791) -> None:
    global _httpd
    if _httpd is not None:
        return

    set_boot(stage="control", label="Control plane up — booting city…", percent=12)

    def _run() -> None:
        global _httpd
        try:
            srv = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
        except OSError as exc:
            carb.log_warn(f"[citylab.stream] bind :{port} failed ({exc})")
            return
        _httpd = srv
        carb.log_warn(f"[citylab.stream] control http://127.0.0.1:{port}/api/release-stream")
        _httpd.serve_forever()

    threading.Thread(target=_run, daemon=True, name="citylab-stream-control").start()


def stop_stream_control() -> None:
    global _httpd
    if _httpd is not None:
        try:
            _httpd.shutdown()
        except Exception:
            pass
        _httpd = None
