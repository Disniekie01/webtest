from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
COOKIE_BROWSERS = ("firefox", "chrome", "chromium", "brave", "edge", "opera")


def youtube_id(url: str) -> str | None:
    try:
        parsed = urlparse(url)
    except Exception:
        return None
    host = (parsed.hostname or "").lower()
    if host == "youtu.be":
        vid = parsed.path.strip("/")
        return vid or None
    if host in YOUTUBE_HOSTS:
        qs = parse_qs(parsed.query)
        if qs.get("v"):
            return qs["v"][0]
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] in {"live", "embed", "shorts"}:
            return parts[1]
    return None


def is_network_ref(ref: str) -> bool:
    r = ref.strip().lower()
    return r.startswith(("http://", "https://", "rtsp://", "rtsps://"))


def is_webcam_ref(ref: str) -> bool:
    r = ref.strip().lower()
    return r in {"webcam", "webcam:0", "0"} or r.startswith("webcam:")


def is_live_ref(ref: str) -> bool:
    return is_network_ref(ref) or is_webcam_ref(ref)


def source_id(ref: str | Path) -> str:
    ref = str(ref).strip()
    vid = youtube_id(ref)
    if vid:
        return f"yt_{vid}"
    if is_webcam_ref(ref):
        idx = "0"
        if ":" in ref:
            idx = ref.split(":", 1)[1] or "0"
        return f"webcam_{idx}"
    if is_network_ref(ref):
        return "live_" + hashlib.sha1(ref.encode("utf-8")).hexdigest()[:12]
    return Path(ref).stem


def webcam_device() -> int | None:
    if os.path.exists("/dev/video0"):
        return 0
    return None


def _short_ytdlp_error(exc: Exception) -> str:
    text = str(exc).strip().splitlines()[-1]
    if "Sign in to confirm" in text or "not a bot" in text.lower():
        return (
            "YouTube blocked the request (bot check). In Setup → YouTube, pick the browser "
            "where you are signed into YouTube (Firefox works best here), or set a cookies.txt path."
        )
    if len(text) > 240:
        text = text[:237] + "..."
    return text or "Could not resolve YouTube stream."


def _pick_youtube_url(info: dict[str, Any]) -> str:
    if info.get("url"):
        return str(info["url"])
    for item in info.get("requested_formats") or []:
        if item.get("url") and (item.get("vcodec") or "none") != "none":
            return str(item["url"])
    candidates = [
        f
        for f in (info.get("formats") or [])
        if f.get("url") and (f.get("vcodec") or "none") != "none"
    ]
    if not candidates:
        raise RuntimeError("No video stream available from this YouTube URL.")

    def score(fmt: dict[str, Any]) -> tuple[int, int, int]:
        height = int(fmt.get("height") or 0)
        proto = str(fmt.get("protocol") or "")
        band = 0 if 1 <= height <= 720 else (1 if height else 2)
        proto_rank = 0 if ("m3u8" in proto or proto.startswith("http")) else 1
        return (band, proto_rank, -height)

    candidates.sort(key=score)
    return str(candidates[0]["url"])


def _youtube_base_opts() -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        # Live HLS is video-only; combined "best" (audio+video) is often missing.
        "format": "bestvideo[height<=720]/bestvideo[height<=480]/bestvideo/best",
        "remote_components": {"ejs:github"},
    }
    node = shutil.which("node") or shutil.which("nodejs")
    if node:
        opts["js_runtimes"] = {"node": {"path": node}}
    return opts


def _browser_cookie_candidates(preferred: str | None) -> list[str]:
    ordered: list[str] = []
    if preferred:
        p = preferred.strip().lower()
        if p and p not in {"none", "off", "false"}:
            ordered.append(p)
    env = os.environ.get("YARDLINE_YT_BROWSER", "").strip().lower()
    if env and env not in ordered:
        ordered.append(env)
    for name in COOKIE_BROWSERS:
        if name not in ordered:
            ordered.append(name)
    return ordered


