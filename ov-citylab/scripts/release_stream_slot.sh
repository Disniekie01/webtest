#!/usr/bin/env bash
# Free Isaac NVST's single WebRTC client slot without a full Kit restart.
set -euo pipefail

SIGNAL_PORT="${ISAACSIM_SIGNAL_PORT:-49100}"
STREAM_PORT="${ISAACSIM_STREAM_PORT:-47998}"
CONTROL_URL="${CITYLAB_STREAM_CONTROL:-http://127.0.0.1:8791/api/release-stream}"
CONTAINER="${CITYLAB_ISAAC_CONTAINER:-citylab-isaac6}"

echo "[release-slot] clients before:"
ss -tnp 2>/dev/null | grep -E ":${SIGNAL_PORT}\b|:${STREAM_PORT}\b|:49102\b" || echo "  (none)"

if curl -fsS -m 3 -X POST "$CONTROL_URL" >/tmp/citylab-release-kit.json 2>/dev/null; then
  echo "[release-slot] kit: $(cat /tmp/citylab-release-kit.json)"
else
  echo "[release-slot] kit control unreachable at $CONTROL_URL (optional)"
fi

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[release-slot] destroying TCP on :${SIGNAL_PORT} / :49102…"
  docker run --rm --privileged --network "container:${CONTAINER}" nicolaka/netshoot \
    bash -lc "ss -K sport = :${SIGNAL_PORT} >/dev/null 2>&1 || true; ss -K dport = :${SIGNAL_PORT} >/dev/null 2>&1 || true; ss -K sport = :49102 >/dev/null 2>&1 || true; ss -K dport = :49102 >/dev/null 2>&1 || true; echo done" \
    || echo "[release-slot] netshoot kill skipped"
else
  echo "[release-slot] container $CONTAINER not running"
fi

sleep 1
left="$(ss -tnp 2>/dev/null | grep -E ":${SIGNAL_PORT}\b|:49102\b" || true)"
echo "[release-slot] clients after:"
if [[ -n "$left" ]]; then
  echo "$left"
  echo "[release-slot] still held — close that browser tab, then Free again"
  exit 1
fi
echo "  (none — slot free)"
echo "[release-slot] OK — open ONLY Chrome → http://127.0.0.1:8210"
exit 0
