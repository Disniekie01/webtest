from __future__ import annotations

import asyncio
import base64
import json
import time
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from yardline.briefing import build_briefing
from yardline.config_io import clear_local, deep_merge, save_local, setup_snapshot
from yardline import dataset as trainset
from yardline import presets as camera_presets
from yardline import reports as shift_reports
from yardline import stream_presets
from yardline.incidents import get_incident, list_incidents
from yardline.runtime import Pipeline, list_videos, load_config
from yardline.sources import is_live_ref
from yardline.store import (
    append_label,
    delete_map_underlay,
    list_labels,
    load_map_underlay,
    save_map_underlay,
)

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
MAPS = ROOT / "data" / "maps"

cfg = load_config(ROOT / "config" / "default.json")
pipeline = Pipeline(cfg)
_cap_lock = asyncio.Lock()
_play_ws: WebSocket | None = None

app = FastAPI(title="irl CVtest", version="0.3.0")
app.mount("/static", StaticFiles(directory=str(WEB)), name="static")
(ROOT / "data" / "incidents").mkdir(parents=True, exist_ok=True)
MAPS.mkdir(parents=True, exist_ok=True)
app.mount(
    "/incidents",
    StaticFiles(directory=str(ROOT / "data" / "incidents")),
    name="incidents",
)
app.mount("/maps", StaticFiles(directory=str(MAPS)), name="maps")


class CalibrateRequest(BaseModel):
    image_points: list[list[float]] = Field(min_length=4)
    world_points: list[list[float]] = Field(min_length=4)


class ZonesRequest(BaseModel):
    zones: list[dict[str, Any]]


class PrivacyRequest(BaseModel):
    enabled: bool


class LabelRequest(BaseModel):
    kind: Literal["near_miss", "false_alarm", "controlled"]
    note: str = ""
    incident_id: str | None = None
    frame_index: int | None = None
    source: str | None = None
    alarm: str | None = None
    still: str | None = None


class HeatmapWindowRequest(BaseModel):
    window_s: float = 120.0


class PromoteRequest(BaseModel):
    apply: bool = True
    dest_name: str = "site_best.pt"


class SetupRequest(BaseModel):
    detector: dict[str, Any] | None = None
    classes: dict[str, Any] | None = None
    tracker: dict[str, Any] | None = None
    risk: dict[str, Any] | None = None
    incidents: dict[str, Any] | None = None
    heatmap: dict[str, Any] | None = None
    stream: dict[str, Any] | None = None
    privacy: dict[str, Any] | None = None
    youtube: dict[str, Any] | None = None


class PresetRequest(BaseModel):
    id: str | None = None
    name: str
    source: str
    note: str = ""
    site_id: str | None = None
    camera_id: str | None = None


class SiteRequest(BaseModel):
    id: str | None = None
    name: str
    kpi: str = "near_miss"
    note: str = ""
    origin_geo: dict[str, Any] | None = None
    cameras: list[dict[str, Any]] | None = None


class SiteActiveRequest(BaseModel):
    site_id: str | None = None


class SiteCameraRequest(BaseModel):
    camera_id: str = "cam1"
    label: str = "Camera"
    source: str
    preset_id: str | None = None
    offset_m: list[float] = Field(default_factory=lambda: [0.0, 0.0])
    note: str = ""


class GeoAnchorRequest(BaseModel):
    lat: float
    lon: float
    alt: float = 0.0
    bearing_deg: float = 0.0
    crs: str = "EPSG:4326"
    site_id: str | None = None
    apply_to_site: bool = True


class AnnotateSaveRequest(BaseModel):
    boxes: list[dict[str, Any]] = Field(default_factory=list)


class GroundRequest(BaseModel):
    prompts: str = "person, car, bus, truck, bicycle, robot"
    conf: float = 0.15


class TrainStartRequest(BaseModel):
    backend: Literal["ultralytics", "tao_rtdetr", "tao_grounding_dino"] = "ultralytics"
    epochs: int = 30
    imgsz: int = 640
    batch: int = 8
    model: str = "weights/yolov8n.pt"


def _json_default(obj: Any):
    item = getattr(obj, "item", None)
    if callable(item):
        return item()
    raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")


def _encode_frame(packet: dict[str, Any]) -> dict[str, Any]:
    jpeg = packet.pop("jpeg", None)
    packet["type"] = "frame"
    if jpeg:
        packet["jpeg"] = base64.b64encode(jpeg).decode("ascii")
    else:
        # Twin mode: UI paints /viewport/frame.jpg — skip huge WS payloads.
        packet["jpeg"] = None
        packet["feed"] = "twin"
    return packet


