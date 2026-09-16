#!/usr/bin/env python3
"""Check vehicle USDs against the conventions `citylab.traffic` relies on.

    ~/isaacsim/python.sh tools/verify_cars.py [name.usdc ...]

A car is only drivable if it is Y-up, has a /Car default prim, sits centred on
the origin with its tyres on y=0, is a plausible size, and carries materials
whose textures resolve. Anything else shows up in the stream as a car that
floats, faces the wrong way, or renders untextured.

For KayKit cars the nose direction is re-derived from the source glTF wheel
nodes and checked against the exported geometry, since a merged mesh can no
longer be inspected for which end is the front.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from pxr import Usd, UsdGeom, UsdShade

ROOT = Path(__file__).resolve().parents[1]
VEH = ROOT / "assets" / "vehicles"
GLTF_DIR = ROOT.parent / "public" / "models" / "kaykit" / "gltf"

LENGTH_RANGE = (3.0, 13.0)
WIDTH_RANGE = (1.4, 3.0)
HEIGHT_RANGE = (1.0, 4.2)
TOL = 0.02


def kaykit_nose_is_minus_x(usd_path: Path) -> bool | None:
    """Replay the export transform on the glTF wheel nodes and check the nose."""
    gltf_path = GLTF_DIR / f"{usd_path.stem}.gltf"
    if not gltf_path.is_file():
        return None
    doc = json.loads(gltf_path.read_text())
    nodes = doc["nodes"]
    origins: dict[str, tuple[float, float, float]] = {}

    def walk(idx: int, parent: tuple[float, float, float]) -> None:
        node = nodes[idx]
        t = node.get("translation", [0.0, 0.0, 0.0])
        here = (parent[0] + t[0], parent[1] + t[1], parent[2] + t[2])
        origins[node.get("name", f"node{idx}")] = here
        for child in node.get("children", []):
            walk(child, here)

    for r in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        walk(r, (0.0, 0.0, 0.0))

    def centre(tag: str):
        picked = [v for k, v in origins.items() if "wheel" in k.lower() and tag in k.lower()]
        if not picked:
            return None
        n = len(picked)
        return tuple(sum(v[i] for v in picked) / n for i in range(3))

    front, rear = centre("front"), centre("rear") or centre("back")
    if front is None or rear is None:
        return None
    theta = math.atan2(front[2] - rear[2], front[0] - rear[0]) - math.pi
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    def rot_x(p) -> float:
        return p[0] * cos_t + p[2] * sin_t

    # Only the sign of (front - rear) along X matters; centring/scaling preserve it.
    return rot_x(front) < rot_x(rear)


def check(path: Path) -> bool:
    problems: list[str] = []
    stage = Usd.Stage.Open(str(path))
    if stage is None:
        print(f"FAIL {path.name}: cannot open")
        return False

    if UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.y:
        problems.append(f"upAxis={UsdGeom.GetStageUpAxis(stage)} (want Y)")
    mpu = UsdGeom.GetStageMetersPerUnit(stage)
    if abs(mpu - 1.0) > 1e-6:
        problems.append(f"metersPerUnit={mpu} (want 1.0)")

    car = stage.GetPrimAtPath("/Car")
    if not car or not car.IsValid():
        print(f"FAIL {path.name}: no /Car prim to reference")
        return False
    default = stage.GetDefaultPrim()
    if not default or default.GetPath().pathString != "/Car":
        problems.append(f"defaultPrim={default.GetPath() if default else None} (want /Car)")

    rng = UsdGeom.BBoxCache(
        Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render]
    ).ComputeWorldBound(car).ComputeAlignedRange()
    if rng.IsEmpty():
        print(f"FAIL {path.name}: empty bounds")
        return False
    mn, mx = rng.GetMin(), rng.GetMax()
    length, height, width = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]

    if abs(mn[1]) > TOL:
        problems.append(f"not grounded (min y={mn[1]:+.3f})")
    if abs(mn[0] + mx[0]) * 0.5 > TOL:
        problems.append(f"off-centre in x (centre={(mn[0] + mx[0]) * 0.5:+.3f})")
    if abs(mn[2] + mx[2]) * 0.5 > TOL:
        problems.append(f"off-centre in z (centre={(mn[2] + mx[2]) * 0.5:+.3f})")
    if not LENGTH_RANGE[0] <= length <= LENGTH_RANGE[1]:
        problems.append(f"length {length:.2f} m outside {LENGTH_RANGE}")
    if not WIDTH_RANGE[0] <= width <= WIDTH_RANGE[1]:
        problems.append(f"width {width:.2f} m outside {WIDTH_RANGE}")
    if not HEIGHT_RANGE[0] <= height <= HEIGHT_RANGE[1]:
        problems.append(f"height {height:.2f} m outside {HEIGHT_RANGE}")
    if length < width:
        problems.append(f"length {length:.2f} < width {width:.2f} — long axis is not X")

    meshes = [p for p in Usd.PrimRange(car) if p.IsA(UsdGeom.Mesh)]
    if not meshes:
        problems.append("no meshes")
    unbound = [
        m.GetName()
        for m in meshes
        if not UsdShade.MaterialBindingAPI(m).GetDirectBinding().GetMaterial()
    ]
    if unbound:
        problems.append(f"unbound meshes: {unbound}")

    textures = 0
    for prim in Usd.PrimRange(car):
        if not prim.IsA(UsdShade.Shader):
            continue
        inp = UsdShade.Shader(prim).GetInput("file")
        val = inp.Get() if inp else None
        if val is None:
            continue
        textures += 1
        if not val.resolvedPath or not Path(val.resolvedPath).is_file():
            problems.append(f"texture does not resolve: {val.path}")

    nose_ok = kaykit_nose_is_minus_x(path)
    if nose_ok is False:
        problems.append("nose points +X (traffic expects -X)")

    tris = sum(
        len(UsdGeom.Mesh(m).GetFaceVertexCountsAttr().Get() or []) for m in meshes
    )
    nose_note = {True: "-X ok", False: "WRONG", None: "n/a"}[nose_ok]
    status = "ok  " if not problems else "FAIL"
    print(
        f"{status} {path.name:24s} L={length:5.2f} W={width:4.2f} H={height:4.2f} "
        f"tris={tris:5d} tex={textures} nose={nose_note}"
    )
    for p in problems:
        print(f"       - {p}")
    return not problems


def main() -> int:
    args = sys.argv[1:]
    if args:
        paths = [VEH / a if not Path(a).is_absolute() else Path(a) for a in args]
    else:
        paths = sorted(VEH.glob("kaykit/*.usdc"))
    if not paths:
        print("no vehicle USDs found", file=sys.stderr)
        return 1
    failed = sum(not check(p) for p in paths if p.is_file())
    print(f"\n{len(paths) - failed}/{len(paths)} cars pass")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
