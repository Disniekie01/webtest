from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment

from yardline.detect import box_iou


@dataclass
class Track:
    track_id: int
    class_name: str
    bbox: np.ndarray
    conf: float
    vx_px: float = 0.0
    vy_px: float = 0.0
    hits: int = 1
    age: int = 1
    time_since_update: int = 0
    confirmed: bool = False
    x_m: float | None = None
    y_m: float | None = None
    vx_mps: float = 0.0
    vy_mps: float = 0.0
    hx: float = 1.0
    hy: float = 0.0
    heading_ready: bool = False
    heading_reverse_hits: int = 0
    length_m: float | None = None
    width_m: float | None = None
    height_m: float | None = None
    history_m: list[tuple[float, float]] = field(default_factory=list)
    class_votes: dict[str, int] = field(default_factory=dict)
    sticky_class: str | None = None

    @property
    def foot(self) -> tuple[float, float]:
        return float(0.5 * (self.bbox[0] + self.bbox[2])), float(self.bbox[3])


def _assoc_box(trk: Track, dt: float) -> np.ndarray:
    miss = max(1, trk.time_since_update)
    tau = min(0.45, dt * miss)
    shift = np.array([trk.vx_px, trk.vy_px, trk.vx_px, trk.vy_px], dtype=np.float64) * tau
    return trk.bbox + shift


def _update_track(trk: Track, det, box: np.ndarray, dt: float, min_hits: int) -> None:
    prev_cx = 0.5 * (trk.bbox[0] + trk.bbox[2])
    prev_cy = 0.5 * (trk.bbox[1] + trk.bbox[3])
    keep = 0.36 if det.class_name in {"vehicle", "machine"} else 0.28
    blended = keep * trk.bbox + (1.0 - keep) * box
    new_cx = 0.5 * (blended[0] + blended[2])
    new_cy = 0.5 * (blended[1] + blended[3])
    if dt > 1e-3:
        inst_vx = (new_cx - prev_cx) / dt
        inst_vy = (new_cy - prev_cy) / dt
        trk.vx_px = 0.7 * trk.vx_px + 0.3 * inst_vx
        trk.vy_px = 0.7 * trk.vy_px + 0.3 * inst_vy
    trk.bbox = blended
    trk.conf = det.conf
    # Sticky class: freeze after confirmation unless another class wins by a clear margin.
    votes = trk.class_votes
    votes[det.class_name] = int(votes.get(det.class_name, 0)) + 1
    if trk.sticky_class is None:
        trk.sticky_class = det.class_name
    elif det.class_name != trk.sticky_class and trk.confirmed:
        if votes.get(det.class_name, 0) >= votes.get(trk.sticky_class, 0) + 3:
            trk.sticky_class = det.class_name
    elif not trk.confirmed:
        trk.sticky_class = det.class_name
    trk.class_name = trk.sticky_class or det.class_name
    trk.hits += 1
    trk.time_since_update = 0
    if trk.hits >= min_hits:
        trk.confirmed = True


def _iou_cost_matrix(
    track_boxes: list[np.ndarray],
    det_boxes: list[np.ndarray],
    track_classes: list[str],
    det_classes: list[str],
) -> np.ndarray:
    n, m = len(track_boxes), len(det_boxes)
    cost = np.ones((n, m), dtype=np.float64)
    for i in range(n):
        for j in range(m):
            if track_classes[i] != det_classes[j]:
                continue
            cost[i, j] = 1.0 - box_iou(track_boxes[i], det_boxes[j])
    return cost


def _assign(cost: np.ndarray, thresh: float) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    if cost.size == 0:
        return [], list(range(cost.shape[0])), list(range(cost.shape[1]))
    rows, cols = linear_sum_assignment(cost)
    matches: list[tuple[int, int]] = []
    matched_r: set[int] = set()
    matched_c: set[int] = set()
    for i, j in zip(rows, cols):
        if cost[i, j] > thresh:
            continue
        matches.append((i, j))
        matched_r.add(i)
        matched_c.add(j)
    u_r = [i for i in range(cost.shape[0]) if i not in matched_r]
    u_c = [j for j in range(cost.shape[1]) if j not in matched_c]
    return matches, u_r, u_c


