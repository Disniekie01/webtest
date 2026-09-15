"""Headless City Generator 2.4 → web-friendly GLB (Blender 4.3+)."""
from __future__ import annotations

from pathlib import Path

import bpy
import bmesh

ROOT = Path(__file__).resolve().parent
ADDON = ROOT / "city-generator-vfxmed" / "The_City_Generator_2.4"
BLEND = ADDON / "City_Generator2.0.blend"
OUT = ROOT.parent / "public" / "models" / "citygen"
OUT.mkdir(parents=True, exist_ok=True)
GLB = OUT / "city_generator_v24.glb"

print("=== open blend ===")
bpy.ops.wm.open_mainfile(filepath=str(BLEND))

obj = bpy.data.objects["City_Generator_2.0_Object"]

# Break self-collection dependency cycle
scene_coll = bpy.context.scene.collection
cg = bpy.data.collections.get("City_Gen_2.0")
if cg and obj.name in cg.objects:
    cg.objects.unlink(obj)
if obj.name not in scene_coll.objects:
    scene_coll.objects.link(obj)

assets = bpy.data.collections.get("City_Gen_2.0_Assets")
if assets:
    assets.hide_viewport = True
    assets.hide_render = True

# Shrink base plane so fewer blocks generate
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bm = bmesh.new()
bm.from_mesh(obj.data)
# Plane is ~72 units; shrink to ~28 for a compact district
bmesh.ops.scale(bm, vec=(0.38, 0.38, 0.38), verts=bm.verts)
bm.to_mesh(obj.data)
bm.free()
obj.data.update()

mod_nodes = obj.modifiers["City_Generator_2.0"]
mod_nodes["Socket_144"] = False  # Traffic
mod_nodes["Socket_142"] = True
mod_nodes["Socket_143"] = True
mod_nodes["Socket_165"] = True  # Realize
mod_nodes["Socket_187"] = True
mod_nodes["Socket_188"] = True
mod_nodes["Socket_112"] = 3
mod_nodes["Socket_113"] = 9
mod_nodes["Socket_21"] = 42
mod_nodes["Socket_114"] = 11
# Fewer sidewalk / tree props
mod_nodes["Socket_72"] = 0.15
mod_nodes["Socket_129"] = 0.1  # fire escapes
mod_nodes["Socket_132"] = 0.1  # flags
mod_nodes["Socket_172"] = 0.35  # tree density
mod_nodes["Socket_64"] = False  # street lights off (web)
obj.scale = (1.0, 1.0, 1.0)
obj.update_tag()

for o in bpy.data.objects:
    o.select_set(o == obj)
bpy.context.view_layer.objects.active = obj

print("=== evaluate ===")
depsgraph = bpy.context.evaluated_depsgraph_get()
eval_obj = obj.evaluated_get(depsgraph)
mesh = eval_obj.to_mesh()
print(f"eval verts={len(mesh.vertices)} polys={len(mesh.polygons)} dims={tuple(round(x,2) for x in eval_obj.dimensions)}")
eval_obj.to_mesh_clear()

print("=== convert ===")
bpy.ops.object.convert(target="MESH")
city = bpy.context.view_layer.objects.active

print("=== decimate ===")
dec = city.modifiers.new(name="WebDecimate", type="DECIMATE")
dec.decimate_type = "COLLAPSE"
# Aim ~250k–400k tris for browser
ratio = min(1.0, 350_000 / max(len(city.data.polygons), 1))
dec.ratio = max(0.04, ratio)
print(f"decimate ratio={dec.ratio:.4f}")
bpy.ops.object.modifier_apply(modifier="WebDecimate")
print(f"after verts={len(city.data.vertices)} polys={len(city.data.polygons)}")

bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
city.location = (0.0, 0.0, 0.0)
# Lift so sidewalk ≈ y=0 after Y-up export (Blender Z-up → glTF Y-up)
# After Y-up: Blender Z becomes glTF Y. Keep ground at z≈0 in Blender.
min_z = min(v.co.z for v in city.data.vertices)
for v in city.data.vertices:
    v.co.z -= min_z
city.data.update()

for o in bpy.data.objects:
    o.select_set(o == city)

print("=== export (Draco + JPEG) ===")
bpy.ops.export_scene.gltf(
    filepath=str(GLB),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=75,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
)

print("wrote", GLB, "MB", round(GLB.stat().st_size / 1e6, 1))
print("DONE")
