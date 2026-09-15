#!/usr/bin/env bash
# Official Isaac 6 browser WebRTC viewer (create-ov-web-rtc-app local-sample) on :8210
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIEWER="$ROOT/isaac6/web-viewer"
PORT="${WEB_VIEWER_PORT:-8210}"
cd "$VIEWER"
if [[ ! -d node_modules ]]; then
  echo "[citylab-web-viewer] npm install…"
  npm install --ignore-scripts
fi
echo "[citylab-web-viewer] http://127.0.0.1:${PORT}/ → Kit signaling 127.0.0.1:49100"
exec npx vite --host 127.0.0.1 --port "$PORT"
