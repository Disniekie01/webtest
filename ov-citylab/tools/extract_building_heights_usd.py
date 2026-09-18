#!/usr/bin/env python3
"""Extract per-parcel roof heights from Isaac City Generator PointInstancers.

Building mass in city_generator_large.usdc is stacked floor instances under
InstancedBuildings. For each SUMO parcel we take max(instance_y + proto_h).

Run: ~/isaacsim/python.sh ov-citylab/tools/extract_building_heights_usd.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from pxr import Gf, Usd, UsdGeom

ROOT = Path(__file__).resolve().parents[1]
USD = ROOT / "assets" / "city" / "city_generator_large.usdc"
SUMO_BLD = ROOT / "assets" / "sumo" / "buildings.json"
WEB_BLD = ROOT.parent / "src" / "data" / "sumoBuildings.json"
HALF = 80.0


def collect_building_pieces(stage: Usd.Stage):
    bbox_cache = UsdGeom.BBoxCache(
        Usd.TimeCode.Default(),
        includedPurposes=[UsdGeom.Tokens.default_],
        useExtentsHint=True,
    )
    pieces = []
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.PointInstancer):
            continue
        path = str(prim.GetPath())
        if "InstancedBuildings" not in path:
            continue
        inst = UsdGeom.PointInstancer(prim)
        protos = inst.GetPrototypesRel().GetTargets()
        indices = list(inst.GetProtoIndicesAttr().Get() or [])
        positions = list(inst.GetPositionsAttr().Get() or [])
        scales_attr = inst.GetScalesAttr().Get()
        scales = list(scales_attr) if scales_attr else None

        proto_h = []
        for t in protos:
            p = stage.GetPrimAtPath(t)
            r = bbox_cache.ComputeWorldBound(p).ComputeAlignedRange()
            if r.IsEmpty():
                proto_h.append(3.0)
            else:
                mn, mx = r.GetMin(), r.GetMax()
                proto_h.append(max(0.5, float(mx[1] - mn[1])))

        parent = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        for i, idx in enumerate(indices):
            pos = positions[i]
            gp = parent.Transform(Gf.Vec3d(float(pos[0]), float(pos[1]), float(pos[2])))
            sy = float(scales[i][1]) if scales and i < len(scales) else 1.0
            h = proto_h[int(idx)] * sy
            top = float(gp[1]) + h
            pieces.append((float(gp[0]), float(gp[2]), top))
    return pieces


def main() -> None:
    print("=== open", USD, flush=True)
    stage = Usd.Stage.Open(str(USD))
    if stage is None:
        raise SystemExit("failed to open USD")

    pieces = collect_building_pieces(stage)
    print(f"building pieces={len(pieces)}", flush=True)
    xs = np.array([p[0] for p in pieces])
    zs = np.array([p[1] for p in pieces])
    tops = np.array([p[2] for p in pieces])
    print(
        f"XZ=[{xs.min():.1f},{xs.max():.1f}]x[{zs.min():.1f},{zs.max():.1f}] "
        f"top Y=[{tops.min():.1f},{tops.max():.1f}]",
        flush=True,
    )

    parcels = json.loads(SUMO_BLD.read_text())
    out = []
    heights = []
    for p in parcels:
        x0 = float(p["x0"]) - HALF
        x1 = float(p["x1"]) - HALF
        z0 = float(p["y0"]) - HALF
        z1 = float(p["y1"]) - HALF
        lo_x, hi_x = min(x0, x1), max(x0, x1)
        lo_z, hi_z = min(z0, z1), max(z0, z1)
        # Slight inset — ignore pieces sitting on the parcel curb
        m = 1.5
        hits = [
            top
            for x, z, top in pieces
            if (lo_x + m) <= x <= (hi_x - m) and (lo_z + m) <= z <= (hi_z - m)
        ]
        if not hits:
            hits = [
                top
                for x, z, top in pieces
                if lo_x <= x <= hi_x and lo_z <= z <= hi_z
            ]
        h = float(max(hits)) if hits else 12.0
        h = round(max(6.0, min(h, 80.0)), 2)
        heights.append(h)
        row = {k: v for k, v in p.items() if k != "height_m"}
        row["height_m"] = h
        out.append(row)
        print(f"  {p['id']:10s}  h={h:5.1f} m  pieces={len(hits)}", flush=True)

    text = json.dumps(out, indent=2) + "\n"
    SUMO_BLD.write_text(text)
    WEB_BLD.write_text(text)
    print(
        f"heights min/med/max = {min(heights):.1f}/{float(np.median(heights)):.1f}/{max(heights):.1f}"
    )
    print("wrote", SUMO_BLD)
    print("wrote", WEB_BLD)
    print("DONE")


if __name__ == "__main__":
    main()
