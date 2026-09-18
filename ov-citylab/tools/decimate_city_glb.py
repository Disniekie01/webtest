"""Decimate city_generator_large.glb for web (~280k tris)."""
from __future__ import annotations

from pathlib import Path

import bpy

WEB = Path("/media/disniekie/Working4/NEWCARLA/webtest/public/models/citygen")
SRC = WEB / "city_generator_large.glb"
TMP = WEB / "city_generator_large_hi.glb"
TARGET = 280_000

if not TMP.exists() and SRC.exists():
    SRC.rename(TMP)
if not TMP.exists():
    raise SystemExit(f"missing {TMP}")

print("=== using hi-res", TMP, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
print("=== import", TMP, flush=True)
bpy.ops.import_scene.gltf(filepath=str(TMP))
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print(f"meshes={len(meshes)}", flush=True)
for o in bpy.data.objects:
    o.select_set(False)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
city = bpy.context.view_layer.objects.active
n = max(len(city.data.polygons), 1)
print(f"polys={n}", flush=True)
if n > TARGET:
    dec = city.modifiers.new(name="WebDecimate", type="DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = max(0.02, TARGET / n)
    print(f"ratio={dec.ratio:.4f}", flush=True)
    bpy.ops.object.modifier_apply(modifier="WebDecimate")
print(f"after={len(city.data.polygons)}", flush=True)

for o in bpy.data.objects:
    o.select_set(o == city)
bpy.context.view_layer.objects.active = city
print("=== export ===", flush=True)
bpy.ops.export_scene.gltf(
    filepath=str(SRC),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_draco_mesh_compression_enable=False,
)
print("wrote", SRC, "MB", round(SRC.stat().st_size / 1e6, 1), flush=True)
print("DONE", flush=True)
