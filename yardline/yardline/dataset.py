from __future__ import annotations

import json
import os
import signal
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
TRAIN_ROOT = ROOT / "data" / "train"
IMAGES = TRAIN_ROOT / "images"
LABELS = TRAIN_ROOT / "labels"
RUNS = TRAIN_ROOT / "runs"
JOBS = TRAIN_ROOT / "jobs"
COCO_ROOT = TRAIN_ROOT / "coco"
TAO_ROOT = ROOT / "data" / "tao"
TAO_SPECS = TAO_ROOT / "specs"
TAO_RESULTS = TAO_ROOT / "results"
TAO_MOUNTS_FILE = ROOT / "config" / "tao_mounts.json"
CLASSES_FILE = TRAIN_ROOT / "classes.json"
META_FILE = TRAIN_ROOT / "samples.jsonl"

# Stable YOLO class order for site fine-tunes.
CLASS_NAMES = ["person", "vehicle", "robot"]
INTERNAL_TO_CLASS = {"worker": "person", "vehicle": "vehicle", "machine": "robot"}
CLASS_TO_ID = {name: i for i, name in enumerate(CLASS_NAMES)}

_train_lock = threading.Lock()
_train_proc: subprocess.Popen | None = None
_train_job: dict[str, Any] | None = None


def ensure_layout() -> None:
    for d in (IMAGES, LABELS, RUNS, JOBS, COCO_ROOT / "images", COCO_ROOT / "annotations", TAO_SPECS, TAO_RESULTS):
        d.mkdir(parents=True, exist_ok=True)
    if not CLASSES_FILE.exists():
        CLASSES_FILE.write_text(json.dumps({"names": CLASS_NAMES}, indent=2) + "\n", encoding="utf-8")
    _write_dataset_yaml()
    write_tao_mounts()
    write_tao_specs()


def _write_dataset_yaml() -> Path:
    TRAIN_ROOT.mkdir(parents=True, exist_ok=True)
    yaml_path = TRAIN_ROOT / "dataset.yaml"
    body = (
        f"path: {TRAIN_ROOT.resolve()}\n"
        f"train: images\n"
        f"val: images\n"
        f"names:\n"
        + "".join(f"  {i}: {name}\n" for i, name in enumerate(CLASS_NAMES))
    )
    yaml_path.write_text(body, encoding="utf-8")
    return yaml_path


def class_id(name: str) -> int:
    key = INTERNAL_TO_CLASS.get(name, name)
    if key not in CLASS_TO_ID:
        raise ValueError(f"Unknown class {name!r}. Use one of {CLASS_NAMES}.")
    return CLASS_TO_ID[key]


def _xyxy_to_yolo(x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> tuple[float, float, float, float]:
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)
    cx = x1 + 0.5 * bw
    cy = y1 + 0.5 * bh
    return cx / w, cy / h, bw / w, bh / h


def _yolo_to_xyxy(cx: float, cy: float, bw: float, bh: float, w: int, h: int) -> list[float]:
    pw, ph = bw * w, bh * h
    x1 = cx * w - 0.5 * pw
    y1 = cy * h - 0.5 * ph
    return [x1, y1, x1 + pw, y1 + ph]


