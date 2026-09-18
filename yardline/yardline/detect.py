from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from ultralytics import YOLO


@dataclass
class Detection:
    class_name: str
    conf: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def cx(self) -> float:
        return 0.5 * (self.x1 + self.x2)

    @property
    def cy(self) -> float:
        return 0.5 * (self.y1 + self.y2)

    @property
    def area(self) -> float:
        return max(0.0, self.x2 - self.x1) * max(0.0, self.y2 - self.y1)

    @property
    def foot_u(self) -> float:
        return 0.5 * (self.x1 + self.x2)

    @property
    def foot_v(self) -> float:
        return self.y2

    def as_xyxy(self) -> np.ndarray:
        return np.array([self.x1, self.y1, self.x2, self.y2], dtype=np.float64)


def box_iou(a: np.ndarray, b: np.ndarray) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return float(inter / union) if union > 0 else 0.0


HAZARD_NAMES = frozenset({"machine", "vehicle"})


def geometry_ok(
    det: Detection,
    frame_w: int,
    frame_h: int,
    *,
    min_area_frac: float = 0.0,
    min_height_frac: float = 0.0,
    min_foot_frac: float = 0.0,
    max_aspect: float = 99.0,
) -> bool:
    if frame_w <= 0 or frame_h <= 0:
        return False
    height = det.y2 - det.y1
    width = det.x2 - det.x1
    if det.area / float(frame_w * frame_h) < min_area_frac:
        return False
    if height / float(frame_h) < min_height_frac:
        return False
    if det.y2 / float(frame_h) < min_foot_frac:
        return False
    if width > max_aspect * max(1.0, height):
        return False
    return True


def nms_keep(dets: list[Detection], iou_thresh: float) -> list[Detection]:
    """Class-agnostic NMS. Keep the largest, most confident box in an overlap group."""
    if len(dets) <= 1:
        return dets
    order = sorted(range(len(dets)), key=lambda i: (dets[i].area, dets[i].conf), reverse=True)
    keep: list[Detection] = []
    suppressed: set[int] = set()
    boxes = [d.as_xyxy() for d in dets]
    for i in order:
        if i in suppressed:
            continue
        keep.append(dets[i])
        for j in order:
            if j == i or j in suppressed:
                continue
            if box_iou(boxes[i], boxes[j]) >= iou_thresh:
                suppressed.add(j)
    return keep


class Detector:
    """COCO YOLO mapped onto worker / vehicle / machine."""

    def __init__(self, cfg: dict[str, Any], device: str):
        weights = Path(cfg["detector"]["weights"])
        self.model = YOLO(str(weights))
        self.device = device
        self.conf = float(cfg["detector"]["conf"])
        self.iou = float(cfg["detector"]["iou"])
        self.imgsz = int(cfg["detector"].get("imgsz", 640))
        self._coco_to_name: dict[int, str] = {}
        self._conf_by_name: dict[str, float] = {}
        self._min_area_frac: dict[str, float] = {}
        self._min_height_frac: dict[str, float] = {}
        self._min_foot_frac: dict[str, float] = {}
        self._max_aspect: dict[str, float] = {}
        for name, spec in cfg["classes"].items():
            self._conf_by_name[name] = float(spec.get("conf", self.conf))
            self._min_area_frac[name] = float(spec.get("min_area_frac", 0.0))
            self._min_height_frac[name] = float(spec.get("min_height_frac", 0.0))
            self._min_foot_frac[name] = float(spec.get("min_foot_frac", 0.0))
            self._max_aspect[name] = float(spec.get("max_aspect", 99.0))
            for coco_id in spec["coco"]:
                self._coco_to_name[int(coco_id)] = name
        self._predict_conf = min(self._conf_by_name.values()) if self._conf_by_name else self.conf
        self._class_ids = sorted(self._coco_to_name.keys())
        self._class_ids_cache: dict[tuple[str, ...], list[int]] = {(): self._class_ids}

    def class_ids(self, skip_names: set[str] | frozenset[str] | None = None) -> list[int]:
        skip = tuple(sorted(skip_names or ()))
        cached = self._class_ids_cache.get(skip)
        if cached is not None:
            return cached
        ids = sorted(i for i, name in self._coco_to_name.items() if name not in skip)
        self._class_ids_cache[skip] = ids
        return ids

    def infer(
        self,
        frame_bgr: np.ndarray,
        skip_names: set[str] | frozenset[str] | None = None,
        keep_floor: float | None = None,
    ) -> list[Detection]:
        h, w = frame_bgr.shape[:2]
        predict_conf = self._predict_conf if keep_floor is None else min(self._predict_conf, float(keep_floor))
        result = self.model.predict(
            source=frame_bgr,
            conf=predict_conf,
            iou=self.iou,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False,
            classes=self.class_ids(skip_names),
        )[0]
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return []

        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        clss = boxes.cls.cpu().numpy().astype(int)
        workers: list[Detection] = []
        hazards: list[Detection] = []
        for box, conf, cls_id in zip(xyxy, confs, clss):
            name = self._coco_to_name.get(int(cls_id))
            if name is None or (skip_names and name in skip_names):
                continue
            det = Detection(
                class_name=name,
                conf=float(conf),
                x1=float(box[0]),
                y1=float(box[1]),
                x2=float(box[2]),
                y2=float(box[3]),
            )
            class_floor = self._conf_by_name.get(name, self.conf)
            min_conf = float(keep_floor) if keep_floor is not None else class_floor
            if det.conf < min_conf:
                continue
            if not geometry_ok(
                det,
                w,
                h,
                min_area_frac=self._min_area_frac.get(name, 0.0),
                min_height_frac=self._min_height_frac.get(name, 0.0),
                min_foot_frac=self._min_foot_frac.get(name, 0.0),
                max_aspect=self._max_aspect.get(name, 99.0),
            ):
                continue
            if name == "worker":
                workers.append(_tighten_person(det))
            else:
                hazards.append(det)
        return workers + nms_keep(hazards, iou_thresh=0.25)


def _tighten_person(det: Detection) -> Detection:
    bw = max(1.0, det.x2 - det.x1)
    bh = max(1.0, det.y2 - det.y1)
    det.x1 += 0.08 * bw
    det.x2 -= 0.08 * bw
    det.y1 += 0.04 * bh
    det.y2 -= 0.02 * bh
    return det
