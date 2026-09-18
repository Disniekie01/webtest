from __future__ import annotations

import time
from collections import deque
from typing import Any, Deque

import numpy as np

from yardline.track import Track


class OccupancyHeatmap:
    """Accumulate worker foot positions on a metric grid for bird's-eye overlay."""

    def __init__(self, cell_m: float = 0.5, decay: float = 0.985, max_cells: int = 80):
        self.cell_m = float(cell_m)
        self.decay = float(decay)
        self.max_cells = int(max_cells)
        self.origin_x = 0.0
        self.origin_y = 0.0
        self.grid = np.zeros((self.max_cells, self.max_cells), dtype=np.float32)
        self._ready = False
        self.window_s = 120.0  # 0 = continuous EWMA mode
        self._events: Deque[tuple[float, float, float]] = deque(maxlen=20000)

    def set_window(self, window_s: float) -> None:
        self.window_s = max(0.0, float(window_s))
        self.reset()

    def reset(self) -> None:
        self.grid.fill(0.0)
        self._ready = False
        self._events.clear()

    def _ensure(self, x: float, y: float) -> None:
        if self._ready:
            return
        half = (self.max_cells * self.cell_m) * 0.5
        self.origin_x = float(x) - half
        self.origin_y = float(y) - half
        self._ready = True

    def _deposit(self, x: float, y: float, weight: float = 1.0) -> None:
        self._ensure(x, y)
        ix = int((x - self.origin_x) / self.cell_m)
        iy = int((y - self.origin_y) / self.cell_m)
        if 0 <= ix < self.max_cells and 0 <= iy < self.max_cells:
            self.grid[iy, ix] += weight

    def step(self, tracks: list[Track]) -> None:
        now = time.time()
        points: list[tuple[float, float]] = []
        for t in tracks:
            if not t.confirmed or t.class_name != "worker" or t.x_m is None or t.y_m is None:
                continue
            points.append((float(t.x_m), float(t.y_m)))

        if self.window_s <= 0:
            self.grid *= self.decay
            for x, y in points:
                self._deposit(x, y, 1.0)
            return

        for x, y in points:
            self._events.append((now, x, y))
        cutoff = now - self.window_s
        while self._events and self._events[0][0] < cutoff:
            self._events.popleft()
        self.grid.fill(0.0)
        self._ready = False
        for _, x, y in self._events:
            self._deposit(x, y, 1.0)

    def to_packet(self, threshold: float = 0.15) -> dict[str, Any] | None:
        if not self._ready:
            return {
                "origin_m": [round(self.origin_x, 2), round(self.origin_y, 2)],
                "cell_m": self.cell_m,
                "cols": self.max_cells,
                "rows": self.max_cells,
                "cells": [],
                "peak": 0.0,
                "window_s": self.window_s,
            }
        peak = float(self.grid.max()) if self.grid.size else 0.0
        if peak < threshold:
            return {
                "origin_m": [round(self.origin_x, 2), round(self.origin_y, 2)],
                "cell_m": self.cell_m,
                "cols": self.max_cells,
                "rows": self.max_cells,
                "cells": [],
                "peak": 0.0,
                "window_s": self.window_s,
            }
        ys, xs = np.where(self.grid >= threshold)
        cells = [
            {"x": int(x), "y": int(y), "v": round(float(self.grid[y, x] / peak), 3)}
            for y, x in zip(ys.tolist(), xs.tolist())
        ]
        if len(cells) > 400:
            cells = sorted(cells, key=lambda c: c["v"], reverse=True)[:400]
        return {
            "origin_m": [round(self.origin_x, 2), round(self.origin_y, 2)],
            "cell_m": self.cell_m,
            "cols": self.max_cells,
            "rows": self.max_cells,
            "cells": cells,
            "peak": round(peak, 2),
            "window_s": self.window_s,
        }
