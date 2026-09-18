from __future__ import annotations

import json
import time
from collections import deque
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
import torch

from yardline.config_io import load_config
from yardline.detect import Detector
from yardline.heatmap import OccupancyHeatmap
from yardline.incidents import FrameRing, create_incident, fire_webhook
from yardline.privacy import FaceRedactor
from yardline.geometry import (
    GroundPlane,
    apparent_height_m,
    blend_ground,
    calibrate,
    camera_pose_from_plane,
    fov_world_polygon,
    ground_box_size,
    scale_plane,
    update_heading,
    vehicle_width_scale,
)
from yardline.risk import RiskEngine
from yardline.sites import snapshot_for_source
from yardline.sources import open_cv_capture, resolve_capture, webcam_device
from yardline.store import delete_plane, load_map_underlay, load_plane, load_plane_bundle, load_zones, save_plane, save_zones
from yardline.taxonomy import resolve_event
from yardline.track import build_tracker

# Re-export for callers that import load_config from runtime.
__all__ = ["Pipeline", "list_videos", "load_config"]

def list_videos(folder: str | Path = "data/videos") -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cam = webcam_device()
    if cam is not None:
        items.append(
            {
                "id": f"webcam_{cam}",
                "name": f"Webcam {cam}",
                "path": f"webcam:{cam}",
                "frames": 0,
                "fps": 0,
                "width": 0,
                "height": 0,
                "calibrated": load_plane(f"webcam:{cam}") is not None,
                "live": True,
            }
        )
    folder = Path(folder)
    exts = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
    if folder.exists():
        for p in sorted(folder.iterdir()):
            if p.suffix.lower() not in exts or p.stat().st_size < 10_000:
                continue
            cap = cv2.VideoCapture(str(p))
            n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            cap.release()
            items.append(
                {
                    "id": p.stem,
                    "name": p.stem.replace("_", " "),
                    "path": str(p).replace("\\", "/"),
                    "frames": n,
                    "fps": round(fps, 2),
                    "width": w,
                    "height": h,
                    "calibrated": load_plane(p) is not None,
                    "live": False,
                }
            )
    return items


def _forecast(track, horizon: float = 5.0, dt: float = 0.5) -> list[list[float]]:
    if track.x_m is None or track.y_m is None:
        return []
    pts = []
    t = dt
    while t <= horizon + 1e-9:
        pts.append([round(track.x_m + track.vx_mps * t, 2), round(track.y_m + track.vy_mps * t, 2)])
        t += dt
    return pts


def _aim_uv(plane: Optional[GroundPlane], track, horizon_s: float = 1.2) -> Optional[list[float]]:
    """Project the locked heading (same path for people and cars) onto the camera."""
    fu, fv = track.foot
    hx, hy = float(track.hx), float(track.hy)
    hmag = float(np.hypot(hx, hy))
    speed = float(np.hypot(track.vx_mps, track.vy_mps))
    ready = bool(getattr(track, "heading_ready", False))
    if plane is not None and track.x_m is not None and (ready or speed > 0.2):
        if hmag > 0.2:
            dx, dy = hx / hmag, hy / hmag
        else:
            dx, dy = track.vx_mps / speed, track.vy_mps / speed
        reach = max(1.6, speed * horizon_s)
        ahead = plane.world_to_image(
            np.array([[track.x_m + dx * reach, track.y_m + dy * reach]], dtype=np.float64)
        )[0]
        return [round(fu, 1), round(fv, 1), round(float(ahead[0]), 1), round(float(ahead[1]), 1)]
    mag = float(np.hypot(track.vx_px, track.vy_px))
    # At higher twin FPS, per-frame px motion is small — still draw a readable tick.
    if mag < 2.0:
        return None
    tip = max(22.0, min(48.0, 0.55 * mag if mag >= 12.0 else 28.0))
    ux, uy = track.vx_px / mag, track.vy_px / mag
    return [
        round(fu, 1),
        round(fv, 1),
        round(fu + ux * tip, 1),
        round(fv + uy * tip, 1),
    ]


