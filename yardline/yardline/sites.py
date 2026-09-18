from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SITE_FILE = ROOT / "data" / "sites.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "site").strip().lower()).strip("-")
    return s[:48] or "site"


def _load_raw() -> dict[str, Any]:
    empty = {"sites": [], "active_site_id": None}
    if not SITE_FILE.exists():
        return empty
    text = SITE_FILE.read_text(encoding="utf-8").strip()
    if not text:
        return empty
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return empty
    if not isinstance(data, dict):
        return empty
    data.setdefault("sites", [])
    data.setdefault("active_site_id", None)
    return data


def _save_raw(data: dict[str, Any]) -> None:
    SITE_FILE.parent.mkdir(parents=True, exist_ok=True)
    SITE_FILE.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def list_sites() -> list[dict[str, Any]]:
    return list(_load_raw().get("sites") or [])


def get_active_site_id() -> str | None:
    return _load_raw().get("active_site_id")


def get_site(site_id: str | None) -> dict[str, Any] | None:
    if not site_id:
        return None
    for s in list_sites():
        if s.get("id") == site_id:
            return s
    return None


def get_active_site() -> dict[str, Any] | None:
    return get_site(get_active_site_id())


def set_active_site(site_id: str | None) -> dict[str, Any] | None:
    data = _load_raw()
    if site_id is None:
        data["active_site_id"] = None
        _save_raw(data)
        return None
    site = get_site(site_id)
    if site is None:
        raise ValueError(f"Unknown site: {site_id}")
    data["active_site_id"] = site_id
    _save_raw(data)
    return site


def upsert_site(payload: dict[str, Any]) -> dict[str, Any]:
    data = _load_raw()
    sites = list(data.get("sites") or [])
    sid = str(payload.get("id") or "").strip() or _slug(str(payload.get("name") or "site"))
    existing = next((s for s in sites if s.get("id") == sid), None) or {}
    cameras = payload.get("cameras")
    if cameras is None:
        cameras = existing.get("cameras") or []
    origin = payload.get("origin_geo")
    if origin is None and "origin_geo" not in payload:
        origin = existing.get("origin_geo")
    row = {
        "id": sid,
        "name": str(payload.get("name") or existing.get("name") or sid).strip() or sid,
        "kpi": str(payload.get("kpi") or existing.get("kpi") or "near_miss"),
        "note": str(payload.get("note") if payload.get("note") is not None else existing.get("note") or ""),
        "origin_geo": origin,
        "cameras": [_normalize_camera(c) for c in cameras],
        "updated_at": _now(),
    }
    out: list[dict[str, Any]] = []
    replaced = False
    for s in sites:
        if s.get("id") == sid:
            out.append(row)
            replaced = True
        else:
            out.append(s)
    if not replaced:
        out.append(row)
    data["sites"] = out
    if not data.get("active_site_id"):
        data["active_site_id"] = sid
    _save_raw(data)
    return row


def delete_site(site_id: str) -> bool:
    data = _load_raw()
    sites = list(data.get("sites") or [])
    next_rows = [s for s in sites if s.get("id") != site_id]
    if len(next_rows) == len(sites):
        return False
    data["sites"] = next_rows
    if data.get("active_site_id") == site_id:
        data["active_site_id"] = next_rows[0]["id"] if next_rows else None
    _save_raw(data)
    return True


def _normalize_camera(cam: dict[str, Any]) -> dict[str, Any]:
    offset = cam.get("offset_m") or [0.0, 0.0]
    if not isinstance(offset, (list, tuple)) or len(offset) < 2:
        offset = [0.0, 0.0]
    return {
        "camera_id": str(cam.get("camera_id") or cam.get("id") or "cam").strip() or "cam",
        "label": str(cam.get("label") or cam.get("name") or "Camera").strip() or "Camera",
        "source": str(cam.get("source") or "").strip(),
        "preset_id": cam.get("preset_id"),
        "offset_m": [float(offset[0]), float(offset[1])],
        "note": str(cam.get("note") or ""),
    }


def bind_camera(site_id: str, camera: dict[str, Any]) -> dict[str, Any]:
    site = get_site(site_id)
    if site is None:
        raise ValueError(f"Unknown site: {site_id}")
    cams = list(site.get("cameras") or [])
    row = _normalize_camera(camera)
    if not row["source"]:
        raise ValueError("Camera needs a source")
    out: list[dict[str, Any]] = []
    replaced = False
    for c in cams:
        if c.get("camera_id") == row["camera_id"] or c.get("source") == row["source"]:
            out.append(row)
            replaced = True
        else:
            out.append(c)
    if not replaced:
        out.append(row)
    return upsert_site({**site, "cameras": out})


def find_camera_for_source(source: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Return (site, camera) matching a source path/URL."""
    src = (source or "").strip()
    if not src:
        return None, None
    for site in list_sites():
        for cam in site.get("cameras") or []:
            if cam.get("source") == src:
                return site, cam
    return None, None


def snapshot_for_source(source: str | None, active_fallback: bool = True) -> dict[str, Any] | None:
    """Site context packet for a live source."""
    site = None
    cam = None
    if source:
        site, cam = find_camera_for_source(source)
    if site is None and active_fallback:
        site = get_active_site()
    if site is None:
        return None
    return {
        "site_id": site.get("id"),
        "site_name": site.get("name"),
        "kpi": site.get("kpi"),
        "origin_geo": site.get("origin_geo"),
        "camera_id": None if cam is None else cam.get("camera_id"),
        "camera_label": None if cam is None else cam.get("label"),
        "offset_m": [0.0, 0.0] if cam is None else list(cam.get("offset_m") or [0.0, 0.0]),
        "cameras": site.get("cameras") or [],
    }
