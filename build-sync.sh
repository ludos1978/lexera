#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  build-sync.sh  —  Build the ludos-sync server and its dependencies
#
#  Usage:
#    ./build-sync.sh              Build shared + ludos-sync
#    ./build-sync.sh --clean      Clean dist/ before building
#    ./build-sync.sh --restart    Build and restart running server
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHARED_DIR="$SCRIPT_DIR/packages/shared"
SYNC_DIR="$SCRIPT_DIR/packages/ludos-sync"

CLEAN=false
RESTART=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)   CLEAN=true;   shift ;;
    --restart) RESTART=true; shift ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^#  //'
      exit 0 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Clean if requested ───────────────────────────────────────────
if $CLEAN; then
  echo "Cleaning shared dist..."
  rm -rf "$SHARED_DIR/dist"
  echo "Cleaning ludos-sync dist..."
  rm -rf "$SYNC_DIR/dist"
fi

# ── Build @ludos/shared ─────────────────────────────────────────
echo "Building @ludos/shared..."
cd "$SHARED_DIR"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run build
echo "  @ludos/shared built."

# ── Build ludos-sync ─────────────────────────────────────────────
echo "Building ludos-sync..."
cd "$SYNC_DIR"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run build
echo "  ludos-sync built."

echo ""
echo "Build complete."

# ── Restart if requested ─────────────────────────────────────────
if $RESTART; then
  echo ""
  echo "Restarting ludos-sync server..."

  # Kill existing ludos-sync processes
  PIDS=$(pgrep -f "node.*ludos-sync.*cli" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "  Stopping PID(s): $PIDS"
    kill $PIDS 2>/dev/null || true
    sleep 1
  fi

  # Restart via the macOS start script if available
  if [ -f "$SYNC_DIR/scripts/start-macos.sh" ] && [[ "$(uname)" == "Darwin" ]]; then
    "$SYNC_DIR/scripts/start-macos.sh" --background
  elif [ -f "$SYNC_DIR/scripts/start-linux.sh" ] && [[ "$(uname)" == "Linux" ]]; then
    "$SYNC_DIR/scripts/start-linux.sh" --background
  else
    echo "  Start the server manually: cd $SYNC_DIR && npm start"
  fi
fi
