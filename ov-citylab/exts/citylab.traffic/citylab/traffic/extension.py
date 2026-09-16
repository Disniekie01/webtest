"""City Lab traffic: open city USD (if needed) and drive SUMO actors in Kit."""
from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import zlib
from pathlib import Path

import carb
import omni.ext
import omni.kit.app
import omni.kit.commands
import omni.usd
from pxr import Gf, Sdf, Usd, UsdGeom, UsdLux, UsdShade

from . import stream_control
from . import viewport_stream as viewstream


# Match Blender 4×4 @ ~160 m + SUMO 5×5 junctions @ 40 m → 160 m (scale≈1)
CITY_SPAN_M = 160.0
SUMO_SPAN_M = 160.0
COORD_SCALE = CITY_SPAN_M / SUMO_SPAN_M
TRAFFIC_ROOT = "/World/DynamicTraffic"
VIEW_W = int(os.environ.get("CITYLAB_VIEW_W", "1920"))
VIEW_H = int(os.environ.get("CITYLAB_VIEW_H", "1080"))
# Shift SUMO walkers onto CityGen sidewalks (from assets/sumo/sidewalks.json).
# Heading-based offsets fail for against-traffic walkers — snap to mesh ribbons instead.
_PED_OFFSET_ENV = os.environ.get("CITYLAB_PED_OFFSET_M")  # optional fixed total (legacy)
PED_SIDEWALK_INSET_M = float(os.environ.get("CITYLAB_PED_INSET_M", "2.2"))  # unused when JSON present
# Optional: jupedsim (crowd dynamics). Default is jupedsim via city.sumocfg / CITYLAB_PED_MODEL.
PED_MODEL = os.environ.get("CITYLAB_PED_MODEL", "jupedsim").strip().lower()
_SIDEWALKS_JSON: dict | None = None
_SIDEWALK_RIBBONS: list[dict] = []

# KayKit City Builder cars (CC0) — the same models the webtest view renders, so
# the twin and the web mock show the same traffic. Built by
# tools/export_kaykit_cars.py, checked by tools/verify_cars.py. All five share
# one atlas material, so the variety costs a single texture.
_CAR_MESHES = (
    "kaykit/car_sedan.usdc",
    "kaykit/car_stationwagon.usdc",
    "kaykit/car_hatchback.usdc",
    "kaykit/car_taxi.usdc",
    "kaykit/car_police.usdc",
)
_CAR_PAINT = (
    Gf.Vec3f(0.82, 0.12, 0.10),
    Gf.Vec3f(0.10, 0.30, 0.78),
    Gf.Vec3f(0.92, 0.92, 0.90),
    Gf.Vec3f(0.08, 0.08, 0.10),
    Gf.Vec3f(0.15, 0.55, 0.22),
    Gf.Vec3f(0.70, 0.70, 0.72),
    Gf.Vec3f(0.90, 0.45, 0.08),
    Gf.Vec3f(0.55, 0.15, 0.55),
)
# Bump path suffix when mesh/yaw convention changes so live actors respawn.
_CAR_PRIM_REV = "v18"
# Temporary uniform shrink so KayKit bodies fit 2.0–3.0 m SUMO lanes
# (meshes are ~2.1 m wide). Replace with properly sized assets later.
_CAR_MESH_SCALE = float(os.environ.get("CITYLAB_CAR_SCALE", "0.85"))
# Car / people USDs are authored Y-up, grounded at y=0, no body tilt.
# SUMO 0°=north (−Z), 90°=east (+X). yaw = 90 - angle, so the 180° offset below
# means the meshes point their nose down −X. verify_cars.py enforces that.
_CAR_YAW_OFFSET_DEG = float(os.environ.get("CITYLAB_CAR_YAW_OFFSET", "180"))
# Peds: export_quaternius_people.py bakes +90° into vertices before forward=+X
# export. Cars use 180; peds need 270 (= 90 + 180) so they face their motion.
_PED_YAW_OFFSET_DEG = float(os.environ.get("CITYLAB_PED_YAW_OFFSET", "270"))

# ped_behaviors.rou.xml type → display color (cube fallback) / mesh file
_PED_COLORS = {
    "elderly": Gf.Vec3f(0.55, 0.70, 0.95),
    "adult": Gf.Vec3f(0.15, 0.90, 1.00),
    "rushed": Gf.Vec3f(1.00, 0.40, 0.15),
    "tourist": Gf.Vec3f(0.95, 0.85, 0.20),
    "delivery_robot": Gf.Vec3f(1.00, 0.62, 0.20),
}
_PED_COLOR_DEFAULT = Gf.Vec3f(0.15, 0.90, 1.00)
_ROBOT_CUBE_SIZE = Gf.Vec3f(0.75, 0.55, 0.70)
# SmartCity deliveryrobot_001 (Y≈height in mesh). Scale ~0.32 → ~0.9 m curb bot.
_ROBOT_MESH_SCALE = float(os.environ.get("CITYLAB_ROBOT_MESH_SCALE", "0.32"))
_ROBOT_ASSET_NAME = os.environ.get("CITYLAB_ROBOT_ASSET", "deliveryrobot_001.usd")
_ROBOT_PRIM_PATH = os.environ.get("CITYLAB_ROBOT_PRIM", "/deliveryrobot_001")
_ROBOT_PRIM_REV = "v2"
# Camera UV overlays were drifting (blank CV boxes). Off until plane is city-aligned.
_ROBOT_PUBLISH_UV = os.environ.get("CITYLAB_ROBOT_UV", "0") == "1"
_ROBOT_YAW_OFFSET_DEG = float(os.environ.get("CITYLAB_ROBOT_YAW_OFFSET", "0"))
# Quaternius outfits — static walk mid-poses only (max stream FPS).
_PED_MESH_POOL = (
    "male_casual",
    "male_shirt",
    "male_longsleeve",
    "male_suit",
    "female_casual",
    "female_tanktop",
    "female_alternative",
    "female_dress",
)
_PED_MESHES = {
    "elderly": ("male_suit", "female_dress"),
    "adult": ("male_casual", "female_casual", "male_shirt"),
    "rushed": ("female_tanktop", "male_longsleeve", "female_alternative"),
    "tourist": ("female_casual", "male_shirt", "female_alternative"),
}
_PED_MESH_DEFAULT = "male_casual"
# Static walk pose only (no skel, no idle swap) — best stream FPS.
_PED_PRIM_REV = "v9"
MAX_PED = int(os.environ.get("CITYLAB_MAX_PED", "24"))
MAX_ROBOT = int(os.environ.get("CITYLAB_MAX_ROBOT", "6"))
MAX_VEH = int(os.environ.get("CITYLAB_MAX_VEH", "32"))
# TraCI sync every N Kit frames (higher = cheaper).
_TRAFFIC_SYNC_EVERY = int(os.environ.get("CITYLAB_TRAFFIC_SYNC_EVERY", "3"))
_BLOCK_M = 40.0


def _sumo_to_usd(sx: float, sy: float, net_w: float, net_h: float) -> tuple[float, float]:
    ux = (sx - net_w * 0.5) * COORD_SCALE
    uz = -(sy - net_h * 0.5) * COORD_SCALE
    return ux, uz


def _sidewalk_offset_sumo(sx: float, sy: float, angle_deg: float, offset_m: float) -> tuple[float, float]:
    """Offset to the walker's right (SUMO angle: 0=north, 90=east). Legacy fallback."""
    rad = math.radians(angle_deg)
    return sx + math.cos(rad) * offset_m, sy - math.sin(rad) * offset_m


def _load_sidewalk_ribbons(root: Path) -> list[dict]:
    global _SIDEWALKS_JSON, _SIDEWALK_RIBBONS
    if _SIDEWALK_RIBBONS:
        return _SIDEWALK_RIBBONS
    path = root / "assets" / "sumo" / "sidewalks.json"
    if not path.is_file():
        carb.log_warn(f"[citylab.traffic] no sidewalks.json at {path} — using heading offset")
        return []
    try:
        _SIDEWALKS_JSON = json.loads(path.read_text(encoding="utf-8"))
        _SIDEWALK_RIBBONS = list(_SIDEWALKS_JSON.get("ribbons") or [])
        carb.log_warn(
            f"[citylab.traffic] loaded {len(_SIDEWALK_RIBBONS)} sidewalk ribbons from mesh"
        )
    except Exception as exc:
        carb.log_warn(f"[citylab.traffic] sidewalks.json: {exc}")
        _SIDEWALK_RIBBONS = []
    return _SIDEWALK_RIBBONS


_PED_BANDS: dict[str, dict] = {}
_PED_CROSS_HALF_M = 1.0


def _load_ped_bands(root: Path) -> dict[str, dict]:
    """Per-segment walkable bands baked from the real carriageway widths."""
    global _PED_BANDS, _PED_CROSS_HALF_M
    if _PED_BANDS:
        return _PED_BANDS
    path = root / "assets" / "sumo" / "ped_bands.json"
    if not path.is_file():
        carb.log_warn(f"[citylab.traffic] no ped_bands.json at {path} — walkers stay centred")
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        _PED_BANDS = dict(data.get("bands") or {})
        # Keep this ≤ ~1.0: larger values push CR walkers past the curb into asphalt.
        _PED_CROSS_HALF_M = float(data.get("cross_half_m") or 1.0)
        carb.log_warn(f"[citylab.traffic] loaded {len(_PED_BANDS)} sidewalk bands")
    except Exception as exc:
        carb.log_warn(f"[citylab.traffic] ped_bands.json: {exc}")
        _PED_BANDS = {}
    return _PED_BANDS


def _edge_from_lane(lane_id: str | None) -> str:
    if not lane_id:
        return ""
    # SUMO lanes are edge_id + "_" + index; edge ids themselves contain underscores.
    if lane_id.startswith(":"):
        return lane_id
    if "_" in lane_id and lane_id.rsplit("_", 1)[-1].isdigit():
        return lane_id.rsplit("_", 1)[0]
    return lane_id


