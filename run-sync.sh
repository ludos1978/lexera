#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  run-sync.sh  —  Run the ludos-sync server (builds if needed)
#
#  Usage:
#    ./run-sync.sh                     Start in foreground
#    ./run-sync.sh --background        Start as background daemon
#    ./run-sync.sh --status            Check if running
#    ./run-sync.sh --stop              Stop running server
#    ./run-sync.sh --config <path>     Custom config file
#    ./run-sync.sh --port <number>     Override port
#    ./run-sync.sh --verbose           Enable verbose logging
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC_DIR="$SCRIPT_DIR/packages/ludos-sync"

ACTION=""
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stop)
      ACTION="stop"; shift ;;
    -h|--help)
      sed -n '2,13p' "$0" | sed 's/^#  //'
      exit 0 ;;
    *)
      PASSTHROUGH_ARGS+=("$1"); shift ;;
  esac
done

# ── Stop action ──────────────────────────────────────────────────
if [[ "$ACTION" == "stop" ]]; then
  PIDS=$(pgrep -f "node.*ludos-sync.*cli" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "Stopping ludos-sync PID(s): $PIDS"
    kill $PIDS 2>/dev/null || true
  else
    echo "No ludos-sync process found."
  fi
  exit 0
fi

# ── Build if needed ──────────────────────────────────────────────
if [ ! -f "$SYNC_DIR/dist/cli.js" ]; then
  echo "ludos-sync not built yet, building..."
  "$SCRIPT_DIR/build-packages.sh" --only shared
  "$SCRIPT_DIR/build-packages.sh" --only ludos-sync
fi

# ── Delegate to platform start script ────────────────────────────
case "$(uname)" in
  Darwin)
    exec "$SYNC_DIR/scripts/start-macos.sh" "${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}"
    ;;
  Linux)
    exec "$SYNC_DIR/scripts/start-linux.sh" "${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}"
    ;;
  *)
    echo "Unsupported platform: $(uname)"
    echo "Run manually: node $SYNC_DIR/dist/cli.js start"
    exit 1
    ;;
esac