def youtube_stream_url(page_url: str, youtube_cfg: dict[str, Any] | None = None) -> str:
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError, ExtractorError
    except ImportError as e:
        raise RuntimeError("yt-dlp is required for YouTube URLs. pip install yt-dlp") from e

    ycfg = youtube_cfg or {}
    cookies_file = (
        ycfg.get("cookies_file")
        or os.environ.get("YARDLINE_YT_COOKIES")
        or ""
    ).strip()
    preferred_browser = (ycfg.get("cookies_from_browser") or "").strip() or None

    attempts: list[dict[str, Any]] = []
    if cookies_file:
        path = Path(cookies_file).expanduser()
        if not path.is_file():
            raise RuntimeError(f"YouTube cookies file not found: {path}")
        opts = _youtube_base_opts()
        opts["cookiefile"] = str(path)
        attempts.append(opts)
    else:
        for browser in _browser_cookie_candidates(preferred_browser):
            opts = _youtube_base_opts()
            opts["cookiesfrombrowser"] = (browser,)
            attempts.append(opts)
        # Last resort without cookies (usually fails on live).
        attempts.append(_youtube_base_opts())

    last_err: Exception | None = None
    for opts in attempts:
        try:
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(page_url, download=False)
            if not info:
                raise RuntimeError("YouTube returned no stream info.")
            return _pick_youtube_url(info)
        except (DownloadError, ExtractorError, RuntimeError, OSError) as e:
            last_err = e
            continue
    assert last_err is not None
    raise RuntimeError(_short_ytdlp_error(last_err)) from last_err


def is_jpeg_url(ref: str) -> bool:
    """Single-frame HTTP JPEGs (City Lab /viewport/frame.jpg) — not an FFMPEG stream."""
    r = ref.strip().lower()
    if not r.startswith(("http://", "https://")):
        return False
    path = urlparse(r).path
    return path.endswith((".jpg", ".jpeg")) or path.rstrip("/").endswith("frame")


class JpegUrlCapture:
    """Poll a still JPEG URL. OpenCV/FFMPEG is awful at single-frame HTTP endpoints."""

    def __init__(self, url: str, timeout_s: float = 1.5):
        self.url = str(url)
        self.timeout_s = float(timeout_s)
        self._w = 0
        self._h = 0
        self._opened = True

    def isOpened(self) -> bool:
        return self._opened

    def release(self) -> None:
        self._opened = False

    def set(self, *_args) -> bool:
        return True

    def get(self, prop: int) -> float:
        import cv2

        if prop == cv2.CAP_PROP_FPS:
            return 8.0
        if prop == cv2.CAP_PROP_FRAME_COUNT:
            return 0.0
        if prop == cv2.CAP_PROP_FRAME_WIDTH:
            return float(self._w)
        if prop == cv2.CAP_PROP_FRAME_HEIGHT:
            return float(self._h)
        return 0.0

    def read(self):
        import cv2
        import numpy as np
        import urllib.error
        import urllib.request

        if not self._opened:
            return False, None
        try:
            req = urllib.request.Request(self.url, headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                data = resp.read()
        except (urllib.error.URLError, TimeoutError, OSError):
            return False, None
        if not data:
            return False, None
        arr = np.frombuffer(data, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return False, None
        self._h, self._w = frame.shape[:2]
        return True, frame


def open_cv_capture(target: str | int):
    import cv2

    if isinstance(target, int):
        cap = cv2.VideoCapture(target)
    elif isinstance(target, str) and is_jpeg_url(target):
        return JpegUrlCapture(target)
    else:
        cap = cv2.VideoCapture(str(target), cv2.CAP_FFMPEG)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap


def resolve_capture(ref: str, youtube_cfg: dict[str, Any] | None = None) -> tuple[str | int, dict[str, Any]]:
    raw = ref.strip()
    if is_webcam_ref(raw):
        idx = 0
        if ":" in raw:
            idx = int(raw.split(":", 1)[1] or 0)
        return idx, {
            "live": True,
            "id": f"webcam_{idx}",
            "name": f"Webcam {idx}",
            "origin": f"webcam:{idx}",
        }
    vid = youtube_id(raw)
    if vid:
        stream = youtube_stream_url(raw, youtube_cfg)
        return stream, {
            "live": True,
            "id": f"yt_{vid}",
            "name": f"YouTube {vid}",
            "origin": raw,
        }
    if is_jpeg_url(raw):
        return raw, {
            "live": True,
            "id": source_id(raw),
            "name": "Twin JPEG",
            "origin": raw,
            "jpeg_poll": True,
        }
    if is_network_ref(raw):
        return raw, {
            "live": True,
            "id": source_id(raw),
            "name": "Network stream",
            "origin": raw,
        }
    return raw, {
        "live": False,
        "id": Path(raw).stem,
        "name": Path(raw).stem.replace("_", " "),
        "origin": raw,
    }