def _parse_ped_edge(edge: str) -> dict | None:
    """Parse baked SW_*/CR_* edge ids into sidewalk/crossing pose hints."""
    if not edge:
        return None
    # Bake adds bidirectional "_r" reverse edges; the suffix is the only cue for
    # which way a walker faces, which decides which half of the ribbon they use.
    reverse = edge.endswith("_r")
    if reverse:
        edge = edge[:-2]
    if edge.startswith("SW_NS_"):
        # SW_NS_{col}_{j0}_{j1}_{L|R}
        parts = edge.split("_")
        if len(parts) >= 6 and parts[-1] in ("L", "R") and parts[2].isdigit():
            return {
                "kind": "SW",
                "dir": "NS",
                "line": float(int(parts[2]) * _BLOCK_M),
                "side": parts[-1],
                "rev": reverse,
                "edge": edge,
            }
    if edge.startswith("SW_EW_"):
        # SW_EW_{row}_{i0}_{i1}_{B|T}
        parts = edge.split("_")
        if len(parts) >= 6 and parts[-1] in ("B", "T") and parts[2].isdigit():
            return {
                "kind": "SW",
                "dir": "EW",
                "line": float(int(parts[2]) * _BLOCK_M),
                "side": parts[-1],
                "rev": reverse,
                "edge": edge,
            }
    if edge.startswith("CR_NS_"):
        # CR_NS_{col}_{row}_{B|T} — cross NS carriageway along an EW sidewalk line
        parts = edge.split("_")
        if len(parts) >= 5 and parts[-1] in ("B", "T") and parts[2].isdigit() and parts[3].isdigit():
            return {
                "kind": "CR",
                "dir": "EW",  # free axis is X; pin Y to EW ribbon
                "line": float(int(parts[3]) * _BLOCK_M),
                "side": parts[-1],
                "across": "NS",
                "rev": reverse,
                "edge": edge,
            }
    if edge.startswith("CR_EW_"):
        # CR_EW_{col}_{row}_{L|R} — cross EW carriageway along an NS sidewalk line
        parts = edge.split("_")
        if len(parts) >= 5 and parts[-1] in ("L", "R") and parts[2].isdigit() and parts[3].isdigit():
            return {
                "kind": "CR",
                "dir": "NS",  # free axis is Y; pin X to NS ribbon
                "line": float(int(parts[2]) * _BLOCK_M),
                "side": parts[-1],
                "across": "EW",
                "rev": reverse,
                "edge": edge,
            }
    return None


def _corridor_from_lane(lane_id: str | None) -> tuple[str, float] | None:
    """Map vehicle lane id → (NS|EW, centerline_sumo). None for ped / junctions."""
    if not lane_id or lane_id.startswith(":"):
        return None
    edge = _edge_from_lane(lane_id)
    if edge.startswith("SW_") or edge.startswith("CR_"):
        return None
    # Edges are like B0B1, A1B1 (letter+digit)×2
    if len(edge) < 4:
        return None
    c1, r1, c2, r2 = edge[0], edge[1], edge[2], edge[3]
    if not (c1.isalpha() and c2.isalpha() and r1.isdigit() and r2.isdigit()):
        return None
    col1, row1 = ord(c1.upper()) - ord("A"), int(r1)
    col2, row2 = ord(c2.upper()) - ord("A"), int(r2)
    if col1 == col2:
        return "NS", float(col1 * _BLOCK_M)
    if row1 == row2:
        return "EW", float(row1 * _BLOCK_M)
    return None


def _ribbon_for(ribbons: list[dict], direction: str, line: float, side: str) -> dict | None:
    best = None
    best_d = 1e9
    for r in ribbons:
        if r.get("dir") != direction:
            continue
        d = abs(float(r["line_sumo"]) - line)
        if d < best_d and r.get("side") == side:
            best, best_d = r, d
    return best if best is not None and best_d < 1.0 else None


def _pick_side(direction: str, line: float, sx: float, sy: float, sticky: str | None) -> str:
    """Choose L/R (NS) or B/T (EW); keep sticky unless clearly on the other side."""
    if direction == "NS":
        delta = sx - line
        natural = "R" if delta >= 0 else "L"
        if sticky in ("L", "R") and abs(delta) < 1.25:
            return sticky
        return natural
    delta = sy - line
    natural = "T" if delta >= 0 else "B"
    if sticky in ("B", "T") and abs(delta) < 1.25:
        return sticky
    return natural


# Max correction per sync tick — keeps junction/crossing motion continuous.
_PED_LATERAL_STEP_M = float(os.environ.get("CITYLAB_PED_LATERAL_STEP_M", "0.55"))
_PED_POS_STEP_M = float(os.environ.get("CITYLAB_PED_POS_STEP_M", "1.25"))

# Sidewalk ribbons are 4-5 m wide; keep walkers off the curb and building faces.
_PED_RIBBON_MARGIN_M = float(os.environ.get("CITYLAB_PED_RIBBON_MARGIN_M", "0.6"))
# Nudge the whole walking band if the extracted ribbon centre reads off visually.
_PED_RIBBON_SHIFT_M = float(os.environ.get("CITYLAB_PED_RIBBON_SHIFT_M", "0.0"))
# Opposing streams pick opposite halves, as on a real footway.
_PED_KEEP_RIGHT = os.environ.get("CITYLAB_PED_KEEP_RIGHT", "1").strip() not in ("0", "false")
# Extra metres trimmed off the kerb side so nobody skims the carriageway edge.
_PED_CURB_BIAS_M = float(os.environ.get("CITYLAB_PED_CURB_BIAS_M", "0.7"))


def _ped_lateral_target(
    pid: str, ribbon: dict, band: dict | None, reverse: bool, crossing: bool
) -> float:
    """Absolute lateral coordinate for one walker on a sidewalk or crosswalk.

    SUMO models the footway as a single narrow lane, so without this every walker
    tracks the exact centre line and a 5 m sidewalk looks unused. The band comes
    from ped_bands.json, which measures the real carriageway per segment -- the
    ribbon's own width spans the whole corridor and overlaps the road wherever
    that block is wider.
    """
    center = float(ribbon["center_sumo"])
    if crossing or not band:
        half = (
            _PED_CROSS_HALF_M
            if crossing
            else max(0.0, 0.5 * float(ribbon.get("width_m") or 0.0) - _PED_RIBBON_MARGIN_M)
        )
        lo, hi = center - half, center + half
    else:
        lo, hi = float(band["min"]), float(band["max"])
        # Push the whole stream away from the kerb, keeping a usable band.
        trim = min(_PED_CURB_BIAS_M, max(0.0, (hi - lo) - 0.5))
        if str(ribbon.get("side")) in ("R", "T"):
            lo += trim
        else:
            hi -= trim
    if hi - lo < 0.05:
        return 0.5 * (lo + hi) + _PED_RIBBON_SHIFT_M

    jitter = (zlib.crc32(pid.encode("utf-8")) % 1001) / 1000.0  # [0, 1]
    # Keep-right is for sidewalk streams only — on CR it pushes walkers into the curb/road.
    if _PED_KEEP_RIGHT and not crossing:
        # Opposing streams take opposite halves, overlapping slightly in the middle.
        mid = 0.5 * (lo + hi)
        slack = 0.15 * (hi - lo)
        a, b = (lo, mid + slack) if reverse else (mid - slack, hi)
    else:
        a, b = lo, hi
    return min(hi, max(lo, a + jitter * (b - a) + _PED_RIBBON_SHIFT_M))


def _separate_pedestrians_xz(
    pedestrians: list, min_dist_m: float = 0.85
) -> list:
    """Push overlapping USD ped positions apart so striping jams don't render as one mesh."""
    if len(pedestrians) < 2:
        return pedestrians
    out = [list(p) for p in pedestrians]
    for _ in range(4):
        moved = False
        for i in range(len(out)):
            for j in range(i + 1, len(out)):
                dx = float(out[j][1]) - float(out[i][1])
                dz = float(out[j][3]) - float(out[i][3])
                d2 = dx * dx + dz * dz
                if d2 >= min_dist_m * min_dist_m:
                    continue
                if d2 < 1e-8:
                    # Identical pose — fan by stable hash so they don't stick forever.
                    ang = (zlib.crc32(str(out[j][0]).encode("utf-8")) % 360) * 0.01745329251
                    dx, dz = math.cos(ang), math.sin(ang)
                    d2 = 1.0
                d = d2 ** 0.5
                push = 0.5 * (min_dist_m - d) / d
                out[i][1] = float(out[i][1]) - dx * push
                out[i][3] = float(out[i][3]) - dz * push
                out[j][1] = float(out[j][1]) + dx * push
                out[j][3] = float(out[j][3]) + dz * push
                moved = True
        if not moved:
            break
    return [tuple(p) for p in out]


def _sumo_ped_model_args() -> list[str]:
    """CLI args for the active pedestrian model (reload-safe)."""
    model = PED_MODEL or "jupedsim"
    args: list[str] = []
    if model in ("striping", "jupedsim", "nonInteracting"):
        args.extend(["--pedestrian.model", model])
    if model == "jupedsim":
        args.extend(
            [
                "--pedestrian.jupedsim.model",
                os.environ.get("CITYLAB_JUPED_MODEL", "CollisionFreeSpeedV2"),
                "--pedestrian.jupedsim.step-length",
                os.environ.get("CITYLAB_JUPED_STEP", "0.05"),
                "--pedestrian.jupedsim.exit-tolerance",
                "1.0",
                "--pedestrian.jupedsim.strength-neighbor-repulsion",
                os.environ.get("CITYLAB_JUPED_NBR_STR", "12.0"),
                "--pedestrian.jupedsim.range-neighbor-repulsion",
                os.environ.get("CITYLAB_JUPED_NBR_RANGE", "1.4"),
                "--pedestrian.jupedsim.strength-geometry-repulsion",
                os.environ.get("CITYLAB_JUPED_GEO_STR", "8.0"),
                "--pedestrian.jupedsim.range-geometry-repulsion",
                os.environ.get("CITYLAB_JUPED_GEO_RANGE", "0.6"),
            ]
        )
    return args


def _ped_lateral_offset_m(traci_mod, pid: str) -> float:
    """Legacy meters from lane center (only if sidewalks.json missing)."""
    if _PED_OFFSET_ENV is not None and str(_PED_OFFSET_ENV).strip() != "":
        return float(_PED_OFFSET_ENV)
    lane_w = 3.5
    try:
        lid = traci_mod.person.getLaneID(pid)
        if lid:
            lane_w = float(traci_mod.lane.getWidth(lid))
    except Exception:
        pass
    return 0.5 * lane_w + PED_SIDEWALK_INSET_M


def _is_delivery_robot(type_id: str) -> bool:
    base = (type_id or "").split("@")[0]
    return base == "delivery_robot"


def _project_world_to_uv(
    stage,
    cam_path: str,
    x: float,
    y: float,
    z: float,
    width: int,
    height: int,
) -> tuple[float, float] | None:
    """Project a USD world point through /World/Camera → image pixels (origin top-left)."""
    try:
        prim = stage.GetPrimAtPath(cam_path)
        if not prim or not prim.IsValid():
            return None
        # Prefer the live xform (Kit reframes the camera) over Gf.Camera cache quirks.
        world_xf = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        p_cam = world_xf.GetInverse().Transform(Gf.Vec3d(float(x), float(y), float(z)))
        # USD camera looks down local −Z; ahead ⇒ z < 0.
        if p_cam[2] >= -0.05:
            return None
        usd_cam = UsdGeom.Camera(prim)
        focal = float(usd_cam.GetFocalLengthAttr().Get() or 16.0)
        hap = float(usd_cam.GetHorizontalApertureAttr().Get() or 20.955)
        vap = float(usd_cam.GetVerticalApertureAttr().Get() or 0.0)
        if vap <= 1e-6:
            vap = hap * (float(height) / max(1.0, float(width)))
        # Film-back pinhole → NDC-ish, then pixels.
        nx = (p_cam[0] / -p_cam[2]) * (focal / hap)
        ny = (p_cam[1] / -p_cam[2]) * (focal / vap)
        if abs(nx) > 1.6 or abs(ny) > 1.6:
            return None
        u = (nx * 0.5 + 0.5) * float(width)
        v = (0.5 - ny * 0.5) * float(height)
        if u < -40 or v < -40 or u > width + 40 or v > height + 40:
            return None
        return float(u), float(v)
    except Exception as exc:
        if not getattr(_project_world_to_uv, "_err_logged", False):
            carb.log_warn(f"[citylab.traffic] project uv: {exc}")
            _project_world_to_uv._err_logged = True  # type: ignore[attr-defined]
        return None