def write_label_file(stem: str, boxes: list[dict[str, Any]], width: int, height: int) -> Path:
    ensure_layout()
    lines: list[str] = []
    for box in boxes:
        name = str(box.get("class_name") or box.get("cls") or "")
        cid = class_id(name)
        x1, y1, x2, y2 = (float(v) for v in box["bbox"])
        cx, cy, bw, bh = _xyxy_to_yolo(x1, y1, x2, y2, width, height)
        lines.append(f"{cid} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
    path = LABELS / f"{stem}.txt"
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return path


def read_label_file(stem: str, width: int, height: int) -> list[dict[str, Any]]:
    path = LABELS / f"{stem}.txt"
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        cid = int(parts[0])
        cx, cy, bw, bh = (float(v) for v in parts[1:])
        name = CLASS_NAMES[cid] if 0 <= cid < len(CLASS_NAMES) else f"cls_{cid}"
        out.append({"class_name": name, "bbox": _yolo_to_xyxy(cx, cy, bw, bh, width, height), "conf": 1.0})
    return out


def capture_frame(
    frame_bgr: np.ndarray,
    *,
    source: str | None,
    frame_index: int | None,
    seed_boxes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    ensure_layout()
    h, w = frame_bgr.shape[:2]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")[:-3]
    stem = f"cap_{stamp}"
    if source:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(source))[:40]
        stem = f"{safe}_{stamp}"
    img_path = IMAGES / f"{stem}.jpg"
    cv2.imwrite(str(img_path), frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    boxes = []
    for box in seed_boxes or []:
        name = INTERNAL_TO_CLASS.get(box.get("class_name", ""), box.get("class_name"))
        if name not in CLASS_TO_ID:
            continue
        boxes.append(
            {
                "class_name": name,
                "bbox": [float(v) for v in box["bbox"]],
                "conf": float(box.get("conf", 1.0)),
            }
        )
    write_label_file(stem, boxes, w, h)
    meta = {
        "id": stem,
        "image": f"images/{stem}.jpg",
        "label": f"labels/{stem}.txt",
        "width": w,
        "height": h,
        "source": source,
        "frame_index": frame_index,
        "n_boxes": len(boxes),
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }
    with META_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(meta) + "\n")
    return sample_detail(stem)


def sample_detail(stem: str) -> dict[str, Any]:
    img = IMAGES / f"{stem}.jpg"
    if not img.exists():
        raise FileNotFoundError(stem)
    frame = cv2.imread(str(img))
    if frame is None:
        raise FileNotFoundError(stem)
    h, w = frame.shape[:2]
    boxes = read_label_file(stem, w, h)
    return {
        "id": stem,
        "width": w,
        "height": h,
        "n_boxes": len(boxes),
        "boxes": boxes,
        "image_url": f"/api/dataset/image/{stem}.jpg",
        "labeled": len(boxes) > 0,
    }


def list_samples(limit: int = 200) -> list[dict[str, Any]]:
    ensure_layout()
    items: list[dict[str, Any]] = []
    for img in sorted(IMAGES.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True):
        stem = img.stem
        frame = cv2.imread(str(img), cv2.IMREAD_UNCHANGED)
        h, w = (0, 0) if frame is None else frame.shape[:2]
        boxes = read_label_file(stem, max(w, 1), max(h, 1)) if w and h else []
        items.append(
            {
                "id": stem,
                "width": w,
                "height": h,
                "n_boxes": len(boxes),
                "labeled": len(boxes) > 0,
                "image_url": f"/api/dataset/image/{stem}.jpg",
            }
        )
        if len(items) >= limit:
            break
    return items


def save_sample(stem: str, boxes: list[dict[str, Any]]) -> dict[str, Any]:
    img = IMAGES / f"{stem}.jpg"
    if not img.exists():
        raise FileNotFoundError(stem)
    frame = cv2.imread(str(img))
    if frame is None:
        raise FileNotFoundError(stem)
    h, w = frame.shape[:2]
    normalized = []
    for box in boxes:
        name = INTERNAL_TO_CLASS.get(box.get("class_name", ""), box.get("class_name"))
        if name not in CLASS_TO_ID:
            raise ValueError(f"Unknown class {box.get('class_name')!r}")
        x1, y1, x2, y2 = (float(v) for v in box["bbox"])
        x1, x2 = sorted((max(0.0, min(w - 1.0, x1)), max(0.0, min(w - 1.0, x2))))
        y1, y2 = sorted((max(0.0, min(h - 1.0, y1)), max(0.0, min(h - 1.0, y2))))
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        normalized.append({"class_name": name, "bbox": [x1, y1, x2, y2], "conf": float(box.get("conf", 1.0))})
    write_label_file(stem, normalized, w, h)
    return sample_detail(stem)


def delete_sample(stem: str) -> None:
    for path in (IMAGES / f"{stem}.jpg", LABELS / f"{stem}.txt"):
        if path.exists():
            path.unlink()


def suggest_boxes(stem: str, detector) -> dict[str, Any]:
    """Run the live detector on a saved still to seed boxes for correction."""
    img = IMAGES / f"{stem}.jpg"
    if not img.exists():
        raise FileNotFoundError(stem)
    frame = cv2.imread(str(img))
    if frame is None:
        raise FileNotFoundError(stem)
    dets = detector.infer(frame, keep_floor=0.15)
    boxes = []
    for d in dets:
        name = INTERNAL_TO_CLASS.get(d.class_name)
        if name is None:
            continue
        boxes.append(
            {
                "class_name": name,
                "bbox": [d.x1, d.y1, d.x2, d.y2],
                "conf": d.conf,
            }
        )
    return save_sample(stem, boxes)


def dataset_stats() -> dict[str, Any]:
    ensure_layout()
    samples = list_samples(limit=10_000)
    labeled = sum(1 for s in samples if s["labeled"])
    boxes = sum(int(s["n_boxes"]) for s in samples)
    coco_json = COCO_ROOT / "annotations" / "instances_train.json"
    return {
        "n_samples": len(samples),
        "n_labeled": labeled,
        "n_boxes": boxes,
        "classes": CLASS_NAMES,
        "dataset_yaml": str((TRAIN_ROOT / "dataset.yaml").resolve()),
        "weights_dir": str((ROOT / "weights").resolve()),
        "coco_ready": coco_json.exists(),
        "coco_json": str(coco_json) if coco_json.exists() else None,
        "tao_mounts": str(TAO_MOUNTS_FILE),
    }


def export_coco() -> dict[str, Any]:
    """Export labeled stills to COCO JSON for TAO RT-DETR (+ contiguous val copy)."""
    ensure_layout()
    images_out = COCO_ROOT / "images"
    ann_dir = COCO_ROOT / "annotations"
    images_out.mkdir(parents=True, exist_ok=True)
    ann_dir.mkdir(parents=True, exist_ok=True)

    coco_images: list[dict[str, Any]] = []
    coco_anns: list[dict[str, Any]] = []
    categories = [{"id": i + 1, "name": name, "supercategory": "object"} for i, name in enumerate(CLASS_NAMES)]
    ann_id = 1
    img_id = 1
    for img_path in sorted(IMAGES.glob("*.jpg")):
        stem = img_path.stem
        frame = cv2.imread(str(img_path))
        if frame is None:
            continue
        h, w = frame.shape[:2]
        boxes = read_label_file(stem, w, h)
        if not boxes:
            continue
        dest = images_out / f"{stem}.jpg"
        if not dest.exists() or dest.stat().st_mtime < img_path.stat().st_mtime:
            dest.write_bytes(img_path.read_bytes())
        coco_images.append({"id": img_id, "file_name": f"{stem}.jpg", "width": w, "height": h})
        for box in boxes:
            x1, y1, x2, y2 = box["bbox"]
            bw, bh = max(1.0, x2 - x1), max(1.0, y2 - y1)
            cid = CLASS_TO_ID[box["class_name"]] + 1
            coco_anns.append(
                {
                    "id": ann_id,
                    "image_id": img_id,
                    "category_id": cid,
                    "bbox": [round(x1, 2), round(y1, 2), round(bw, 2), round(bh, 2)],
                    "area": round(bw * bh, 2),
                    "iscrowd": 0,
                }
            )
            ann_id += 1
        img_id += 1

    if not coco_images:
        raise RuntimeError("No labeled stills to export. Capture and save labels first.")

    payload = {
        "info": {"description": "irl CVtest site dataset", "version": "1.0"},
        "licenses": [],
        "images": coco_images,
        "annotations": coco_anns,
        "categories": categories,
    }
    train_json = ann_dir / "instances_train.json"
    val_json = ann_dir / "instances_val.json"
    train_json.write_text(json.dumps(payload), encoding="utf-8")
    val_json.write_text(json.dumps(payload), encoding="utf-8")

    # ODVG jsonl + label map for TAO Grounding DINO fine-tune.
    odvg_path = ann_dir / "instances_train.jsonl"
    label_map = {name: i for i, name in enumerate(CLASS_NAMES)}
    (ann_dir / "label_map.json").write_text(json.dumps(label_map, indent=2) + "\n", encoding="utf-8")
    with odvg_path.open("w", encoding="utf-8") as fh:
        by_image = {im["id"]: im for im in coco_images}
        anns_by_img: dict[int, list[dict[str, Any]]] = {}
        for ann in coco_anns:
            anns_by_img.setdefault(ann["image_id"], []).append(ann)
        for iid, im in by_image.items():
            instances = []
            nouns: list[str] = []
            for ann in anns_by_img.get(iid, []):
                name = CLASS_NAMES[ann["category_id"] - 1]
                x, y, bw, bh = ann["bbox"]
                instances.append({"bbox": [x, y, x + bw, y + bh], "label": name, "category": name})
                nouns.append(name)
            rec = {
                "filename": im["file_name"],
                "height": im["height"],
                "width": im["width"],
                "detection": {"instances": instances},
                "grounding": {"caption": " . ".join(dict.fromkeys(nouns)), "regions": []},
            }
            fh.write(json.dumps(rec) + "\n")

    classmap = ann_dir / "classmap.txt"
    classmap.write_text("\n".join(CLASS_NAMES) + "\n", encoding="utf-8")
    write_tao_specs()
    return {
        "n_images": len(coco_images),
        "n_annotations": len(coco_anns),
        "coco_json": str(train_json),
        "odvg_jsonl": str(odvg_path),
        "images_dir": str(images_out),
        "classes": CLASS_NAMES,
    }


def write_tao_mounts() -> Path:
    TAO_MOUNTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "Mounts": [
            {"source": str(TRAIN_ROOT.resolve()), "destination": "/data"},
            {"source": str(TAO_ROOT.resolve()), "destination": "/tao"},
            {"source": str((ROOT / "weights").resolve()), "destination": "/weights"},
        ],
        "Envs": [{"variable": "MAXSMVER", "value": "120"}],
        "DockerOptions": {
            "tty": False,
            "user": "1000:1000",
            "shm_size": "16G",
            "ulimits": {"memlock": -1, "stack": 67108864},
        },
    }
    TAO_MOUNTS_FILE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return TAO_MOUNTS_FILE


