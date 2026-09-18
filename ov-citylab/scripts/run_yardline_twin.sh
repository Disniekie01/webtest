#!/usr/bin/env bash
# Start Yardline CV against the City Lab twin viewport JPEG.
# Prereqs: Isaac streaming with CITYLAB_VIEWPORT_HTTP=1 (default), Vite on :5175.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
YARDLINE="${YARDLINE_ROOT:-$REPO_ROOT/yardline}"
cd "$YARDLINE"
PY="$YARDLINE/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "missing Yardline venv python at $PY" >&2
  echo "Create it once: cd \"$YARDLINE\" && python3 -m venv .venv && .venv/bin/pip install -e ." >&2
  exit 1
fi
# Twin profile: nano YOLO, light JPEGs — shares GPU with Isaac.
export YARDLINE_TWIN="${YARDLINE_TWIN:-1}"
echo "Yardline (twin) → http://127.0.0.1:5175/viewport/frame.jpg"
echo "Open City Lab UI, toggle Yardline CV; WS via /yardline/ws/stream"
exec "$PY" -m uvicorn yardline.server:app --host 127.0.0.1 --port 8010