def _robot_bbox_from_foot(
    u: float,
    v: float,
    width: int,
    height: int,
    *,
    half_w: float = 18.0,
    half_h: float = 14.0,
) -> list[float]:
    """Axis-aligned box around a projected foot (image px)."""
    x1 = max(0.0, u - half_w)
    y1 = max(0.0, v - half_h * 1.6)
    x2 = min(float(width), u + half_w)
    y2 = min(float(height), v + half_h * 0.4)
    return [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)]


def _ped_color(type_id: str) -> Gf.Vec3f:
    base = (type_id or "").split("@")[0]
    return _PED_COLORS.get(base, _PED_COLOR_DEFAULT)


def _ped_mesh_stem(type_id: str, actor_id: str = "") -> str:
    """Pick a Quaternius outfit stem (no _walk/_idle suffix)."""
    base = (type_id or "").split("@")[0]
    pool = _PED_MESHES.get(base) or _PED_MESH_POOL
    if isinstance(pool, str):
        return pool.replace(".usdc", "")
    h = abs(hash(f"{actor_id}|{base}")) if actor_id else abs(hash(base))
    return pool[h % len(pool)]


def _ped_mesh_name(type_id: str, actor_id: str = "") -> str:
    """Always static walk pose — no idle/skel swap (stream FPS)."""
    return f"{_ped_mesh_stem(type_id, actor_id)}_walk.usdc"


def _set_actor_xform(prim, x: float, y: float, z: float, yaw: float) -> None:
    """Update translate/rotate without rebuilding xform ops every tick."""
    xf = UsdGeom.Xformable(prim)
    ops = xf.GetOrderedXformOps()
    if len(ops) >= 2 and ops[0].GetOpType() == UsdGeom.XformOp.TypeTranslate:
        ops[0].Set(Gf.Vec3d(x, y, z))
        if ops[1].GetOpType() in (
            UsdGeom.XformOp.TypeRotateXYZ,
            UsdGeom.XformOp.TypeRotateYZX,
            UsdGeom.XformOp.TypeRotateZXY,
            UsdGeom.XformOp.TypeRotateXZY,
            UsdGeom.XformOp.TypeRotateYXZ,
            UsdGeom.XformOp.TypeRotateZYX,
        ):
            ops[1].Set(Gf.Vec3f(0.0, float(yaw), 0.0))
            return
    xf.ClearXformOpOrder()
    xf.AddTranslateOp().Set(Gf.Vec3d(x, y, z))
    xf.AddRotateXYZOp().Set(Gf.Vec3f(0.0, float(yaw), 0.0))


def _setup_sumo_path(root: Path) -> Path:
    py = f"python{sys.version_info.major}.{sys.version_info.minor}"
    sumo_home = root / ".venv" / "lib" / py / "site-packages" / "sumo"
    # Isaac Kit uses its own Python — prefer system/eclipse sumo tools if venv py mismatches
    if not sumo_home.exists():
        # fall back: try any sumo under ov-citylab .venv
        matches = list((root / ".venv" / "lib").glob("python*/site-packages/sumo"))
        if matches:
            sumo_home = matches[0]
    tools = sumo_home / "tools"
    if tools.exists() and str(tools) not in sys.path:
        sys.path.insert(0, str(tools))
    os.environ["SUMO_HOME"] = str(sumo_home)
    os.environ["PATH"] = f"{sumo_home / 'bin'}:{os.environ.get('PATH', '')}"
    return sumo_home


