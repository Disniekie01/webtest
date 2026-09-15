#!/usr/bin/env bash
# Launch the Isaac Sim WebRTC Streaming Client against local Kit streaming.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/tools/webrtc-client/isaac-webrtc.AppImage"
if [[ ! -x "$APP" ]]; then
  echo "Missing $APP — download Isaac Sim WebRTC Streaming Client 1.1.5" >&2
  exit 1
fi
echo "[citylab-kit] Opening native WebRTC client → 127.0.0.1 (do not append :49100)"
exec "$APP" "$@"
