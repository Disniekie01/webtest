from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "config" / "default.json"
LOCAL_PATH = ROOT / "config" / "local.json"
WEIGHTS_DIR = ROOT / "weights"


def deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    path = Path(path) if path else DEFAULT_PATH
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    if LOCAL_PATH.exists():
        with open(LOCAL_PATH, "r", encoding="utf-8") as f:
            overlay = json.load(f)
        cfg = deep_merge(cfg, overlay)
    # Twin / City Lab overlay — applied last so Isaac co-run stays light.
    # Set YARDLINE_TWIN=1 (run_yardline_twin.sh) or YARDLINE_OVERLAY=/path/to.json
    import os

    overlay_env = (os.environ.get("YARDLINE_OVERLAY") or "").strip()
    twin_on = os.environ.get("YARDLINE_TWIN", "").strip().lower() in {"1", "true", "yes", "on"}
    twin_path = Path(overlay_env) if overlay_env else (ROOT / "config" / "twin.json" if twin_on else None)
    if twin_path is not None and twin_path.is_file():
        with open(twin_path, "r", encoding="utf-8") as f:
            cfg = deep_merge(cfg, json.load(f))
    return cfg


def load_default() -> dict[str, Any]:
    with open(DEFAULT_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_local(overlay: dict[str, Any]) -> dict[str, Any]:
    LOCAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCAL_PATH, "w", encoding="utf-8") as f:
        json.dump(overlay, f, indent=2)
        f.write("\n")
    return load_config()


def clear_local() -> dict[str, Any]:
    if LOCAL_PATH.exists():
        LOCAL_PATH.unlink()
    return load_config()


def list_weights() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not WEIGHTS_DIR.exists():
        return items
    for p in sorted(WEIGHTS_DIR.iterdir()):
        if p.suffix.lower() not in {".pt", ".engine"}:
            continue
        kind = "tensorrt" if p.suffix.lower() == ".engine" else "pytorch"
        items.append(
            {
                "path": f"weights/{p.name}",
                "name": p.name,
                "kind": kind,
                "size_mb": round(p.stat().st_size / (1024 * 1024), 2),
            }
        )
    return items


def setup_snapshot(cfg: dict[str, Any], *, device: str, gpu: str) -> dict[str, Any]:
    return {
        "device": device,
        "gpu": gpu,
        "weights": list_weights(),
        "has_local": LOCAL_PATH.exists(),
        "config": {
            "detector": cfg.get("detector", {}),
            "classes": cfg.get("classes", {}),
            "tracker": cfg.get("tracker", {}),
            "risk": cfg.get("risk", {}),
            "incidents": cfg.get("incidents", {}),
            "heatmap": cfg.get("heatmap", {}),
            "stream": cfg.get("stream", {}),
            "privacy": cfg.get("privacy", {}),
            "youtube": cfg.get("youtube", {}),
        },
        "roadmap": [
            {
                "id": "proximity",
                "title": "Proximity + TTC clearance",
                "status": "ready",
                "note": "Alarms when person–vehicle/robot edge clearance or TTC crosses Setup thresholds.",
            },
            {
                "id": "zones_alerts",
                "title": "Zones, tripwires, incidents",
                "status": "ready",
                "note": "Exclusion / work / path polygons, line-crossing counts, duration hold, clip capture, webhooks.",
            },
            {
                "id": "heatmap",
                "title": "Occupancy heatmap",
                "status": "ready",
                "note": "Bird's-eye density from worker feet on the calibrated plane.",
            },
            {
                "id": "tensorrt",
                "title": "TensorRT inference",
                "status": "ready",
                "note": "Pick a .engine weight below. Same boxes, faster GPU path.",
            },
            {
                "id": "site_detector",
                "title": "Site-trained detector",
                "status": "ready",
                "note": "Annotate → Ground (YOLO-World) → Export COCO → train Ultralytics or TAO RT-DETR / Grounding DINO.",
            },
            {
                "id": "bytetrack",
                "title": "ByteTrack IDs",
                "status": "ready",
                "note": "High-score match + low-score rescue through occlusions. Toggle in Tracker.",
            },
            {
                "id": "deepstream",
                "title": "DeepStream ingest",
                "status": "planned",
                "note": "NVDEC + NvDCF sidecar for multi-RTSP. UI tabs switch one Yardline pipeline today; true multi-cam needs N pipelines or DS.",
            },
            {
                "id": "promote_weights",
                "title": "Promote site weights",
                "status": "ready",
                "note": "Annotate → train → Promote to weights/site_best.pt and hot-reload detector.",
            },
            {
                "id": "shift_report",
                "title": "Shift report export",
                "status": "ready",
                "note": "GET /api/report?fmt=csv|json|save — incidents, labels, tripwire tallies.",
            },
            {
                "id": "junction_cal",
                "title": "Honest junction calibration",
                "status": "ready",
                "note": "Use Calibrate + stream plane presets (Abbey Road / scramble / yard lane).",
            },
        ],
    }
