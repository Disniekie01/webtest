#!/usr/bin/env python3
"""Export KayKit City Builder cars (CC0) as traffic-ready USDs.

Run with a USD-capable interpreter:
    ~/isaacsim/python.sh tools/export_kaykit_cars.py

glTF and the City Lab stage are both Y-up and metre-scale, so geometry is
copied across without any axis conversion. Each car is emitted as one merged
mesh (the pack uses a single shared atlas material, so merging is lossless and
keeps one prim per actor), centred on its footprint, grounded at y=0, scaled to
a real length, with the nose along -X.

Nose direction is measured from the pack's named wheel nodes
(``*_wheel_front_left`` and friends) rather than assumed, so a re-authored
source can't silently flip a car around.
"""
from __future__ import annotations

import json
import math
import shutil
import struct
import sys
from pathlib import Path

from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade

ROOT = Path(__file__).resolve().parents[1]
GLTF_DIR = ROOT.parent / "public" / "models" / "kaykit" / "gltf"
OUT = ROOT / "assets" / "vehicles" / "kaykit"

# Realistic bumper-to-bumper length per model, in metres. Kept just under the
# SUMO passenger vType length (5.0 m) so actors never visually overlap.
TARGET_LENGTH_M = {
    "car_sedan": 4.6,
    "car_stationwagon": 4.8,
    "car_hatchback": 4.0,
    "car_taxi": 4.7,
    "car_police": 4.9,
}
DEFAULT_LENGTH_M = 4.6

_COMPONENT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Gltf:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.doc = json.loads(path.read_text())
        self._buffers: list[bytes] = []
        for buf in self.doc.get("buffers", []):
            uri = buf.get("uri")
            if not uri or uri.startswith("data:"):
                raise RuntimeError(f"{path.name}: embedded buffers not supported")
            self._buffers.append((path.parent / uri).read_bytes())

    def read(self, accessor_index: int) -> list[tuple]:
        acc = self.doc["accessors"][accessor_index]
        ncomp = _COUNT[acc["type"]]
        fmt = _COMPONENT[acc["componentType"]]
        size = struct.calcsize(fmt)
        view = self.doc["bufferViews"][acc["bufferView"]]
        data = self._buffers[view.get("buffer", 0)]
        base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride") or ncomp * size
        out = []
        for i in range(acc["count"]):
            off = base + i * stride
            out.append(struct.unpack_from(f"<{ncomp}{fmt}", data, off))
        return out


def node_matrix(node: dict) -> Gf.Matrix4d:
    if "matrix" in node:  # glTF stores column-major; Gf is row-major
        m = node["matrix"]
        return Gf.Matrix4d(*m).GetTranspose()
    mat = Gf.Matrix4d(1.0)
    if "scale" in node:
        mat = mat * Gf.Matrix4d().SetScale(Gf.Vec3d(*node["scale"]))
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        mat = mat * Gf.Matrix4d().SetRotate(Gf.Quatd(w, Gf.Vec3d(x, y, z)))
    if "translation" in node:
        mat = mat * Gf.Matrix4d().SetTranslate(Gf.Vec3d(*node["translation"]))
    return mat


