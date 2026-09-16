#!/usr/bin/env python3
"""Render a contact sheet of the vehicle USDs for eyeball checks.

    ~/isaacsim/python.sh tools/preview_cars.py [out.png]

A tiny textured z-buffer rasteriser, so orientation and proportions can be
confirmed without booting Kit. The left column is a true side view with world
+X to the right: because traffic cars are authored nose-toward -X, a correct
car faces LEFT in that column.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pxr import Usd, UsdGeom, UsdShade

ROOT = Path(__file__).resolve().parents[1]
VEH = ROOT / "assets" / "vehicles"

TILE = (420, 260)
SPAN_M = 6.0  # metres across a tile
LIGHT = np.array([-0.35, 0.78, 0.52])
BG = (24, 26, 30)


def load(path: Path):
    stage = Usd.Stage.Open(str(path))
    car = stage.GetPrimAtPath("/Car")
    meshes = [p for p in Usd.PrimRange(car) if p.IsA(UsdGeom.Mesh)]
    pts, tris, uvs = [], [], []
    atlas = None
    for prim in Usd.PrimRange(car):
        if not prim.IsA(UsdShade.Shader):
            continue
        inp = UsdShade.Shader(prim).GetInput("file")
        val = inp.Get() if inp else None
        if val is not None and val.resolvedPath:
            atlas = Path(val.resolvedPath)
    for m in meshes:
        mesh = UsdGeom.Mesh(m)
        base = len(pts)
        mpts = np.array(mesh.GetPointsAttr().Get(), dtype=float)
        xf = UsdGeom.Xformable(m).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        mat = np.array(xf, dtype=float)
        mpts = mpts @ mat[:3, :3] + mat[3, :3]
        pts.extend(mpts.tolist())
        idx = list(mesh.GetFaceVertexIndicesAttr().Get() or [])
        counts = list(mesh.GetFaceVertexCountsAttr().Get() or [])
        st = UsdGeom.PrimvarsAPI(m).GetPrimvar("st")
        stv = np.array(st.Get(), dtype=float) if st and st.Get() else None
        uvs.extend((stv.tolist() if stv is not None else [[0.0, 0.0]] * len(mpts)))
        cursor = 0
        for c in counts:
            fan = idx[cursor : cursor + c]
            for k in range(1, c - 1):
                tris.append([base + fan[0], base + fan[k], base + fan[k + 1]])
            cursor += c
    return np.array(pts), np.array(tris, dtype=int), np.array(uvs), atlas


def rasterise(pts, tris, uvs, tex, yaw_deg, pitch_deg, size):
    w, h = size
    img = np.zeros((h, w, 3), dtype=float)
    img[:, :] = np.array(BG) / 255.0
    depth = np.full((h, w), -1e9)

    ya, pa = math.radians(yaw_deg), math.radians(pitch_deg)
    ry = np.array([[math.cos(ya), 0, math.sin(ya)], [0, 1, 0], [-math.sin(ya), 0, math.cos(ya)]])
    rx = np.array([[1, 0, 0], [0, math.cos(pa), -math.sin(pa)], [0, math.sin(pa), math.cos(pa)]])
    view = pts @ ry.T @ rx.T

    centre = (pts.min(axis=0) + pts.max(axis=0)) * 0.5
    cview = centre @ ry.T @ rx.T
    scale = w / SPAN_M
    sx = (view[:, 0] - cview[0]) * scale + w * 0.5
    sy = h * 0.60 - (view[:, 1] - cview[1]) * scale
    sz = view[:, 2]

    th, tw = (tex.shape[0], tex.shape[1]) if tex is not None else (1, 1)

    for tri in tris:
        p = np.stack([sx[tri], sy[tri]], axis=1)
        z = sz[tri]
        normal = np.cross(view[tri[1]] - view[tri[0]], view[tri[2]] - view[tri[0]])
        norm = np.linalg.norm(normal)
        if norm < 1e-12:
            continue
        normal /= norm
        shade = 0.32 + 0.68 * max(0.0, float(np.dot(normal, LIGHT / np.linalg.norm(LIGHT))))

        x0 = max(int(np.floor(p[:, 0].min())), 0)
        x1 = min(int(np.ceil(p[:, 0].max())) + 1, w)
        y0 = max(int(np.floor(p[:, 1].min())), 0)
        y1 = min(int(np.ceil(p[:, 1].max())) + 1, h)
        if x0 >= x1 or y0 >= y1:
            continue

        area = (p[1, 0] - p[0, 0]) * (p[2, 1] - p[0, 1]) - (p[2, 0] - p[0, 0]) * (p[1, 1] - p[0, 1])
        if abs(area) < 1e-9:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        w0 = ((p[1, 0] - gx) * (p[2, 1] - gy) - (p[2, 0] - gx) * (p[1, 1] - gy)) / area
        w1 = ((p[2, 0] - gx) * (p[0, 1] - gy) - (p[0, 0] - gx) * (p[2, 1] - gy)) / area
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        zz = w0 * z[0] + w1 * z[1] + w2 * z[2]
        block = depth[y0:y1, x0:x1]
        win = inside & (zz > block)
        if not win.any():
            continue
        block[win] = zz[win]

        if tex is not None:
            u = w0 * uvs[tri[0], 0] + w1 * uvs[tri[1], 0] + w2 * uvs[tri[2], 0]
            v = w0 * uvs[tri[0], 1] + w1 * uvs[tri[1], 1] + w2 * uvs[tri[2], 1]
            px = np.clip((u * (tw - 1)).astype(int), 0, tw - 1)
            py = np.clip(((1.0 - v) * (th - 1)).astype(int), 0, th - 1)
            colour = tex[py, px]
        else:
            colour = np.full(w0.shape + (3,), 0.7)
        target = img[y0:y1, x0:x1]
        target[win] = np.clip(colour[win] * shade, 0, 1)
    return Image.fromarray((img * 255).astype(np.uint8))


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_output" / "cars_preview.png"
    cars = sorted(VEH.glob("kaykit/*.usdc"))
    if not cars:
        print("no cars to preview", file=sys.stderr)
        return 1

    views = [("side (nose must face LEFT)", 0.0, 0.0), ("three-quarter", -38.0, 16.0)]
    pad, header = 8, 22
    sheet = Image.new(
        "RGB",
        (TILE[0] * len(views) + pad * (len(views) + 1),
         (TILE[1] + header) * len(cars) + pad * (len(cars) + 1)),
        BG,
    )
    draw = ImageDraw.Draw(sheet)

    for row, path in enumerate(cars):
        pts, tris, uvs, atlas = load(path)
        tex = None
        if atlas and atlas.is_file():
            tex = np.asarray(Image.open(atlas).convert("RGB"), dtype=float) / 255.0
        length = pts[:, 0].max() - pts[:, 0].min()
        for col, (label, yaw, pitch) in enumerate(views):
            tile = rasterise(pts, tris, uvs, tex, yaw, pitch, TILE)
            x = pad + col * (TILE[0] + pad)
            y = pad + row * (TILE[1] + header + pad)
            draw.text((x, y + 4), f"{path.stem}  {length:.2f} m  —  {label}", fill=(200, 205, 215))
            sheet.paste(tile, (x, y + header))
        print(f"  rendered {path.stem}")

    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
