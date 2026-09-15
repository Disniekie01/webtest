#!/usr/bin/env python3
"""Export Generic_passenger_car_pack as flat origin-centered USDs (no Sketchfab hierarchy)."""
from __future__ import annotations

import sys
from math import radians
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Vector

ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "assets" / "vehicles" / "generic_pack" / "scene.usdc"
OUT = ROOT / "assets" / "vehicles"

BODIES = [
    "Compact_Body",
    "Coupe_Body",
    "Hatchback_Body",
    "Offroad_Body",
    "Pickup_Body",
    "SUV_Body",
    "Sedan_Body",
    "Sport_body",
    "Wagon_Body",
    "minivan_body",
]

PAINTS = {
    "Compact_Body": (0.82, 0.14, 0.12, 1),
    "Coupe_Body": (0.12, 0.32, 0.78, 1),
    "Hatchback_Body": (0.92, 0.92, 0.90, 1),
    "Offroad_Body": (0.25, 0.45, 0.22, 1),
    "Pickup_Body": (0.55, 0.55, 0.20, 1),
    "SUV_Body": (0.10, 0.10, 0.12, 1),
    "Sedan_Body": (0.70, 0.70, 0.72, 1),
    "Sport_body": (0.90, 0.45, 0.08, 1),
    "Wagon_Body": (0.45, 0.18, 0.55, 1),
    "minivan_body": (0.15, 0.55, 0.65, 1),
}


def world_bbox(objs):
    pts = []
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    if not pts:
        return None
    mn = Vector((min(p[i] for p in pts) for i in range(3)))
    mx = Vector((max(p[i] for p in pts) for i in range(3)))
    return mn, mx