def collect(gltf: Gltf) -> tuple[list, list, list, list, dict]:
    """Flatten the scene into merged points/normals/uvs/triangles + node origins."""
    doc = gltf.doc
    nodes = doc["nodes"]
    points: list[Gf.Vec3d] = []
    normals: list[Gf.Vec3f] = []
    uvs: list[Gf.Vec2f] = []
    indices: list[int] = []
    origins: dict[str, Gf.Vec3d] = {}

    def walk(idx: int, parent: Gf.Matrix4d) -> None:
        node = nodes[idx]
        world = node_matrix(node) * parent
        name = node.get("name", f"node{idx}")
        origins[name] = world.Transform(Gf.Vec3d(0, 0, 0))
        if "mesh" in node:
            normal_mat = world.GetInverse().GetTranspose()
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                attrs = prim["attributes"]
                pos = gltf.read(attrs["POSITION"])
                nrm = gltf.read(attrs["NORMAL"]) if "NORMAL" in attrs else None
                uv = gltf.read(attrs["TEXCOORD_0"]) if "TEXCOORD_0" in attrs else None
                first = len(points)
                for i, p in enumerate(pos):
                    points.append(world.Transform(Gf.Vec3d(*p)))
                    if nrm:
                        n = normal_mat.TransformDir(Gf.Vec3d(*nrm[i]))
                        n = n.GetNormalized() if n.GetLength() > 1e-9 else Gf.Vec3d(0, 1, 0)
                        normals.append(Gf.Vec3f(*n))
                    else:
                        normals.append(Gf.Vec3f(0, 1, 0))
                    # glTF UVs run top-down; USD expects bottom-up.
                    uvs.append(Gf.Vec2f(uv[i][0], 1.0 - uv[i][1]) if uv else Gf.Vec2f(0, 0))
                tri = [i[0] for i in gltf.read(prim["indices"])]
                indices.extend(first + i for i in tri)
        for child in node.get("children", []):
            walk(child, world)

    for root in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        walk(root, Gf.Matrix4d(1.0))
    return points, normals, uvs, indices, origins


def nose_angle(origins: dict[str, Gf.Vec3d]) -> float:
    """Heading of the rear->front axle vector in the horizontal XZ plane."""
    def centre(tag: str) -> Gf.Vec3d | None:
        picked = [
            v for k, v in origins.items() if "wheel" in k.lower() and tag in k.lower()
        ]
        if not picked:
            return None
        acc = Gf.Vec3d(0, 0, 0)
        for v in picked:
            acc += v
        return acc / len(picked)

    front = centre("front")
    rear = centre("rear") or centre("back")
    if front is None or rear is None:
        raise RuntimeError("no named front/rear wheel nodes to measure nose from")
    dx, dz = front[0] - rear[0], front[2] - rear[2]
    if math.hypot(dx, dz) < 1e-9:
        raise RuntimeError("front and rear axles coincide")
    return math.atan2(dz, dx)


def normalize(points: list[Gf.Vec3d], origins: dict, target_len: float) -> list[Gf.Vec3f]:
    """Nose to -X, footprint centred, tyres on y=0, scaled to `target_len`."""
    # Rotating about +Y by theta turns an XZ heading phi into phi - theta.
    theta = nose_angle(origins) - math.pi
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    rotated = [
        Gf.Vec3d(p[0] * cos_t + p[2] * sin_t, p[1], -p[0] * sin_t + p[2] * cos_t)
        for p in points
    ]

    mn = [min(p[i] for p in rotated) for i in range(3)]
    mx = [max(p[i] for p in rotated) for i in range(3)]
    length = mx[0] - mn[0]
    if length < 1e-9:
        raise RuntimeError("degenerate car length")
    scale = target_len / length
    cx, cz = (mn[0] + mx[0]) * 0.5, (mn[2] + mx[2]) * 0.5
    return [
        Gf.Vec3f(
            float((p[0] - cx) * scale),
            float((p[1] - mn[1]) * scale),
            float((p[2] - cz) * scale),
        )
        for p in rotated
    ]


def bind_atlas(stage: Usd.Stage, mesh: UsdGeom.Mesh, texture: str, roughness: float) -> None:
    mat = UsdShade.Material.Define(stage, "/Car/Looks/citybits")
    surface = UsdShade.Shader.Define(stage, "/Car/Looks/citybits/Surface")
    surface.CreateIdAttr("UsdPreviewSurface")
    surface.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(roughness)
    surface.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.0)

    reader = UsdShade.Shader.Define(stage, "/Car/Looks/citybits/stReader")
    reader.CreateIdAttr("UsdPrimvarReader_float2")
    reader.CreateInput("varname", Sdf.ValueTypeNames.Token).Set("st")

    tex = UsdShade.Shader.Define(stage, "/Car/Looks/citybits/Atlas")
    tex.CreateIdAttr("UsdUVTexture")
    tex.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(texture)
    tex.CreateInput("sourceColorSpace", Sdf.ValueTypeNames.Token).Set("sRGB")
    # Atlas UVs sit flush against their tile edges -- clamping stops bleed.
    tex.CreateInput("wrapS", Sdf.ValueTypeNames.Token).Set("clamp")
    tex.CreateInput("wrapT", Sdf.ValueTypeNames.Token).Set("clamp")
    tex.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(
        reader.ConnectableAPI(), "result"
    )
    tex.CreateOutput("rgb", Sdf.ValueTypeNames.Float3)
    surface.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(
        tex.ConnectableAPI(), "rgb"
    )
    mat.CreateSurfaceOutput().ConnectToSource(surface.ConnectableAPI(), "surface")
    UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(mat)


