#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  build-packages.sh  —  Build all packages
#
#  Usage:
#    ./build-packages.sh              Build all packages
#    ./build-packages.sh --clean      Clean dist/ before building
#    ./build-packages.sh --only X     Build only package X (shared|marp-engine|ludos-sync|ludos-sync-menubar)
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHARED_DIR="$SCRIPT_DIR/packages/shared"
MARP_DIR="$SCRIPT_DIR/packages/marp-engine"
SYNC_DIR="$SCRIPT_DIR/packages/ludos-sync"
MENUBAR_DIR="$SCRIPT_DIR/packages/ludos-sync-menubar"

CLEAN=false
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)   CLEAN=true; shift ;;
    --only)    ONLY="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^#  //'
      exit 0 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

should_build() {
  [[ -z "$ONLY" || "$ONLY" == "$1" ]]
}

# ── Clean if requested ───────────────────────────────────────────
if $CLEAN; then
  if should_build "shared"; then
    echo "Cleaning shared dist..."
    rm -rf "$SHARED_DIR/dist"
  fi
  if should_build "ludos-sync"; then
    echo "Cleaning ludos-sync dist..."
    rm -rf "$SYNC_DIR/dist"
  fi
fi

# ── Build @ludos/shared ──────────────────────────────────────────
if should_build "shared"; then
  echo "Building @ludos/shared..."
  cd "$SHARED_DIR"
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run build
  echo "  @ludos/shared built."
fi

# ── Build marp-engine (install dependencies) ─────────────────────
if should_build "marp-engine"; then
  echo "Building marp-engine..."
  cd "$MARP_DIR/engine"
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  echo "  marp-engine built."
fi

# ── Build ludos-sync ─────────────────────────────────────────────
if should_build "ludos-sync"; then
  echo "Building ludos-sync..."
  cd "$SYNC_DIR"
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run build
  echo "  ludos-sync built."
fi

# ── Build ludos-sync-menubar (install Python deps) ────────────────
if should_build "ludos-sync-menubar"; then
  echo "Building ludos-sync-menubar..."
  cd "$MENUBAR_DIR"
  pip install -r requirements.txt 2>/dev/null || pip3 install -r requirements.txt
  echo "  ludos-sync-menubar built."
fi

echo ""
echo "Build complete."
