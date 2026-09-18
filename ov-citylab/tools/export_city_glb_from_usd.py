"""Extract city_generator_large.usdc → Draco-friendly GLB via Isaac pxr + trimesh.

Same mesh Isaac loads — spatial parity with SUMO / Kit camera.
Run: /home/disniekie/isaacsim/python.sh ov-citylab/tools/export_city_glb_from_usd.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
from pxr import Usd, UsdGeom, Gf

ROOT = Path(__file__).resolve().parents[1]
USD = ROOT / "assets" / "city" / "city_generator_large.usdc"
WEB_OUT = ROOT.parent / "public" / "models" / "citygen"
WEB_OUT.mkdir(parents=True, exist_ok=True)
GLB = WEB_OUT / "city_generator_large.glb"
TARGET_FACES = 280_000


def _xf_matrix(prim) -> np.ndarray:
    xf = UsdGeom.Xformable(prim)
    m = xf.ComputeLocalToWorldTransform(Usd.TimeCode.Default())
    return np.array(m, dtype=np.float64).reshape(4, 4)


def _mesh_parts(stage: Usd.Stage) -> list[trimesh.Trimesh]:
    parts: list[trimesh.Trimesh] = []
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        pts = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        indices = mesh.GetFaceVertexIndicesAttr().Get()
        if not pts or not counts or not indices:
            continue
        verts = np.array([[p[0], p[1], p[2]] for p in pts], dtype=np.float64)
        # Apply world xform
        M = _xf_matrix(prim)
        ones = np.ones((verts.shape[0], 1))
        hom = np.hstack([verts, ones]) @ M.T
        verts = hom[:, :3]

        faces: list[list[int]] = []
        cursor = 0
        for c in counts:
            c = int(c)
            idx = [int(indices[cursor + i]) for i in range(c)]
            cursor += c
            if c == 3:
                faces.append(idx)
            elif c == 4:
                faces.append([idx[0], idx[1], idx[2]])
                faces.append([idx[0], idx[2], idx[3]])
            elif c > 4:
                for i in range(1, c - 1):
                    faces.append([idx[0], idx[i], idx[i + 1]])
        if not faces:
            continue
        try:
            tm = trimesh.Trimesh(vertices=verts, faces=np.array(faces, dtype=np.int64), process=False)
            if len(tm.faces) > 0:
                parts.append(tm)
        except Exception:
            continue
    return parts


def main() -> None:
    print("=== open", USD, flush=True)
    stage = Usd.Stage.Open(str(USD))
    if stage is None:
        raise SystemExit(f"failed to open {USD}")
    parts = _mesh_parts(stage)
    print(f"mesh parts={len(parts)}", flush=True)
    if not parts:
        raise SystemExit("no meshes found")

    city = trimesh.util.concatenate(parts)
    print(f"merged verts={len(city.vertices)} faces={len(city.faces)}", flush=True)

    # Center XY; lift min Y to 0 (USD is already Y-up)
    bounds = city.bounds
    center = (bounds[0] + bounds[1]) * 0.5
    city.apply_translation([-center[0], -bounds[0][1], -center[2]])

    span = float(np.max(city.extents))
    print(f"span_m≈{span:.1f} extents={city.extents}", flush=True)

    if len(city.faces) > TARGET_FACES:
        ratio = TARGET_FACES / len(city.faces)
        print(f"=== simplify ratio={ratio:.4f} ===", flush=True)
        try:
            city = city.simplify_quadric_decimation(face_count=TARGET_FACES)
        except Exception as exc:
            print(f"simplify skipped: {exc}", flush=True)
        print(f"after faces={len(city.faces)}", flush=True)

    print("=== export GLB ===", flush=True)
    if GLB.exists():
        GLB.unlink()
    city.export(GLB)
    (WEB_OUT / "city_generator_large_bounds.txt").write_text(
        f"dims_xy={city.extents[0]:.3f},{city.extents[2]:.3f}\n"
        f"span_m={span:.3f}\n"
        f"source={USD.name}\n"
        f"faces={len(city.faces)}\n"
        f"parity=isaac_usdc\n"
    )
    print("wrote", GLB, "MB", round(GLB.stat().st_size / 1e6, 1), flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
