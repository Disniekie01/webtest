#!/usr/bin/env python3
"""profile-stage:baseline quick mode for city_generator_large.usdc"""
from __future__ import annotations

import gc
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

from pxr import Usd, UsdGeom, UsdShade

STAGE = "/media/disniekie/Working3/NEWCARLA/ov-citylab/assets/city/city_generator_large.usdc"
OUT = Path(__file__).resolve().parents[1]
OUT_JSON = OUT / "baseline_profile.json"
OUT_DIR = OUT / "profiles"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def open_once_ms(path: str) -> float:
    t0 = time.perf_counter()
    stage = Usd.Stage.Open(path)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    del stage
    gc.collect()
    return elapsed_ms


def main() -> None:
    cold_open_ms = open_once_ms(STAGE)
    _warmup = open_once_ms(STAGE)
    warm_samples = [open_once_ms(STAGE) for _ in range(5)]
    warm_open_ms = median(warm_samples)
    warm_spread = (
        (max(warm_samples) - min(warm_samples)) / warm_open_ms * 100.0 if warm_open_ms else 0.0
    )

    stage = Usd.Stage.Open(STAGE)

    t0 = time.perf_counter()
    prims = list(stage.Traverse())
    traverse_ms = (time.perf_counter() - t0) * 1000.0

    t0 = time.perf_counter()
    n_attr = 0
    for p in prims:
        for a in p.GetAttributes():
            _ = a.Get()
            n_attr += 1
            if n_attr >= 50000:
                break
        if n_attr >= 50000:
            break
    attr_ms = (time.perf_counter() - t0) * 1000.0

    t0 = time.perf_counter()
    cache = UsdGeom.XformCache(Usd.TimeCode.Default())
    n_xf = 0
    for p in prims:
        if p.IsA(UsdGeom.Xformable):
            cache.GetLocalToWorldTransform(p)
            n_xf += 1
    xform_ms = (time.perf_counter() - t0) * 1000.0

    t0 = time.perf_counter()
    n_mat = 0
    for p in prims:
        if p.IsA(UsdGeom.Imageable):
            UsdShade.MaterialBindingAPI(p).ComputeBoundMaterial()
            n_mat += 1
            if n_mat >= 20000:
                break
    mat_ms = (time.perf_counter() - t0) * 1000.0

    report = {
        "schemaVersion": "0.4.1",
        "mode": "quick",
        "label": "profile-stage:baseline",
        "probed_at": datetime.now(timezone.utc).isoformat(),
        "stage": STAGE,
        "metrics": {
            "cold_open_ms": round(cold_open_ms, 2),
            "warmup_open_ms": round(_warmup, 2),
            "warm_open_ms": round(warm_open_ms, 2),
            "warm_open_samples_ms": [round(x, 2) for x in warm_samples],
            "warm_open_spread_pct": round(warm_spread, 2),
            "traverse_ms": round(traverse_ms, 2),
            "traverse_prim_count": len(prims),
            "attr_resolve_ms_capped": round(attr_ms, 2),
            "attr_resolve_count_capped": n_attr,
            "xform_cache_ms": round(xform_ms, 2),
            "xformable_count": n_xf,
            "material_bind_ms_capped": round(mat_ms, 2),
            "material_bind_count_capped": n_mat,
        },
        "notes": [
            "Quick mode: no FPS/VRAM (Kit→omniperf adjunct not enabled).",
            "Attribute and material bind timings are capped for large stages.",
        ],
    }
    OUT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")
    (OUT_DIR / "baseline_quick.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(OUT_JSON), "warm_open_ms": report["metrics"]["warm_open_ms"], "traverse_prim_count": len(prims)}))


if __name__ == "__main__":
    main()
