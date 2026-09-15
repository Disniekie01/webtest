#!/usr/bin/env bash
# Launch Isaac Sim 5.1 headless WebRTC streaming with the City Lab USD stage + SUMO traffic.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISAAC_HOME="${ISAAC_HOME:-$HOME/isaacsim}"
USD="${CITY_USD:-$ROOT/assets/stage/city_lab.usda}"
SIGNAL_PORT="${ISAACSIM_SIGNAL_PORT:-49100}"
LOG="${OV_CITYLAB_KIT_LOG:-/tmp/citylab_kit_streaming.log}"
EXTS="$ROOT/exts"

if [[ ! -x "$ISAAC_HOME/isaac-sim.streaming.sh" ]]; then
  echo "Isaac Sim streaming launcher not found: $ISAAC_HOME/isaac-sim.streaming.sh" >&2
  exit 1
fi
if [[ ! -f "$USD" ]]; then
  echo "City USD missing: $USD" >&2
  exit 1
fi

# Free OVRTX MJPEG GPU path if still holding the device
pkill -f 'ovrtx_stream_server.py' 2>/dev/null || true
fuser -k 8787/tcp 2>/dev/null || true

export CITYLAB_USD="$USD"
export CITYLAB_ROOT="$ROOT"
export ACCEPT_EULA="${ACCEPT_EULA:-Y}"
export PRIVACY_CONSENT="${PRIVACY_CONSENT:-Y}"

echo "[citylab-kit] Isaac: $ISAAC_HOME"
echo "[citylab-kit] USD:   $USD"
echo "[citylab-kit] WebRTC signaling TCP $SIGNAL_PORT · media UDP 47998"
echo "[citylab-kit] log:   $LOG"
echo "[citylab-kit] Connect City Lab webview → 127.0.0.1:$SIGNAL_PORT"

(
  for _ in $(seq 1 180); do
    if ss -ltn 2>/dev/null | grep -q ":${SIGNAL_PORT} "; then
      echo "[citylab-kit] READY — signaling on 127.0.0.1:${SIGNAL_PORT}"
      exit 0
    fi
    sleep 2
  done
  echo "[citylab-kit] WARN — signaling port ${SIGNAL_PORT} not seen after 6 min" >&2
) &

# Viewport-only: hide Isaac editor chrome (panels/menubar). City Lab embeds the
# Kit viewport framebuffer — not the full editor UI.
# shellcheck disable=SC2086
exec "$ISAAC_HOME/isaac-sim.streaming.sh" \
  --no-ros-env \
  --ext-folder "$EXTS" \
  --enable citylab.traffic \
  --/isaac/startup/create_new_stage=0 \
  --/app/livestream/publicEndpointAddress=127.0.0.1 \
  --/app/livestream/port="${SIGNAL_PORT}" \
  --/app/window/hideUi=1 \
  --/app/window/drawMouse=0 \
  --/app/window/width=1920 \
  --/app/window/height=1080 \
  --/app/renderer/resolution/width=1920 \
  --/app/renderer/resolution/height=1080 \
  --/app/livestream/allowDynamicResize=1 \
  --/app/viewport/grid/enabled=0 \
  --/exts/omni.kit.viewport.window/startup/windowName="" \
  --/renderer/multiGpu/enabled=0 \
  "$USD" \
  "$@" 2>&1 | tee "$LOG"
