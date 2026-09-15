"""Export 160 m no-car city by USD-exporting the GN object (no Realize — fast/stable)."""
from __future__ import annotations

from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "city"
OUT.mkdir(parents=True, exist_ok=True)
BLEND = OUT / "city_layout_preview.blend"
USD = OUT / "city_generator_large.usdc"

print("=== open", BLEND, flush=True)
bpy.ops.wm.open_mainfile(filepath=str(BLEND))

obj = bpy.data.objects["City_Generator_2.0_Object"]
scene_coll = bpy.context.scene.collection
if obj.name not in scene_coll.objects:
    try:
        scene_coll.objects.link(obj)
    except RuntimeError:
        pass

assets = bpy.data.collections.get("City_Gen_2.0_Assets")
if assets:
    assets.hide_viewport = True
    assets.hide_render = True

me = obj.data
xs = [v.co.x for v in me.vertices]
ys = [v.co.y for v in me.vertices]
span_x = max(xs) - min(xs)
span_y = max(ys) - min(ys)
print(f"layout faces={len(me.polygons)} span={span_x:.1f}x{span_y:.1f}", flush=True)

mod = obj.modifiers["City_Generator_2.0"]
mod["Socket_8"] = False
mod["Socket_142"] = True   # buildings
mod["Socket_143"] = True   # streets
mod["Socket_144"] = False  # NO cars
mod["Socket_64"] = False   # no street lights (lighter)
mod["Socket_165"] = False  # keep instances — USD exporter handles eval
mod["Socket_187"] = True
mod["Socket_188"] = True
try:
    mod["Socket_172"] = 0.15
except Exception:
    pass
obj.update_tag()

# Center object at origin for stage alignment
cx = 0.5 * (min(xs) + max(xs))
cy = 0.5 * (min(ys) + max(ys))
obj.location = (-cx, -cy, 0.0)

for o in bpy.data.objects:
    o.select_set(False)
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

print("=== USD export (instanced, no cars) ===", flush=True)
if USD.exists():
    USD.unlink()
bpy.ops.wm.usd_export(
    filepath=str(USD),
    selected_objects_only=True,
    export_materials=True,
    export_textures=True,
    overwrite_textures=True,
    relative_paths=True,
    root_prim_path="/World/City",
    convert_orientation=True,
    export_global_forward_selection="NEGATIVE_Z",
    export_global_up_selection="Y",
)

span = max(span_x, span_y)
(OUT / "city_bounds.txt").write_text(
    f"dims_xy={span_x:.3f},{span_y:.3f}\n"
    f"span_m={span:.3f}\n"
    f"source={BLEND.name}\n"
    f"traffic_baked=0\n"
    f"realize=0\n"
)
print("wrote", USD, "MB", round(USD.stat().st_size / 1e6, 1) if USD.exists() else 0, flush=True)
print("DONE", flush=True)
