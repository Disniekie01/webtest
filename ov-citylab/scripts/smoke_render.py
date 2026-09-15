#!/usr/bin/env python3
"""Smoke-test ovrtx + ovstage: render one frame from NVIDIA sample or local stage."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import ovrtx
import ovstage
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_USD = (
    "https://omniverse-content-production.s3.us-west-2.amazonaws.com/"
    "Samples/Robot-OVRTX/robot-ovrtx.usda"
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--usd",
        default=SAMPLE_USD,
        help="USD URL or local path (default: NVIDIA ovrtx sample)",
    )
    parser.add_argument("--camera", default="/Render/Camera")
    parser.add_argument("--out", type=Path, default=ROOT / "_output" / "smoke.png")
    args = parser.parse_args()

    usd = args.usd
    if not usd.startswith("http") and not Path(usd).is_absolute():
        usd = str((ROOT / usd).resolve())

    print("Creating ovrtx renderer (first run compiles shaders)...", file=sys.stderr)
    renderer = ovrtx.Renderer()
    stage = ovstage.Stage("citylab.smoke")
    renderer.attach_ovstage(stage)

    ordinal = 1
    print(f"Opening {usd} ...", file=sys.stderr)
    ovstage.population.open_usd(stage, usd, ordinal=ordinal)
    stage.advance_write_floor(ordinal, ovstage.Scope.ALL).wait()

    print(f"Stepping {args.camera} ...", file=sys.stderr)
    products = renderer.step(
        render_products={args.camera},
        delta_time=1.0 / 60.0,
        ordinal=ordinal,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    for _name, product in products.items():
        for frame in product.frames:
            # Prefer explicit LdrColor path; fall back to first render var
            key = f"{args.camera}/LdrColor"
            if key not in frame.render_vars:
                key = next(iter(frame.render_vars))
            var = frame.render_vars[key].map(device=ovrtx.Device.CPU)
            view = np.from_dlpack(var)
            pixels = view.copy()
            del view
            var.unmap()
            Image.fromarray(pixels).save(args.out)
            print(f"Wrote {args.out}", file=sys.stderr)

    renderer.detach_ovstage()
    stage.destroy()
    renderer.destroy()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