def write_tao_specs(*, epochs: int = 30, batch: int = 4) -> dict[str, Path]:
    ensure_layout_dirs_only()
    TAO_SPECS.mkdir(parents=True, exist_ok=True)
    TAO_RESULTS.mkdir(parents=True, exist_ok=True)

    rtdetr = f"""results_dir: /tao/results/rtdetr
encryption_key: yardline
model:
  backbone: resnet_50
  train_backbone: true
  return_interm_indices: [1, 2, 3]
  dec_layers: 6
  enc_layers: 1
  num_queries: 300
train:
  num_epochs: {int(epochs)}
  checkpoint_interval: 5
  validation_interval: 5
  clip_grad_norm: 0.1
  precision: fp16
  distributed_strategy: ddp
  activation_checkpoint: true
  num_gpus: 1
  gpu_ids: [0]
  num_nodes: 1
  seed: 1234
  optim:
    optimizer: AdamW
    lr: 0.0001
    lr_backbone: 0.00001
    momentum: 0.9
    weight_decay: 0.0001
    lr_scheduler: MultiStep
    lr_steps: [20]
    lr_decay: 0.1
dataset:
  train_data_sources:
    - image_dir: /data/coco/images
      json_file: /data/coco/annotations/instances_train.json
  val_data_sources:
    image_dir: /data/coco/images
    json_file: /data/coco/annotations/instances_val.json
  test_data_sources:
    image_dir: /data/coco/images
    json_file: /data/coco/annotations/instances_val.json
  infer_data_sources:
    image_dir: [/data/coco/images]
    classmap: /data/coco/annotations/classmap.txt
  num_classes: {len(CLASS_NAMES)}
  batch_size: {int(batch)}
  workers: 4
  remap_mscoco_category: false
  dataset_type: serialized
  pin_memory: true
  augmentation:
    train_spatial_size: [640, 640]
    eval_spatial_size: [640, 640]
    preserve_aspect_ratio: false
"""

    gdino = f"""results_dir: /tao/results/grounding_dino
encryption_key: yardline
model:
  backbone: swin_tiny_224_1k
  train_backbone: true
  num_feature_levels: 4
  dec_layers: 6
  enc_layers: 6
  num_queries: 900
  dropout_ratio: 0.0
  dim_feedforward: 2048
  log_scale: auto
  class_embed_bias: true
train:
  num_epochs: {int(epochs)}
  checkpoint_interval: 5
  validation_interval: 5
  precision: bf16
  num_gpus: 1
  gpu_ids: [0]
  num_nodes: 1
  freeze: ["backbone.0", "bert"]
  optim:
    lr: 0.0002
    lr_backbone: 0.00002
    momentum: 0.9
    weight_decay: 0.0001
    lr_scheduler: MultiStep
    lr_steps: [10, 20]
    lr_decay: 0.1
dataset:
  train_data_sources:
    - image_dir: /data/coco/images
      json_file: /data/coco/annotations/instances_train.jsonl
      label_map: /data/coco/annotations/label_map.json
  val_data_sources:
    image_dir: /data/coco/images
    json_file: /data/coco/annotations/instances_val.json
  max_labels: 80
  batch_size: {max(1, int(batch) // 2)}
  workers: 4
  dataset_type: serialized
"""

    paths = {
        "rtdetr": TAO_SPECS / "rtdetr_train.yaml",
        "grounding_dino": TAO_SPECS / "grounding_dino_train.yaml",
    }
    paths["rtdetr"].write_text(rtdetr, encoding="utf-8")
    paths["grounding_dino"].write_text(gdino, encoding="utf-8")
    return paths


