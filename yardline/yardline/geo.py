from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from yardline.incidents import list_incidents
from yardline.sites import get_active_site, get_site, snapshot_for_source
from yardline.store import load_plane_bundle

ROOT = Path(__file__).resolve().parent.parent


def normalize_origin(geo: dict[str, Any] | None) -> dict[str, Any] | None:
    if not geo:
        return None
    try:
        lat = float(geo["lat"])
        lon = float(geo["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    return {
        "lat": lat,
        "lon": lon,
        "alt": float(geo.get("alt") or 0.0),
        "crs": str(geo.get("crs") or "EPSG:4326"),
        "bearing_deg": float(geo.get("bearing_deg") or 0.0),
    }


def local_to_lonlat(
    x_m: float,
    y_m: float,
    origin: dict[str, Any],
    *,
    offset_m: list[float] | tuple[float, float] | None = None,
) -> tuple[float, float]:
    """Map site-local meters (x eastish, y northish after bearing) to WGS84."""
    ox = float((offset_m or [0.0, 0.0])[0])
    oy = float((offset_m or [0.0, 0.0])[1])
    x = float(x_m) + ox
    y = float(y_m) + oy
    bearing = math.radians(float(origin.get("bearing_deg") or 0.0))
    # Rotate local XY so bearing_deg is the compass heading of +Y.
    east = x * math.cos(bearing) + y * math.sin(bearing)
    north = -x * math.sin(bearing) + y * math.cos(bearing)
    lat0 = float(origin["lat"])
    lon0 = float(origin["lon"])
    dlat = north / 111_320.0
    cos_lat = math.cos(math.radians(lat0))
    dlon = east / (111_320.0 * max(1e-6, cos_lat))
    return lon0 + dlon, lat0 + dlat


def point_feature(
    x_m: float,
    y_m: float,
    origin: dict[str, Any],
    *,
    props: dict[str, Any] | None = None,
    offset_m: list[float] | None = None,
) -> dict[str, Any]:
    lon, lat = local_to_lonlat(x_m, y_m, origin, offset_m=offset_m)
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
        "properties": props or {},
    }


def polygon_feature(
    poly_m: list[list[float]],
    origin: dict[str, Any],
    *,
    props: dict[str, Any] | None = None,
    offset_m: list[float] | None = None,
) -> dict[str, Any] | None:
    if not poly_m or len(poly_m) < 3:
        return None
    ring = [list(local_to_lonlat(p[0], p[1], origin, offset_m=offset_m)) for p in poly_m]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [[[round(a, 7), round(b, 7)] for a, b in ring]]},
        "properties": props or {},
    }


def build_site_geojson(
    *,
    site_id: str | None = None,
    include_incidents: bool = True,
    limit_incidents: int = 100,
) -> dict[str, Any]:
    site = get_site(site_id) if site_id else get_active_site()
    if site is None:
        raise ValueError("No site selected")
    origin = normalize_origin(site.get("origin_geo"))
    if origin is None:
        raise ValueError("Site needs origin_geo (lat/lon) before GIS export")

    features: list[dict[str, Any]] = []
    features.append(
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [origin["lon"], origin["lat"]],
            },
            "properties": {
                "kind": "site_origin",
                "site_id": site.get("id"),
                "name": site.get("name"),
                "kpi": site.get("kpi"),
                "bearing_deg": origin.get("bearing_deg"),
                "crs": origin.get("crs"),
            },
        }
    )

    for cam in site.get("cameras") or []:
        offset = list(cam.get("offset_m") or [0.0, 0.0])
        features.append(
            point_feature(
                0.0,
                0.0,
                origin,
                offset_m=offset,
                props={
                    "kind": "camera",
                    "site_id": site.get("id"),
                    "camera_id": cam.get("camera_id"),
                    "label": cam.get("label"),
                    "source": cam.get("source"),
                    "offset_m": offset,
                },
            )
        )
        source = cam.get("source") or ""
        bundle = load_plane_bundle(source) if source else None
        if bundle and bundle.get("world_points"):
            feat = polygon_feature(
                bundle["world_points"],
                origin,
                offset_m=offset,
                props={
                    "kind": "calibration_pad",
                    "site_id": site.get("id"),
                    "camera_id": cam.get("camera_id"),
                    "rms_px": bundle.get("rms_px"),
                },
            )
            if feat:
                features.append(feat)
        from yardline.store import load_zones

        for z in load_zones(source) if source else []:
            kind = z.get("kind") or "exclusion"
            if kind == "tripwire":
                a = z.get("a") or (z.get("polygon") or [None])[0]
                b = z.get("b") or (z.get("polygon") or [None, None])[1]
                if not a or not b:
                    continue
                lon1, lat1 = local_to_lonlat(a[0], a[1], origin, offset_m=offset)
                lon2, lat2 = local_to_lonlat(b[0], b[1], origin, offset_m=offset)
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [
                                [round(lon1, 7), round(lat1, 7)],
                                [round(lon2, 7), round(lat2, 7)],
                            ],
                        },
                        "properties": {
                            "kind": "tripwire",
                            "zone_id": z.get("id"),
                            "name": z.get("name"),
                            "site_id": site.get("id"),
                            "camera_id": cam.get("camera_id"),
                        },
                    }
                )
                continue
            feat = polygon_feature(
                z.get("polygon") or [],
                origin,
                offset_m=offset,
                props={
                    "kind": "zone",
                    "zone_kind": kind,
                    "zone_id": z.get("id"),
                    "name": z.get("name"),
                    "level": z.get("level"),
                    "site_id": site.get("id"),
                    "camera_id": cam.get("camera_id"),
                },
            )
            if feat:
                features.append(feat)

    if include_incidents:
        for inc in list_incidents(limit_incidents):
            if site.get("id") and inc.get("site_id") and inc.get("site_id") != site.get("id"):
                continue
            # Place incident at camera offset origin when no metric foot is stored.
            offset = [0.0, 0.0]
            for cam in site.get("cameras") or []:
                if cam.get("source") == inc.get("source") or cam.get("camera_id") == inc.get("camera_id"):
                    offset = list(cam.get("offset_m") or [0.0, 0.0])
                    break
            xy = inc.get("location_m")
            if isinstance(xy, (list, tuple)) and len(xy) >= 2:
                x_m, y_m = float(xy[0]), float(xy[1])
            else:
                x_m, y_m = 0.0, 0.0
            features.append(
                point_feature(
                    x_m,
                    y_m,
                    origin,
                    offset_m=offset,
                    props={
                        "kind": "incident",
                        "id": inc.get("id"),
                        "event_code": inc.get("event_code"),
                        "alarm": inc.get("alarm"),
                        "site_id": inc.get("site_id") or site.get("id"),
                        "camera_id": inc.get("camera_id"),
                        "created_at": inc.get("created_at"),
                        "still": inc.get("still"),
                    },
                )
            )

    return {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "site_id": site.get("id"),
            "site_name": site.get("name"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "crs": origin.get("crs") or "EPSG:4326",
            "context": snapshot_for_source(None),
        },
    }


def save_geojson(collection: dict[str, Any], site_id: str | None = None) -> Path:
    out_dir = ROOT / "data" / "gis"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    sid = site_id or (collection.get("properties") or {}).get("site_id") or "site"
    path = out_dir / f"{sid}_{stamp}.geojson"
    path.write_text(json.dumps(collection, indent=2) + "\n", encoding="utf-8")
    return path
