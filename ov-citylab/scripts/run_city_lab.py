#!/usr/bin/env python3
"""
City Lab runtime: SUMO (roads/traffic/peds) + ovrtx cameras.

- SUMO owns vehicle/pedestrian motion (TraCI).
- ovrtx renders virtual CCTV frames from the OpenUSD stage.
- City mesh is referenced from assets/city/city_generator_large.usdc when present.

Coordinate note: SUMO grid origin is the SW corner; we center it on the USD city.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENV_SUMO = (
    ROOT
    / ".venv"
    / "lib"
    / f"python{sys.version_info.major}.{sys.version_info.minor}"
    / "site-packages"
    / "sumo"
)
sys.path.insert(0, str(VENV_SUMO / "tools"))
os.environ.setdefault("SUMO_HOME", str(VENV_SUMO))
os.environ["PATH"] = f"{VENV_SUMO / 'bin'}:{os.environ.get('PATH', '')}"

import numpy as np  # noqa: E402
import traci  # noqa: E402
from PIL import Image  # noqa: E402

# Optional heavy imports after SUMO path is set
import ovrtx  # noqa: E402
import ovstage  # noqa: E402


def sumo_to_usd(x: float, y: float, net_w: float, net_h: float) -> tuple[float, float]:
    """SUMO (x,y) → USD (x,z) with Y-up, city centered at origin."""
    return (x - net_w * 0.5, -(y - net_h * 0.5))


def main() -> int:
    ap = argparse.ArgumentParser(description="Run City Lab (SUMO + ovrtx)")
    ap.add_argument("--steps", type=int, default=120)
    ap.add_argument("--render-every", type=int, default=20)
    ap.add_argument("--camera", default="/Render/Camera")
    ap.add_argument("--headless-sumo", action="store_true", default=True)
    ap.add_argument("--out-dir", type=Path, default=ROOT / "_output" / "frames")
    args = ap.parse_args()

    stage_usd = ROOT / "assets" / "stage" / "city_lab.usda"
    city_usd = ROOT / "assets" / "city" / "city_generator_large.usdc"
    sumo_cfg = ROOT / "assets" / "sumo" / "city.sumocfg"
    if not sumo_cfg.exists():
        print("SUMO config missing — run: python tools/build_sumo_net.py", file=sys.stderr)
        return 1

    print("Starting SUMO ...", file=sys.stderr)
    sumo_bin = str(VENV_SUMO / "bin" / "sumo")
    traci.start([sumo_bin, "-c", str(sumo_cfg), "--start", "--quit-on-end"])
    net_w = traci.simulation.getNetBoundary()[1][0] - traci.simulation.getNetBoundary()[0][0]
    net_h = traci.simulation.getNetBoundary()[1][1] - traci.simulation.getNetBoundary()[0][1]
    print(f"SUMO net size ≈ {net_w:.1f} x {net_h:.1f} m", file=sys.stderr)

    print("Creating ovrtx renderer ...", file=sys.stderr)
    renderer = ovrtx.Renderer()
    stage = ovstage.Stage("citylab.runtime")
    renderer.attach_ovstage(stage)

    ordinal = 1
    if not city_usd.exists():
        print(
            "WARN: city USD missing — run tools/export_city_usd.py first",
            file=sys.stderr,
        )
    print(f"Opening stage {stage_usd} ...", file=sys.stderr)
    ovstage.population.open_usd(stage, str(stage_usd.resolve()), ordinal=ordinal)
    stage.advance_write_floor(ordinal, ovstage.Scope.ALL).wait()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    for step in range(args.steps):
        traci.simulationStep()
        n_veh = traci.vehicle.getIDCount()
        n_ped = traci.person.getIDCount()

        # Log actor poses (USD prim writes land in a follow-up once schemas settle)
        if step % args.render_every == 0:
            sample = []
            for vid in list(traci.vehicle.getIDList())[:3]:
                x, y = traci.vehicle.getPosition(vid)
                ux, uz = sumo_to_usd(x, y, net_w, net_h)
                sample.append(f"{vid}=({ux:.1f},{uz:.1f})")
            print(
                f"t={traci.simulation.getTime():.2f}s veh={n_veh} ped={n_ped} {', '.join(sample)}",
                file=sys.stderr,
            )
            products = renderer.step(
                render_products={args.camera},
                delta_time=0.05,
                ordinal=ordinal,
            )
            for _name, product in products.items():
                for frame in product.frames:
                    key = f"{args.camera}/LdrColor"
                    if key not in frame.render_vars:
                        key = next(iter(frame.render_vars))
                    var = frame.render_vars[key].map(device=ovrtx.Device.CPU)
                    pixels = np.from_dlpack(var).copy()
                    var.unmap()
                    out = args.out_dir / f"frame_{step:05d}.png"
                    Image.fromarray(pixels).save(out)
                    print(f"  rendered {out}", file=sys.stderr)

    print(f"Done in {time.time() - t0:.1f}s", file=sys.stderr)
    traci.close()
    renderer.detach_ovstage()
    stage.destroy()
    renderer.destroy()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
