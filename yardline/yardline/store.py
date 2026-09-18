from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from yardline.geometry import GroundPlane
from yardline.sources import source_id

ROOT = Path(__file__).resolve().parent.parent
CAL_DIR = ROOT / "data" / "calibrations"
ZONE_DIR = ROOT / "data" / "zones"
LABEL_FILE = ROOT / "data" / "labels.jsonl"


def _stem(path: str) -> str:
    return source_id(path)


def load_plane(path: str) -> Optional[GroundPlane]:
    f = CAL_DIR / f"{_stem(path)}.json"
    if not f.exists():
        return None
    data = json.loads(f.read_text(encoding="utf-8"))
    return GroundPlane.from_dict(data)


def load_plane_bundle(path: str) -> dict[str, Any] | None:
    """Raw calibration JSON plus additive smart-city fields."""
    f = CAL_DIR / f"{_stem(path)}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def save_plane(
    path: str,
    plane: GroundPlane,
    *,
    site_id: str | None = None,
    geo_anchor: dict[str, Any] | None = None,
    preserve_extras: bool = True,
) -> Path:
    CAL_DIR.mkdir(parents=True, exist_ok=True)
    f = CAL_DIR / f"{_stem(path)}.json"
    payload = plane.to_dict()
    extras: dict[str, Any] = {}
    if preserve_extras and f.exists():
        try:
            old = json.loads(f.read_text(encoding="utf-8"))
            for key in ("site_id", "geo_anchor", "camera_id"):
                if key in old and old[key] is not None:
                    extras[key] = old[key]
        except Exception:
            extras = {}
    if site_id is not None:
        extras["site_id"] = site_id
    if geo_anchor is not None:
        extras["geo_anchor"] = geo_anchor
    payload.update(extras)
    f.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return f


def set_plane_geo(path: str, geo_anchor: dict[str, Any] | None, site_id: str | None = None) -> dict[str, Any]:
    bundle = load_plane_bundle(path)
    if bundle is None:
        raise FileNotFoundError("Calibrate this source before setting a geo anchor")
    if geo_anchor is not None:
        bundle["geo_anchor"] = geo_anchor
    elif "geo_anchor" in bundle:
        del bundle["geo_anchor"]
    if site_id is not None:
        bundle["site_id"] = site_id
    f = CAL_DIR / f"{_stem(path)}.json"
    f.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    return bundle


def delete_plane(path: str) -> None:
    f = CAL_DIR / f"{_stem(path)}.json"
    if f.exists():
        f.unlink()


def load_zones(path: str) -> list[dict[str, Any]]:
    from yardline.risk import _normalize_zone

    f = ZONE_DIR / f"{_stem(path)}.json"
    if not f.exists():
        return []
    raw = json.loads(f.read_text(encoding="utf-8"))
    return [_normalize_zone(z) for z in raw]


def save_zones(path: str, zones: list[dict[str, Any]]) -> Path:
    from yardline.risk import _normalize_zone

    ZONE_DIR.mkdir(parents=True, exist_ok=True)
    f = ZONE_DIR / f"{_stem(path)}.json"
    normalized = [_normalize_zone(z) for z in zones]
    f.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
    return f


MAP_DIR = ROOT / "data" / "maps"


def map_underlay_paths(path: str) -> tuple[Path, Path]:
    stem = _stem(path)
    return MAP_DIR / f"{stem}.jpg", MAP_DIR / f"{stem}.json"


def save_map_underlay(
    path: str,
    jpeg_bytes: bytes,
    *,
    world_rect: list[list[float]] | None = None,
) -> dict[str, Any]:
    MAP_DIR.mkdir(parents=True, exist_ok=True)
    img_path, meta_path = map_underlay_paths(path)
    img_path.write_bytes(jpeg_bytes)
    meta = {
        "source": path,
        "image": f"maps/{img_path.name}",
        "world_rect": world_rect,
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def load_map_underlay(path: str) -> dict[str, Any] | None:
    _img, meta_path = map_underlay_paths(path)
    if not meta_path.exists():
        return None
    return json.loads(meta_path.read_text(encoding="utf-8"))


def delete_map_underlay(path: str) -> None:
    img_path, meta_path = map_underlay_paths(path)
    if img_path.exists():
        img_path.unlink()
    if meta_path.exists():
        meta_path.unlink()


def append_label(record: dict[str, Any]) -> dict[str, Any]:
    LABEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    record = {
        **record,
        "labeled_at": datetime.now(timezone.utc).isoformat(),
    }
    with LABEL_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")
    return record


def list_labels(limit: int = 50) -> list[dict[str, Any]]:
    if not LABEL_FILE.exists():
        return []
    rows = []
    with LABEL_FILE.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows[-limit:]
