#!/usr/bin/env python3
"""Validate pedestrians stay on SW_*/CR_* and align with sidewalk ribbons.

  python tools/validate_ped_sidewalks.py
  python tools/validate_ped_sidewalks.py --steps 2000 --gui
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "sumo"
SUMO_HOME = (
    ROOT
    / ".venv"
    / "lib"
    / f"python{sys.version_info.major}.{sys.version_info.minor}"
    / "site-packages"
    / "sumo"
)
BLOCK = 40.0


def _edge_from_lane(lane_id: str) -> str:
    if not lane_id:
        return ""
    if lane_id.startswith(":"):
        return lane_id
    if "_" in lane_id and lane_id.rsplit("_", 1)[-1].isdigit():
        return lane_id.rsplit("_", 1)[0]
    return lane_id


def _parse_ped_edge(edge: str) -> dict | None:
    if not edge:
        return None
    if edge.endswith("_r"):
        edge = edge[:-2]
    if edge.startswith("SW_NS_"):
        parts = edge.split("_")
        if len(parts) >= 6 and parts[-1] in ("L", "R") and parts[2].isdigit():
            return {"kind": "SW", "dir": "NS", "line": float(int(parts[2]) * BLOCK), "side": parts[-1]}
    if edge.startswith("SW_EW_"):
        parts = edge.split("_")
        if len(parts) >= 6 and parts[-1] in ("B", "T") and parts[2].isdigit():
            return {"kind": "SW", "dir": "EW", "line": float(int(parts[2]) * BLOCK), "side": parts[-1]}
    if edge.startswith("CR_NS_"):
        parts = edge.split("_")
        if len(parts) >= 5 and parts[-1] in ("B", "T") and parts[2].isdigit() and parts[3].isdigit():
            return {"kind": "CR", "dir": "EW", "line": float(int(parts[3]) * BLOCK), "side": parts[-1]}
    if edge.startswith("CR_EW_"):
        parts = edge.split("_")
        if len(parts) >= 5 and parts[-1] in ("L", "R") and parts[2].isdigit() and parts[3].isdigit():
            return {"kind": "CR", "dir": "NS", "line": float(int(parts[2]) * BLOCK), "side": parts[-1]}
    return None


def _ribbon_for(ribbons: list[dict], direction: str, line: float, side: str) -> dict | None:
    best = None
    best_d = 1e9
    for r in ribbons:
        if r.get("dir") != direction:
            continue
        d = abs(float(r["line_sumo"]) - line)
        if d < best_d and r.get("side") == side:
            best, best_d = r, d
    return best if best is not None and best_d < 1.0 else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=1500)
    ap.add_argument("--gui", action="store_true", help="Open sumo-gui (visual check)")
    ap.add_argument("--delay", type=int, default=40, help="GUI delay ms")
    args = ap.parse_args()

    os.environ["SUMO_HOME"] = str(SUMO_HOME)
    sys.path.insert(0, str(SUMO_HOME / "tools"))
    import traci

    ribbons = json.loads((OUT / "sidewalks.json").read_text(encoding="utf-8"))["ribbons"]
    binary = SUMO_HOME / "bin" / ("sumo-gui" if args.gui else "sumo")
    cmd = [
        str(binary),
        "-c",
        str(OUT / "city.sumocfg"),
        "--start",
        "--no-step-log",
        "true",
        "--pedestrian.model",
        "striping",
    ]
    if args.gui:
        cmd.extend(["--delay", str(args.delay)])

    traci.start(cmd)
    kind_c: Counter[str] = Counter()
    edge_c: Counter[str] = Counter()
    lateral_err: list[float] = []
    road_hits = 0
    samples: list[tuple] = []
    crossing_users: set[str] = set()
    sidewalk_users: set[str] = set()

    for step in range(args.steps):
        traci.simulationStep()
        for pid in traci.person.getIDList():
            try:
                lid = traci.person.getLaneID(pid)
            except Exception:
                lid = ""
            try:
                eid = traci.person.getRoadID(pid)
            except Exception:
                eid = ""
            x, y = traci.person.getPosition(pid)
            edge = _edge_from_lane(lid) or eid
            ped = _parse_ped_edge(edge)
            if ped is None:
                if edge.startswith(":"):
                    kind_c[":junc"] += 1
                elif len(edge) >= 4 and edge[0].isalpha() and edge[1].isdigit():
                    kind_c["VEHICLE_ROAD"] += 1
                    road_hits += 1
                else:
                    kind_c["OTHER"] += 1
            else:
                kind_c[ped["kind"]] += 1
                edge_c[edge if not edge.endswith("_r") else edge[:-2]] += 1
                if ped["kind"] == "SW":
                    sidewalk_users.add(pid)
                else:
                    crossing_users.add(pid)
                ribbon = _ribbon_for(ribbons, ped["dir"], ped["line"], ped["side"])
                if ribbon:
                    target = float(ribbon["center_sumo"])
                    err = abs(x - target) if ped["dir"] == "NS" else abs(y - target)
                    lateral_err.append(err)
            if step in (100, 400, 800, 1200) and len([s for s in samples if s[0] == step]) < 4:
                samples.append((step, pid, round(x, 2), round(y, 2), edge))

    traci.close()

    total = sum(kind_c.values()) or 1
    sw = kind_c.get("SW", 0)
    cr = kind_c.get("CR", 0)
    road = kind_c.get("VEHICLE_ROAD", 0)
    junc = kind_c.get(":junc", 0)
    mean_err = sum(lateral_err) / len(lateral_err) if lateral_err else float("nan")
    p95 = sorted(lateral_err)[int(0.95 * (len(lateral_err) - 1))] if lateral_err else float("nan")

    print("=== SUMO pedestrian sidewalk validation ===")
    print(f"steps={args.steps} person-ticks={total}")
    print(f"on SW_ sidewalk : {sw:7d}  ({100 * sw / total:5.1f}%)")
    print(f"on CR_ crossing : {cr:7d}  ({100 * cr / total:5.1f}%)")
    print(f"on junction     : {junc:7d}  ({100 * junc / total:5.1f}%)")
    print(f"on vehicle road : {road:7d}  ({100 * road / total:5.1f}%)  ← should be 0")
    print(f"unique on SW    : {len(sidewalk_users)}")
    print(f"unique used CR  : {len(crossing_users)}")
    print(f"lateral vs ribbon mean={mean_err:.2f} m  p95={p95:.2f} m  (SUMO raw; Isaac snaps to 0)")
    print("top edges:")
    for e, n in edge_c.most_common(12):
        print(f"  {e}: {n}")
    print("samples:")
    for s in samples:
        print(f"  {s}")

    ok = road == 0 and cr > 0 and sw > 0 and len(crossing_users) > 0
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
