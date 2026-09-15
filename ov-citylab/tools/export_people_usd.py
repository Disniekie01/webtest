#!/usr/bin/env python3
"""Export low-poly pedestrian USDs for City Lab (mirrors assets/vehicles car pack).

Run:
  ../webtest/tools/blender-4.3.2-linux-x64/blender -b --python tools/export_people_usd.py
→ assets/people/{elderly,adult,rushed,tourist}.usdc  (defaultPrim=Person)
"""
from __future__ import annotations

from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "people"

# type → (height_m, torso_rgb, accent_rgb)
PEOPLE = {
    "elderly": (1.60, (0.45, 0.55, 0.75), (0.75, 0.72, 0.68)),
    "adult": (1.75, (0.20, 0.55, 0.70), (0.85, 0.70, 0.58)),
    "rushed": (1.80, (0.75, 0.25, 0.12), (0.80, 0.62, 0.50)),
    "tourist": (1.70, (0.85, 0.70, 0.15), (0.90, 0.75, 0.60)),
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes) + list(bpy.data.materials):
        bpy.data.batch_remove([block])


def mat(name: str, rgb: tuple[float, float, float]):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.65
    return m


def add_mesh(name: str, verts, faces, material, loc=(0, 0, 0), scale=(1, 1, 1)):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.scale = scale
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)
    return obj


def box_verts(sx, sy, sz):
    """Axis-aligned box centered at origin, size sx×sy×sz (Y-up after we use Z-up Blender → USD Y)."""
    hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
    # Blender Z-up; USD export uses Y-up — standing along +Z here.
    return [
        (-hx, -hy, -hz),
        (hx, -hy, -hz),
        (hx, hy, -hz),
        (-hx, hy, -hz),
        (-hx, -hy, hz),
        (hx, -hy, hz),
        (hx, hy, hz),
        (-hx, hy, hz),
    ]


FACES = [
    (0, 1, 2, 3),
    (4, 7, 6, 5),
    (0, 4, 5, 1),
    (1, 5, 6, 2),
    (2, 6, 7, 3),
    (3, 7, 4, 0),
]


def build_person(height: float, torso_rgb, skin_rgb) -> None:
    clear_scene()
    # Root empty becomes defaultPrim via collection rename after join
    clothes = mat("Clothes", torso_rgb)
    skin = mat("Skin", skin_rgb)

    # Proportions relative to height
    leg_h = height * 0.45
    torso_h = height * 0.32
    head_r = height * 0.08
    shoulder_w = height * 0.28
    depth = height * 0.16

    # Legs (two boxes)
    leg_w = shoulder_w * 0.28
    for side, x in (("L", -shoulder_w * 0.22), ("R", shoulder_w * 0.22)):
        add_mesh(
            f"Leg_{side}",
            box_verts(leg_w, depth * 0.7, leg_h),
            FACES,
            clothes,
            loc=(x, 0.0, leg_h * 0.5),
        )

    # Torso
    add_mesh(
        "Torso",
        box_verts(shoulder_w, depth, torso_h),
        FACES,
        clothes,
        loc=(0.0, 0.0, leg_h + torso_h * 0.5),
    )

    # Arms
    arm_h = torso_h * 0.95
    arm_w = leg_w * 0.75
    for side, x in (("L", -shoulder_w * 0.55), ("R", shoulder_w * 0.55)):
        add_mesh(
            f"Arm_{side}",
            box_verts(arm_w, depth * 0.55, arm_h),
            FACES,
            clothes,
            loc=(x, 0.0, leg_h + torso_h * 0.55),
        )

    # Head
    add_mesh(
        "Head",
        box_verts(head_r * 2.0, head_r * 2.0, head_r * 2.2),
        FACES,
        skin,
        loc=(0.0, 0.0, leg_h + torso_h + head_r * 1.1),
    )

    # Join into one mesh under an empty-named root via parenting to a new empty
    bpy.ops.object.select_all(action="SELECT")
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in objs:
        bpy.context.view_layer.objects.active = o
        break
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "Body"

    root = bpy.data.objects.new("Person", None)
    bpy.context.collection.objects.link(root)
    body.parent = root
    # Face +Y in Blender (forward); City Lab cars face +X after USD — match cars: nose +X.
    # Blender Y-forward → rotate -90° around Z so local +Y becomes +X in world before export.
    root.rotation_euler = (0.0, 0.0, -1.5707963)


def export_person(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    bpy.ops.wm.usd_export(
        filepath=str(path),
        export_materials=True,
        export_meshes=True,
        export_animation=False,
        root_prim_path="/Person",
        selected_objects_only=False,
        generate_preview_surface=True,
        convert_orientation=True,
        export_global_forward_selection="X",
        export_global_up_selection="Y",
    )
    print(f"wrote {path} ({path.stat().st_size} bytes)", flush=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (height, torso, skin) in PEOPLE.items():
        build_person(height, torso, skin)
        export_person(OUT / f"{name}.usdc")
    print("done people pack →", OUT, flush=True)


if __name__ == "__main__":
    main()