async def _send_json(ws: WebSocket, data: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(data, default=_json_default, separators=(",", ":")))


async def _cap(fn, *args):
    async with _cap_lock:
        return await asyncio.to_thread(fn, *args)


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


@app.get("/annotate")
def annotate_page():
    return FileResponse(WEB / "annotate.html")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "system": "irl CVtest",
        "device": pipeline.device,
        "gpu": pipeline.gpu_name(),
        "calibrated": pipeline.plane is not None,
        "source": pipeline.source,
        "frame_index": pipeline.frame_idx,
        "pii_redacted": pipeline.redact_pii,
    }


@app.get("/api/sources")
def sources():
    return list_videos(ROOT / "data" / "videos")


@app.get("/api/state")
def state():
    from yardline.sites import get_active_site
    from yardline.taxonomy import count_kpi, load_taxonomy

    site = get_active_site()
    kpi = None
    if site and site.get("kpi"):
        kpi = count_kpi(list_incidents(200), str(site["kpi"]))
    return {
        "device": pipeline.device,
        "gpu": pipeline.gpu_name(),
        "calibrated": pipeline.plane is not None,
        "plane": None if pipeline.plane is None else pipeline.plane.to_dict(),
        "zones": pipeline.risk.zones,
        "source": pipeline.source,
        "frame_index": pipeline.frame_idx,
        "last": pipeline.last_packet,
        "pii_redacted": pipeline.redact_pii,
        "weights": pipeline.cfg.get("detector", {}).get("weights"),
        "metric_scale": getattr(pipeline, "metric_scale", 1.0),
        "site": pipeline.site_context(),
        "active_site": site,
        "kpi": kpi,
        "taxonomy": load_taxonomy(),
    }


@app.get("/api/setup")
def get_setup():
    return setup_snapshot(pipeline.cfg, device=pipeline.device, gpu=pipeline.gpu_name())


@app.post("/api/setup")
def post_setup(req: SetupRequest):
    from yardline.config_io import LOCAL_PATH

    patch = {k: v for k, v in req.model_dump(exclude_none=True).items()}
    if not patch:
        raise HTTPException(status_code=400, detail="No setup fields provided.")
    try:
        existing: dict[str, Any] = {}
        if LOCAL_PATH.exists():
            with open(LOCAL_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)
        overlay = deep_merge(existing, patch)
        cfg = save_local(overlay)
        pipeline.apply_config(cfg)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        **setup_snapshot(pipeline.cfg, device=pipeline.device, gpu=pipeline.gpu_name()),
    }


@app.post("/api/setup/reset")
def reset_setup():
    cfg = clear_local()
    pipeline.apply_config(cfg)
    return {
        "ok": True,
        **setup_snapshot(pipeline.cfg, device=pipeline.device, gpu=pipeline.gpu_name()),
    }


@app.post("/api/calibrate")
def calibrate(req: CalibrateRequest):
    try:
        plane = pipeline.set_plane(req.image_points, req.world_points)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "rms_px": round(plane.rms_px, 2), "plane": plane.to_dict()}


@app.post("/api/calibrate/clear")
def clear_cal():
    pipeline.clear_plane()
    return {"ok": True, "calibrated": False}


@app.post("/api/zones")
def set_zones(req: ZonesRequest):
    pipeline.persist_zones(req.zones)
    return {"ok": True, "count": len(req.zones), "zones": pipeline.risk.zones}


@app.get("/api/map")
def get_map():
    if not pipeline.source:
        return {"map": None}
    return {"map": load_map_underlay(pipeline.source["path"])}


@app.post("/api/map")
async def post_map(file: UploadFile = File(...)):
    if not pipeline.source:
        raise HTTPException(status_code=400, detail="Open a source first")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > 12_000_000:
        raise HTTPException(status_code=400, detail="Map image too large (12 MB max)")
    import cv2
    import numpy as np

    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image")
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise HTTPException(status_code=400, detail="Could not encode JPEG")
    world_rect = None
    if pipeline.plane is not None:
        world_rect = [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in pipeline.plane.world_points]
    meta = save_map_underlay(pipeline.source["path"], buf.tobytes(), world_rect=world_rect)
    return {"ok": True, "map": meta}


@app.delete("/api/map")
def remove_map():
    if not pipeline.source:
        raise HTTPException(status_code=400, detail="Open a source first")
    delete_map_underlay(pipeline.source["path"])
    return {"ok": True, "map": None}


@app.get("/api/taxonomy")
def get_taxonomy():
    from yardline.taxonomy import load_taxonomy

    return load_taxonomy()


