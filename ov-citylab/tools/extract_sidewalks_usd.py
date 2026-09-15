#!/usr/bin/env python3
"""Extract sidewalk ribbons from CityGen USD (CityGenside_walks) → assets/sumo/sidewalks.json

Uses Isaac / Kit pxr:
  ~/isaacsim/kit/python/bin/python3 tools/extract_sidewalks_usd.py
  # or docker path used by build_sumo_varwidth.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from pxr import Usd, UsdGeom

ROOT = Path(__file__).resolve().parents[1]
USD = ROOT / "assets" / "city" / "city_generator_large.usdc"
OUT = ROOT / "assets" / "sumo" / "sidewalks.json"
PLANE = "/World/City/City_Generator_2_0_Object/Plane"
ORIGIN = 80.0  # USD centered → SUMO 0..160
BLOCK = 40.0
JUNCTIONS = 5


def _face_bbox(counts, indices, face_starts, pts, fi: int):
    c = int(counts[fi])
    st = face_starts[fi]
    f = pts[[int(indices[st + k]) for k in range(c)]]
    return float(f[:, 0].min()), float(f[:, 0].max()), float(f[:, 1].min()), float(f[:, 1].max())


def main() -> None:
    usd_path = Path(sys.argv[1]) if len(sys.argv) > 1 else USD
    stage = Usd.Stage.Open(str(usd_path))
    plane = stage.GetPrimAtPath(PLANE)
    if not plane:
        raise SystemExit(f"missing plane {PLANE}")
    mesh = UsdGeom.Mesh(plane)
    pts = np.array(mesh.GetPointsAttr().Get(), dtype=np.float64)
    counts = list(mesh.GetFaceVertexCountsAttr().Get())
    indices = list(mesh.GetFaceVertexIndicesAttr().Get())
    face_starts: list[int] = []
    s = 0
    for c in counts:
        face_starts.append(s)
        s += int(c)

    walk = list(map(int, plane.GetChild("CityGenside_walks").GetAttribute("indices").Get()))
    ribbons = []

    # NS corridors (constant X)
    for i in range(JUNCTIONS):
        line = i * BLOCK - ORIGIN
        left: list[float] = []
        right: list[float] = []
        for fi in walk:
            x0, x1, y0, y1 = _face_bbox(counts, indices, face_starts, pts, fi)
            cx = 0.5 * (x0 + x1)
            if abs(cx - line) > 12:
                continue
            if (y1 - y0) < (x1 - x0) * 0.8:
                continue
            (left if cx < line else right).extend([x0, x1])
        for side, xs in (("L", left), ("R", right)):
            if not xs:
                continue
            a = np.array(xs, dtype=np.float64)
            center_usd = float(0.5 * (a.min() + a.max()))
            ribbons.append(
                {
                    "dir": "NS",
                    "line_sumo": float(line + ORIGIN),
                    "side": side,
                    "center_sumo": float(center_usd + ORIGIN),
                    "width_m": float(a.max() - a.min()),
                    "offset_m": float(center_usd - line),
                }
            )

    # EW corridors (constant Y)
    for j in range(JUNCTIONS):
        line = j * BLOCK - ORIGIN
        bot: list[float] = []
        top: list[float] = []
        for fi in walk:
            x0, x1, y0, y1 = _face_bbox(counts, indices, face_starts, pts, fi)
            cy = 0.5 * (y0 + y1)
            if abs(cy - line) > 12:
                continue
            if (x1 - x0) < (y1 - y0) * 0.8:
                continue
            (bot if cy < line else top).extend([y0, y1])
        for side, ys in (("B", bot), ("T", top)):
            if not ys:
                continue
            a = np.array(ys, dtype=np.float64)
            center_usd = float(0.5 * (a.min() + a.max()))
            ribbons.append(
                {
                    "dir": "EW",
                    "line_sumo": float(line + ORIGIN),
                    "side": side,
                    "center_sumo": float(center_usd + ORIGIN),
                    "width_m": float(a.max() - a.min()),
                    "offset_m": float(center_usd - line),
                }
            )

    # Crossing zones = junction footprints spanning the carriageway (~8 m)
    crossings = []
    for i in range(JUNCTIONS):
        for j in range(JUNCTIONS):
            crossings.append(
                {
                    "id": f"{chr(ord('A') + i)}{j}",
                    "x_sumo": float(i * BLOCK),
                    "y_sumo": float(j * BLOCK),
                    "half_size_m": 5.0,
                    "note": "inferred junction box; CityGen has no GeomSubset for crossings",
                }
            )

    payload = {
        "source": str(usd_path),
        "subset": "CityGenside_walks",
        "usd_to_sumo_offset": ORIGIN,
        "ribbons": ribbons,
        "crossings": crossings,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {OUT} ribbons={len(ribbons)} crossings={len(crossings)}", flush=True)


if __name__ == "__main__":
    main()
