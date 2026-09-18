from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
PRESET_FILE = ROOT / "data" / "presets.json"


def _load() -> list[dict[str, Any]]:
    if not PRESET_FILE.exists():
        return []
    data = json.loads(PRESET_FILE.read_text(encoding="utf-8"))
    return list(data.get("presets") or [])


def _save(presets: list[dict[str, Any]]) -> None:
    PRESET_FILE.parent.mkdir(parents=True, exist_ok=True)
    PRESET_FILE.write_text(
        json.dumps({"presets": presets}, indent=2) + "\n",
        encoding="utf-8",
    )


def list_presets() -> list[dict[str, Any]]:
    return _load()


def upsert_preset(preset: dict[str, Any]) -> dict[str, Any]:
    presets = _load()
    pid = str(preset.get("id") or "").strip() or f"p{int(datetime.now(timezone.utc).timestamp())}"
    name = str(preset.get("name") or "Camera").strip() or "Camera"
    source = str(preset.get("source") or "").strip()
    if not source:
        raise ValueError("Preset needs a source URL or path.")
    row = {
        "id": pid,
        "name": name,
        "source": source,
        "note": str(preset.get("note") or ""),
        "site_id": preset.get("site_id") or None,
        "camera_id": preset.get("camera_id") or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    out: list[dict[str, Any]] = []
    replaced = False
    for p in presets:
        if p.get("id") == pid:
            out.append(row)
            replaced = True
        else:
            out.append(p)
    if not replaced:
        out.append(row)
    _save(out)
    return row


def delete_preset(preset_id: str) -> bool:
    presets = _load()
    next_rows = [p for p in presets if p.get("id") != preset_id]
    if len(next_rows) == len(presets):
        return False
    _save(next_rows)
    return True