@app.get("/api/sites")
def get_sites():
    from yardline import sites as site_reg

    return {
        "sites": site_reg.list_sites(),
        "active_site_id": site_reg.get_active_site_id(),
        "active_site": site_reg.get_active_site(),
    }


@app.post("/api/sites")
def post_site(req: SiteRequest):
    from yardline import sites as site_reg

    try:
        row = site_reg.upsert_site(req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "site": row, "sites": site_reg.list_sites(), "active_site_id": site_reg.get_active_site_id()}


@app.post("/api/sites/active")
def post_active_site(req: SiteActiveRequest):
    from yardline import sites as site_reg

    try:
        site = site_reg.set_active_site(req.site_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if site is not None:
        pipeline.set_site_context(site.get("id"), pipeline.camera_id)
    else:
        pipeline.set_site_context(None, None)
    return {"ok": True, "active_site": site, "sites": site_reg.list_sites()}


@app.delete("/api/sites/{site_id}")
def remove_site(site_id: str):
    from yardline import sites as site_reg

    ok = site_reg.delete_site(site_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Site not found")
    return {"ok": True, "sites": site_reg.list_sites(), "active_site_id": site_reg.get_active_site_id()}


@app.post("/api/sites/{site_id}/cameras")
def post_site_camera(site_id: str, req: SiteCameraRequest):
    from yardline import sites as site_reg

    try:
        site = site_reg.bind_camera(site_id, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    pipeline.set_site_context(site_id, req.camera_id)
    return {"ok": True, "site": site}


@app.post("/api/geo/anchor")
def post_geo_anchor(req: GeoAnchorRequest):
    from yardline import sites as site_reg
    from yardline.geo import normalize_origin
    from yardline.store import set_plane_geo

    origin = normalize_origin(req.model_dump())
    if origin is None:
        raise HTTPException(status_code=400, detail="Invalid lat/lon")
    site_id = req.site_id or site_reg.get_active_site_id()
    bundle = None
    if pipeline.source and pipeline.plane is not None:
        try:
            bundle = set_plane_geo(pipeline.source["path"], origin, site_id=site_id)
        except FileNotFoundError:
            bundle = None
    site = None
    if req.apply_to_site and site_id:
        site = site_reg.get_site(site_id)
        if site is None:
            raise HTTPException(status_code=404, detail="Site not found")
        site = site_reg.upsert_site({**site, "origin_geo": origin})
        pipeline.set_site_context(site_id, pipeline.camera_id)
    elif not site_id:
        raise HTTPException(status_code=400, detail="Select a site before saving geo")
    return {"ok": True, "geo_anchor": origin, "plane": bundle, "site": site}


@app.get("/api/geo/search")
def geo_search(q: str, limit: int = 5):
    """Forward-geocode an address via OpenStreetMap Nominatim."""
    import urllib.parse
    import urllib.request

    query = (q or "").strip()
    if len(query) < 3:
        raise HTTPException(status_code=400, detail="Enter at least 3 characters")
    params = urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "limit": max(1, min(10, int(limit))),
        }
    )
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "irl-CVtest-yardline/0.3 (smart-city GIS helper)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Geocoder unavailable: {e}") from e
    hits = []
    for row in rows:
        try:
            hits.append(
                {
                    "label": row.get("display_name"),
                    "lat": float(row["lat"]),
                    "lon": float(row["lon"]),
                    "type": row.get("type"),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    return {"query": query, "hits": hits}


@app.get("/api/gis/export")
def gis_export(site_id: str | None = None, save: bool = False):
    from yardline.geo import build_site_geojson, save_geojson

    try:
        collection = build_site_geojson(site_id=site_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    path = None
    if save:
        path = str(save_geojson(collection, site_id=site_id)).replace("\\", "/")
    return {"ok": True, "geojson": collection, "saved": path}


@app.get("/api/incidents")
def incidents(limit: int = 40):
    return {"incidents": list_incidents(limit), "live": pipeline.incidents[-8:]}


@app.get("/api/incidents/{incident_id}")
def incident_detail(incident_id: str):
    row = get_incident(incident_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return row


@app.get("/api/presets")
def get_presets():
    return {"presets": camera_presets.list_presets()}


@app.post("/api/presets")
def post_preset(req: PresetRequest):
    try:
        row = camera_presets.upsert_preset(req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "preset": row, "presets": camera_presets.list_presets()}


@app.delete("/api/presets/{preset_id}")
def remove_preset(preset_id: str):
    ok = camera_presets.delete_preset(preset_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"ok": True, "presets": camera_presets.list_presets()}


@app.post("/api/privacy")
def set_privacy(req: PrivacyRequest):
    pipeline.redact_pii = bool(req.enabled)
    return {"ok": True, "pii_redacted": pipeline.redact_pii}


@app.get("/api/briefing")
def briefing():
    return build_briefing(pipeline.last_packet, pipeline.source)


@app.get("/api/labels")
def labels(limit: int = 40):
    return list_labels(limit)


@app.post("/api/labels")
def add_label(req: LabelRequest):
    packet = pipeline.last_packet
    risk = (packet or {}).get("risk") or {}
    source_path = req.source or ((pipeline.source or {}).get("path") if pipeline.source else None)
    if packet is None and not req.incident_id:
        raise HTTPException(status_code=400, detail="Play a source or attach an incident before labeling.")
    record = append_label(
        {
            "kind": req.kind,
            "note": req.note,
            "incident_id": req.incident_id,
            "source": source_path,
            "frame_index": req.frame_index if req.frame_index is not None else (packet or {}).get("frame_index"),
            "alarm": req.alarm or risk.get("alarm"),
            "min_ttc_s": risk.get("min_ttc_s"),
            "min_distance_m": risk.get("min_distance_m"),
            "min_clearance_m": risk.get("min_clearance_m"),
            "still": req.still,
            "calibrated": (packet or {}).get("calibrated"),
        }
    )
    return {"ok": True, "label": record}


@app.get("/api/report")
def shift_report(fmt: str = "json"):
    report = shift_reports.build_shift_report()
    if fmt == "csv":
        return PlainTextResponse(shift_reports.report_to_csv(report), media_type="text/csv")
    if fmt == "save":
        path = shift_reports.save_report_json(report)
        return {"ok": True, "path": str(path.relative_to(ROOT)).replace("\\", "/"), "summary": report["summary"]}
    return report


@app.post("/api/heatmap/window")
def heatmap_window(req: HeatmapWindowRequest):
    pipeline.set_heatmap_window(req.window_s)
    return {"ok": True, "window_s": pipeline.heatmap.window_s}


@app.post("/api/heatmap/clear")
def heatmap_clear():
    pipeline.clear_heatmap()
    return {"ok": True}


@app.get("/api/stream-presets")
def get_stream_presets(source: str | None = None):
    return {
        "presets": stream_presets.list_stream_presets(),
        "suggested": stream_presets.suggest_for_source(source),
    }


@app.post("/api/dataset/promote")
def promote_weights(req: PromoteRequest):
    try:
        promoted = trainset.promote_latest_weights(req.dest_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    applied = False
    if req.apply:
        from yardline.config_io import LOCAL_PATH

        existing: dict[str, Any] = {}
        if LOCAL_PATH.exists():
            with open(LOCAL_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)
        overlay = deep_merge(existing, {"detector": {"weights": promoted["weights"]}})
        cfg = save_local(overlay)
        pipeline.apply_config(cfg)
        applied = True
    return {"ok": True, "applied": applied, **promoted}


@app.get("/api/dataset")
def dataset_info():
    return trainset.dataset_stats()


@app.get("/api/dataset/samples")
def dataset_samples(limit: int = 200):
    return trainset.list_samples(limit=limit)


@app.get("/api/dataset/samples/{stem}")
def dataset_sample(stem: str):
    try:
        return trainset.sample_detail(stem)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Sample not found") from e


@app.get("/api/dataset/image/{name}")
def dataset_image(name: str):
    stem = Path(name).stem
    path = trainset.IMAGES / f"{stem}.jpg"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path, media_type="image/jpeg")


@app.post("/api/dataset/capture")
def dataset_capture(seed: bool = True):
    if pipeline.last_bgr is None:
        raise HTTPException(status_code=400, detail="Open a live/source and wait for a frame first.")
    packet = pipeline.last_packet or {}
    seed_boxes = packet.get("detections") if seed else []
    sample = trainset.capture_frame(
        pipeline.last_bgr,
        source=(pipeline.source or {}).get("id") or (pipeline.source or {}).get("path"),
        frame_index=packet.get("frame_index"),
        seed_boxes=seed_boxes or [],
    )
    return {"ok": True, "sample": sample, "stats": trainset.dataset_stats()}


@app.put("/api/dataset/samples/{stem}")
def dataset_save(stem: str, req: AnnotateSaveRequest):
    try:
        sample = trainset.save_sample(stem, req.boxes)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Sample not found") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "sample": sample, "stats": trainset.dataset_stats()}


@app.delete("/api/dataset/samples/{stem}")
def dataset_delete(stem: str):
    trainset.delete_sample(stem)
    return {"ok": True, "stats": trainset.dataset_stats()}


@app.post("/api/dataset/samples/{stem}/suggest")
def dataset_suggest(stem: str):
    try:
        sample = trainset.suggest_boxes(stem, pipeline.detector)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Sample not found") from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "sample": sample}


@app.post("/api/dataset/samples/{stem}/ground")
def dataset_ground(stem: str, req: GroundRequest):
    from yardline.grounding import suggest as ground_suggest

    try:
        sample = ground_suggest(stem, prompts=req.prompts, conf=req.conf)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Sample not found") from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "sample": sample, "stats": trainset.dataset_stats()}


@app.post("/api/dataset/export/coco")
def dataset_export_coco():
    try:
        result = trainset.export_coco()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, **result, "stats": trainset.dataset_stats()}


@app.get("/api/dataset/train")
def dataset_train_status():
    status = trainset.train_status()
    latest = trainset.latest_weights()
    status["latest_weights"] = None if latest is None else str(latest)
    return status


@app.post("/api/dataset/train")
def dataset_train_start(req: TrainStartRequest):
    try:
        job = trainset.start_train(
            backend=req.backend,
            epochs=req.epochs,
            imgsz=req.imgsz,
            batch=req.batch,
            model=req.model,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "job": job}


@app.post("/api/dataset/train/stop")
def dataset_train_stop():
    return {"ok": True, "job": trainset.stop_train()}


@app.websocket("/ws/stream")
async def stream(ws: WebSocket):
    global _play_ws
    await ws.accept()
    playing = False
    speed = 1.0
    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=0.001 if playing else None)
            except asyncio.TimeoutError:
                msg = None
            except WebSocketDisconnect:
                break

            if msg:
                action = msg.get("action")
                if action == "open":
                    raw = str(msg["path"])
                    if is_live_ref(raw):
                        source_path = raw
                    else:
                        source_path = str(ROOT / raw) if not Path(raw).is_absolute() else raw
                    try:
                        meta = await _cap(pipeline.open, source_path)
                    except Exception as e:
                        await _send_json(ws, {"type": "error", "detail": str(e)})
                        continue
                    playing = False
                    await _send_json(ws, {"type": "opened", "source": meta})
                    packet = await _cap(pipeline.step)
                    if packet is not None:
                        await _send_json(ws, _encode_frame(packet))
                elif action == "play":
                    _play_ws = ws
                    playing = True
                elif action == "pause":
                    playing = False
                    if _play_ws is ws:
                        _play_ws = None
                elif action == "stop":
                    playing = False
                    await _send_json(ws, {"type": "stopped"})
                elif action == "speed":
                    try:
                        speed = max(0.25, min(4.0, float(msg.get("rate", 1.0))))
                    except (TypeError, ValueError):
                        speed = 1.0
                elif action == "restart":
                    meta = await _cap(pipeline.restart)
                    playing = False
                    if meta is not None:
                        await _send_json(ws, {"type": "opened", "source": meta})
                        packet = await _cap(pipeline.step)
                        if packet is not None:
                            await _send_json(ws, _encode_frame(packet))
                elif action == "seek":
                    playing = False
                    await _cap(pipeline.seek, int(msg.get("frame", 0)))
                    packet = await _cap(pipeline.step)
                    if packet is None:
                        await _send_json(ws, {"type": "ended"})
                    else:
                        await _send_json(ws, _encode_frame(packet))
                elif action == "step":
                    playing = False
                    packet = await _cap(pipeline.step)
                    if packet is None:
                        await _send_json(ws, {"type": "ended"})
                    else:
                        await _send_json(ws, _encode_frame(packet))

            if playing and _play_ws is ws:
                t0 = time.perf_counter()
                packet = await _cap(pipeline.step)
                if packet is None:
                    live = bool((pipeline.source or {}).get("live"))
                    if live:
                        await asyncio.sleep(0.25)
                        continue
                    playing = False
                    await _send_json(ws, {"type": "ended"})
                    continue
                dt = float(packet.get("dt_s") or 0.05)
                await _send_json(ws, _encode_frame(packet))
                fps = float((pipeline.source or {}).get("fps") or 0.0) or (1.0 / max(dt, 0.001))
                target = float((pipeline.cfg.get("stream") or {}).get("target_fps") or 0.0)
                if target > 0:
                    fps = min(fps, target)
                period = 1.0 / min(max(fps, 4.0), 30.0)
                remain = (period / speed) - (time.perf_counter() - t0)
                if remain > 0:
                    await asyncio.sleep(remain)
    except WebSocketDisconnect:
        return
    except Exception:
        raise


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("yardline.server:app", host="127.0.0.1", port=8010, reload=False)
