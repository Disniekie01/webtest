from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
PRESET_FILE = ROOT / "data" / "stream_presets.json"


def list_stream_presets() -> list[dict[str, Any]]:
    if not PRESET_FILE.exists():
        return []
    data = json.loads(PRESET_FILE.read_text(encoding="utf-8"))
    return list(data.get("presets") or [])


def suggest_for_source(source: str | None) -> dict[str, Any] | None:
    if not source:
        return None
    needle = str(source).lower()
    for preset in list_stream_presets():
        for token in preset.get("match") or []:
            if str(token).lower() in needle:
                return preset
    return None
