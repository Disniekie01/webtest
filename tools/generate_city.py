"""Headless Procgen Maps city → GLB for City Lab."""
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent
ADDON = ROOT / "bene-proggen-maps"
OUT = ROOT.parent / "public" / "models" / "procgen"
OUT.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(ADDON))

import procgen_maps

procgen_maps.register()

scene = bpy.context.scene
# Smallest preset for web-friendly size
scene.procgen_maps.preset = "DORF"
scene.procgen_maps.seed = 42

print("=== generating terrain ===")
bpy.ops.procgen_maps.generate_terrain()
print("=== generating city ===")
bpy.ops.procgen_maps.generate_city()

# Night glow for dusk City Lab look if property exists
pg = scene.procgen_maps
if hasattr(pg, "night_mode"):
    pg.night_mode = True
    if hasattr(bpy.ops.procgen_maps, "toggle_night_mode"):
        try:
            bpy.ops.procgen_maps.toggle_night_mode()
        except Exception as e:
            print("night toggle skipped:", e)

export_dir = str(OUT) + "/"
if hasattr(pg, "export_directory"):
    pg.export_directory = export_dir

print("=== export glTF ===")
# Prefer addon exporter; fall back to built-in
try:
    bpy.ops.procgen_maps.export_gltf()
    print("addon export_gltf OK")
except Exception as e:
    print("addon export failed, using bpy export_scene.gltf:", e)
    glb = OUT / "city_dorf_seed42.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
    )
    print("wrote", glb)

# Also write blend for iteration
blend = OUT / "city_dorf_seed42.blend"
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
print("wrote", blend)

# Stats
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
verts = sum(len(o.data.vertices) for o in meshes)
print(f"objects={len(bpy.data.objects)} meshes={len(meshes)} verts≈{verts}")

procgen_maps.unregister()
print("DONE")