class IoUTracker:
    """Class-aware single-stage matcher (legacy)."""

    backend = "iou"

    def __init__(self, iou_match: float = 0.15, max_age: int = 28, min_hits: int = 2, **_kwargs):
        self.iou_match = iou_match
        self.max_age = max_age
        self.min_hits = min_hits
        self.tracks: dict[int, Track] = {}
        self._next_id = 1

    def reset(self) -> None:
        self.tracks.clear()
        self._next_id = 1

    def score_floor(self) -> float | None:
        return None

    def step(self, detections: list, dt: float) -> list[Track]:
        for trk in self.tracks.values():
            trk.age += 1
            trk.time_since_update += 1

        det_boxes = [np.array([d.x1, d.y1, d.x2, d.y2], dtype=np.float64) for d in detections]
        track_ids = list(self.tracks.keys())
        assigned_det: set[int] = set()

        if track_ids and det_boxes:
            cost = np.ones((len(track_ids), len(det_boxes)), dtype=np.float64)
            for i, tid in enumerate(track_ids):
                trk = self.tracks[tid]
                for j, det in enumerate(detections):
                    if det.class_name != trk.class_name:
                        continue
                    pred = _assoc_box(trk, dt)
                    iou = box_iou(pred, det_boxes[j])
                    if iou >= self.iou_match:
                        cost[i, j] = 1.0 - iou
                    else:
                        tcx = 0.5 * (pred[0] + pred[2])
                        tcy = 0.5 * (pred[1] + pred[3])
                        dcx = 0.5 * (det_boxes[j][0] + det_boxes[j][2])
                        dcy = 0.5 * (det_boxes[j][1] + det_boxes[j][3])
                        th = max(1.0, pred[3] - pred[1])
                        tw = max(1.0, pred[2] - pred[0])
                        dist = float(np.hypot(tcx - dcx, tcy - dcy))
                        wide = 0.72 if trk.class_name in {"vehicle", "machine"} else 0.55
                        gate = wide * max(th, det_boxes[j][3] - det_boxes[j][1], tw, det_boxes[j][2] - det_boxes[j][0])
                        if dist <= gate:
                            cost[i, j] = 0.45 + 0.4 * (dist / max(gate, 1.0))
            matches, _, _ = _assign(cost, 0.72)
            for i, j in matches:
                tid = track_ids[i]
                _update_track(self.tracks[tid], detections[j], det_boxes[j], dt, self.min_hits)
                assigned_det.add(j)

        for j, det in enumerate(detections):
            if j in assigned_det:
                continue
            tid = self._next_id
            self.tracks[tid] = Track(
                track_id=tid,
                class_name=det.class_name,
                bbox=det_boxes[j],
                conf=det.conf,
            )
            if self.tracks[tid].hits >= self.min_hits:
                self.tracks[tid].confirmed = True
            self._next_id += 1

        stale = [
            tid
            for tid, trk in self.tracks.items()
            if trk.time_since_update > (2 if not trk.confirmed else self.max_age)
        ]
        for tid in stale:
            del self.tracks[tid]

        return [t for t in self.tracks.values() if t.confirmed]


