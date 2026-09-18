#!/usr/bin/env bash
# Start Yardline CV against the City Lab twin viewport JPEG.
# Prereqs: Isaac streaming with CITYLAB_VIEWPORT_HTTP=1 (default), Vite on :5175.
set -euo pipefail
YARDLINE="${YARDLINE_ROOT:-/media/disniekie/Working4/CV/Yardline}"
cd "$YARDLINE"
PY="$YARDLINE/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "missing Yardline venv python at $PY" >&2
  exit 1
fi
# Twin profile: TensorRT nano @640, ~8 FPS, no YOLO-World — shares GPU with Isaac.
export YARDLINE_TWIN="${YARDLINE_TWIN:-1}"
echo "Yardline (twin) → http://127.0.0.1:5175/viewport/frame.jpg"
echo "Open City Lab UI, toggle Yardline CV; WS via /yardline/ws/stream"
exec "$PY" -m uvicorn yardline.server:app --host 127.0.0.1 --port 8010
