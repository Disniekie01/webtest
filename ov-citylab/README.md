# City Lab (`ov-citylab`)

Smart-city sim stack on the **new Omniverse libraries** (not Kit-as-app):

| Library | Role |
|---------|------|
| [`ovrtx`](https://nvidia-omniverse.github.io/ovrtx/) | RTX virtual cameras / sensors |
| [`ovstage`](https://github.com/NVIDIA-Omniverse/ovstage) | OpenUSD runtime stage |
| [`ovphysx`](https://nvidia-omniverse.github.io/PhysX/ovphysx/) | PhysX (optional — currently pins older `ovstage`; we use SUMO kinematics for traffic) |
| [SUMO](https://eclipse.dev/sumo/) (`eclipse-sumo`) | Roads, signals, cars, pedestrians |

Isaac Sim 5.1 at `~/isaacsim` remains available for IRA / richer people later. This folder is the deploy-shaped path: **libraries + TraCI + USD**.

## Setup

```bash
cd ov-citylab
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 1) Live OVRTX in the web app (Blacknode pattern)

Same approach as Blacknode `viewer-ovrtx`: GPU renders with **ovrtx**, browser shows **`/stream.mjpg`**.

```bash
# terminal A — OVRTX MJPEG server
cd ov-citylab && source .venv/bin/activate
python scripts/ovrtx_stream_server.py
# → http://127.0.0.1:8787/stream.mjpg

# terminal B — City Lab UI
cd webtest && npm run dev
# → http://127.0.0.1:5173  (proxies /ovrtx → :8787)
```

First frame compiles shaders and loads the city USD (can take a few minutes once).

## 2) Export a large City Generator USD

Needs Blender 4.3+ (we use `webtest/tools/blender-4.3.2-linux-x64`):

```bash
../webtest/tools/blender-4.3.2-linux-x64/blender -b --python tools/export_city_usd.py
# → assets/city/city_generator_large.usdc
```

## 3) Build SUMO network (traffic + ped behavior pack)

```bash
python tools/build_sumo_varwidth.py
# → assets/sumo/city.sumocfg  (loads traffic.rou.xml + ped_behaviors.rou.xml)
```

Pedestrian pack types: `elderly` / `adult` / `rushed` / `tourist` (striping model).
People meshes live in `assets/people/*.usdc` (same pattern as `assets/vehicles`). Regenerate:

```bash
../webtest/tools/blender-4.3.2-linux-x64/blender -b --python tools/export_people_usd.py
```

Sidewalk ribbons (from CityGen `CityGenside_walks`) → `assets/sumo/sidewalks.json`:

```bash
~/isaacsim/kit/python/bin/python3 tools/extract_sidewalks_usd.py
python tools/bake_ped_network.py
# → sidewalk + crossing edges in city_grid.net.xml, buildings.poly.xml parcels
```

Pedestrians route on `SW_*` sidewalks and `CR_*` crossings (vehicle lanes disallow pedestrians).
Building parcels are block interiors from sidewalk outer edges (proxy until per-mesh footprints).

## 4) Run City Lab

```bash
python scripts/run_city_lab.py --steps 200 --render-every 20
# → _output/frames/frame_*.png
```

## Architecture

```
stories JSON (later) ──► scenario ticks
                         │
SUMO TraCI ── vehicles/peds poses ──► ovstage attribute writes (next)
                         │
City Generator USD ──────┴──► ovstage ──► ovrtx cameras ──► CV / dashboard
```

**Why SUMO (not CARLA co-sim here):** CARLA+SUMO stays available under `NEWCARLA` for Unreal. For Omniverse libraries, SUMO gives a working road/traffic/ped authority without Kit. Visual mesh = City Generator USD; motion = SUMO.

**ovphysx note:** `ovphysx 0.5.11` requires `ovstage==0.1.1`, while `ovrtx 0.5` wants `ovstage 0.2`. We pin **ovrtx + ovstage 0.2** for cameras. Revisit physics when NVIDIA ships matching wheels.

## Web dashboard

`../webtest` stays the operator UI. Next bridge: stream `_output/frames` or WebRTC from ovrtx into the Yardline-style CV panel.
