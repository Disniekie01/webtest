#!/usr/bin/env python3
"""Run sumo-gui at wall-clock speed so pedestrian behaviour can be eyeballed.

Standalone sumo-gui with --delay only approximates real time; here each 0.05 s
step is paced against the clock and a few frames are written to disk so runs can
be compared after the fact.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUMO_HOME = ROOT / ".venv/lib/python3.13/site-packages/sumo"
os.environ.setdefault("SUMO_HOME", str(SUMO_HOME))
sys.path.insert(0, str(SUMO_HOME / "tools"))

import traci  # noqa: E402

STEP = 0.05


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=3600.0)
    ap.add_argument("--zoom", type=float, default=900.0)
    ap.add_argument("--center", default="44,40")
    ap.add_argument("--shot-dir", default="/tmp/sumo_shots")
    ap.add_argument("--shot-every", type=float, default=8.0, help="0 disables")
    args = ap.parse_args()

    cx, cy = (float(v) for v in args.center.split(","))
    shots = Path(args.shot_dir)
    shots.mkdir(parents=True, exist_ok=True)

    traci.start(
        [
            str(SUMO_HOME / "bin/sumo-gui"),
            "-c",
            str(ROOT / "assets/sumo/city.sumocfg"),
            "--gui-settings-file",
            str(ROOT / "assets/sumo/gui_natural.xml"),
            "--start",
            "--quit-on-end",
            "false",
            "--window-size",
            "1600,1000",
            "--no-step-log",
            "true",
        ]
    )

    view = "View #0"
    traci.gui.setSchema(view, "real world")
    traci.gui.setOffset(view, cx, cy)
    traci.gui.setZoom(view, args.zoom)

    total = int(args.seconds / STEP)
    shot_iv = int(args.shot_every / STEP) if args.shot_every > 0 else 0
    shot_n = 0
    t0 = time.monotonic()
    for i in range(total):
        traci.simulationStep()

        if shot_iv and i % shot_iv == 0 and shot_n < 6:
            traci.gui.screenshot(view, str(shots / f"frame_{shot_n:02d}.png"))
            shot_n += 1

        # Pace to wall clock; report drift so a slow machine is visible.
        target = t0 + (i + 1) * STEP
        slack = target - time.monotonic()
        if slack > 0:
            time.sleep(slack)
        elif i % 400 == 0 and i:
            print(f"  behind real time by {-slack:.2f}s at t={i * STEP:.0f}s", flush=True)

    traci.close()


if __name__ == "__main__":
    main()
