#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  build-marp-engine.sh  —  Set up the Marp presentation engine
#
#  Usage:
#    ./build-marp-engine.sh              Install Node + Python deps
#    ./build-marp-engine.sh --clean      Remove node_modules and venv
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE_DIR="$SCRIPT_DIR/packages/marp-engine/engine"
BIN_DIR="$SCRIPT_DIR/packages/marp-engine/bin"

CLEAN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)  CLEAN=true; shift ;;
    -h|--help)
      sed -n '2,7p' "$0" | sed 's/^#  //'
      exit 0 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Clean mode ───────────────────────────────────────────────────
if $CLEAN; then
  echo "Cleaning marp-engine…"
  rm -rf "$ENGINE_DIR/node_modules"
  echo "Done."
  exit 0
fi

# ── 1. Install Node.js engine deps ──────────────────────────────
echo "Installing marp-engine Node.js dependencies…"
cd "$ENGINE_DIR"
npm install
echo "  Node.js deps installed."

# ── 2. Install Python deps for bin/ scripts ──────────────────────
echo "Installing marp-engine Python dependencies…"
pip3 install --quiet watchdog 2>/dev/null || pip install --quiet watchdog
echo "  Python deps installed."

# ── 3. Make bin scripts executable ───────────────────────────────
chmod +x "$BIN_DIR"/*.py
echo "  bin/ scripts marked executable."

echo ""
echo "marp-engine ready."
echo "  Engine:  $ENGINE_DIR/engine.js"
echo "  Themes:  $ENGINE_DIR/themes/"
echo "  Scripts: $BIN_DIR/"