def export(gltf_path: Path) -> bool:
    name = gltf_path.stem
    gltf = Gltf(gltf_path)
    points, normals, uvs, indices, origins = collect(gltf)
    if not points or not indices:
        print(f"  {name}: no geometry")
        return False

    placed = normalize(points, origins, TARGET_LENGTH_M.get(name, DEFAULT_LENGTH_M))

    images = gltf.doc.get("images", [])
    if len(images) != 1:
        print(f"  {name}: expected one atlas image, found {len(images)}")
        return False
    atlas = images[0]["uri"]
    mat0 = (gltf.doc.get("materials") or [{}])[0]
    roughness = float(
        mat0.get("pbrMetallicRoughness", {}).get("roughnessFactor", 0.4)
    )

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "textures").mkdir(exist_ok=True)
    shutil.copyfile(gltf_path.parent / atlas, OUT / "textures" / atlas)

    out = OUT / f"{name}.usdc"
    if out.exists():
        out.unlink()
    stage = Usd.Stage.CreateNew(str(out))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    car = UsdGeom.Xform.Define(stage, "/Car")
    stage.SetDefaultPrim(car.GetPrim())

    mesh = UsdGeom.Mesh.Define(stage, "/Car/CarBody")
    mesh.CreatePointsAttr(placed)
    mesh.CreateFaceVertexIndicesAttr(indices)
    mesh.CreateFaceVertexCountsAttr([3] * (len(indices) // 3))
    mesh.CreateNormalsAttr(normals)
    mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
    # Low-poly art: keep the faceted silhouette, don't let renderers subdivide.
    mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
    mesh.CreateExtentAttr(UsdGeom.PointBased(mesh).ComputeExtent(placed))
    # RTX expects faceVarying st for these meshes; vertex UVs trigger
    # "corrupted primvar 'st'" and the shared atlas never samples, so every
    # car renders as the same untextured silhouette.
    face_uvs = [uvs[i] for i in indices]
    primvar = UsdGeom.PrimvarsAPI(mesh).CreatePrimvar(
        "st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.faceVarying
    )
    primvar.Set(face_uvs)

    bind_atlas(stage, mesh, f"./textures/{atlas}", roughness)
    stage.GetRootLayer().Save()

    mn = [min(p[i] for p in placed) for i in range(3)]
    mx = [max(p[i] for p in placed) for i in range(3)]
    print(
        f"  {name}: size=({mx[0] - mn[0]:.2f},{mx[1] - mn[1]:.2f},{mx[2] - mn[2]:.2f}) "
        f"ground_y={mn[1]:+.4f} tris={len(indices) // 3} verts={len(placed)} "
        f"→ {out.name}"
    )
    return True


def main() -> int:
    if not GLTF_DIR.is_dir():
        print(f"missing glTF source dir {GLTF_DIR}", file=sys.stderr)
        return 1
    cars = sorted(GLTF_DIR.glob("car_*.gltf"))
    if not cars:
        print(f"no car_*.gltf in {GLTF_DIR}", file=sys.stderr)
        return 1
    print(f"exporting {len(cars)} KayKit cars → {OUT}")
    ok = 0
    for path in cars:
        try:
            ok += bool(export(path))
        except Exception as exc:  # one bad model shouldn't stop the batch
            import traceback

            print(f"  FAIL {path.stem}: {exc}")
            traceback.print_exc()
    print(f"DONE {ok}/{len(cars)}")
    return 0 if ok == len(cars) else 1


if __name__ == "__main__":
    raise SystemExit(main())
