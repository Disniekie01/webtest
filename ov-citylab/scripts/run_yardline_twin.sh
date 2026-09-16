#!/usr/bin/env bash
# Start Yardline CV against the City Lab twin viewport JPEG.
# Prereqs: Isaac streaming with CITYLAB_VIEWPORT_HTTP=1 (default), Vite on :5175.
set -euo pipefail
YARDLINE="${YARDLINE_ROOT:-/media/disniekie/Working3/CV/Yardline}"
cd "$YARDLINE"
if [[ -f .venv/bin/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi
echo "Yardline → twin frames at http://127.0.0.1:5175/viewport/frame.jpg"
echo "Open City Lab UI, toggle Yardline CV; WS via /yardline/ws/stream"
exec python -m uvicorn yardline.server:app --host 127.0.0.1 --port 8010
