#!/usr/bin/env python3
"""Export Quaternius Walk as UsdSkel clips for budgeted near-camera animation.

Static poses still come from export_quaternius_people.py.
This only writes {slug}_walk_skel.usdc (armature + Walk, ~1.75 m).

Run:
  ../webtest/tools/blender-4.2.9-linux-x64/blender -b --python tools/export_quaternius_skel.py
"""
from __future__ import annotations

import sys
from math import radians
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
FBX_DIR = ROOT / "assets" / "people" / "quaternius" / "fbx"
OUT = ROOT / "assets" / "people"
TARGET_HEIGHT_M = 1.75
FPS = 24.0
CLIP_FRAMES = (1, 26)

# Keep skel set small — twin only animates a budget near the camera.
VARIANTS = [
    "Male_Casual",
    "Male_Shirt",
    "Male_Suit",
    "Female_Casual",
    "Female_TankTop",
    "Female_Dress",
]


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def find_walk():
    for a in bpy.data.actions:
        n = a.name
        if n.endswith("|Man_Walk") or n.endswith("|Female_Walk") or n.endswith("|Woman_Walk"):
            return a
        if n.endswith("_Walk") and "Running" not in n:
            return a
    return None


def world_mesh_bounds():
    pts = []
    deps = bpy.context.evaluated_depsgraph_get()
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(deps)
        if ev.type != "MESH" or ev.data is None:
            continue
        for c in ev.bound_box:
            pts.append(ev.matrix_world @ Vector(c))
    if not pts:
        return None
    mn = Vector((min(p[i] for p in pts) for i in range(3)))
    mx = Vector((max(p[i] for p in pts) for i in range(3)))
    return mn, mx


def keep_walk(arm):
    walk = find_walk()
    if walk is None:
        raise RuntimeError("no Walk")
    keep = walk.name
    for a in list(bpy.data.actions):
        if a.name != keep:
            bpy.data.actions.remove(a)
    walk = bpy.data.actions.get(keep)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = walk
    fr0, fr1 = CLIP_FRAMES
    sc = bpy.context.scene
    sc.render.fps = int(FPS)
    sc.frame_start = fr0
    sc.frame_end = fr1
    sc.frame_set(fr0)
    print(f"  walk={walk.name} frames={fr0}-{fr1}")
    return fr0, fr1


def normalize_armature(arm) -> None:
    bpy.context.view_layer.update()
    bb = world_mesh_bounds()
    if not bb:
        raise RuntimeError("no bounds")
    mn, mx = bb
    height = max((mx - mn).z, 1e-6)
    s = TARGET_HEIGHT_M / height
    arm.scale = (arm.scale.x * s, arm.scale.y * s, arm.scale.z * s)
    bpy.context.view_layer.update()
    arm.rotation_euler[2] += radians(90)
    bpy.context.view_layer.update()
    bb = world_mesh_bounds()
    mn, mx = bb
    arm.location.x -= 0.5 * (mn.x + mx.x)
    arm.location.y -= 0.5 * (mn.y + mx.y)
    arm.location.z -= mn.z
    bpy.context.view_layer.update()
    bb = world_mesh_bounds()
    mn, mx = bb
    print(f"  scale={s:.3f} h={(mx.z - mn.z):.2f}")


def export_one(stem: str) -> Path | None:
    fbx = FBX_DIR / f"{stem}.fbx"
    if not fbx.is_file():
        print("MISSING", fbx)
        return None
    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(fbx), automatic_bone_orientation=True, use_anim=True)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        print("FAIL armature", stem)
        return None
    arm = arms[0]
    fr0, fr1 = keep_walk(arm)
    normalize_armature(arm)
    root = bpy.data.objects.new("Person", None)
    bpy.context.collection.objects.link(root)
    mw = arm.matrix_world.copy()
    arm.parent = root
    arm.matrix_world = mw
    out = OUT / f"{stem.lower()}_walk_skel.usdc"
    if out.exists():
        out.unlink()
    bpy.context.scene.frame_start = fr0
    bpy.context.scene.frame_end = fr1
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.wm.usd_export(
        filepath=str(out),
        selected_objects_only=False,
        export_materials=True,
        export_textures=True,
        export_animation=True,
        export_armatures=True,
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
    print(f"  wrote {out} ({out.stat().st_size})")
    return out


def main() -> int:
    if not FBX_DIR.is_dir():
        print("missing", FBX_DIR, file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for stem in VARIANTS:
        try:
            if export_one(stem):
                n += 1
        except Exception as exc:
            import traceback

            print("FAIL", stem, exc)
            traceback.print_exc()
    (OUT / "ped_timeline.json").write_text(
        f'{{"frames":[{CLIP_FRAMES[0]},{CLIP_FRAMES[1]}],"fps":{FPS}}}\n',
        encoding="utf-8",
    )
    print("DONE", n, "skel walk clips")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
