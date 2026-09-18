from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
TAXONOMY_FILE = ROOT / "data" / "events_taxonomy.json"

_cache: dict[str, Any] | None = None


def load_taxonomy() -> dict[str, Any]:
    global _cache
    if _cache is not None:
        return _cache
    if not TAXONOMY_FILE.exists():
        _cache = {"version": 1, "events": [], "kpis": []}
        return _cache
    _cache = json.loads(TAXONOMY_FILE.read_text(encoding="utf-8"))
    return _cache


def reload_taxonomy() -> dict[str, Any]:
    global _cache
    _cache = None
    return load_taxonomy()


def event_by_code(code: str) -> dict[str, Any] | None:
    for row in load_taxonomy().get("events") or []:
        if row.get("code") == code:
            return row
    return None


def kpi_by_id(kpi_id: str) -> dict[str, Any] | None:
    for row in load_taxonomy().get("kpis") or []:
        if row.get("id") == kpi_id:
            return row
    return None


def _zone_kinds(risk: dict[str, Any]) -> set[str]:
    kinds: set[str] = set()
    for hit in risk.get("zone_hits") or []:
        k = hit.get("kind") or hit.get("zone_kind")
        if k:
            kinds.add(str(k))
    return kinds


def resolve_event(
    *,
    kind: str,
    alarm: str | None = None,
    risk: dict[str, Any] | None = None,
    zone_kind: str | None = None,
) -> dict[str, Any]:
    """Map runtime outcomes to a stable city event code."""
    risk = risk or {}
    kinds = _zone_kinds(risk)
    if zone_kind:
        kinds.add(zone_kind)

    events = list(load_taxonomy().get("events") or [])

    def match_row(row: dict[str, Any]) -> bool:
        m = row.get("match") or {}
        if m.get("kind") and m["kind"] != kind:
            return False
        if m.get("alarm") and m["alarm"] != alarm:
            return False
        if m.get("zone_kind") and m["zone_kind"] not in kinds:
            return False
        return True

    # Prefer zone-specific codes when an intrusion is the primary signal.
    if kind == "alarm" and kinds:
        for prefer in ("exclusion", "path", "work"):
            if prefer not in kinds:
                continue
            for row in events:
                m = row.get("match") or {}
                if m.get("zone_kind") == prefer and match_row(row):
                    return {
                        "event_code": row["code"],
                        "event_label": row.get("label") or row["code"],
                        "category": row.get("category") or "other",
                        "severity": row.get("severity") or alarm or "advisory",
                    }

    for row in events:
        m = row.get("match") or {}
        if m.get("zone_kind"):
            continue
        if match_row(row):
            return {
                "event_code": row["code"],
                "event_label": row.get("label") or row["code"],
                "category": row.get("category") or "other",
                "severity": row.get("severity") or alarm or "advisory",
            }

    fallback = {
        "tripwire": "CITY.TRIPWIRE.CROSS",
        "alarm": "CITY.CLEARANCE_WARN",
    }.get(kind, "CITY.CLEARANCE_ADVISORY")
    meta = event_by_code(fallback) or {}
    return {
        "event_code": fallback,
        "event_label": meta.get("label") or fallback,
        "category": meta.get("category") or "other",
        "severity": meta.get("severity") or alarm or "advisory",
    }


def count_kpi(incidents: list[dict[str, Any]], kpi_id: str) -> dict[str, Any]:
    kpi = kpi_by_id(kpi_id) or {"id": kpi_id, "label": kpi_id, "event_codes": []}
    codes = set(kpi.get("event_codes") or [])
    n = sum(1 for inc in incidents if inc.get("event_code") in codes)
    return {
        "id": kpi.get("id") or kpi_id,
        "label": kpi.get("label") or kpi_id,
        "event_codes": list(codes),
        "count": n,
    }
