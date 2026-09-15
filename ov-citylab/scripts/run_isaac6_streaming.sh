#!/usr/bin/env bash
# Official Isaac Sim 6.0.1 streaming (Docker) — NVIDIA livestream best practice.
# Docs: one Chromium client on :8210 OR native WebRTC client; --network=host;
# ports 49100 TCP / 47998 UDP. Do not use Cursor Simple Browser for the stream.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CITYLAB="$ROOT"
IMAGE="${ISAAC_SIM_IMAGE:-nvcr.io/nvidia/isaac-sim:6.0.1}"
DATA="${ISAAC_SIM_DATA:-$HOME/docker/isaac-sim-citylab}"
NAME="${ISAAC_CONTAINER_NAME:-citylab-isaac6}"
# Isaac defaults (Livestream Clients doc)
SIGNAL_PORT="${ISAACSIM_SIGNAL_PORT:-49100}"
STREAM_PORT="${ISAACSIM_STREAM_PORT:-47998}"
HOST_IP="${ISAACSIM_HOST:-127.0.0.1}"

mkdir -p \
  "$DATA/cache/main" "$DATA/cache/computecache" "$DATA/cache/kit" \
  "$DATA/config" "$DATA/data" "$DATA/logs" "$DATA/pkg" \
  "$ROOT/isaac6/web-viewer/public"
chmod -R a+rwX "$DATA" 2>/dev/null || true

printf '%s\n' "$HOST_IP" >"$ROOT/isaac6/.stream_host"
printf '%s\n' "$HOST_IP" >"$ROOT/isaac6/web-viewer/public/stream-host.txt"
printf '{"host":"%s","signalingPort":%s,"mediaPort":%s}\n' "$HOST_IP" "$SIGNAL_PORT" "$STREAM_PORT" \
  >"$ROOT/isaac6/web-viewer/public/stream-config.json"

pkill -f 'isaacsim.exp.full' 2>/dev/null || true
# Clear both custom and default ports from earlier experiments
for p in 49100 49102 49101; do fuser -k "${p}/tcp" 2>/dev/null || true; done
for p in 47998 48002; do fuser -k "${p}/udp" 2>/dev/null || true; done
docker rm -f "$NAME" 2>/dev/null || true

echo "[citylab-isaac6] image=$IMAGE host=$HOST_IP signal=$SIGNAL_PORT media=$STREAM_PORT"
echo "[citylab-isaac6] city → lights → stream → SUMO last (deferred until media UDP)"
echo "[citylab-isaac6] Stream under City Lab UI → http://127.0.0.1:5175 (embedded :8210)"

docker run -d --name "$NAME" \
  --gpus all \
  --network=host \
  --runtime=nvidia \
  --user root \
  -e ACCEPT_EULA=Y \
  -e PRIVACY_CONSENT=Y \
  -e OMNI_KIT_ALLOW_ROOT=1 \
  -e ISAACSIM_HOST="$HOST_IP" \
  -e CITYLAB_ROOT=/citylab \
  -e CITYLAB_USD=/citylab/assets/stage/city_lab.usda \
  -e CITYLAB_VIEWPORT_HTTP=0 \
  -e CITYLAB_SUMO="${CITYLAB_SUMO:-1}" \
  -e CITYLAB_SUMO_DEFER="${CITYLAB_SUMO_DEFER:-1}" \
  -e CITYLAB_SUMO_START_FRAME="${CITYLAB_SUMO_START_FRAME:-300}" \
  -e CITYLAB_SUMO_MEDIA_SETTLE_FRAMES="${CITYLAB_SUMO_MEDIA_SETTLE_FRAMES:-180}" \
  -e CITYLAB_PED_MODEL="${CITYLAB_PED_MODEL:-striping}" \
  -e CITYLAB_MAX_PED="${CITYLAB_MAX_PED:-36}" \
  -e CITYLAB_PED_RIBBON_MARGIN_M="${CITYLAB_PED_RIBBON_MARGIN_M:-0.6}" \
  -e CITYLAB_PED_RIBBON_SHIFT_M="${CITYLAB_PED_RIBBON_SHIFT_M:-0.0}" \
  -e CITYLAB_PED_KEEP_RIGHT="${CITYLAB_PED_KEEP_RIGHT:-1}" \
  -e CITYLAB_PED_CURB_BIAS_M="${CITYLAB_PED_CURB_BIAS_M:-0.7}" \
  -e CITYLAB_LIGHTING="${CITYLAB_LIGHTING:-studio}" \
  -e CITYLAB_DYNAMIC_SKY="${CITYLAB_DYNAMIC_SKY:-0}" \
  -e CITYLAB_VIEW_W="${CITYLAB_VIEW_W:-1920}" \
  -e CITYLAB_VIEW_H="${CITYLAB_VIEW_H:-1080}" \
  -e CITYLAB_DLSS="${CITYLAB_DLSS:-1}" \
  -e CITYLAB_DLSS_MODE="${CITYLAB_DLSS_MODE:-quality}" \
  -e CITYLAB_HIDE_UI="${CITYLAB_HIDE_UI:-1}" \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -v "$DATA/cache/main:/isaac-sim/.cache:rw" \
  -v "$DATA/cache/computecache:/isaac-sim/.nv/ComputeCache:rw" \
  -v "$DATA/cache/kit:/isaac-sim/kit/cache:rw" \
  -v "$DATA/logs:/isaac-sim/.nvidia-omniverse/logs:rw" \
  -v "$DATA/config:/isaac-sim/.nvidia-omniverse/config:rw" \
  -v "$DATA/data:/isaac-sim/.local/share/ov/data:rw" \
  -v "$DATA/pkg:/isaac-sim/.local/share/ov/pkg:rw" \
  -v "$CITYLAB:/citylab:ro" \
  --entrypoint bash \
  "$IMAGE" \
  -lc "./isaac-sim.streaming.sh --no-ros-env \
    --/isaac/startup/create_new_stage=0 \
    --/app/window/hideUi=1 \
    --/exts/omni.kit.livestream.app/primaryStream/publicIp=${HOST_IP} \
    --/exts/omni.kit.livestream.app/primaryStream/signalPort=${SIGNAL_PORT} \
    --/exts/omni.kit.livestream.app/primaryStream/streamPort=${STREAM_PORT} \
    --/exts/omni.kit.livestream.app/primaryStream/allowDynamicResize=false \
    --/exts/omni.kit.livestream.app/primaryStream/targetFps=60 \
    --/app/window/width=1920 \
    --/app/window/height=1080 \
    --/persistent/app/window/width=1920 \
    --/persistent/app/window/height=1080 \
    --/app/window/dpiScaleOverride=1.0 \
    --/app/window/scaleToMonitor=0 \
    --/app/renderer/resolution/width=1920 \
    --/app/renderer/resolution/height=1080 \
    --/rtx/post/dlss/enabled=true \
    --/rtx/post/dlss/execMode=2 \
    --/rtx/post/aa/op=3 \
    --/app/runLoops/main/rateLimitFrequency=60 \
    --/app/runLoops/present/rateLimitFrequency=60 \
    --/app/runLoops/rendering_0/rateLimitFrequency=60 \
    --/rtx/ecoMode/enabled=0 \
    --enable omni.kit.environment.core \
    --ext-folder /citylab/exts \
    --enable citylab.traffic \
    /citylab/assets/stage/city_lab.usda"

echo "[citylab-isaac6] started — wait ~60–90s then Open stream from UI or Chrome → http://127.0.0.1:8210"
echo "[citylab-isaac6] logs: docker logs -f $NAME"