class Pipeline:
    def __init__(self, cfg: dict[str, Any]):
        self.cfg = cfg
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.detector = Detector(cfg, self.device)
        self.tracker = build_tracker(cfg)
        radii = {name: float(spec["radius_m"]) for name, spec in cfg["classes"].items()}
        self.risk = RiskEngine(cfg, radii)
        self.plane: Optional[GroundPlane] = None
        self.cap: Optional[cv2.VideoCapture] = None
        self.source: Optional[dict[str, Any]] = None
        self.frame_idx = 0
        self.last_packet: Optional[dict[str, Any]] = None
        self.last_bgr: Optional[np.ndarray] = None
        self.events: list[dict[str, Any]] = []
        self.incidents: list[dict[str, Any]] = []
        self.max_width = int(cfg["stream"]["max_width"])
        self.jpeg_quality = int(cfg["stream"]["jpeg_quality"])
        self.send_jpeg = bool(cfg.get("stream", {}).get("send_jpeg", True))
        self.slim_packet = bool(cfg.get("stream", {}).get("slim_packet", False))
        self.lag_frames = max(0, int(cfg.get("stream", {}).get("lag_frames", 0)))
        self._prefetch: deque[np.ndarray] = deque()
        self.redact_pii = bool(cfg.get("privacy", {}).get("blur_faces", True))
        self.redactor = FaceRedactor()
        self.metric_scale = 1.0
        self._scale_samples: list[float] = []
        self._scale_locked = False
        inc = cfg.get("incidents") or {}
        self.incidents_enabled = bool(inc.get("enabled", True))
        self.webhook_url = str(inc.get("webhook_url") or "")
        self.frame_ring = FrameRing(int(inc.get("pre_roll_frames", 48)))
        hm = cfg.get("heatmap") or {}
        self.heatmap_enabled = bool(hm.get("enabled", True))
        self.heatmap = OccupancyHeatmap(
            cell_m=float(hm.get("cell_m", 0.5)),
            decay=float(hm.get("decay", 0.985)),
        )
        self.site_id: str | None = None
        self.camera_id: str | None = None
        if "homography" in cfg:
            self.plane = GroundPlane.from_dict(cfg["homography"])

    def site_context(self) -> dict[str, Any] | None:
        path = None if not self.source else self.source.get("path")
        snap = snapshot_for_source(path)
        if snap is None and (self.site_id or self.camera_id):
            snap = {
                "site_id": self.site_id,
                "camera_id": self.camera_id,
                "site_name": None,
                "kpi": None,
                "origin_geo": None,
                "offset_m": [0.0, 0.0],
                "cameras": [],
            }
        if snap is not None:
            if self.site_id:
                snap["site_id"] = self.site_id
            if self.camera_id:
                snap["camera_id"] = self.camera_id
        return snap

    def set_site_context(self, site_id: str | None = None, camera_id: str | None = None) -> dict[str, Any] | None:
        self.site_id = site_id
        self.camera_id = camera_id
        return self.site_context()

    def gpu_name(self) -> str:
        if self.device.startswith("cuda") and torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
        return "cpu"

    def apply_config(self, cfg: dict[str, Any]) -> None:
        """Hot-reload detector / tracker / risk / stream from a merged config."""
        zones = list(self.risk.zones)
        self.cfg = cfg
        self.detector = Detector(cfg, self.device)
        self.tracker = build_tracker(cfg)
        self.tracker.reset()
        radii = {name: float(spec["radius_m"]) for name, spec in cfg["classes"].items()}
        self.risk = RiskEngine(cfg, radii)
        self.risk.set_zones(zones)
        self.max_width = int(cfg["stream"]["max_width"])
        self.jpeg_quality = int(cfg["stream"]["jpeg_quality"])
        self.send_jpeg = bool(cfg.get("stream", {}).get("send_jpeg", True))
        self.slim_packet = bool(cfg.get("stream", {}).get("slim_packet", False))
        self.lag_frames = max(0, int(cfg.get("stream", {}).get("lag_frames", 0)))
        self._prefetch: deque[np.ndarray] = deque()
        self.redact_pii = bool(cfg.get("privacy", {}).get("blur_faces", True))
        inc = cfg.get("incidents") or {}
        self.incidents_enabled = bool(inc.get("enabled", True))
        self.webhook_url = str(inc.get("webhook_url") or "")
        self.frame_ring = FrameRing(int(inc.get("pre_roll_frames", 48)))
        hm = cfg.get("heatmap") or {}
        self.heatmap_enabled = bool(hm.get("enabled", True))
        self.heatmap = OccupancyHeatmap(
            cell_m=float(hm.get("cell_m", 0.5)),
            decay=float(hm.get("decay", 0.985)),
        )

    def open(self, path: str) -> dict[str, Any]:
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        target, meta = resolve_capture(path, self.cfg.get("youtube"))
        self.cap = open_cv_capture(target)
        if not self.cap.isOpened():
            raise FileNotFoundError(f"Could not open source: {meta.get('origin', path)}")
        self.tracker.reset()
        self.risk.reset()
        self.heatmap.reset()
        self.frame_ring.clear()
        self._reset_metric_scale()
        self.frame_idx = 0
        self.last_packet = None
        self.last_bgr = None
        self.events = []
        self.incidents = []
        self._prefetch = deque()
        fps = float(self.cap.get(cv2.CAP_PROP_FPS) or 0.0) or 25.0
        if fps < 8.0 or fps > 60.0:
            fps = 25.0
        # Twin / still-JPEG polls + optional stream.target_fps cap (share GPU with Isaac).
        target_fps = float((self.cfg.get("stream") or {}).get("target_fps") or 0.0)
        if meta.get("jpeg_poll"):
            fps = target_fps if target_fps > 0 else 8.0
        elif target_fps > 0:
            fps = min(fps, target_fps)
        self.lag_frames = max(0, int((self.cfg.get("stream") or {}).get("lag_frames", 0)))
        # Warm a short delay line so play stays a few frames behind (smoother hitch recovery).
        if self.lag_frames > 0 and (meta.get("jpeg_poll") or meta.get("live")):
            for _ in range(self.lag_frames):
                ok, fr = self.cap.read()
                if not ok or fr is None:
                    break
                self._prefetch.append(fr)
        n = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        origin = str(meta.get("origin") or path)
        live = bool(meta.get("live"))
        self.plane = load_plane(origin)
        self.risk.set_zones(load_zones(origin))
        snap = snapshot_for_source(origin)
        if snap:
            self.site_id = snap.get("site_id")
            self.camera_id = snap.get("camera_id")
        if live:
            n = 0
        self.source = {
            "path": origin,
            "id": meta.get("id") or Path(origin).stem,
            "name": meta.get("name"),
            "fps": fps,
            "frames": n,
            "width": w,
            "height": h,
            "calibrated": self.plane is not None,
            "zones": self.risk.zones,
            "live": live,
            "site_id": self.site_id,
            "camera_id": self.camera_id,
        }
        return self.source

    def _reopen_live(self) -> bool:
        if not self.source or not self.source.get("live"):
            return False
        origin = self.source["path"]
        target, _ = resolve_capture(origin, self.cfg.get("youtube"))
        if self.cap is not None:
            self.cap.release()
        self.cap = open_cv_capture(target)
        return bool(self.cap is not None and self.cap.isOpened())

    def close(self) -> None:
        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def set_plane(self, image_points: list[list[float]], world_points: list[list[float]]) -> GroundPlane:
        self.plane = calibrate(image_points, world_points)
        self._reset_metric_scale()
        if self.source:
            site = self.site_context() or {}
            origin = site.get("origin_geo")
            save_plane(
                self.source["path"],
                self.plane,
                site_id=site.get("site_id") or self.site_id,
                geo_anchor=origin if isinstance(origin, dict) else None,
            )
            self.source["calibrated"] = True
        return self.plane

    def clear_plane(self) -> None:
        self.plane = None
        self._reset_metric_scale()
        if self.source:
            delete_plane(self.source["path"])
            self.source["calibrated"] = False

    def persist_zones(self, zones: list[dict[str, Any]]) -> None:
        self.risk.set_zones(zones)
        if self.source:
            save_zones(self.source["path"], zones)
            self.source["zones"] = zones

    def set_heatmap_window(self, window_s: float) -> None:
        self.heatmap.set_window(window_s)

    def clear_heatmap(self) -> None:
        self.heatmap.reset()

    def seek(self, frame_index: int) -> None:
        if self.cap is None or (self.source or {}).get("live"):
            return
        total = int((self.source or {}).get("frames") or 0)
        idx = max(0, min(int(frame_index), max(0, total - 1)))
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        self.frame_idx = idx
        self.tracker.reset()
        self.risk.reset()

    def restart(self) -> Optional[dict[str, Any]]:
        if not self.source:
            return None
        return self.open(self.source["path"])

    def step(self) -> Optional[dict[str, Any]]:
        if self.cap is None:
            return None
        ok, frame = self.cap.read()
        if (not ok or frame is None) and (self.source or {}).get("live"):
            if self._reopen_live():
                ok, frame = self.cap.read()
        if ok and frame is not None:
            self._prefetch.append(frame)
        # Stay ~lag_frames behind; if we fell further behind, drop stale frames to catch up.
        depth = self.lag_frames + 1
        while len(self._prefetch) > max(1, depth):
            self._prefetch.popleft()
        if not self._prefetch:
            return None
        frame = self._prefetch.popleft()
        t0 = time.perf_counter()
        h, w = frame.shape[:2]
        scale = 1.0
        if max(h, w) > self.max_width:
            scale = self.max_width / float(max(h, w))
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
            h, w = frame.shape[:2]

        fps = float((self.source or {}).get("fps") or 25.0) or 25.0
        dt = 1.0 / fps
        dets = self.detector.infer(
            frame,
            skip_names={"machine"} if (self.source or {}).get("live") else None,
            keep_floor=self.tracker.score_floor(),
        )
        # Twin mesh robots: do not inject UV boxes (projection was misaligned).
        # Map/proximity still uses Kit actors; vision sees the USD mesh itself.
        if scale != 1.0:
            # detector ran on resized frame; boxes already in resized coords
            pass
        tracks = self.tracker.step(dets, dt)
        # Twin UI: never draw coasting ghosts — they look like duplicate boxes
        # stuck where the person used to be while a new track follows them.
        if self.slim_packet:
            tracks = [t for t in tracks if int(getattr(t, "time_since_update", 0)) == 0]

        pose = camera_pose_from_plane(self._working_plane(), w, h) if self.plane is not None else None
        fov = None
        if self.plane is not None:
            try:
                fov = fov_world_polygon(self._working_plane(), w, h)
            except Exception:
                fov = None
        if self.plane is not None:
            self._update_world(tracks, dt, pose)

        risk = (
            self.risk.evaluate(tracks, dt_s=dt)
            if self.plane is not None
            else {
                "pairs": [],
                "min_ttc_s": None,
                "min_distance_m": None,
                "min_clearance_m": None,
                "raw_level": 0,
                "alarm": "uncalibrated",
                "alarm_level": 0,
                "zone_hits": [],
                "trip_events": [],
                "trip_counts": {},
                "occupancy": {},
                "escalate": False,
                "method": None,
            }
        )
        if self.plane is not None and self.heatmap_enabled:
            self.heatmap.step(tracks)

        if self.redact_pii:
            boxes = []
            for t in tracks:
                if t.class_name == "worker":
                    boxes.append(tuple(float(v) for v in t.bbox.tolist()))
            for d in dets:
                if d.class_name == "worker":
                    boxes.append((d.x1, d.y1, d.x2, d.y2))
            frame = self.redactor.apply(frame, boxes)

        jpeg: bytes | None = None
        if self.send_jpeg:
            _, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
            jpeg = buf.tobytes()
        latency_ms = (time.perf_counter() - t0) * 1000.0
        self.frame_idx += 1
        # Twin path skips heavy copies — incidents/ring are off or unused.
        if self.send_jpeg or self.incidents_enabled:
            self.last_bgr = frame.copy()
            if self.incidents_enabled:
                self.frame_ring.push(frame)
        else:
            self.last_bgr = frame
        self._record_event(risk, tracks)

        hist_n = 4 if self.slim_packet else 16
        track_rows = []
        for t in tracks:
            row = {
                "id": t.track_id,
                "class_name": t.class_name,
                "confirmed": t.confirmed,
                "bbox": [round(float(v), 1) for v in t.bbox.tolist()],
                "conf": round(t.conf, 3),
                "foot": [round(t.foot[0], 1), round(t.foot[1], 1)],
                "time_since_update": int(t.time_since_update),
                "x_m": None if t.x_m is None else float(round(t.x_m, 2)),
                "y_m": None if t.y_m is None else float(round(t.y_m, 2)),
                "vx_px": float(round(t.vx_px, 1)),
                "vy_px": float(round(t.vy_px, 1)),
                "vx_mps": float(round(t.vx_mps, 2)),
                "vy_mps": float(round(t.vy_mps, 2)),
                "hx": float(round(t.hx, 3)),
                "hy": float(round(t.hy, 3)),
                "heading_ready": bool(t.heading_ready),
                "speed_mps": float(round(float(np.hypot(t.vx_mps, t.vy_mps)), 2)),
                "aim_uv": _aim_uv(self._working_plane(), t),
                "history_m": [[round(x, 2), round(y, 2)] for x, y in t.history_m[-hist_n:]],
            }
            if not self.slim_packet:
                row.update(
                    {
                        "age": int(t.age),
                        "hits": int(t.hits),
                        "time_since_update": int(t.time_since_update),
                        "length_m": None if t.length_m is None else float(round(t.length_m, 2)),
                        "width_m": None if t.width_m is None else float(round(t.width_m, 2)),
                        "height_m": None if t.height_m is None else float(round(t.height_m, 2)),
                        "forecast_m": (
                            _forecast(t, horizon=5.0, dt=0.5)
                            if t.confirmed and t.x_m is not None and float(np.hypot(t.vx_mps, t.vy_mps)) > 0.25
                            else []
                        ),
                        "radius_m": self.risk.radii.get(t.class_name, 0.5),
                    }
                )
            track_rows.append(row)

        packet = {
            "frame_index": self.frame_idx - 1,
            "width": w,
            "height": h,
            "dt_s": round(dt, 4),
            "calibrated": self.plane is not None,
            "rms_px": None if self.plane is None else round(self.plane.rms_px, 2),
            "latency_ms": round(latency_ms, 2),
            "device": self.device,
            "pii_redacted": self.redact_pii,
            "jpeg": jpeg,
            "tracks": track_rows,
            "risk": risk,
            "n_workers": sum(1 for t in tracks if t.confirmed and t.class_name == "worker"),
            "n_vehicles": sum(1 for t in tracks if t.confirmed and t.class_name == "vehicle"),
            "n_machines": sum(1 for t in tracks if t.confirmed and t.class_name == "machine"),
            "source_fps": (self.source or {}).get("fps", 0),
        }
        if not self.slim_packet:
            packet.update(
                {
                    "detections": [
                        {
                            "class_name": d.class_name,
                            "conf": round(d.conf, 3),
                            "bbox": [round(d.x1, 1), round(d.y1, 1), round(d.x2, 1), round(d.y2, 1)],
                        }
                        for d in dets
                    ],
                    "risk_thresholds": {
                        "advisory_distance_m": float(self.cfg.get("risk", {}).get("advisory_distance_m", 4.0)),
                        "warning_distance_m": float(self.cfg.get("risk", {}).get("warning_distance_m", 2.0)),
                        "critical_distance_m": float(self.cfg.get("risk", {}).get("critical_distance_m", 0.5)),
                    },
                    "fov_m": fov,
                    "map": load_map_underlay(self.source["path"]) if self.source else None,
                    "zones": self.risk.zones,
                    "events": self.events[-16:],
                    "incidents": self.incidents[-8:],
                    "heatmap": self.heatmap.to_packet() if self.heatmap_enabled and self.plane is not None else None,
                    "source_frames": (self.source or {}).get("frames", 0),
                    "plane": None if self._working_plane() is None else self._working_plane().to_dict(),
                    "camera": pose,
                    "metric_scale": round(self.metric_scale, 2),
                    "site": self.site_context(),
                    "geo_anchor": None
                    if not self.source
                    else (load_plane_bundle(self.source["path"]) or {}).get("geo_anchor"),
                }
            )
        self.last_packet = {k: v for k, v in packet.items() if k != "jpeg"}
        return packet

    def _reset_metric_scale(self) -> None:
        self.metric_scale = 1.0
        self._scale_samples = []
        self._scale_locked = False

    def _working_plane(self) -> Optional[GroundPlane]:
        if self.plane is None:
            return None
        if abs(self.metric_scale - 1.0) < 0.05:
            return self.plane
        return scale_plane(self.plane, self.metric_scale)

    def _maybe_lock_scale(self, tracks) -> None:
        if self._scale_locked or self.plane is None:
            return
        for trk in tracks:
            if trk.class_name != "vehicle" or trk.time_since_update != 0:
                continue
            ratio = vehicle_width_scale(self.plane, trk.bbox)
            if ratio is not None:
                self._scale_samples.append(ratio)
        if len(self._scale_samples) < 10:
            return
        new_scale = float(np.clip(float(np.median(self._scale_samples)), 1.4, 8.5))
        factor = new_scale / max(self.metric_scale, 1e-6)
        self.metric_scale = new_scale
        self._scale_locked = True
        if abs(factor - 1.0) < 0.05:
            return
        for trk in tracks:
            if trk.x_m is None or trk.y_m is None:
                continue
            trk.x_m *= factor
            trk.y_m *= factor
            trk.vx_mps *= factor
            trk.vy_mps *= factor
            if trk.length_m is not None:
                trk.length_m *= factor
            if trk.width_m is not None:
                trk.width_m *= factor
            trk.history_m = [(x * factor, y * factor) for x, y in trk.history_m]

    def _update_world(self, tracks, dt: float, pose: dict | None = None) -> None:
        if self.plane is None:
            return
        self._maybe_lock_scale(tracks)
        plane = self._working_plane()
        if plane is None:
            return
        live = [t for t in tracks if t.time_since_update == 0]
        if live:
            feet = np.array([trk.foot for trk in live], dtype=np.float64)
            world = plane.image_to_world(feet)
            for trk, (x, y) in zip(live, world):
                vehicle = trk.class_name in {"vehicle", "machine"}
                nx, ny, nvx, nvy = blend_ground(
                    trk.x_m,
                    trk.y_m,
                    trk.vx_mps,
                    trk.vy_mps,
                    float(x),
                    float(y),
                    dt,
                    max_speed_mps=36.0 if vehicle else 12.0,
                )
                trk.x_m, trk.y_m, trk.vx_mps, trk.vy_mps = nx, ny, nvx, nvy
                min_speed = 0.45
                trk.hx, trk.hy, trk.heading_reverse_hits = update_heading(
                    trk.hx,
                    trk.hy,
                    nvx,
                    nvy,
                    trk.heading_reverse_hits,
                    min_speed=min_speed,
                    ready=trk.heading_ready,
                )
                if float(np.hypot(nvx, nvy)) >= min_speed:
                    trk.heading_ready = True
                if vehicle:
                    length, width = ground_box_size(
                        plane,
                        trk.bbox,
                        trk.hx,
                        trk.hy,
                        aspect=2.2 if trk.class_name == "vehicle" else 1.7,
                        min_len=1.4 if trk.class_name == "vehicle" else 2.0,
                        max_len=6.2 if trk.class_name == "vehicle" else 8.0,
                        min_wid=0.7 if trk.class_name == "vehicle" else 1.1,
                        max_wid=2.4 if trk.class_name == "vehicle" else 3.4,
                    )
                    if trk.length_m is None or trk.width_m is None:
                        trk.length_m, trk.width_m = length, width
                    else:
                        trk.length_m = 0.78 * trk.length_m + 0.22 * length
                        trk.width_m = 0.78 * trk.width_m + 0.22 * width
                if pose is not None and trk.class_name == "worker":
                    h_app = apparent_height_m(pose, nx, ny, trk.bbox)
                    if trk.height_m is None:
                        trk.height_m = h_app
                    else:
                        trk.height_m = 0.8 * trk.height_m + 0.2 * h_app
                trk.history_m.append((nx, ny))
                if len(trk.history_m) > 40:
                    trk.history_m.pop(0)
        for trk in tracks:
            if trk.time_since_update == 0 or trk.x_m is None:
                continue
            trk.vx_mps *= 0.9
            trk.vy_mps *= 0.9
            trk.x_m = float(trk.x_m + trk.vx_mps * dt)
            trk.y_m = float(trk.y_m + trk.vy_mps * dt)
            trk.history_m.append((trk.x_m, trk.y_m))
            if len(trk.history_m) > 40:
                trk.history_m.pop(0)

    def _record_event(self, risk: dict[str, Any], tracks: list | None = None) -> None:
        frame_i = self.frame_idx - 1
        site = self.site_context() or {}
        site_id = site.get("site_id") or self.site_id
        camera_id = site.get("camera_id") or self.camera_id
        track_by_id = {int(t.track_id): t for t in (tracks or [])}

        for trip in risk.get("trip_events") or []:
            tax = resolve_event(kind="tripwire", alarm="tripwire", risk=risk)
            self.events.append(
                {
                    "frame": frame_i,
                    "alarm": "tripwire",
                    "kind": "tripwire",
                    "event_code": tax["event_code"],
                    "event_label": tax["event_label"],
                    "category": tax["category"],
                    "site_id": site_id,
                    "camera_id": camera_id,
                    "ttc_s": None,
                    "distance_m": None,
                    "clearance_m": None,
                    "zone_hits": 0,
                    "detail": f"{trip.get('name')} ×{trip.get('count')} (id {trip.get('track_id')})",
                }
            )

        escalate = bool(risk.get("escalate"))
        level = int(risk.get("alarm_level") or 0)
        if level >= 2:
            dup = False
            if self.events:
                last = self.events[-1]
                if last.get("alarm") == risk.get("alarm") and frame_i - int(last["frame"]) < 12:
                    dup = True
            if not dup:
                top = (risk.get("pairs") or [{}])[0]
                tax = resolve_event(kind="alarm", alarm=str(risk.get("alarm") or ""), risk=risk)
                self.events.append(
                    {
                        "frame": frame_i,
                        "alarm": risk.get("alarm"),
                        "kind": "alarm",
                        "event_code": tax["event_code"],
                        "event_label": tax["event_label"],
                        "category": tax["category"],
                        "site_id": site_id,
                        "camera_id": camera_id,
                        "ttc_s": risk.get("min_ttc_s"),
                        "distance_m": risk.get("min_distance_m"),
                        "clearance_m": risk.get("min_clearance_m"),
                        "zone_hits": len(risk.get("zone_hits") or []),
                        "track_a": top.get("track_a"),
                        "track_b": top.get("track_b"),
                        "detail": None,
                    }
                )

        if escalate and self.incidents_enabled and level >= 2:
            tax = resolve_event(kind="alarm", alarm=str(risk.get("alarm") or ""), risk=risk)
            location_m = None
            top = (risk.get("pairs") or [None])[0]
            if top:
                a = track_by_id.get(int(top.get("track_a") or -1))
                b = track_by_id.get(int(top.get("track_b") or -1))
                if a is not None and b is not None and a.x_m is not None and b.x_m is not None:
                    location_m = [
                        round((float(a.x_m) + float(b.x_m)) * 0.5, 2),
                        round((float(a.y_m) + float(b.y_m)) * 0.5, 2),
                    ]
            record = create_incident(
                source=self.source,
                risk=risk,
                frame_index=frame_i,
                still_bgr=self.last_bgr,
                ring=self.frame_ring,
                fps=float((self.source or {}).get("fps") or 12.0),
                kind="alarm",
                event_code=tax["event_code"],
                event_label=tax["event_label"],
                category=tax["category"],
                site_id=site_id,
                camera_id=camera_id,
                location_m=location_m,
            )
            self.incidents.append(
                {
                    "id": record["id"],
                    "alarm": record.get("alarm"),
                    "event_code": record.get("event_code"),
                    "event_label": record.get("event_label"),
                    "site_id": record.get("site_id"),
                    "frame": record.get("frame_index"),
                    "still": record.get("still"),
                    "clip": record.get("clip"),
                    "created_at": record.get("created_at"),
                }
            )
            if len(self.incidents) > 20:
                self.incidents = self.incidents[-20:]
            if self.webhook_url:
                fire_webhook(
                    self.webhook_url,
                    {
                        "type": "yardline.incident",
                        "incident": record,
                        "source": self.source,
                        "site": site,
                    },
                )

        if len(self.events) > 60:
            self.events = self.events[-60:]