class ByteTracker:
    """BYTE association: high-score match, then low-score rescue for occlusions."""

    backend = "bytetrack"

    def __init__(
        self,
        *,
        high_thresh: float = 0.25,
        low_thresh: float = 0.1,
        match_thresh: float = 0.8,
        second_match: float = 0.5,
        max_age: int = 28,
        min_hits: int = 2,
        class_high: dict[str, float] | None = None,
        **_kwargs,
    ):
        self.high_thresh = high_thresh
        self.low_thresh = low_thresh
        self.match_thresh = match_thresh
        self.second_match = second_match
        self.max_age = max_age
        self.min_hits = min_hits
        self.class_high = class_high or {}
        self.tracks: dict[int, Track] = {}
        self._next_id = 1

    def reset(self) -> None:
        self.tracks.clear()
        self._next_id = 1

    def score_floor(self) -> float | None:
        return self.low_thresh

    def _is_high(self, det) -> bool:
        floor = self.class_high.get(det.class_name, self.high_thresh)
        return det.conf >= floor

    def step(self, detections: list, dt: float) -> list[Track]:
        for trk in self.tracks.values():
            trk.age += 1
            trk.time_since_update += 1

        high = [(i, d) for i, d in enumerate(detections) if self._is_high(d)]
        low = [(i, d) for i, d in enumerate(detections) if not self._is_high(d) and d.conf >= self.low_thresh]

        track_ids = list(self.tracks.keys())

        if track_ids and high:
            t_boxes = [_assoc_box(self.tracks[tid], dt) for tid in track_ids]
            t_cls = [self.tracks[tid].class_name for tid in track_ids]
            d_boxes = [np.array([d.x1, d.y1, d.x2, d.y2], dtype=np.float64) for _, d in high]
            d_cls = [d.class_name for _, d in high]
            cost = _iou_cost_matrix(t_boxes, d_boxes, t_cls, d_cls)
            matches, u_tracks, u_dets = _assign(cost, 1.0 - self.match_thresh)
            for ti, di in matches:
                tid = track_ids[ti]
                _, det = high[di]
                box = np.array([det.x1, det.y1, det.x2, det.y2], dtype=np.float64)
                _update_track(self.tracks[tid], det, box, dt, self.min_hits)
            remain_ids = [track_ids[i] for i in u_tracks]
        else:
            remain_ids = track_ids
            u_dets = list(range(len(high)))

        # Second association: unmatched tracks ↔ low-score dets (IoU only).
        if remain_ids and low:
            t_boxes = [_assoc_box(self.tracks[tid], dt) for tid in remain_ids]
            t_cls = [self.tracks[tid].class_name for tid in remain_ids]
            d_boxes = [np.array([d.x1, d.y1, d.x2, d.y2], dtype=np.float64) for _, d in low]
            d_cls = [d.class_name for _, d in low]
            cost = _iou_cost_matrix(t_boxes, d_boxes, t_cls, d_cls)
            matches, _, _ = _assign(cost, 1.0 - self.second_match)
            for ti, di in matches:
                tid = remain_ids[ti]
                _, det = low[di]
                box = np.array([det.x1, det.y1, det.x2, det.y2], dtype=np.float64)
                _update_track(self.tracks[tid], det, box, dt, self.min_hits)

        # New tracks only from unmatched high-score detections.
        for di in u_dets:
            _, det = high[di]
            box = np.array([det.x1, det.y1, det.x2, det.y2], dtype=np.float64)
            tid = self._next_id
            self.tracks[tid] = Track(
                track_id=tid,
                class_name=det.class_name,
                bbox=box,
                conf=det.conf,
            )
            if self.tracks[tid].hits >= self.min_hits:
                self.tracks[tid].confirmed = True
            self._next_id += 1

        stale = [
            tid
            for tid, trk in self.tracks.items()
            if trk.time_since_update > (2 if not trk.confirmed else self.max_age)
        ]
        for tid in stale:
            del self.tracks[tid]

        return [t for t in self.tracks.values() if t.confirmed]


def build_tracker(cfg: dict[str, Any]) -> IoUTracker | ByteTracker:
    tcfg = cfg.get("tracker", {})
    backend = str(tcfg.get("backend", "bytetrack")).lower()
    class_high = {
        name: float(spec.get("conf", tcfg.get("high_thresh", 0.25)))
        for name, spec in cfg.get("classes", {}).items()
    }
    common = dict(
        max_age=int(tcfg.get("max_age", 28)),
        min_hits=int(tcfg.get("min_hits", 2)),
        iou_match=float(tcfg.get("iou_match", 0.12)),
        high_thresh=float(tcfg.get("high_thresh", 0.25)),
        low_thresh=float(tcfg.get("low_thresh", 0.1)),
        match_thresh=float(tcfg.get("match_thresh", 0.7)),
        second_match=float(tcfg.get("second_match", 0.5)),
        class_high=class_high,
    )
    if backend in {"iou", "simple"}:
        return IoUTracker(**common)
    return ByteTracker(**common)
