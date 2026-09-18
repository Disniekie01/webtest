from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Optional

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
INCIDENT_DIR = ROOT / "data" / "incidents"
INCIDENT_INDEX = INCIDENT_DIR / "index.jsonl"


class FrameRing:
    """Keep recent BGR frames for pre-roll incident clips."""

    def __init__(self, max_frames: int = 60):
        self.max_frames = max(8, int(max_frames))
        self._buf: Deque[np.ndarray] = deque(maxlen=self.max_frames)

    def push(self, bgr: np.ndarray) -> None:
        self._buf.append(bgr.copy())

    def clear(self) -> None:
        self._buf.clear()

    def frames(self) -> list[np.ndarray]:
        return list(self._buf)

    def __len__(self) -> int:
        return len(self._buf)


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")[:-3]


def create_incident(
    *,
    source: dict[str, Any] | None,
    risk: dict[str, Any],
    frame_index: int,
    still_bgr: np.ndarray | None,
    ring: FrameRing | None,
    fps: float = 12.0,
    kind: str = "alarm",
    event_code: str | None = None,
    event_label: str | None = None,
    category: str | None = None,
    site_id: str | None = None,
    camera_id: str | None = None,
    location_m: list[float] | None = None,
) -> dict[str, Any]:
    INCIDENT_DIR.mkdir(parents=True, exist_ok=True)
    iid = f"INC-{_stamp()}"
    folder = INCIDENT_DIR / iid
    folder.mkdir(parents=True, exist_ok=True)

    still_path = None
    if still_bgr is not None:
        still_path = folder / "still.jpg"
        cv2.imwrite(str(still_path), still_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 88])

    clip_path = None
    frames = ring.frames() if ring is not None else []
    if frames:
        clip_path = folder / "clip.mp4"
        h, w = frames[0].shape[:2]
        writer = cv2.VideoWriter(
            str(clip_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            max(6.0, float(fps)),
            (w, h),
        )
        for fr in frames:
            if fr.shape[0] != h or fr.shape[1] != w:
                fr = cv2.resize(fr, (w, h))
            writer.write(fr)
        writer.release()

    record = {
        "id": iid,
        "kind": kind,
        "event_code": event_code,
        "event_label": event_label,
        "category": category,
        "site_id": site_id,
        "camera_id": camera_id,
        "location_m": location_m,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": (source or {}).get("path"),
        "source_id": (source or {}).get("id"),
        "frame_index": frame_index,
        "alarm": risk.get("alarm"),
        "alarm_level": risk.get("alarm_level"),
        "min_ttc_s": risk.get("min_ttc_s"),
        "min_clearance_m": risk.get("min_clearance_m"),
        "min_distance_m": risk.get("min_distance_m"),
        "zone_hits": risk.get("zone_hits") or [],
        "trip_events": risk.get("trip_events") or [],
        "still": None if still_path is None else str(still_path.relative_to(ROOT)).replace("\\", "/"),
        "clip": None if clip_path is None else str(clip_path.relative_to(ROOT)).replace("\\", "/"),
    }
    with INCIDENT_INDEX.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")
    return record


def list_incidents(limit: int = 40) -> list[dict[str, Any]]:
    if not INCIDENT_INDEX.exists():
        return []
    rows: list[dict[str, Any]] = []
    with INCIDENT_INDEX.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows[-limit:]


def get_incident(incident_id: str) -> Optional[dict[str, Any]]:
    for row in list_incidents(limit=500):
        if row.get("id") == incident_id:
            return row
    return None


def fire_webhook(url: str, payload: dict[str, Any], timeout_s: float = 4.0) -> None:
    if not url:
        return

    def _run() -> None:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "yardline-webhook/1"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                resp.read(256)
        except (urllib.error.URLError, TimeoutError, OSError):
            pass

    threading.Thread(target=_run, daemon=True).start()