class CityLabTrafficExtension(omni.ext.IExt):
    def on_startup(self, _ext_id: str) -> None:
        self._root = Path(os.environ.get("CITYLAB_ROOT", "")).resolve()
        if not self._root.exists() or not (self._root / "assets").exists():
            # extension lives at …/ov-citylab/exts/citylab.traffic/…
            # parents[4] = ov-citylab on host; in Docker prefer /citylab mount
            candidates = [
                Path("/citylab"),
                Path(__file__).resolve().parents[4],
                Path(__file__).resolve().parents[3],
            ]
            for c in candidates:
                if (c / "assets" / "sumo").exists() or (c / "assets" / "stage").exists():
                    self._root = c
                    break
            else:
                self._root = candidates[0]
        self._usd_path = Path(
            os.environ.get("CITYLAB_USD", str(self._root / "assets" / "stage" / "city_lab.usda"))
        )
        self._sumo_cfg = self._root / "assets" / "sumo" / "city.sumocfg"
        self._sidewalk_ribbons = _load_sidewalk_ribbons(self._root)
        _load_ped_bands(self._root)
        self._ped_sidewalk_state: dict[str, dict] = {}
        self._ped_follow_ids: list[str] = []
        self._update_sub = None
        self._traci = None
        self._running = False
        self._loop_task = None
        self._net_w = SUMO_SPAN_M
        self._net_h = SUMO_SPAN_M
        self._frame = 0
        self._veh = 0
        self._ped = 0
        self._ped_spawn_logged = 0
        self._car_spawn_logged = 0
        # WebRTC is the live path; skip heavy viewport JPEG unless explicitly enabled
        self._capture_enabled = os.environ.get("CITYLAB_VIEWPORT_HTTP", "0") == "1"
        self._capture_pending = False
        self._capture_started_at = 0
        # Lighting: studio (Isaac Grey Studio) | hdri | dynamic
        self._lighting_mode = os.environ.get("CITYLAB_LIGHTING", "studio").strip().lower()
        # Dynamic Sky is heavy — apply after WebRTC media is up (only if lighting=dynamic)
        self._dynamic_sky_pending = (
            self._lighting_mode == "dynamic"
            or os.environ.get("CITYLAB_DYNAMIC_SKY", "0") == "1"
        )
        self._dynamic_sky_applied = False
        # SUMO TraCI also stalls StreamSDK if started at boot — defer until stage is ticking
        # (and until a WebRTC client is live when livestream signaling is listening).
        self._sumo_enabled = os.environ.get("CITYLAB_SUMO", "1") == "1"
        self._sumo_defer = os.environ.get("CITYLAB_SUMO_DEFER", "1") == "1"
        self._sumo_pending = False
        self._sumo_start_frame = int(os.environ.get("CITYLAB_SUMO_START_FRAME", "300"))
        carb.log_info(f"[citylab.traffic] root={self._root} usd={self._usd_path}")
        stream_control.start_stream_control(8791)
        stream_control.set_boot(
            stage="booting",
            label="Waiting for livestream to settle…",
            percent=18,
        )
        if self._capture_enabled:
            viewstream.start_viewport_http(8790)
        self._task = asyncio.ensure_future(self._boot())

    def on_shutdown(self) -> None:
        self._running = False
        if getattr(self, "_loop_task", None) is not None:
            self._loop_task.cancel()
            self._loop_task = None
        if self._update_sub is not None:
            self._update_sub = None
        stream_control.stop_stream_control()
        viewstream.stop_viewport_http()
        if self._traci is not None:
            try:
                self._traci.close()
            except Exception:
                pass
            self._traci = None

    async def _boot(self) -> None:
        app = omni.kit.app.get_app()
        # Let livestream settle before opening the large city payload
        for _ in range(360):
            await app.next_update_async()

        await self._ensure_city_stage(reason="boot")
        stream_control.set_boot(
            stage="city",
            label="City USD loaded",
            percent=40,
            city=True,
        )
        # Light first so StreamSDK can start; Dynamic Sky only if CITYLAB_LIGHTING=dynamic
        if self._lighting_mode == "studio":
            self._ensure_environment_lights(prefer_dynamic=False, prefer_studio=True)
            stream_control.set_boot(
                stage="lights",
                label="Grey Studio lights ready",
                percent=55,
                lights=True,
            )
        elif self._lighting_mode == "hdri":
            self._ensure_environment_lights(prefer_dynamic=False, prefer_studio=False)
            stream_control.set_boot(
                stage="lights",
                label="Environment light ready (HDRI)",
                percent=55,
                lights=True,
            )
        else:
            self._ensure_environment_lights(prefer_dynamic=False, prefer_studio=False)
            stream_control.set_boot(
                stage="lights",
                label="Environment light ready (Dynamic Sky after stream)",
                percent=55,
                lights=True,
            )
        self._frame_city_camera_sync()

        if not self._sumo_enabled:
            carb.log_warn("[citylab.traffic] SUMO disabled (CITYLAB_SUMO=0)")
            stream_control.set_boot(
                stage="ready_no_sumo",
                label="City ready (SUMO off)",
                percent=90,
                sumo=False,
            )
            self._arm_update()
            return

        if not self._sumo_cfg.exists():
            carb.log_warn(f"[citylab.traffic] SUMO cfg missing: {self._sumo_cfg}")
            stream_control.set_boot(
                stage="ready_no_sumo",
                label="City ready (no SUMO cfg)",
                percent=90,
            )
            self._arm_update()
            return

        if self._sumo_defer:
            self._sumo_pending = True
            carb.log_warn(
                "[citylab.traffic] SUMO is LAST — waits for city + lights + stream media "
                f"(frame>={self._sumo_start_frame}, UDP 47998 + settle)"
            )
            stream_control.set_boot(
                stage="ready",
                label="City ready — connect stream; SUMO starts last",
                percent=88,
                sumo=False,
            )
            self._arm_update()
            return

        self._start_sumo()
        self._arm_update()
        stream_control.set_boot(
            stage="ready",
            label="Kit ready — connect one WebRTC client",
            percent=88,
        )

    def _arm_update(self) -> None:
        self._running = True
        # Prefer Kit update subscription; also keep asyncio fallback — livestream
        # sometimes never delivers update_event_stream pops, which stalls deferred
        # Dynamic Sky / SUMO forever (ticking stays false).
        try:
            self._update_sub = (
                omni.kit.app.get_app()
                .get_update_event_stream()
                .create_subscription_to_pop(self._on_update)
            )
            carb.log_warn("[citylab.traffic] update subscription armed")
        except Exception as exc:
            carb.log_error(f"[citylab.traffic] update sub failed: {exc}")
        if self._loop_task is None:
            self._loop_task = asyncio.ensure_future(self._tick_loop())
            carb.log_warn("[citylab.traffic] asyncio tick loop armed")

    async def _ensure_city_stage(self, reason: str) -> None:
        app = omni.kit.app.get_app()
        ctx = omni.usd.get_context()
        usd = str(self._usd_path)
        carb.log_warn(
            f"[citylab.traffic] ensure({reason}) root={self._root} usd={usd} exists={self._usd_path.exists()}"
        )
        if not self._usd_path.exists():
            carb.log_error(f"[citylab.traffic] USD missing: {usd}")
            return

        stage = ctx.get_stage()
        try:
            city = stage.GetPrimAtPath("/World/City") if stage else None
            if city and city.IsValid() and len(city.GetChildren()) > 0:
                carb.log_warn(
                    f"[citylab.traffic] city already loaded children={len(city.GetChildren())} — skip reopen"
                )
                return
        except Exception:
            pass

        try:
            result = await ctx.open_stage_async(usd)
            ok = result[0] if isinstance(result, (tuple, list)) else bool(result)
            carb.log_warn(f"[citylab.traffic] open_stage({reason}) ok={ok}")
        except Exception as exc:
            carb.log_error(f"[citylab.traffic] open_stage({reason}) failed: {exc}")
            return

        for _ in range(45):
            await app.next_update_async()

        stage = ctx.get_stage()
        city_ok = False
        child_count = 0
        try:
            city = stage.GetPrimAtPath("/World/City") if stage else None
            city_ok = bool(city and city.IsValid())
            if city_ok:
                # Force payload composition for the large city usdc
                try:
                    city.Load()
                except Exception:
                    pass
                try:
                    stage.Load("/World/City")
                except Exception:
                    pass
                child_count = len(city.GetChildren())
                if child_count == 0:
                    city_usdc = self._root / "assets" / "city" / "city_generator_large.usdc"
                    if city_usdc.exists():
                        try:
                            from pxr import Sdf

                            city.GetPayloads().ClearPayloads()
                            city.GetPayloads().AddPayload(Sdf.Payload(str(city_usdc)))
                            city.Load()
                            for _ in range(30):
                                await app.next_update_async()
                            child_count = len(city.GetChildren())
                            carb.log_warn(
                                f"[citylab.traffic] rebound payload → {city_usdc} children={child_count}"
                            )
                        except Exception as exc:
                            carb.log_error(f"[citylab.traffic] payload rebind failed: {exc}")
        except Exception as exc:
            carb.log_warn(f"[citylab.traffic] city check failed: {exc}")
        carb.log_warn(
            f"[citylab.traffic] /World/City valid={city_ok} children={child_count} ({reason})"
        )

    def _ensure_environment_lights(
        self, prefer_dynamic: bool = True, prefer_studio: bool = False
    ) -> None:
        """Outdoor HDRI, Isaac Grey Studio, or Dynamic Sky."""
        stage = omni.usd.get_context().get_stage()
        if stage is None:
            return

        if prefer_dynamic:
            # Remove boot HDRI / studio so Dynamic Sky owns the look
            for path in (
                "/World/DomeLight",
                "/World/Sun",
                "/World/Studio",
                "/Environment",
            ):
                prim = stage.GetPrimAtPath(path)
                if prim and prim.IsValid():
                    try:
                        stage.RemovePrim(path)
                    except Exception:
                        try:
                            omni.kit.commands.execute("DeletePrimsCommand", paths=[path])
                        except Exception:
                            pass
            sky_url = self._resolve_dynamic_sky_url()
            if sky_url and self._apply_dynamic_sky(sky_url):
                stream_control.set_boot(lights=True)
                self._dynamic_sky_applied = True
                self._dynamic_sky_pending = False
                return
            carb.log_warn("[citylab.traffic] Dynamic Sky apply failed — keeping HDRI")
            return

        if prefer_studio or self._lighting_mode == "studio":
            self._apply_grey_studio_lights(stage)
            return

        # Static HDRI + distant sun (safe for livestream startup)
        try:
            for path in ("/World/DomeLight", "/World/Sun"):
                prim = stage.GetPrimAtPath(path)
                if prim and prim.IsValid():
                    continue  # already present from USD

            hdr = self._root / "assets" / "env" / "stinson_beach.hdr"
            hdr_path = str(hdr) if hdr.exists() else ""

            dome = UsdLux.DomeLight.Define(stage, "/World/DomeLight")
            dome.CreateIntensityAttr(2500.0)
            dome.CreateExposureAttr(1.0)
            dome.CreateColorAttr(Gf.Vec3f(1.0, 1.0, 1.0))
            try:
                dome.CreateNormalizeAttr(True)
            except Exception:
                pass
            if hdr_path:
                dome.CreateTextureFileAttr(hdr_path)
                try:
                    dome.CreateTextureFormatAttr("latlong")
                except Exception:
                    pass
            xf = UsdGeom.Xformable(dome.GetPrim())
            xf.ClearXformOpOrder()
            xf.AddRotateXYZOp().Set(Gf.Vec3f(0.0, 30.0, 0.0))

            sun = UsdLux.DistantLight.Define(stage, "/World/Sun")
            sun.CreateIntensityAttr(12000.0)
            sun.CreateAngleAttr(0.53)
            sun.CreateColorAttr(Gf.Vec3f(1.0, 0.96, 0.88))
            try:
                sun.CreateNormalizeAttr(True)
            except Exception:
                pass
            sxf = UsdGeom.Xformable(sun.GetPrim())
            sxf.ClearXformOpOrder()
            sxf.AddRotateXYZOp().Set(Gf.Vec3f(-48.0, 40.0, 0.0))

            carb.log_warn(
                f"[citylab.traffic] env lights HDRI boot dome_hdr={bool(hdr_path)}"
            )
            stream_control.set_boot(lights=True)
        except Exception as exc:
            carb.log_warn(f"[citylab.traffic] env lights: {exc}")

    @staticmethod
    def _mute_light_prim(stage, path: str) -> None:
        """Hide competing lights so studio key/fill aren't blown out."""
        prim = stage.GetPrimAtPath(path)
        if not prim or not prim.IsValid():
            return
        try:
            UsdGeom.Imageable(prim).MakeInvisible()
        except Exception:
            pass
        for attr_name, value in (
            ("inputs:intensity", 0.0),
            ("inputs:exposure", 0.0),
        ):
            attr = prim.GetAttribute(attr_name)
            if attr and attr.IsValid():
                try:
                    attr.Set(value)
                except Exception:
                    pass

    def _apply_grey_studio_lights(self, stage) -> None:
        """Neutral grey fill + soft key — one dome + one sun (no stacked HDRIs)."""
        try:
            studio_usd = self._root / "assets" / "env" / "Grey_Studio.usda"
            studio_prim = stage.GetPrimAtPath("/World/Studio")
            if studio_usd.exists() and (not studio_prim or not studio_prim.IsValid()):
                studio_prim = stage.DefinePrim("/World/Studio")
                studio_prim.GetPayloads().AddPayload(Sdf.Payload(str(studio_usd)))
                try:
                    studio_prim.Load()
                except Exception:
                    pass
                carb.log_warn(f"[citylab.traffic] Grey Studio payload → {studio_usd}")

            # Stage ships multiple bright lights; mute them or exposure goes nuclear.
            # Do not mute /World/Fill — we author that as canyon bounce light below.
            for path in (
                "/Environment",
                "/Environment/sky",
                "/World/DistantLight",
                "/World/Studio/DistantLight",
                "/World/Studio/DomeLight",
                "/World/City/City/env_light",
                "/World/City/env_light",
            ):
                self._mute_light_prim(stage, path)

            # Soft ambient dome (no HDR texture — grey IBL)
            dome = UsdLux.DomeLight.Define(stage, "/World/DomeLight")
            dome.CreateIntensityAttr(4500.0)
            dome.CreateExposureAttr(1.25)
            dome.CreateColorAttr(Gf.Vec3f(0.92, 0.94, 0.98))
            try:
                dome.CreateNormalizeAttr(True)
            except Exception:
                pass
            try:
                attr = dome.GetTextureFileAttr()
                if attr:
                    attr.Clear()
            except Exception:
                pass
            try:
                dome.GetPrim().CreateAttribute(
                    "visibleInPrimaryRay", Sdf.ValueTypeNames.Bool
                ).Set(False)
            except Exception:
                pass
            dxf = UsdGeom.Xformable(dome.GetPrim())
            dxf.ClearXformOpOrder()
            dxf.AddRotateXYZOp().Set(Gf.Vec3f(270.0, -30.0, 0.0))

            # Soft key sun
            key = UsdLux.DistantLight.Define(stage, "/World/Sun")
            key.CreateIntensityAttr(9000.0)
            key.CreateAngleAttr(35.0)
            key.CreateColorAttr(Gf.Vec3f(1.0, 0.98, 0.94))
            try:
                key.CreateNormalizeAttr(True)
            except Exception:
                pass
            kxf = UsdGeom.Xformable(key.GetPrim())
            kxf.ClearXformOpOrder()
            kxf.AddRotateXYZOp().Set(Gf.Vec3f(-42.0, 35.0, 0.0))

            # Extra fill so street canyons aren't black
            fill = UsdLux.DistantLight.Define(stage, "/World/Fill")
            fill.CreateIntensityAttr(2200.0)
            fill.CreateAngleAttr(60.0)
            fill.CreateColorAttr(Gf.Vec3f(0.75, 0.82, 0.95))
            try:
                fill.CreateNormalizeAttr(True)
            except Exception:
                pass
            fxf = UsdGeom.Xformable(fill.GetPrim())
            fxf.ClearXformOpOrder()
            fxf.AddRotateXYZOp().Set(Gf.Vec3f(-25.0, -140.0, 0.0))

            stream_control.set_boot(lights=True)
            carb.log_warn("[citylab.traffic] Grey Studio lights ready (brighter dome+sun+fill)")
        except Exception as exc:
            carb.log_warn(f"[citylab.traffic] Grey Studio lights: {exc}")
    def _start_sumo(self) -> bool:
        """Start SUMO TraCI. Safe to call once from boot or deferred tick."""
        if self._traci is not None:
            return True
        try:
            sumo_home = _setup_sumo_path(self._root)
            import traci  # noqa: WPS433 — after SUMO_HOME

            sumo_bin = str(sumo_home / "bin" / "sumo")
            if not Path(sumo_bin).exists():
                raise FileNotFoundError(f"sumo binary missing: {sumo_bin}")
            cmd = [
                sumo_bin,
                "-c",
                str(self._sumo_cfg),
                "--start",
                "--no-step-log",
                "true",
            ]
            model = PED_MODEL or "jupedsim"
            cmd.extend(_sumo_ped_model_args())
            traci.start(cmd)
            bounds = traci.simulation.getNetBoundary()
            # Use the designed 160 m grid span for centering — TraCI bounds can inflate
            # with junction geometry and would shift cars onto sidewalks.
            self._net_w = float(SUMO_SPAN_M)
            self._net_h = float(SUMO_SPAN_M)
            raw_w = bounds[1][0] - bounds[0][0]
            raw_h = bounds[1][1] - bounds[0][1]
            self._traci = traci
            self._sumo_pending = False
            carb.log_warn(
                f"[citylab.traffic] SUMO up map={raw_w:.0f}×{raw_h:.0f} m "
                f"center={self._net_w:.0f}×{self._net_h:.0f} scale={COORD_SCALE:.3f} "
                f"ped_model={model}"
            )
            stream_control.set_boot(
                stage="sumo",
                label=f"SUMO traffic up ({self._net_w:.0f}×{self._net_h:.0f} m)",
                percent=95,
                sumo=True,
            )
            return True
        except Exception as exc:
            self._sumo_pending = False
            carb.log_error(f"[citylab.traffic] SUMO failed: {exc}")
            stream_control.set_boot(
                stage="sumo_error",
                label=f"SUMO failed: {exc}",
                percent=60,
            )
            return False

    def _sumo_ready_to_start(self) -> bool:
        """SUMO is strictly last: city ticking + WebRTC media live + settle window."""
        if self._frame < self._sumo_start_frame:
            return False
        # Always treat livestream as active when signaling listens — never start SUMO
        # before the viewer has negotiated media (kills StreamSDK).
        if self._signaling_listening():
            if not self._webrtc_client_connected():
                if self._frame % 60 == 0:
                    stream_control.set_boot(
                        stage="ticking",
                        label="Waiting for stream client — SUMO last",
                        percent=92,
                        ticking=True,
                        sumo=False,
                    )
                return False
            if not self._media_udp_listening():
                if self._frame % 60 == 0:
                    stream_control.set_boot(
                        stage="ticking",
                        label="Stream connecting — SUMO waits for media",
                        percent=94,
                        ticking=True,
                        sumo=False,
                    )
                return False
            settle = int(os.environ.get("CITYLAB_SUMO_MEDIA_SETTLE_FRAMES", "180"))
            media_at = getattr(self, "_media_seen_frame", None)
            if media_at is None:
                self._media_seen_frame = self._frame
                stream_control.set_boot(
                    stage="stream_live",
                    label="Stream live — settling before SUMO…",
                    percent=96,
                    ticking=True,
                    sumo=False,
                )
                return False
            if self._frame - media_at < settle:
                if self._frame % 60 == 0:
                    left = settle - (self._frame - media_at)
                    stream_control.set_boot(
                        stage="stream_live",
                        label=f"Stream live — SUMO in ~{max(1, left // 60)}s",
                        percent=97,
                        ticking=True,
                        sumo=False,
                    )
                return False
            # Dynamic Sky (if pending) must finish before SUMO
            if self._dynamic_sky_pending and not self._dynamic_sky_applied:
                return False
        return True

    @staticmethod
    def _media_udp_listening(media_port: int = 47998) -> bool:
        """True if livestream media UDP port is bound (WebRTC video path up)."""
        try:
            want = f"{media_port:04X}"
            with open("/proc/net/udp", encoding="utf-8") as fh:
                next(fh)
                for line in fh:
                    parts = line.split()
                    if len(parts) < 2:
                        continue
                    local = parts[1]
                    if local.endswith(f":{want}"):
                        return True
        except Exception:
            return False
        return False

    @staticmethod
    def _signaling_listening(signal_port: int = 49100) -> bool:
        """True if livestream signaling TCP port is listening (streaming mode)."""
        try:
            want = f"{signal_port:04X}"
            with open("/proc/net/tcp", encoding="utf-8") as fh:
                next(fh)
                for line in fh:
                    parts = line.split()
                    if len(parts) < 4:
                        continue
                    local, state = parts[1], parts[3]
                    # LISTEN = 0A
                    if state == "0A" and local.endswith(f":{want}"):
                        return True
        except Exception:
            return False
        return False

    @staticmethod
    def _webrtc_client_connected(signal_port: int = 49100) -> bool:
        """True if something has an ESTABLISHED TCP to the livestream signaling port."""
        try:
            want = f"{signal_port:04X}"
            with open("/proc/net/tcp", encoding="utf-8") as fh:
                next(fh)
                for line in fh:
                    parts = line.split()
                    if len(parts) < 4:
                        continue
                    local, rem, state = parts[1], parts[2], parts[3]
                    # ESTABLISHED = 01; local or remote port match
                    if state != "01":
                        continue
                    if local.endswith(f":{want}") or rem.endswith(f":{want}"):
                        return True
        except Exception:
            return False
        return False

    def _resolve_dynamic_sky_url(self) -> str:
        """Isaac Dynamic Sky USD — prefer local bundled asset, then NVIDIA default ClearSky."""
        override = os.environ.get("CITYLAB_DYNAMIC_SKY_URL", "").strip()
        if override:
            return override
        # Bundled with omni.kit.environment.core (works offline)
        try:
            import omni.kit.environment.core as env_core

            base = Path(env_core.__file__).resolve().parents[4]  # extension root
            local = base / "data" / "tests" / "Skies" / "Dynamic" / "sunstudy.usd"
            if local.exists():
                return str(local)
        except Exception:
            pass
        # Official default from extension.toml
        return (
            "http://omniverse-content-production.s3-us-west-2.amazonaws.com/"
            "Assets/Skies/Dynamic/ClearSky.usd"
        )

    def _apply_dynamic_sky(self, sky_url: str) -> bool:
        try:
            manager = omni.kit.app.get_app().get_extension_manager()
            if not manager.is_extension_enabled("omni.kit.environment.core"):
                manager.set_extension_enabled_immediate("omni.kit.environment.core", True)

            from omni.kit.environment.core import SkyType, import_environment
            from omni.kit.environment.core.constants import SKY_PRIM_PATH

            # Avoid modal "extra lights" dialog in headless/stream
            try:
                import carb.settings

                carb.settings.get_settings().set(
                    "/exts/omni.kit.environment.core/rtx/light/warning", False
                )
            except Exception:
                pass

            result = import_environment(SkyType.DYNAMIC, sky_url)
            stage = omni.usd.get_context().get_stage()
            sky = stage.GetPrimAtPath(SKY_PRIM_PATH) if stage else None
            ok = bool(sky and sky.IsValid()) or bool(result)
            if ok:
                carb.log_warn(f"[citylab.traffic] Dynamic Sky ok → {sky_url}")
                # Optional daytime animation (Sun Study)
                if os.environ.get("CITYLAB_SUNSTUDY", "0") == "1":
                    try:
                        from omni.kit.environment.core import get_sunstudy_player

                        get_sunstudy_player().start()
                        carb.log_warn("[citylab.traffic] Sun Study playing")
                    except Exception as exc:
                        carb.log_warn(f"[citylab.traffic] Sun Study: {exc}")
                return True
            carb.log_warn(f"[citylab.traffic] Dynamic Sky failed for {sky_url}")
            return False
        except Exception as exc:
            carb.log_warn(f"[citylab.traffic] Dynamic Sky unavailable: {exc}")
            return False

    def _frame_city_camera_sync(self) -> None:
        """Point viewport at city camera without awaiting (avoids hang before stream client)."""
        cam_path = "/World/Camera"
        try:
            try:
                import carb.settings

                settings = carb.settings.get_settings()
                # Clean city pixels only — no Isaac editor chrome in the stream.
                hide_ui = os.environ.get("CITYLAB_HIDE_UI", "1") == "1"
                settings.set("/app/window/hideUi", hide_ui)
                settings.set("/app/viewport/grid/enabled", False)
                settings.set("/app/viewport/show/gizmos", False)
                settings.set("/persistent/app/viewport/grid/enabled", False)
                settings.set("/persistent/app/viewport/show/gizmos", False)
                settings.set("/app/viewport/guide/enabled", False)
                settings.set("/app/renderer/resolution/width", VIEW_W)
                settings.set("/app/renderer/resolution/height", VIEW_H)
                settings.set("/app/window/width", VIEW_W)
                settings.set("/app/window/height", VIEW_H)
                self._apply_stream_quality(settings)
            except Exception:
                pass

            stage = omni.usd.get_context().get_stage()
            if stage is None:
                carb.log_warn("[citylab.traffic] no stage for camera")
                return
            cam = stage.GetPrimAtPath(cam_path)
            if not cam or not cam.IsValid():
                cam_xf = UsdGeom.Camera.Define(stage, cam_path)
                xf = UsdGeom.Xformable(cam_xf.GetPrim())
            else:
                xf = UsdGeom.Xformable(cam)
            xf.ClearXformOpOrder()
            # High wide view of ~160 m district
            xf.AddTranslateOp().Set(Gf.Vec3d(90.0, 120.0, 160.0))
            xf.AddRotateXYZOp().Set(Gf.Vec3f(-35.0, 35.0, 0.0))

            try:
                from omni.kit.viewport.utility import get_active_viewport

                vp = get_active_viewport()
                if vp is not None:
                    try:
                        vp.set_active_camera(cam_path)
                    except Exception:
                        try:
                            vp.camera_path = cam_path
                        except Exception:
                            pass
                    try:
                        if hasattr(vp, "set_texture_resolution"):
                            vp.set_texture_resolution((VIEW_W, VIEW_H))
                    except Exception:
                        pass
                    try:
                        if hasattr(vp, "set_hd_resolution"):
                            vp.set_hd_resolution((VIEW_W, VIEW_H))
                    except Exception:
                        pass
            except Exception as exc:
                carb.log_warn(f"[citylab.traffic] viewport camera: {exc}")
            carb.log_warn(f"[citylab.traffic] camera framed → {cam_path} @ {VIEW_W}x{VIEW_H}")
        except Exception as exc:
            carb.log_warn(f"[citylab.traffic] camera frame: {exc}")

    @staticmethod
    def _apply_stream_quality(settings) -> None:
        """1080p viewport + DLSS for livestream encode."""
        enable_dlss = os.environ.get("CITYLAB_DLSS", "1") == "1"
        for key, val in (
            ("/rtx/post/dlss/enabled", enable_dlss),
            ("/rtx-transient/dlssg/enabled", False),
            ("/rtx/post/aa/op", 3 if enable_dlss else 0),
            ("/rtx/post/dlss/execMode", 2),
        ):
            try:
                settings.set(key, val)
            except Exception:
                pass
        mode = os.environ.get("CITYLAB_DLSS_MODE", "quality").strip().lower()
        mode_map = {"performance": 0, "balanced": 1, "quality": 2, "auto": 3, "dlsaa": 4}
        try:
            settings.set("/rtx/post/dlss/execMode", mode_map.get(mode, 2))
        except Exception:
            pass
        carb.log_warn(
            f"[citylab.traffic] stream quality {VIEW_W}x{VIEW_H} dlss={'on/'+mode if enable_dlss else 'off'}"
        )

    async def _tick_loop(self) -> None:
        app = omni.kit.app.get_app()
        while self._running:
            await app.next_update_async()
            self._on_update(None)

    async def _frame_city_camera(self) -> None:
        """Point Kit viewport at the city USD camera; hide editor chrome (viewport only)."""
        cam_path = "/World/Camera"
        try:
            # Prefer viewport pixels only — no Isaac editor panels in the stream.
            try:
                import carb.settings

                settings = carb.settings.get_settings()
                settings.set("/app/window/hideUi", True)
                settings.set("/app/viewport/grid/enabled", False)
                settings.set("/app/viewport/show/gizmos", False)
                settings.set("/app/renderer/resolution/width", VIEW_W)
                settings.set("/app/renderer/resolution/height", VIEW_H)
                self._apply_stream_quality(settings)
            except Exception:
                pass

            stage = omni.usd.get_context().get_stage()
            if stage is None:
                return
            cam = stage.GetPrimAtPath(cam_path)
            if not cam or not cam.IsValid():
                cam_xf = UsdGeom.Camera.Define(stage, cam_path)
                xf = UsdGeom.Xformable(cam_xf.GetPrim())
                xf.ClearXformOpOrder()
                xf.AddTranslateOp().Set(Gf.Vec3d(55.0, 85.0, 110.0))
                xf.AddRotateXYZOp().Set(Gf.Vec3f(-36.0, 38.0, 0.0))
            else:
                xf = UsdGeom.Xformable(cam)
                xf.ClearXformOpOrder()
                xf.AddTranslateOp().Set(Gf.Vec3d(55.0, 85.0, 110.0))
                xf.AddRotateXYZOp().Set(Gf.Vec3f(-36.0, 38.0, 0.0))

            from omni.kit.viewport.utility import get_active_viewport

            # Drop editor selection outline so the stream is clean 3D only
            try:
                import omni.kit.commands as kit_commands

                kit_commands.execute("SelectPrims", old_selected_paths=[], new_selected_paths=[], expand_in_stage=False)
            except Exception:
                try:
                    sel = omni.usd.get_context().get_selection()
                    sel.clear_selected_prim_paths()
                except Exception:
                    pass

            vp = get_active_viewport()
            if vp is not None:
                try:
                    vp.set_active_camera(cam_path)
                except Exception:
                    try:
                        vp.camera_path = cam_path
                    except Exception:
                        pass
                # Force 1080p framebuffer for the City Lab stream
                try:
                    if hasattr(vp, "set_texture_resolution"):
                        vp.set_texture_resolution((VIEW_W, VIEW_H))
                    elif hasattr(vp, "set_hd_resolution"):
                        vp.set_hd_resolution((VIEW_W, VIEW_H))
                except Exception as exc:
                    carb.log_warn(f"[citylab.traffic] 1080p set failed: {exc}")
                try:
                    import carb.settings

                    s = carb.settings.get_settings()
                    s.set("/app/renderer/resolution/width", VIEW_W)
                    s.set("/app/renderer/resolution/height", VIEW_H)
                    s.set("/app/window/width", VIEW_W)
                    s.set("/app/window/height", VIEW_H)
                except Exception:
                    pass
                carb.log_info(f"[citylab.traffic] viewport-only {VIEW_W}x{VIEW_H} → {cam_path}")
            for _ in range(5):
                await omni.kit.app.get_app().next_update_async()
        except Exception as exc:
            carb.log_warn(f"[citylab.traffic] camera frame: {exc}")

    async def _bounce_livestream_slot(self) -> None:
        """Best-effort slot free. Prefer client terminate + TCP kill; avoid NVST bounce."""
        # Extension disable/enable of livestream.webrtc puts NVST in INVALID_STATE.
        # Record the request so /api/stream-slot can report it; host script does the rest.
        info = {
            "ok": True,
            "detail": "queued for host release (terminate clients + TCP kill)",
            "hint": "UI Free stream slot / scripts/release_stream_slot.sh",
        }
        stream_control.set_last_release(info)
        carb.log_warn(f"[citylab.stream] slot release noted: {info['detail']}")

    def _on_update(self, _e) -> None:
        # Guard against subscription + asyncio both firing the same frame
        if getattr(self, "_in_update", False):
            return
        self._in_update = True
        try:
            self._on_update_inner(_e)
        finally:
            self._in_update = False

    def _on_update_inner(self, _e) -> None:
        if stream_control.consume_release():
            asyncio.ensure_future(self._bounce_livestream_slot())
        self._frame += 1
        if self._frame == 1:
            stream_control.set_boot(
                stage="ticking",
                label="Simulation ticking — waiting for stream client",
                percent=92,
                ticking=True,
            )
        # Swap in Isaac Dynamic Sky once settled (stream client required only in livestream mode)
        if (
            self._dynamic_sky_pending
            and not self._dynamic_sky_applied
            and self._frame >= 90
            and (
                not self._signaling_listening()
                or self._webrtc_client_connected()
            )
        ):
            self._dynamic_sky_pending = False
            carb.log_warn("[citylab.traffic] load settled — applying Dynamic Sky")
            self._ensure_environment_lights(prefer_dynamic=True)
        # Start SUMO after load (and after stream client when livestream is active)
        if self._sumo_pending and self._traci is None and self._sumo_ready_to_start():
            carb.log_warn("[citylab.traffic] load settled — starting SUMO")
            self._start_sumo()
        if self._frame == 1 or self._frame % 120 == 0:
            # Keep camera locked; streaming apps sometimes reset Persp
            try:
                from omni.kit.viewport.utility import get_active_viewport

                vp = get_active_viewport()
                if vp is not None:
                    try:
                        vp.set_active_camera("/World/Camera")
                    except Exception:
                        try:
                            vp.camera_path = "/World/Camera"
                        except Exception:
                            pass
            except Exception:
                pass
        if self._capture_enabled:
            if self._capture_pending and self._frame - self._capture_started_at > 45:
                self._capture_pending = False
            # ~10 Hz capture — enough for UI, lighter than every other frame
            if self._frame % 6 == 0:
                self._capture_viewport()
        if self._frame == 1 or self._frame % 300 == 0:
            carb.log_warn(f"[citylab.traffic] tick frame={self._frame} capture={self._capture_enabled}")
        if self._traci is None:
            return
        try:
            # ~traffic Hz vs Kit frame rate
            if self._frame % max(1, _TRAFFIC_SYNC_EVERY) != 0:
                return
            self._traci.simulationStep()
            if (
                not self._traci.vehicle.getIDList()
                and not self._traci.person.getIDList()
                and self._traci.simulation.getMinExpectedNumber() == 0
            ):
                reload = ["-c", str(self._sumo_cfg), "--start", "--no-step-log", "true"]
                reload.extend(_sumo_ped_model_args())
                self._traci.load(reload)
                return

            vehicles = []
            for vid in list(self._traci.vehicle.getIDList())[:MAX_VEH]:
                sx, sy = self._traci.vehicle.getPosition(vid)
                angle = self._traci.vehicle.getAngle(vid)
                ux, uz = _sumo_to_usd(sx, sy, self._net_w, self._net_h)
                yaw = -(angle - 90.0) + _CAR_YAW_OFFSET_DEG
                # Mesh grounded at y=0 (wheel contact); tiny lift avoids z-fight
                vehicles.append((vid, ux, 0.02, uz, yaw))

            pedestrians = []
            ribbons = self._sidewalk_ribbons
            all_pids = [str(p) for p in self._traci.person.getIDList()]
            alive = set(all_pids)

            def _person_type(pid: str) -> str:
                try:
                    return str(self._traci.person.getTypeID(pid))
                except Exception:
                    return "adult"

            robot_pids = [p for p in all_pids if _is_delivery_robot(_person_type(p))]
            human_pids = [p for p in all_pids if p not in set(robot_pids)]
            # Prefer delivery robots in the sticky follow set (capped separately).
            self._ped_follow_ids = [p for p in self._ped_follow_ids if p in alive]
            follow_robots = [p for p in self._ped_follow_ids if p in set(robot_pids)]
            follow_humans = [p for p in self._ped_follow_ids if p not in set(robot_pids)]
            for p in robot_pids:
                if len(follow_robots) >= MAX_ROBOT:
                    break
                if p not in follow_robots:
                    follow_robots.append(p)
            human_slots = max(0, MAX_PED - len(follow_robots))
            for p in human_pids:
                if len(follow_humans) >= human_slots:
                    break
                if p not in follow_humans:
                    follow_humans.append(p)
            self._ped_follow_ids = follow_robots + follow_humans[:human_slots]
            live_pids: set[str] = set(self._ped_follow_ids)
            for pid in self._ped_follow_ids:
                sx, sy = self._traci.person.getPosition(pid)
                try:
                    angle = float(self._traci.person.getAngle(pid))
                except Exception:
                    angle = 0.0
                try:
                    lane_id = self._traci.person.getLaneID(pid)
                except Exception:
                    lane_id = ""
                try:
                    speed = float(self._traci.person.getSpeed(pid))
                except Exception:
                    speed = 1.0
                try:
                    lane_pos = float(self._traci.person.getLanePosition(pid))
                except Exception:
                    lane_pos = 0.0
                if ribbons and PED_MODEL != "jupedsim":
                    # Striping sits on lane centre-lines — snap onto CityGen sidewalk ribbons.
                    # JuPedSim already places agents in continuous 2D; snapping would collapse
                    # their natural spacing back into a blob.
                    sx, sy = self._smooth_sidewalk_pose(
                        str(pid), sx, sy, lane_id, ribbons, speed=speed, lane_pos=lane_pos
                    )
                elif PED_MODEL != "jupedsim":
                    offset = _ped_lateral_offset_m(self._traci, pid)
                    if offset:
                        sx, sy = _sidewalk_offset_sumo(sx, sy, angle, offset)
                ux, uz = _sumo_to_usd(sx, sy, self._net_w, self._net_h)
                yaw = -(angle - 90.0) + _PED_YAW_OFFSET_DEG
                try:
                    ptype = self._traci.person.getTypeID(pid)
                except Exception:
                    ptype = "adult"
                pedestrians.append((pid, ux, 0.05, uz, yaw, ptype))

            # Light safety net only — JuPedSim should already keep ~0.5–1 m gaps.
            sep = 0.55 if PED_MODEL == "jupedsim" else 0.85
            pedestrians = _separate_pedestrians_xz(pedestrians, min_dist_m=sep)

            # Drop sticky state for people who left the sim
            for stale in list(self._ped_sidewalk_state.keys()):
                if stale not in live_pids:
                    self._ped_sidewalk_state.pop(stale, None)

            self._veh = len(vehicles)
            self._ped = len(pedestrians)
            self._sync_prims(vehicles, pedestrians)
            # USD XZ poses for City Lab 2D map (prefer TraCI over vision).
            # Also project robots → camera UV so Yardline CV can box them
            # (YOLO will not see amber curb cubes as "robot").
            stage = omni.usd.get_context().get_stage()
            cam_path = "/World/Camera"
            vw = int(getattr(viewstream.STATE, "width", 0) or VIEW_W)
            vh = int(getattr(viewstream.STATE, "height", 0) or VIEW_H)

            def _with_uv(aid, ux, uy, uz, yaw, ptype, cls_name: str) -> dict:
                row = {
                    "id": str(aid),
                    "x": round(float(ux), 2),
                    "z": round(float(uz), 2),
                    "yaw": round(float(yaw), 1),
                    "cls": cls_name,
                    "type": str(ptype),
                }
                if stage is not None and cls_name == "robot" and _ROBOT_PUBLISH_UV:
                    uv = _project_world_to_uv(stage, cam_path, ux, uy, uz, vw, vh)
                    if uv is not None:
                        u, v = uv
                        row["u"] = round(u, 1)
                        row["v"] = round(v, 1)
                        row["bbox"] = _robot_bbox_from_foot(u, v, vw, vh)
                        # Aim a short heading tick in image space from yaw (USD Y-up).
                        rad = math.radians(float(yaw))
                        row["aim_uv"] = [
                            round(u, 1),
                            round(v, 1),
                            round(u + math.sin(rad) * 22.0, 1),
                            round(v - math.cos(rad) * 22.0, 1),
                        ]
                        if not getattr(self, "_robot_uv_ok", False):
                            carb.log_warn(
                                f"[citylab.traffic] robot UV ok {aid} → ({row['u']},{row['v']}) @{vw}x{vh}"
                            )
                            self._robot_uv_ok = True
                    elif self._frame % 300 == 0:
                        carb.log_warn(
                            f"[citylab.traffic] robot UV miss {aid} xyz=({ux:.1f},{uy:.1f},{uz:.1f})"
                        )
                return row

            viewstream.STATE.publish_actors(
                [
                    {
                        "id": str(vid),
                        "x": round(float(ux), 2),
                        "z": round(float(uz), 2),
                        "yaw": round(float(yaw), 1),
                        "cls": "vehicle",
                    }
                    for vid, ux, _uy, uz, yaw in vehicles
                ],
                [
                    _with_uv(
                        pid,
                        ux,
                        uy,
                        uz,
                        yaw,
                        ptype,
                        "robot" if _is_delivery_robot(str(ptype)) else "person",
                    )
                    for pid, ux, uy, uz, yaw, ptype in pedestrians
                ],
                span_m=CITY_SPAN_M,
            )
        except Exception as exc:
            if self._frame % 60 == 0:
                carb.log_warn(f"[citylab.traffic] sync: {exc}")

    def _capture_viewport(self) -> None:
        if self._capture_pending:
            return
        try:
            from omni.kit.viewport.utility import capture_viewport_to_buffer, get_active_viewport

            vp = get_active_viewport()
            if vp is None:
                if self._frame <= 5 or self._frame % 180 == 0:
                    carb.log_warn("[citylab.view] no active viewport yet")
                return
            self._capture_pending = True
            self._capture_started_at = self._frame

            def _on_buffer(buffer, buffer_size, width, height, *_rest) -> None:
                self._capture_pending = False
                try:
                    jpeg = viewstream.buffer_to_jpeg(buffer, buffer_size, int(width), int(height))
                    if jpeg:
                        viewstream.STATE.publish(jpeg, int(width), int(height), self._veh, self._ped)
                        if self._frame <= 10 or self._frame % 300 == 0:
                            carb.log_warn(
                                f"[citylab.view] frame {self._frame} {width}x{height} jpeg={len(jpeg)}"
                            )
                    elif self._frame <= 10 or self._frame % 180 == 0:
                        carb.log_warn(
                            f"[citylab.view] jpeg empty buf={buffer_size} {width}x{height} type={type(buffer)}"
                        )
                except Exception as exc:
                    carb.log_warn(f"[citylab.view] buffer: {exc}")

            capture_viewport_to_buffer(vp, _on_buffer, is_hdr=False)
        except Exception as exc:
            self._capture_pending = False
            carb.log_warn(f"[citylab.view] capture: {exc}")

    def _smooth_sidewalk_pose(
        self,
        pid: str,
        sx: float,
        sy: float,
        lane_id: str,
        ribbons: list[dict],
        speed: float = 1.0,
        lane_pos: float = 0.0,
    ) -> tuple[float, float]:
        """Pin walkers to CityGen sidewalk/crosswalk ribbons; lerp so junctions don't jump."""
        state = self._ped_sidewalk_state.get(pid)
        edge = _edge_from_lane(lane_id)
        ped = _parse_ped_edge(edge)

        def _step(prev: float, goal: float, lim: float) -> float:
            return prev + max(-lim, min(lim, goal - prev))

        def _store(direction: str, line: float, side: str, vis_x: float, vis_y: float) -> tuple[float, float]:
            self._ped_sidewalk_state[pid] = {
                "dir": direction,
                "line": line,
                "side": side,
                "vis_x": vis_x,
                "vis_y": vis_y,
            }
            return vis_x, vis_y

        # Baked sidewalk / crossing graph — snap lateral to mesh ribbon centers.
        if ped is not None:
            direction = str(ped["dir"])
            line = float(ped["line"])
            side = str(ped["side"])
            ribbon = _ribbon_for(ribbons, direction, line, side)
            prev_x = float(state["vis_x"]) if state else sx
            prev_y = float(state["vis_y"]) if state else sy
            if ribbon is None:
                # Still trust SUMO along-path motion; just smooth large jumps.
                if state is None:
                    return _store(direction, line, side, sx, sy)
                return _store(
                    direction,
                    line,
                    side,
                    _step(prev_x, sx, _PED_POS_STEP_M),
                    _step(prev_y, sy, _PED_POS_STEP_M),
                )
            crossing = str(ped.get("kind")) == "CR"
            center = float(ribbon["center_sumo"])
            # Crossings: pin hard to ribbon centre (no curb-side spread into asphalt).
            # Sidewalks: keep band/keep-right spread.
            if crossing:
                # Building-side inset so waiters sit on tiles, not the zebra/curb.
                half_w = 0.5 * float(ribbon.get("width_m") or 4.0)
                inset = min(0.9, max(0.35, half_w * 0.35))
                target = center - inset if center < line else center + inset
            elif (
                state is not None
                and state.get("dir") == direction
                and str(state.get("side")) == side
            ):
                target = float(state["vis_x"] if direction == "NS" else state["vis_y"])
            else:
                target = _ped_lateral_target(
                    pid,
                    ribbon,
                    _PED_BANDS.get(str(ped.get("edge") or "")),
                    bool(ped.get("rev")),
                    False,
                )

            along = (
                (zlib.crc32(f"{pid}|along".encode("utf-8")) % 1001) / 1000.0 - 0.5
            ) * (0.25 if crossing else 0.45)

            # Jammed / queued on a crossing → hold at the nearer sidewalk corner
            # instead of stacking mid-zebra where SUMO striping deadlocks.
            if crossing and speed < 0.45 and lane_id and self._traci is not None:
                try:
                    shape = self._traci.lane.getShape(lane_id)
                    lane_len = float(self._traci.lane.getLength(lane_id)) or 1.0
                    if shape:
                        end = shape[0] if lane_pos < 0.5 * lane_len else shape[-1]
                        sx, sy = float(end[0]), float(end[1])
                        along = (
                            (zlib.crc32(f"{pid}|wait".encode("utf-8")) % 1001) / 1000.0 - 0.5
                        ) * 1.2
                except Exception:
                    pass

            if direction == "NS":
                goal_x, goal_y = target, sy + along
            else:
                goal_x, goal_y = sx + along, target
            if state is None:
                return _store(direction, line, side, goal_x, goal_y)
            axis_flip = str(state.get("dir")) != direction
            lat_lim = _PED_POS_STEP_M if axis_flip or crossing else _PED_LATERAL_STEP_M
            free_lim = _PED_POS_STEP_M
            return _store(
                direction,
                line,
                side,
                _step(prev_x, goal_x, lat_lim if direction == "NS" else free_lim),
                _step(prev_y, goal_y, lat_lim if direction == "EW" else free_lim),
            )

        # True junction / unknown: keep the last sidewalk lateral pin when we have one,
        # otherwise people slam into the carriageway centre where SUMO junctions sit.
        if edge.startswith(":") or (ped is None and _corridor_from_lane(lane_id) is None):
            if state is not None and state.get("dir") in ("NS", "EW") and state.get("side") not in (None, "?"):
                direction = str(state["dir"])
                line = float(state["line"])
                side = str(state["side"])
                ribbon = _ribbon_for(ribbons, direction, line, side)
                prev_x = float(state["vis_x"])
                prev_y = float(state["vis_y"])
                if ribbon is not None:
                    target = float(ribbon["center_sumo"])
                    if direction == "NS":
                        goal_x, goal_y = target, sy
                    else:
                        goal_x, goal_y = sx, target
                    return _store(
                        direction,
                        line,
                        side,
                        _step(prev_x, goal_x, _PED_LATERAL_STEP_M if direction == "NS" else _PED_POS_STEP_M),
                        _step(prev_y, goal_y, _PED_LATERAL_STEP_M if direction == "EW" else _PED_POS_STEP_M),
                    )
            if state is None:
                return _store("?", 0.0, "?", sx, sy)
            prev_x = float(state["vis_x"])
            prev_y = float(state["vis_y"])
            return _store(
                str(state.get("dir", "?")),
                float(state.get("line", 0.0)),
                str(state.get("side", "?")),
                _step(prev_x, sx, _PED_POS_STEP_M),
                _step(prev_y, sy, _PED_POS_STEP_M),
            )

        # Legacy fallback: vehicle-lane person → snap to nearest sidewalk ribbon.
        direction, line = _corridor_from_lane(lane_id)  # type: ignore[misc]
        sticky_side = state.get("side") if state else None
        side = _pick_side(direction, line, sx, sy, sticky_side)
        ribbon = _ribbon_for(ribbons, direction, line, side)
        if ribbon is None:
            alt = {"L": "R", "R": "L", "B": "T", "T": "B"}.get(side)
            ribbon = _ribbon_for(ribbons, direction, line, alt) if alt else None
            if ribbon:
                side = alt  # type: ignore[assignment]
        if ribbon is None:
            return sx, sy

        target = float(ribbon["center_sumo"])
        prev_x = float(state["vis_x"]) if state else sx
        prev_y = float(state["vis_y"]) if state else sy
        if direction == "NS":
            if state is None:
                return _store(direction, line, side, target, sy)
            return _store(direction, line, side, _step(prev_x, target, _PED_LATERAL_STEP_M), sy)
        if state is None:
            return _store(direction, line, side, sx, target)
        return _store(direction, line, side, sx, _step(prev_y, target, _PED_LATERAL_STEP_M))

    def _sync_prims(self, vehicles, pedestrians) -> None:
        stage = omni.usd.get_context().get_stage()
        if stage is None:
            return
        root = stage.GetPrimAtPath(TRAFFIC_ROOT)
        if not root or not root.IsValid():
            UsdGeom.Xform.Define(stage, TRAFFIC_ROOT)
            UsdGeom.Xform.Define(stage, f"{TRAFFIC_ROOT}/Vehicles")
            UsdGeom.Xform.Define(stage, f"{TRAFFIC_ROOT}/Pedestrians")

        self._apply_vehicle_actors(stage, f"{TRAFFIC_ROOT}/Vehicles", vehicles)
        self._apply_pedestrian_actors(stage, f"{TRAFFIC_ROOT}/Pedestrians", pedestrians)

    def _vehicle_asset_for(self, aid: str) -> tuple[Path, Gf.Vec3f]:
        # Spread across all mesh types: Python's hash() is salted per process,
        # so use a stable checksum so sedan/taxi/police/etc. all show up.
        h = sum(ord(c) for c in str(aid))
        mesh_name = _CAR_MESHES[h % len(_CAR_MESHES)]
        color = _CAR_PAINT[h % len(_CAR_PAINT)]
        return self._root / "assets" / "vehicles" / mesh_name, color

    def _bind_car_paint(self, stage, body_path: str, color: Gf.Vec3f) -> None:
        """Fallback paint only when the referenced car has no materials."""
        body = stage.GetPrimAtPath(body_path)
        if not body or not body.IsValid():
            return
        has_mat = False
        for prim in Usd.PrimRange(body):
            if prim.IsA(UsdShade.Material):
                has_mat = True
                break
            if prim.IsA(UsdGeom.Mesh):
                bound = UsdShade.MaterialBindingAPI(prim).GetDirectBinding().GetMaterial()
                if bound:
                    has_mat = True
                    break
        if has_mat:
            return
        mat_path = f"{body_path}/Looks/Paint"
        mat = UsdShade.Material.Define(stage, mat_path)
        shader = UsdShade.Shader.Define(stage, f"{mat_path}/Shader")
        shader.CreateIdAttr("UsdPreviewSurface")
        shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(color)
        shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.35)
        shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.15)
        mat.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
        for prim in Usd.PrimRange(body):
            if prim.IsA(UsdGeom.Mesh):
                UsdShade.MaterialBindingAPI.Apply(prim).Bind(mat)

    def _apply_vehicle_actors(self, stage, parent_path, actors) -> None:
        parent = stage.GetPrimAtPath(parent_path)
        if not parent or not parent.IsValid():
            UsdGeom.Xform.Define(stage, parent_path)

        live = set()
        for item in actors:
            aid, x, y, z, yaw = item
            safe = "".join(c if c.isalnum() or c == "_" else "_" for c in str(aid))
            path = f"{parent_path}/car_{_CAR_PRIM_REV}_{safe}"
            live.add(path)
            prim = stage.GetPrimAtPath(path)
            if not prim or not prim.IsValid():
                asset, color = self._vehicle_asset_for(str(aid))
                xform = UsdGeom.Xform.Define(stage, path)
                prim = xform.GetPrim()
                body_path = f"{path}/Body"
                if stage.GetPrimAtPath(body_path):
                    stage.RemovePrim(body_path)
                if asset.is_file():
                    body = stage.DefinePrim(body_path, "Xform")
                    body.GetReferences().AddReference(
                        Sdf.Reference(assetPath=str(asset), primPath="/Car")
                    )
                    if abs(_CAR_MESH_SCALE - 1.0) > 1e-3:
                        UsdGeom.Xformable(body).AddScaleOp().Set(
                            Gf.Vec3f(_CAR_MESH_SCALE)
                        )
                    self._bind_car_paint(stage, body_path, color)
                    if getattr(self, "_car_spawn_logged", 0) < 6:
                        self._car_spawn_logged = getattr(self, "_car_spawn_logged", 0) + 1
                        carb.log_warn(f"[citylab.traffic] spawn {safe} → {asset}")
                else:
                    cube = UsdGeom.Cube.Define(stage, body_path)
                    cube.CreateSizeAttr(1.0)
                    cube.AddScaleOp().Set(
                        Gf.Vec3f(4.5 * _CAR_MESH_SCALE, 1.5 * _CAR_MESH_SCALE, 2.0 * _CAR_MESH_SCALE)
                    )
                    cube.GetDisplayColorAttr().Set([color])
                    carb.log_warn(f"[citylab.traffic] missing car mesh {asset}")
            _set_actor_xform(prim, x, y, z, yaw)

        for child in list(stage.GetPrimAtPath(parent_path).GetChildren()):
            if child.GetPath().pathString not in live:
                stage.RemovePrim(child.GetPath())

    def _pedestrian_asset_for(self, type_id: str, actor_id: str = "") -> Path:
        return self._root / "assets" / "people" / _ped_mesh_name(type_id, actor_id)

    def _robot_asset_for(self) -> Path:
        return self._root / "assets" / "robots" / _ROBOT_ASSET_NAME

    def _apply_pedestrian_actors(self, stage, parent_path, pedestrians) -> None:
        parent = stage.GetPrimAtPath(parent_path)
        if not parent or not parent.IsValid():
            UsdGeom.Xform.Define(stage, parent_path)

        size = Gf.Vec3f(0.55, 1.75, 0.45)
        live = set()
        for item in pedestrians:
            aid, x, y, z, yaw, ptype = item[:6]
            safe = "".join(c if c.isalnum() or c == "_" else "_" for c in str(aid))
            is_bot = _is_delivery_robot(str(ptype))
            prefix = f"robot_{_ROBOT_PRIM_REV}" if is_bot else f"ped_{_PED_PRIM_REV}"
            path = f"{parent_path}/{prefix}_{safe}"
            live.add(path)
            color = _ped_color(str(ptype))
            prim = stage.GetPrimAtPath(path)
            if not prim or not prim.IsValid():
                UsdGeom.Xform.Define(stage, path)
                prim = stage.GetPrimAtPath(path)
                body_path = f"{path}/Body"
                if stage.GetPrimAtPath(body_path):
                    stage.RemovePrim(body_path)
                if is_bot:
                    asset = self._robot_asset_for()
                    if asset.is_file():
                        body = stage.DefinePrim(body_path, "Xform")
                        body.GetReferences().AddReference(
                            Sdf.Reference(
                                assetPath=str(asset),
                                primPath=_ROBOT_PRIM_PATH,
                            )
                        )
                        xf_body = UsdGeom.Xformable(body)
                        if abs(_ROBOT_MESH_SCALE - 1.0) > 1e-3:
                            xf_body.AddScaleOp().Set(
                                Gf.Vec3f(_ROBOT_MESH_SCALE)
                            )
                        if self._ped_spawn_logged < 8:
                            carb.log_warn(
                                f"[citylab.traffic] spawn robot {safe} → {asset.name} ×{_ROBOT_MESH_SCALE}"
                            )
                            self._ped_spawn_logged += 1
                    else:
                        cube = UsdGeom.Cube.Define(stage, body_path)
                        cube.CreateSizeAttr(1.0)
                        cube.AddScaleOp().Set(_ROBOT_CUBE_SIZE)
                        cube.GetDisplayColorAttr().Set([color])
                        carb.log_warn(f"[citylab.traffic] missing robot mesh {asset}")
                else:
                    asset = self._pedestrian_asset_for(str(ptype), str(aid))
                    if asset.is_file():
                        body = stage.DefinePrim(body_path, "Xform")
                        body.GetReferences().AddReference(
                            Sdf.Reference(assetPath=str(asset), primPath="/Person")
                        )
                        if self._ped_spawn_logged < 4:
                            carb.log_warn(
                                f"[citylab.traffic] spawn ped {safe} ({ptype}) → {asset.name}"
                            )
                            self._ped_spawn_logged += 1
                    else:
                        cube = UsdGeom.Cube.Define(stage, body_path)
                        cube.CreateSizeAttr(1.0)
                        cube.AddScaleOp().Set(size)
                        cube.GetDisplayColorAttr().Set([color])
                        carb.log_warn(f"[citylab.traffic] missing ped mesh {asset}")
            bot_yaw = float(yaw) + (_ROBOT_YAW_OFFSET_DEG if is_bot else 0.0)
            ground_y = 0.02 if is_bot else y
            _set_actor_xform(prim, x, ground_y, z, bot_yaw)

        for child in list(stage.GetPrimAtPath(parent_path).GetChildren()):
            if child.GetPath().pathString not in live:
                stage.RemovePrim(child.GetPath())

    def _apply_actors(self, stage, parent_path, prefix, actors, size, color) -> None:
        parent = stage.GetPrimAtPath(parent_path)
        if not parent or not parent.IsValid():
            UsdGeom.Xform.Define(stage, parent_path)

        live = set()
        for item in actors:
            aid, x, y, z, yaw = item
            safe = "".join(c if c.isalnum() or c == "_" else "_" for c in str(aid))
            path = f"{parent_path}/{prefix}_{safe}"
            live.add(path)
            prim = stage.GetPrimAtPath(path)
            if not prim or not prim.IsValid():
                xform = UsdGeom.Xform.Define(stage, path)
                cube = UsdGeom.Cube.Define(stage, f"{path}/Body")
                cube.CreateSizeAttr(1.0)
                cube.AddScaleOp().Set(size)
                cube.GetDisplayColorAttr().Set([color])
                prim = xform.GetPrim()
            xf = UsdGeom.Xformable(prim)
            # Prefer cheap in-place update when ops already exist
            ops = xf.GetOrderedXformOps()
            if len(ops) >= 1 and ops[0].GetOpType() == UsdGeom.XformOp.TypeTranslate:
                ops[0].Set(Gf.Vec3d(x, y, z))
                if abs(yaw) > 1e-3 or prefix == "car":
                    if len(ops) >= 2:
                        ops[1].Set(Gf.Vec3f(0.0, float(yaw), 0.0))
                    else:
                        xf.AddRotateXYZOp().Set(Gf.Vec3f(0.0, float(yaw), 0.0))
            else:
                xf.ClearXformOpOrder()
                xf.AddTranslateOp().Set(Gf.Vec3d(x, y, z))
                if abs(yaw) > 1e-3 or prefix == "car":
                    xf.AddRotateXYZOp().Set(Gf.Vec3f(0.0, float(yaw), 0.0))

        # prune stale
        for child in list(stage.GetPrimAtPath(parent_path).GetChildren()):
            if child.GetPath().pathString not in live:
                stage.RemovePrim(child.GetPath())
