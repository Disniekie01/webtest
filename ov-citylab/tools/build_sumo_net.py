"""Build a SUMO grid that matches City Generator streets (Blender sockets).

Source of truth (tools/preview_city_blender.py):
  TARGET_SPAN_M = 160, STREET_WIDTH = 8.0, Socket_12 = 2 lanes,
  4×4 parcels → 5 street lines.

SUMO model (vehicle lanes only — CG already draws sidewalks in the mesh):
  - 5×5 junctions @ 40 m → 160 m span (1:1 with USD)
  - 1 driving lane / direction @ 3.5 m → lane centers ~±1.75 m (inside 8 m street)
  - NO SUMO sidewalks (they push lanes onto the CG curb/sidewalk)
  - TLS guessed; no turn pockets (keeps junction radius tight)
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUMO_HOME = (
    ROOT
    / ".venv"
    / "lib"
    / f"python{sys.version_info.major}.{sys.version_info.minor}"
    / "site-packages"
    / "sumo"
)
BIN = SUMO_HOME / "bin"
OUT = ROOT / "assets" / "sumo"
OUT.mkdir(parents=True, exist_ok=True)

# --- match City Generator / USD ---
JUNCTIONS = 5
BLOCK_LENGTH_M = 40  # (JUNCTIONS-1)*40 == 160
STREET_WIDTH_M = 8.0
LANES = 1
LANE_WIDTH_M = 3.5  # 2 × 3.5 ≈ 7 m carriageway inside 8 m street
SPEED_MPS = 11.1  # ~40 km/h — calmer for Kit

env = os.environ.copy()
env["SUMO_HOME"] = str(SUMO_HOME)
env["PATH"] = f"{BIN}:{env.get('PATH', '')}"

if not (BIN / "netgenerate").exists():
    raise SystemExit(f"netgenerate missing under {BIN} — pip install eclipse-sumo in ov-citylab/.venv")

net = OUT / "city_grid.net.xml"
cmd = [
    str(BIN / "netgenerate"),
    "--grid",
    "--grid.x-number",
    str(JUNCTIONS),
    "--grid.y-number",
    str(JUNCTIONS),
    "--grid.length",
    str(BLOCK_LENGTH_M),
    "--default.lanenumber",
    str(LANES),
    "--default.lanewidth",
    str(LANE_WIDTH_M),
    "--default.speed",
    str(SPEED_MPS),
    # No sidewalks — CG mesh already has them; SUMO sidewalks offset cars onto curbs
    "--sidewalks.guess",
    "false",
    "--crossings.guess",
    "false",
    "--tls.guess",
    "true",
    "--junctions.corner-detail",
    "5",
    "--no-turnarounds",
    "true",
    "--output-file",
    str(net),
]
print("Running:", " ".join(cmd), flush=True)
subprocess.check_call(cmd, env=env)

span = (JUNCTIONS - 1) * BLOCK_LENGTH_M
carriageway = LANES * LANE_WIDTH_M * 2

# Arterial flows only (no randomTrips peds — keeps Kit clean)
flows = OUT / "traffic.rou.xml"
flows.write_text(
    """<?xml version="1.0" encoding="UTF-8"?>
<routes>
  <vType id="car" vClass="passenger" color="1,0.45,0.1"
         length="4.5" width="1.8" height="1.5"
         maxSpeed="11.1" speedFactor="0.9" sigma="0.3"
         accel="2.0" decel="4.5" emergencyDecel="9.0"
         minGap="2.5" guiShape="passenger" latAlignment="center"
         jmIgnoreKeepClearTime="2" impatience="0.2"/>

  <flow id="ns_b" type="car" begin="0" end="3600" period="12"
        from="B0B1" to="B3B4" departLane="best" departSpeed="max"/>
  <flow id="sn_c" type="car" begin="0" end="3600" period="14"
        from="C4C3" to="C1C0" departLane="best" departSpeed="max"/>
  <flow id="ew_1" type="car" begin="0" end="3600" period="12"
        from="A1B1" to="D1E1" departLane="best" departSpeed="max"/>
  <flow id="we_2" type="car" begin="0" end="3600" period="14"
        from="E2D2" to="B2A2" departLane="best" departSpeed="max"/>
  <flow id="diag" type="car" begin="0" end="3600" period="20"
        from="A0B0" to="D3E3" departLane="best" departSpeed="max"/>
</routes>
"""
)

cfg = OUT / "city.sumocfg"
cfg.write_text(
    f"""<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <input>
    <net-file value="{net.name}"/>
    <route-files value="traffic.rou.xml"/>
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
  </processing>
  <report>
    <duration-log.disable value="true"/>
    <no-step-log value="true"/>
  </report>
</configuration>
"""
)

meta = OUT / "sumo_bounds.txt"
meta.write_text(
    f"junctions={JUNCTIONS}x{JUNCTIONS}\n"
    f"block_length_m={BLOCK_LENGTH_M}\n"
    f"span_m={span}\n"
    f"street_width_m={STREET_WIDTH_M}\n"
    f"lanes_per_direction={LANES}\n"
    f"lane_width_m={LANE_WIDTH_M}\n"
    f"carriageway_both_ways_m={carriageway:.1f}\n"
    f"sidewalks=0\n"
    f"note=no_sumo_sidewalks_so_lanes_stay_in_cg_street\n"
)

sys.path.insert(0, str(SUMO_HOME / "tools"))
import sumolib  # noqa: E402

snet = sumolib.net.readNet(str(net))
needed = ["B0B1", "B3B4", "C4C3", "C1C0", "A1B1", "D1E1", "E2D2", "B2A2", "A0B0", "D3E3"]
missing = [e for e in needed if snet.getEdge(e) is None]
e = snet.getEdge("B1B2")
lane0 = e.getLanes()[0].getShape()[0]
print(f"B1B2 lane0 start xy={lane0} (expect ~x=41.75 for centerline 40 + 1.75)")
print("boundary", snet.getBoundary())

print("wrote", net)
print("wrote", cfg)
print("wrote", flows)
print(
    f"SUMO span={span} m  lanes/dir={LANES}×{LANE_WIDTH_M} m  "
    f"carriageway≈{carriageway:.1f} m (street {STREET_WIDTH_M} m)  sidewalks=OFF"
)
if missing:
    print("WARN missing flow edges:", missing)
    raise SystemExit(1)
print("flow edges OK")
print("DONE")
