"""Export web Draco GLB from the same Isaac City Generator layout blend (160 m).

Opens city_layout_preview.blend (canonical for city_generator_large.usdc),
realizes + decimates for the browser, centers like the USD export.
"""
from __future__ import annotations

from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUT_CITY = ROOT / "assets" / "city"
BLEND = OUT_CITY / "city_layout_preview.blend"
WEB_OUT = ROOT.parent / "public" / "models" / "citygen"
WEB_OUT.mkdir(parents=True, exist_ok=True)
GLB = WEB_OUT / "city_generator_large.glb"
TARGET_TRIS = 280_000


def _set_socket(mod, key: str, value) -> None:
    """GN socket writes differ across Blender 4/5 — try a few APIs."""
    try:
        mod[key] = value
        return
    except Exception:
        pass
    try:
        # Blender 4.2+ identifier form
        for item in getattr(mod.node_group.interface, "items_tree", []) or []:
            ident = getattr(item, "identifier", None)
            name = getattr(item, "name", None)
            if ident == key or name == key or (ident and key in ident):
                mod[ident] = value
                return
    except Exception:
        pass
    print(f"warn: could not set {key}={value}", flush=True)


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
print("mod keys sample:", list(mod.keys())[:20], flush=True)

# Match export_city_usd.py intent (layout blend already configured — force realize)
_set_socket(mod, "Socket_144", False)  # NO cars
_set_socket(mod, "Socket_165", True)   # Realize for glTF
_set_socket(mod, "Socket_64", False)

# Center like USD export
cx = 0.5 * (min(xs) + max(xs))
cy = 0.5 * (min(ys) + max(ys))
obj.location = (-cx, -cy, 0.0)
obj.update_tag()

for o in bpy.data.objects:
    o.select_set(False)
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

print("=== evaluate / convert ===", flush=True)
depsgraph = bpy.context.evaluated_depsgraph_get()
eval_obj = obj.evaluated_get(depsgraph)
mesh = eval_obj.to_mesh()
print(
    f"eval verts={len(mesh.vertices)} polys={len(mesh.polygons)} "
    f"dims={tuple(round(x, 2) for x in eval_obj.dimensions)}",
    flush=True,
)
eval_obj.to_mesh_clear()

if len(mesh.vertices) == 0:
    raise SystemExit("evaluated mesh empty — City Generator did not realize")

bpy.ops.object.convert(target="MESH")
city = bpy.context.view_layer.objects.active

print("=== decimate ===", flush=True)
npoly = max(len(city.data.polygons), 1)
if npoly > TARGET_TRIS:
    dec = city.modifiers.new(name="WebDecimate", type="DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = max(0.02, min(1.0, TARGET_TRIS / npoly))
    print(f"decimate ratio={dec.ratio:.4f}", flush=True)
    bpy.ops.object.modifier_apply(modifier="WebDecimate")
print(f"after verts={len(city.data.vertices)} polys={len(city.data.polygons)}", flush=True)

bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
city.location = (0.0, 0.0, 0.0)
min_z = min(v.co.z for v in city.data.vertices)
for v in city.data.vertices:
    v.co.z -= min_z
city.data.update()

xs2 = [v.co.x for v in city.data.vertices]
ys2 = [v.co.y for v in city.data.vertices]
span_x2 = max(xs2) - min(xs2)
span_y2 = max(ys2) - min(ys2)
print(f"final span_xy={span_x2:.1f}x{span_y2:.1f}", flush=True)

for o in bpy.data.objects:
    o.select_set(o == city)
bpy.context.view_layer.objects.active = city

print("=== glTF Draco ===", flush=True)
if GLB.exists():
    GLB.unlink()
bpy.ops.export_scene.gltf(
    filepath=str(GLB),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
)

(WEB_OUT / "city_generator_large_bounds.txt").write_text(
    f"dims_xy={span_x2:.3f},{span_y2:.3f}\n"
    f"span_m={max(span_x2, span_y2):.3f}\n"
    f"source={BLEND.name}\n"
    f"tris={len(city.data.polygons)}\n"
    f"parity=isaac_layout\n"
)
print("wrote", GLB, "MB", round(GLB.stat().st_size / 1e6, 1), flush=True)
print("DONE", flush=True)