def ensure_layout_dirs_only() -> None:
    for d in (IMAGES, LABELS, RUNS, JOBS, COCO_ROOT / "images", COCO_ROOT / "annotations", TAO_SPECS, TAO_RESULTS):
        d.mkdir(parents=True, exist_ok=True)


def train_status() -> dict[str, Any]:
    with _train_lock:
        running = _train_proc is not None and _train_proc.poll() is None
        job = dict(_train_job or {})
        if _train_proc is not None and not running:
            job["returncode"] = _train_proc.returncode
            job["running"] = False
            if job.get("status") == "running":
                job["status"] = "done" if _train_proc.returncode == 0 else "failed"
        else:
            job["running"] = running
        log_tail = ""
        log_path = job.get("log")
        if log_path and Path(log_path).exists():
            text = Path(log_path).read_text(encoding="utf-8", errors="replace")
            log_tail = text[-4000:]
        job["log_tail"] = log_tail
        return job or {"running": False, "status": "idle"}


def start_train(
    *,
    backend: str = "ultralytics",
    epochs: int = 30,
    imgsz: int = 640,
    model: str = "weights/yolov8n.pt",
    batch: int = 8,
) -> dict[str, Any]:
    backend = (backend or "ultralytics").lower().strip()
    if backend in {"tao_rtdetr", "rtdetr"}:
        return start_tao_train(task="rtdetr", epochs=epochs, batch=batch)
    if backend in {"tao_grounding_dino", "grounding_dino", "gdino"}:
        return start_tao_train(task="grounding_dino", epochs=epochs, batch=batch)
    return start_ultralytics_train(epochs=epochs, imgsz=imgsz, model=model, batch=batch)


