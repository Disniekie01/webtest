from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2

from yardline import dataset as trainset

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = ROOT / "weights" / "yolov8s-worldv2.pt"
DEFAULT_PROMPTS = ["person", "car", "bus", "truck", "bicycle", "robot"]

# Open-vocab prompt → annotate class (person / vehicle / robot).
PROMPT_TO_CLASS = {
    "person": "person",
    "pedestrian": "person",
    "people": "person",
    "human": "person",
    "worker": "person",
    "car": "vehicle",
    "bus": "vehicle",
    "truck": "vehicle",
    "van": "vehicle",
    "vehicle": "vehicle",
    "automobile": "vehicle",
    "motorcycle": "vehicle",
    "bicycle": "vehicle",
    "bike": "vehicle",
    "robot": "robot",
    "excavator": "robot",
    "machine": "robot",
    "forklift": "robot",
    "amr": "robot",
}

_model = None
_model_prompts: tuple[str, ...] | None = None


def map_prompt_to_class(prompt: str) -> str | None:
    key = prompt.strip().lower()
    if key in PROMPT_TO_CLASS:
        return PROMPT_TO_CLASS[key]
    for token, cls in PROMPT_TO_CLASS.items():
        if token in key or key in token:
            return cls
    return None


def parse_prompts(raw: str | list[str] | None) -> list[str]:
    if raw is None:
        return list(DEFAULT_PROMPTS)
    if isinstance(raw, list):
        items = [str(x).strip() for x in raw if str(x).strip()]
        return items or list(DEFAULT_PROMPTS)
    items = [p.strip() for p in str(raw).replace(";", ",").split(",") if p.strip()]
    return items or list(DEFAULT_PROMPTS)


def _get_model(prompts: list[str]):
    global _model, _model_prompts
    from ultralytics import YOLO

    weights = DEFAULT_WEIGHTS
    if not weights.exists():
        raise RuntimeError(
            f"YOLO-World weights missing at {weights}. "
            "Download yolov8s-worldv2.pt into weights/."
        )
    prompt_key = tuple(prompts)
    if _model is None:
        _model = YOLO(str(weights))
    if _model_prompts != prompt_key:
        _model.set_classes(list(prompts))
        _model_prompts = prompt_key
    return _model


def ground_image(
    frame_bgr,
    *,
    prompts: list[str] | None = None,
    conf: float = 0.15,
) -> list[dict[str, Any]]:
    """Run open-vocab grounding; return annotate-class boxes."""
    prompt_list = parse_prompts(prompts)
    model = _get_model(prompt_list)
    result = model.predict(frame_bgr, conf=float(conf), verbose=False)[0]
    boxes: list[dict[str, Any]] = []
    if result.boxes is None or len(result.boxes) == 0:
        return boxes
    xyxy = result.boxes.xyxy.cpu().numpy()
    confs = result.boxes.conf.cpu().numpy()
    clss = result.boxes.cls.cpu().numpy().astype(int)
    names = result.names or {i: p for i, p in enumerate(prompt_list)}
    for box, score, cls_id in zip(xyxy, confs, clss):
        prompt = str(names.get(int(cls_id), prompt_list[int(cls_id)] if int(cls_id) < len(prompt_list) else ""))
        mapped = map_prompt_to_class(prompt)
        if mapped is None:
            continue
        boxes.append(
            {
                "class_name": mapped,
                "bbox": [float(box[0]), float(box[1]), float(box[2]), float(box[3])],
                "conf": float(score),
                "prompt": prompt,
            }
        )
    return boxes


def suggest(stem: str, *, prompts: str | list[str] | None = None, conf: float = 0.15) -> dict[str, Any]:
    """Ground a saved still and write YOLO labels for Annotate."""
    img_path = trainset.IMAGES / f"{stem}.jpg"
    if not img_path.exists():
        raise FileNotFoundError(stem)
    frame = cv2.imread(str(img_path))
    if frame is None:
        raise FileNotFoundError(stem)
    boxes = ground_image(frame, prompts=parse_prompts(prompts), conf=conf)
    return trainset.save_sample(stem, boxes)
