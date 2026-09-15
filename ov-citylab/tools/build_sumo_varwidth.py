#!/usr/bin/env python3
"""Build a SUMO grid whose lane widths match City Generator curb-to-curb carriageway.

Measures CityGen_Curb on the exported USD Plane, writes plain nodes/edges, netconvert.

Coordinate map (city centered, SUMO 0..160):
  USD = SUMO - 80
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from collections import defaultdict
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
BIN = SUMO_HOME / "bin"

JUNCTIONS = 5
BLOCK = 40.0
SPAN = (JUNCTIONS - 1) * BLOCK
SPEED = 5.0  # ~18 km/h — slow city crawl for twin preview


def measure_carriageways_docker() -> dict[str, float | None]:
    helper = ROOT / "tools" / "_measure_carriage_usd.py"
    helper.write_text(
        '''import json, sys
from pxr import Usd, UsdGeom

stage = Usd.Stage.Open(sys.argv[1])
plane = stage.GetPrimAtPath("/World/City/City_Generator_2_0_Object/Plane")
mesh = UsdGeom.Mesh(plane)
pts = list(mesh.GetPointsAttr().Get())
counts = list(mesh.GetFaceVertexCountsAttr().Get())
indices = list(mesh.GetFaceVertexIndicesAttr().Get())
face_starts = []
s = 0
for c in counts:
    face_starts.append(s)
    s += int(c)

def face_xy(fi):
    c = int(counts[fi])
    st = face_starts[fi]
    fpts = [pts[int(indices[st + k])] for k in range(c)]
    xs = [float(p[0]) for p in fpts]
    ys = [float(p[1]) for p in fpts]
    return min(xs), max(xs), min(ys), max(ys), 0.5 * (min(xs) + max(xs)), 0.5 * (min(ys) + max(ys))

curbs = []
for fi in map(int, plane.GetChild("CityGen_Curb").GetAttribute("indices").Get()):
    x0, x1, y0, y1, cx, cy = face_xy(fi)
    curbs.append((cx, cy, x0, x1, y0, y1))

ORIGIN = 80.0
BLOCK = 40.0
out = {}

def carriage_ns(line_usd, y0u, y1u):
    left, right = [], []
    y_lo, y_hi = min(y0u, y1u), max(y0u, y1u)
    for cx, cy, x0, x1, y0, y1 in curbs:
        if cy < y_lo - 1 or cy > y_hi + 1:
            continue
        if abs(cx - line_usd) > 12:
            continue
        (left if cx < line_usd else right).extend([x0, x1])
    if not left or not right:
        return None
    lo, hi = max(left), min(right)
    return hi - lo if hi > lo else None

def carriage_ew(line_usd, x0u, x1u):
    bot, top = [], []
    x_lo, x_hi = min(x0u, x1u), max(x0u, x1u)
    for cx, cy, x0, x1, y0, y1 in curbs:
        if cx < x_lo - 1 or cx > x_hi + 1:
            continue
        if abs(cy - line_usd) > 12:
            continue
        (bot if cy < line_usd else top).extend([y0, y1])
    if not bot or not top:
        return None
    lo, hi = max(bot), min(top)
    return hi - lo if hi > lo else None

for i in range(5):
    sx = i * BLOCK
    line_usd = sx - ORIGIN
    for j in range(4):
        sy0, sy1 = j * BLOCK, (j + 1) * BLOCK
        c = carriage_ns(line_usd, sy0 - ORIGIN, sy1 - ORIGIN)
        out[f"NS|{sx}|{sy0}|{sy1}"] = c

for j in range(5):
    sy = j * BLOCK
    line_usd = sy - ORIGIN
    for i in range(4):
        sx0, sx1 = i * BLOCK, (i + 1) * BLOCK
        c = carriage_ew(line_usd, sx0 - ORIGIN, sx1 - ORIGIN)
        out[f"EW|{sy}|{sx0}|{sx1}"] = c

print(json.dumps(out))
''',
        encoding="utf-8",
    )

    cmd = [
        "docker",
        "exec",
        "citylab-isaac6",
        "bash",
        "-lc",
        "LIBROOT=/isaac-sim/extscache/omni.usd.libs-1.0.3+f9bf0dda.lx64.r.cp312; "
        "export LD_LIBRARY_PATH=$LIBROOT/bin:$LD_LIBRARY_PATH PYTHONPATH=$LIBROOT:$PYTHONPATH; "
        "/isaac-sim/kit/python/bin/python3 /citylab/tools/_measure_carriage_usd.py "
        "/citylab/assets/city/city_generator_large.usdc",
    ]
    raw = subprocess.check_output(cmd, text=True)
    line = [ln for ln in raw.strip().splitlines() if ln.startswith("{")][-1]
    data = json.loads(line)
    return {k: (float(v) if v is not None else None) for k, v in data.items()}


def lane_width_from_carriage(carriage: float | None) -> float:
    if carriage is None or carriage <= 0:
        return 3.5
    half = carriage * 0.5
    return max(2.0, min(3.75, round(half * 2) / 2))


def jid(i: int, j: int) -> str:
    return f"{chr(ord('A') + i)}{j}"


def build_plain(widths: dict[str, float]) -> tuple[Path, Path]:
    nod = OUT / "city_var.nod.xml"
    edg = OUT / "city_var.edg.xml"
    nodes = [
        f'  <node id="{jid(i,j)}" x="{i*BLOCK:.1f}" y="{j*BLOCK:.1f}" type="traffic_light"/>'
        for i in range(JUNCTIONS)
        for j in range(JUNCTIONS)
    ]
    nod.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<nodes>\n' + "\n".join(nodes) + "\n</nodes>\n",
        encoding="utf-8",
    )

    edges: list[str] = []
    for i in range(JUNCTIONS):
        for j in range(JUNCTIONS - 1):
            key = f"NS|{i*BLOCK}|{j*BLOCK}|{(j+1)*BLOCK}"
            lw = widths[key]
            a, b = jid(i, j), jid(i, j + 1)
            edges.append(
                f'  <edge id="{a}{b}" from="{a}" to="{b}" numLanes="1" speed="{SPEED}" width="{lw}"/>'
            )
            edges.append(
                f'  <edge id="{b}{a}" from="{b}" to="{a}" numLanes="1" speed="{SPEED}" width="{lw}"/>'
            )
    for j in range(JUNCTIONS):
        for i in range(JUNCTIONS - 1):
            key = f"EW|{j*BLOCK}|{i*BLOCK}|{(i+1)*BLOCK}"
            lw = widths[key]
            a, b = jid(i, j), jid(i + 1, j)
            edges.append(
                f'  <edge id="{a}{b}" from="{a}" to="{b}" numLanes="1" speed="{SPEED}" width="{lw}"/>'
            )
            edges.append(
                f'  <edge id="{b}{a}" from="{b}" to="{a}" numLanes="1" speed="{SPEED}" width="{lw}"/>'
            )

    edg.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<edges>\n' + "\n".join(edges) + "\n</edges>\n",
        encoding="utf-8",
    )
    return nod, edg


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if not (BIN / "netconvert").exists():
        raise SystemExit(f"netconvert missing: {BIN}")

    print("Measuring curb carriageways from city USD…", flush=True)
    raw = measure_carriageways_docker()
    widths: dict[str, float] = {}
    hist: dict[float, int] = defaultdict(int)
    for k, c in sorted(raw.items()):
        lw = lane_width_from_carriage(c)
        widths[k] = lw
        hist[lw] += 1
        print(f"  {k}: carriage={c} → lane_w={lw}")

    print("lane width hist:", dict(sorted(hist.items())), flush=True)
    nod, edg = build_plain(widths)
    net = OUT / "city_grid.net.xml"
    cmd = [
        str(BIN / "netconvert"),
        f"--node-files={nod}",
        f"--edge-files={edg}",
        "--no-turnarounds",
        "true",
        "--tls.guess",
        "true",
        "--junctions.corner-detail",
        "5",
        "-o",
        str(net),
    ]
    print("Running:", " ".join(cmd), flush=True)
    env = os.environ.copy()
    env["SUMO_HOME"] = str(SUMO_HOME)
    env["PATH"] = f"{BIN}:{env.get('PATH', '')}"
    subprocess.check_call(cmd, env=env)

    (OUT / "city.sumocfg").write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <input>
    <net-file value="{net.name}"/>
    <route-files value="traffic.rou.xml,ped_behaviors.rou.xml"/>
  </input>
  <time>
    <begin value="0"/>
    <end value="3600"/>
    <step-length value="0.05"/>
  </time>
  <processing>
    <collision.action value="warn"/>
    <time-to-teleport value="120"/>
    <emergencydecel.warning-threshold value="1.5"/>
    <pedestrian.model value="striping"/>
    <pedestrian.striping.dawdling value="0.25"/>
    <pedestrian.striping.stripe-width value="0.65"/>
  </processing>
  <report>
    <duration-log.disable value="true"/>
    <no-step-log value="true"/>
  </report>
</configuration>
""",
        encoding="utf-8",
    )

    (OUT / "sumo_bounds.txt").write_text(
        f"junctions={JUNCTIONS}x{JUNCTIONS}\n"
        f"block_length_m={BLOCK}\n"
        f"span_m={SPAN}\n"
        f"variable_lane_widths=1\n"
        f"lane_width_hist={dict(sorted(hist.items()))}\n"
        f"sidewalks_in_sumo=0\n"
        f"source=curb_inner_from_CityGen_Curb\n",
        encoding="utf-8",
    )

    # Save measured map for debugging
    (OUT / "carriage_to_lane_width.json").write_text(
        json.dumps(
            {
                k: {"carriage_m": raw[k], "lane_width_m": widths[k]}
                for k in sorted(raw)
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    sys.path.insert(0, str(SUMO_HOME / "tools"))
    import sumolib  # noqa: E402

    snet = sumolib.net.readNet(str(net))
    needed = ["B0B1", "B3B4", "C4C3", "C1C0", "A1B1", "D1E1", "E2D2", "B2A2", "A0B0", "D3E3"]
    missing = [e for e in needed if snet.getEdge(e) is None]
    print("sample edge widths:")
    for eid in ["B0B1", "B1B2", "B2B3", "C2C3", "A1B1", "B1C1", "D1E1"]:
        e = snet.getEdge(eid)
        if e:
            print(f"  {eid}: w={[l.getWidth() for l in e.getLanes()]}")
    if missing:
        raise SystemExit(f"missing edges: {missing}")
    print("wrote", net)
    print("DONE — next: extract_sidewalks_usd.py && bake_ped_network.py for ped graph")


if __name__ == "__main__":
    main()