def start_ultralytics_train(
    *,
    epochs: int = 30,
    imgsz: int = 640,
    model: str = "weights/yolov8n.pt",
    batch: int = 8,
) -> dict[str, Any]:
    global _train_proc, _train_job
    ensure_layout()
    stats = dataset_stats()
    if stats["n_labeled"] < 5:
        raise RuntimeError("Need at least 5 labeled stills before training.")

    model_path = Path(model)
    if not model_path.is_absolute():
        model_path = ROOT / model_path
    if not model_path.exists():
        raise RuntimeError(f"Base weights not found: {model_path}")

    yaml_path = _write_dataset_yaml()
    job_id = datetime.now(timezone.utc).strftime("train_%Y%m%dT%H%M%S")
    log_path = JOBS / f"{job_id}.log"
    out_name = job_id

    cmd = [
        str(ROOT / ".venv" / "bin" / "python"),
        "-c",
        (
            "from ultralytics import YOLO; "
            f"YOLO(r'{model_path}').train("
            f"data=r'{yaml_path}', epochs={int(epochs)}, imgsz={int(imgsz)}, "
            f"batch={int(batch)}, device=0, project=r'{RUNS}', name=r'{out_name}', exist_ok=True)"
        ),
    ]

    with _train_lock:
        if _train_proc is not None and _train_proc.poll() is None:
            raise RuntimeError("A training job is already running.")
        log_fh = open(log_path, "w", encoding="utf-8")
        _train_proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            text=True,
        )
        _train_job = {
            "id": job_id,
            "backend": "ultralytics",
            "status": "running",
            "running": True,
            "pid": _train_proc.pid,
            "log": str(log_path),
            "epochs": int(epochs),
            "imgsz": int(imgsz),
            "model": str(model_path),
            "run_dir": str(RUNS / out_name),
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        return dict(_train_job)


def start_tao_train(*, task: str, epochs: int = 30, batch: int = 4) -> dict[str, Any]:
    """Launch `tao model <task> train` with Yardline mounts (does not overwrite ~/.tao_mounts.json)."""
    global _train_proc, _train_job
    ensure_layout()
    coco = export_coco()
    write_tao_mounts()
    write_tao_specs(epochs=epochs, batch=batch)

    task = "grounding_dino" if task == "grounding_dino" else "rtdetr"
    spec_name = "grounding_dino_train.yaml" if task == "grounding_dino" else "rtdetr_train.yaml"
    job_id = datetime.now(timezone.utc).strftime(f"tao_{task}_%Y%m%dT%H%M%S")
    log_path = JOBS / f"{job_id}.log"
    results = f"/tao/results/{task}/{job_id}"

    # Prefer launcher on PATH; fall back to ~/.local/bin/tao.
    tao_bin = "tao"
    local_tao = Path.home() / ".local" / "bin" / "tao"
    if local_tao.exists():
        tao_bin = str(local_tao)

    cmd = [
        tao_bin,
        "model",
        task,
        "train",
        "-e",
        f"/tao/specs/{spec_name}",
        "-r",
        results,
    ]
    env = {
        **os.environ,
        "TAO_MOUNTS_PATH": str(TAO_MOUNTS_FILE),
        "TAO_MOUNT_FILE": str(TAO_MOUNTS_FILE),
    }
    # TAO launcher historically reads ~/.tao_mounts.json; point a wrapper via HOME overlay.
    # Copy mounts into a job-local home so we don't clobber the user's ASC mounts permanently.
    job_home = JOBS / f"{job_id}_home"
    job_home.mkdir(parents=True, exist_ok=True)
    (job_home / ".tao_mounts.json").write_text(TAO_MOUNTS_FILE.read_text(encoding="utf-8"), encoding="utf-8")
    env["HOME"] = str(job_home)

    with _train_lock:
        if _train_proc is not None and _train_proc.poll() is None:
            raise RuntimeError("A training job is already running.")
        log_fh = open(log_path, "w", encoding="utf-8")
        log_fh.write(
            f"# TAO {task} train\n# coco images={coco['n_images']} anns={coco['n_annotations']}\n"
            f"# mounts={TAO_MOUNTS_FILE}\n# First run may pull nvcr.io/nvidia/tao/tao-toolkit:*-pyt\n"
            f"# cmd={' '.join(cmd)}\n\n"
        )
        log_fh.flush()
        _train_proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
        )
        _train_job = {
            "id": job_id,
            "backend": f"tao_{task}",
            "status": "running",
            "running": True,
            "pid": _train_proc.pid,
            "log": str(log_path),
            "epochs": int(epochs),
            "batch": int(batch),
            "spec": f"/tao/specs/{spec_name}",
            "results_dir": str(TAO_RESULTS / task / job_id),
            "coco": coco,
            "note": "NGC login required if image pull fails: docker login nvcr.io",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        return dict(_train_job)


def stop_train() -> dict[str, Any]:
    global _train_proc, _train_job
    with _train_lock:
        if _train_proc is None or _train_proc.poll() is not None:
            return train_status()
        _train_proc.send_signal(signal.SIGTERM)
        try:
            _train_proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            _train_proc.kill()
        if _train_job:
            _train_job["status"] = "stopped"
            _train_job["running"] = False
        return train_status()


def latest_weights() -> Optional[Path]:
    best = sorted(RUNS.glob("*/weights/best.pt"), key=lambda p: p.stat().st_mtime, reverse=True)
    if best:
        return best[0]
    tao_ckpts = sorted(TAO_RESULTS.glob("**/*.pth"), key=lambda p: p.stat().st_mtime, reverse=True)
    return tao_ckpts[0] if tao_ckpts else None


def promote_latest_weights(dest_name: str = "site_best.pt") -> dict[str, Any]:
    """Copy latest train checkpoint into weights/ for live Setup selection."""
    import shutil

    src = latest_weights()
    if src is None:
        raise FileNotFoundError("No trained weights found under data/train/runs or data/tao/results.")
    weights_dir = ROOT / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)
    dest = weights_dir / dest_name
    shutil.copy2(src, dest)
    return {
        "ok": True,
        "source": str(src.relative_to(ROOT)).replace("\\", "/"),
        "weights": f"weights/{dest.name}",
        "size_mb": round(dest.stat().st_size / (1024 * 1024), 2),
    }
