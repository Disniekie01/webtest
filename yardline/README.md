# Yardline

Metric work-zone / city-twin clearance from a camera. Detect people and machines, keep IDs, calibrate a ground plane, then compute constant-velocity time-to-collision.

This tree is vendored into the City Lab **webtest** monorepo (`./yardline`). For the Isaac twin, prefer:

```bash
# one-time
cd yardline && python3 -m venv .venv && .venv/bin/pip install -e .

# from webtest root
ov-citylab/scripts/run_yardline_twin.sh   # YARDLINE_TWIN=1 → config/twin.json
```

Or manually:

```bash
cd yardline
source .venv/bin/activate
export YARDLINE_TWIN=1
python -m uvicorn yardline.server:app --host 127.0.0.1 --port 8010
```

Open http://127.0.0.1:8010 (or City Lab UI → Yardline via Vite `/yardline` proxy).

1. Twin / Play a source. Boxes and IDs are live GPU inference.
2. Calibrate plane: click four ground points and set metric coordinates.
3. TTC and the top-down view appear only after that homography exists.

Swap `weights/yolov8n.pt` for a site-trained YOLO when you have one (classes in `config/default.json`). Twin overlay: `config/twin.json`.
