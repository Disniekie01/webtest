from __future__ import annotations

from typing import Iterable

import cv2
import numpy as np


def _clip_box(x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> tuple[int, int, int, int]:
    ix1 = max(0, int(np.floor(x1)))
    iy1 = max(0, int(np.floor(y1)))
    ix2 = min(w, int(np.ceil(x2)))
    iy2 = min(h, int(np.ceil(y2)))
    return ix1, iy1, ix2, iy2


def head_region(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    frame_h: float | None = None,
) -> tuple[float, float, float, float]:
    """Face band inside a person box. Close-ups use a smaller crop."""
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)
    close = frame_h is not None and bh > 0.36 * frame_h
    cx = 0.5 * (x1 + x2)
    fw = (0.40 if close else 0.56) * bw
    return (
        cx - 0.5 * fw,
        y1 + (0.08 if close else 0.04) * bh,
        cx + 0.5 * fw,
        y1 + (0.22 if close else 0.30) * bh,
    )


def pixelate(frame: np.ndarray, box: tuple[float, float, float, float], block: int = 14) -> None:
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = _clip_box(*box, w, h)
    if x2 - x1 < 8 or y2 - y1 < 8:
        return
    roi = frame[y1:y2, x1:x2]
    nw = max(1, (x2 - x1) // block)
    nh = max(1, (y2 - y1) // block)
    small = cv2.resize(roi, (nw, nh), interpolation=cv2.INTER_AREA)
    mosaic = cv2.resize(small, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)
    frame[y1:y2, x1:x2] = mosaic


class FaceRedactor:
    """PII reduction for the outbound JPEG. Pixelates heads before the frame is sent."""

    def __init__(self):
        self._faces = None
        try:
            path = getattr(cv2, "data", None)
            classifier = getattr(cv2, "CascadeClassifier", None)
            if path is not None and classifier is not None:
                xml = path.haarcascades + "haarcascade_frontalface_default.xml"
                loaded = classifier(xml)
                if loaded is not None and not loaded.empty():
                    self._faces = loaded
        except Exception:
            self._faces = None

    def regions(self, frame: np.ndarray, boxes: Iterable[tuple[float, float, float, float]]) -> list[tuple[float, float, float, float]]:
        h, w = frame.shape[:2]
        out = [head_region(*b, frame_h=h) for b in boxes]
        if self._faces is not None:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            found = self._faces.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=4, minSize=(22, 22))
            for x, y, fw, fh in found:
                pad = 0.22
                out.append((x - pad * fw, y - pad * fh, x + fw * (1 + pad), y + fh * (1 + pad)))
        clipped = []
        for box in out:
            x1, y1, x2, y2 = _clip_box(*box, w, h)
            if x2 - x1 >= 8 and y2 - y1 >= 8:
                clipped.append((float(x1), float(y1), float(x2), float(y2)))
        return clipped

    def apply(self, frame: np.ndarray, boxes: Iterable[tuple[float, float, float, float]]) -> np.ndarray:
        redacted = frame
        for box in self.regions(frame, boxes):
            pixelate(redacted, box)
        return redacted
