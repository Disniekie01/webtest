"""Generate a fresh multi-block city in Blender GUI for visual check.

Guide: keep the stock plane (UVs/attrs), subdivide for blocks, then SCALE
the faces so parcels are large enough for streets + buildings.
"""
from __future__ import annotations

import pathlib

import bpy

OUT_BLEND = str(
    pathlib.Path(__file__).resolve().parent.parent
    / "assets/city/city_layout_preview.blend"
)
SUBDIV_CUTS = 3          # 1 face → 4×4 faces
TARGET_SPAN_M = 160.0    # scale faces out (user fix)
STREET_WIDTH = 8.0
SIDEWALK_SCALE = 4.0


obj = bpy.data.objects["City_Generator_2.0_Object"]
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

# Subdivide original plane (preserves UV / attributes)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.subdivide(number_cuts=SUBDIV_CUTS)
bpy.ops.object.mode_set(mode="OBJECT")

# Scale faces in XY to target span (the fix you found)
me = obj.data
xs = [v.co.x for v in me.vertices]
ys = [v.co.y for v in me.vertices]
cur = max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
s = TARGET_SPAN_M / cur
for v in me.vertices:
    v.co.x *= s
    v.co.y *= s
me.update()

print(
    f"layout faces={len(me.polygons)} span≈{TARGET_SPAN_M:.0f}m "
    f"(scale={s:.3f})"
)

mod = obj.modifiers["City_Generator_2.0"]
mod["Socket_8"] = False   # full city
mod["Socket_142"] = True  # buildings
mod["Socket_143"] = True  # streets
mod["Socket_144"] = False # traffic off
mod["Socket_165"] = False # keep instances (viewport-safe)
mod["Socket_187"] = True
mod["Socket_188"] = True
mod["Socket_9"] = STREET_WIDTH
mod["Socket_12"] = 2
mod["Socket_16"] = SIDEWALK_SCALE
mod["Socket_21"] = 17
mod["Socket_112"] = 5
mod["Socket_113"] = 22
mod["Socket_114"] = 23
mod["Socket_64"] = True
mod["Socket_172"] = 0.35
obj.update_tag()

deps = bpy.context.evaluated_depsgraph_get()
ev = obj.evaluated_get(deps)
print(f"evaluated dims={tuple(round(x, 2) for x in ev.dimensions)}")

for area in bpy.context.screen.areas:
    if area.type != "VIEW_3D":
        continue
    for space in area.spaces:
        if space.type == "VIEW_3D":
            space.shading.type = "MATERIAL"
            space.clip_end = 8000.0
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(area=area, region=region):
        bpy.ops.view3d.view_all(center=False)
    break

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print("saved", OUT_BLEND)
print("=== new city ready in Blender — tweak if needed, then tell us to export ===")
