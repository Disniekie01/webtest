#!/usr/bin/env python3
"""Bake Quaternius Walk/Idle mid-poses to static (no skel) pedestrian USDs.

Skinned timeline playback was too heavy for the twin — these are flat meshes
like the car pack. SUMO still moves roots; pose swaps on speed.

Run (from ov-citylab):
  ../webtest/tools/blender-4.2.9-linux-x64/blender -b --python tools/export_quaternius_people.py
"""
from __future__ import annotations

import sys
from math import radians
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
FBX_DIR = ROOT / "assets" / "people" / "quaternius" / "fbx"
OUT = ROOT / "assets" / "people"
TARGET_HEIGHT_M = 1.75

VARIANTS = [
    "Male_Casual",
    "Male_Shirt",
    "Male_LongSleeve",
    "Male_Suit",
    "Female_Casual",
    "Female_TankTop",
    "Female_Alternative",
    "Female_Dress",
]

TYPE_ALIAS = {
    "elderly": "Male_Suit",
    "adult": "Male_Casual",
    "rushed": "Female_TankTop",
    "tourist": "Female_Casual",
}

CLIPS = (
    ("walk", ("Man_Walk", "Female_Walk", "Woman_Walk", "_Walk")),
    ("idle", ("Man_Idle", "Female_Idle", "Woman_Idle", "_Idle")),
)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def find_action(suffixes: tuple[str, ...]):
    for a in bpy.data.actions:
        n = a.name
        for s in suffixes:
            if n.endswith("|" + s.lstrip("_")) or n.endswith(s):
                if s == "_Walk" and "Running" in n:
                    continue
                return a
    return None


def apply_midpose(arm, action) -> int:
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    fr0, fr1 = int(action.frame_range[0]), int(action.frame_range[1])
    mid = int((fr0 + fr1) * 0.5)
    bpy.context.scene.frame_set(mid)
    print(f"  pose={action.name} frame={mid}")
    return mid


def bake_mesh(arm) -> bpy.types.Object | None:
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    for mesh in list(meshes):
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        for mod in list(mesh.modifiers):
            if mod.type == "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        if mesh.name in bpy.data.objects:
            mesh.select_set(True)
    live = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if not live:
        return None
    bpy.context.view_layer.objects.active = live[0]
    if len(live) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "Body"
    if arm and arm.name in bpy.data.objects:
        bpy.data.objects.remove(arm, do_unlink=True)
    # Drop leftover armatures / empties
    for o in list(bpy.data.objects):
        if o != body and o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    return body


def normalize_person(body: bpy.types.Object) -> None:
    import bmesh

    if body.data.shape_keys:
        bpy.ops.object.select_all(action="DESELECT")
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.shape_key_remove(all=True)
    if body.animation_data:
        body.animation_data_clear()

    mw = body.matrix_world.copy()
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(mw)
    body.matrix_world = Matrix.Identity(4)

    coords = [v.co.copy() for v in bm.verts]
    mn = Vector((min(c[i] for c in coords) for i in range(3)))
    mx = Vector((max(c[i] for c in coords) for i in range(3)))
    height = max((mx - mn).x, (mx - mn).y, (mx - mn).z, 1e-6)
    s = TARGET_HEIGHT_M / height
    for v in bm.verts:
        v.co *= s

    coords = [v.co.copy() for v in bm.verts]
    mn = Vector((min(c[i] for c in coords) for i in range(3)))
    mx = Vector((max(c[i] for c in coords) for i in range(3)))
    cent = (mn + mx) * 0.5
    rot = Euler((0, 0, radians(90))).to_matrix()
    for v in bm.verts:
        v.co = cent + rot @ (v.co - cent)

    coords = [v.co.copy() for v in bm.verts]
    mn = Vector((min(c[i] for c in coords) for i in range(3)))
    mx = Vector((max(c[i] for c in coords) for i in range(3)))
    center = Vector(((mn.x + mx.x) * 0.5, (mn.y + mx.y) * 0.5, mn.z))
    for v in bm.verts:
        v.co -= center

    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    body.scale = (1, 1, 1)
    body.location = (0, 0, 0)
    body.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    d = body.dimensions
    print(f"  static dims m=({d.x:.2f},{d.y:.2f},{d.z:.2f})")


def export_usd(body: bpy.types.Object, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    root = bpy.data.objects.new("Person", None)
    bpy.context.collection.objects.link(root)
    body.parent = root
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.wm.usd_export(
        filepath=str(path),
        selected_objects_only=True,
        export_materials=True,
        export_textures=True,
        export_animation=False,
        export_armatures=False,
        export_meshes=True,
        export_shapekeys=False,
        root_prim_path="/Person",
        generate_preview_surface=True,
        convert_orientation=True,
        export_global_forward_selection="X",
        export_global_up_selection="Y",
        export_custom_properties=False,
        author_blender_name=False,
    )
    print(f"  wrote {path} ({path.stat().st_size} bytes)")


def export_clip(stem: str, clip_name: str, suffixes: tuple[str, ...]) -> Path | None:
    fbx = FBX_DIR / f"{stem}.fbx"
    if not fbx.is_file():
        print("MISSING", fbx)
        return None
    clear_scene()
    bpy.ops.import_scene.fbx(
        filepath=str(fbx),
        automatic_bone_orientation=True,
        use_anim=True,
    )
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        print("FAIL no armature", stem)
        return None
    arm = arms[0]
    action = find_action(suffixes)
    if action is None:
        print("FAIL no action", stem, clip_name)
        return None
    apply_midpose(arm, action)
    body = bake_mesh(arm)
    if body is None:
        print("FAIL bake", stem, clip_name)
        return None
    normalize_person(body)
    out = OUT / f"{stem.lower()}_{clip_name}.usdc"
    export_usd(body, out)
    return out


def main() -> int:
    if not FBX_DIR.is_dir():
        print("missing FBX dir", FBX_DIR, file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    written: dict[tuple[str, str], Path] = {}
    for stem in VARIANTS:
        for clip_name, suffixes in CLIPS:
            try:
                path = export_clip(stem, clip_name, suffixes)
                if path:
                    written[(stem, clip_name)] = path
            except Exception as exc:
                import traceback

                print("FAIL", stem, clip_name, exc)
                traceback.print_exc()

    for alias, stem in TYPE_ALIAS.items():
        for clip_name, _ in CLIPS:
            src = written.get((stem, clip_name))
            if not src:
                continue
            dst = OUT / f"{alias}_{clip_name}.usdc"
            dst.write_bytes(src.read_bytes())
            print(f"alias {dst.name} ← {stem}_{clip_name}")

    print("DONE", len(written), "static poses →", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