def make_paint(name: str, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.4
        bsdf.inputs["Metallic"].default_value = 0.25
    return mat


def bake_world_to_mesh(obj: bpy.types.Object) -> None:
    """Write world-space verts into mesh local space; clear object xform."""
    mw = obj.matrix_world.copy()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(mw)
    # cm → m
    bmesh.ops.scale(bm, vec=(0.01, 0.01, 0.01), verts=bm.verts)
    bm.to_mesh(obj.data)
    bm.free()
    obj.matrix_world = Matrix_identity()
    obj.data.update()


def Matrix_identity():
    from mathutils import Matrix

    return Matrix.Identity(4)


def center_ground(obj: bpy.types.Object) -> None:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    coords = [v.co.copy() for v in bm.verts]
    mn = Vector((min(c[i] for c in coords) for i in range(3)))
    mx = Vector((max(c[i] for c in coords) for i in range(3)))
    size = mx - mn
    cent = (mn + mx) * 0.5
    if size.y >= size.x:
        bmesh.ops.rotate(
            bm,
            cent=cent,
            matrix=Euler((0, 0, radians(90))).to_matrix(),
            verts=bm.verts,
        )
        coords = [v.co.copy() for v in bm.verts]
        mn = Vector((min(c[i] for c in coords) for i in range(3)))
        mx = Vector((max(c[i] for c in coords) for i in range(3)))
        cent = (mn + mx) * 0.5
    bmesh.ops.rotate(
        bm,
        cent=cent,
        matrix=Euler((0, 0, radians(180))).to_matrix(),
        verts=bm.verts,
    )
    coords = [v.co.copy() for v in bm.verts]
    mn = Vector((min(c[i] for c in coords) for i in range(3)))
    mx = Vector((max(c[i] for c in coords) for i in range(3)))
    center = Vector(((mn.x + mx.x) * 0.5, (mn.y + mx.y) * 0.5, mn.z))
    for v in bm.verts:
        v.co -= center
    # Normalize length to ~4.5 m (pack units are inconsistent after bake)
    coords = [v.co.copy() for v in bm.verts]
    mn = Vector((min(c[i] for c in coords) for i in range(3)))
    mx = Vector((max(c[i] for c in coords) for i in range(3)))
    length = max(mx.x - mn.x, mx.y - mn.y)
    if length > 1e-6:
        s = 4.5 / length
        bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts)
        coords = [v.co.copy() for v in bm.verts]
        mn = Vector((min(c[i] for c in coords) for i in range(3)))
        for v in bm.verts:
            v.co.z -= mn.z
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def export_variant(body_name: str) -> None:
    body = bpy.data.objects.get(body_name)
    if body is None:
        print("MISSING", body_name)
        return
    sc = bpy.context.scene.collection
    body_meshes = [m for m in body.children_recursive if m.type == "MESH"]
    bb = world_bbox(body_meshes)
    if not bb:
        print("NOMESH", body_name)
        return
    bmn, bmx = bb
    pad = Vector((40, 40, 40))
    # Prefer wheels parented under this body. Global Wheel_* search grabs a shared
    # hub mesh and joins it at the wrong place → cars look perched on a wheel.
    wheels = [
        m
        for m in body.children_recursive
        if m.type == "MESH" and m.name.lower().startswith("wheel")
    ]
    if not wheels:
        wheel_cands = []
        for o in bpy.data.objects:
            if not o.name.startswith("Wheel_") or o.type != "MESH":
                continue
            if o.name in {m.name for m in body_meshes}:
                continue
            wbb = world_bbox([o])
            if not wbb:
                continue
            wmn, wmx = wbb
            wc = (wmn + wmx) * 0.5
            bcenter = (bmn + bmx) * 0.5
            if (wc - bcenter).length > 80:
                continue
            if (
                bmn.x - pad.x <= wc.x <= bmx.x + pad.x
                and bmn.y - pad.y <= wc.y <= bmx.y + pad.y
            ):
                dist = (Vector((wc.x, wc.y)) - Vector((bcenter.x, bcenter.y))).length
                wheel_cands.append((dist, o))
        wheel_cands.sort(key=lambda t: t[0])
        wheels = [o for _, o in wheel_cands[:4]]
    # Body mesh already includes wheel GeomSubsets in this pack — don't double-add
    # shared Wheel_* objects unless we found none under the body.
    parts = body_meshes if body_meshes else wheels
    if wheels and not any("wheel" in m.name.lower() for m in body_meshes):
        parts = body_meshes + wheels
    print(f"{body_name}: body={len(body_meshes)} wheels={len(wheels)} parts={len(parts)}")

    # Duplicate + join in world space
    bpy.ops.object.select_all(action="DESELECT")
    temps = []
    for o in parts:
        dup = o.copy()
        dup.data = o.data.copy()
        dup.matrix_world = o.matrix_world.copy()
        sc.objects.link(dup)
        # break parent so join uses matrix_world
        dup.parent = None
        temps.append(dup)
        dup.select_set(True)
    bpy.context.view_layer.objects.active = temps[0]
    if len(temps) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    bake_world_to_mesh(joined)
    center_ground(joined)

    # Brand-new clean object (strips Sketchfab customData / hierarchy names)
    clean_mesh = joined.data.copy()
    clean_mesh.name = "CarBody"
    for key in list(clean_mesh.keys()):
        del clean_mesh[key]
    paint = make_paint(f"paint_{body_name}", PAINTS[body_name])
    clean_mesh.materials.clear()
    clean_mesh.materials.append(paint)
    clean = bpy.data.objects.new("CarBody", clean_mesh)
    for key in list(clean.keys()):
        del clean[key]
    sc.objects.link(clean)
    # drop the joined temp (keep mesh datablock we copied)
    mesh_to_remove = joined.data
    bpy.data.objects.remove(joined, do_unlink=True)
    if mesh_to_remove.users == 0:
        bpy.data.meshes.remove(mesh_to_remove)

    d = clean.dimensions
    print(f"  dims m=({d.x:.2f},{d.y:.2f},{d.z:.2f}) parent={clean.parent}")

    slug = body_name.lower().replace("_body", "").replace("body", "").strip("_")
    out = OUT / f"generic_{slug}.usdc"
    bpy.ops.object.select_all(action="DESELECT")
    clean.select_set(True)
    bpy.context.view_layer.objects.active = clean
    bpy.ops.wm.usd_export(
        filepath=str(out),
        selected_objects_only=True,
        export_materials=True,
        export_textures=False,
        export_lights=False,
        export_cameras=False,
        convert_world_material=False,
        export_custom_properties=False,
        author_blender_name=False,
        root_prim_path="/Car",
        convert_orientation=True,
        export_global_forward_selection="NEGATIVE_Z",
        export_global_up_selection="Y",
        generate_preview_surface=True,
    )
    print("  wrote", out, out.stat().st_size)
    bpy.data.objects.remove(clean, do_unlink=True)
    if clean_mesh.users == 0:
        bpy.data.meshes.remove(clean_mesh)


def main() -> int:
    if not SCENE.is_file():
        print("missing", SCENE, file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.usd_import(filepath=str(SCENE))
    for b in BODIES:
        try:
            export_variant(b)
        except Exception as exc:
            import traceback

            print("FAIL", b, exc)
            traceback.print_exc()
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
