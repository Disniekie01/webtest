#!/usr/bin/env bash
# Launch Isaac Sim Full editor on the City Lab USD (for manual railing edits).
set -euo pipefail
export DISPLAY="${DISPLAY:-:1}"
export GDK_BACKEND=x11
export QT_QPA_PLATFORM=xcb
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CITY="${1:-$ROOT/assets/city/city_generator_large.usdc}"
LOG=/tmp/isaac-editor-citylab.log
: > "$LOG"
cd /home/disniekie/isaacsim
echo "Opening Isaac editor on: $CITY" | tee -a "$LOG"
echo "DISPLAY=$DISPLAY" | tee -a "$LOG"
exec ./isaac-sim.sh --no-ros-env --/isaac/startup/create_new_stage=0 "$CITY"
