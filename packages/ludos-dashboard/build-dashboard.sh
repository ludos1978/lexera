#!/usr/bin/env bash
# Build the Ludos Dashboard Tauri app and install it.
#
# Prerequisites: run setup-tauri.sh once to install Rust + Tauri CLI.
#
# Steps:
#   1. Build the ludos-sync server (TypeScript → dist/)
#   2. Build the Tauri app (Rust + frontend)
#   3. Stop running instance, install to builds/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SYNC_DIR="$PROJECT_ROOT/packages/ludos-sync"
DASHBOARD_DIR="$SCRIPT_DIR"
BUILDS_DIR="$PROJECT_ROOT/builds"
APP_NAME="Ludos Dashboard"

echo "==> Building $APP_NAME"
echo "    Project root: $PROJECT_ROOT"
echo ""

# ── 0. Check Tauri CLI ─────────────────────────────────────────
if ! cargo tauri --version &>/dev/null; then
    echo "ERROR: Tauri CLI not found. Run setup-tauri.sh first."
    exit 1
fi
echo "    Tauri CLI: $(cargo tauri --version)"
echo ""

# ── 1. Build ludos-sync server ─────────────────────────────────
echo "==> Building ludos-sync server (TypeScript)…"
(cd "$SYNC_DIR" && npm run build)
echo ""

# ── 2. Build Tauri app ─────────────────────────────────────────
echo "==> Building Tauri app…"
(cd "$DASHBOARD_DIR" && cargo tauri build 2>&1)
echo ""

# ── 3. Install to builds/ ─────────────────────────────────────
BINARY="$DASHBOARD_DIR/src-tauri/target/release/ludos-dashboard"
# On macOS, cargo tauri build produces a .app bundle
APP_BUNDLE="$DASHBOARD_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"

if [[ -d "$APP_BUNDLE" ]]; then
    echo "==> Installing .app bundle to $BUILDS_DIR/"
    mkdir -p "$BUILDS_DIR"

    # Stop running instance
    if pgrep -f "ludos-dashboard" >/dev/null 2>&1; then
        echo "    Stopping running instance…"
        pkill -f "ludos-dashboard" || true
        sleep 1
    fi

    rm -rf "$BUILDS_DIR/$APP_NAME.app"
    cp -R "$APP_BUNDLE" "$BUILDS_DIR/$APP_NAME.app"

    echo ""
    echo "==> Done! Launch with:"
    echo "    open \"$BUILDS_DIR/$APP_NAME.app\""
elif [[ -f "$BINARY" ]]; then
    echo "==> Installing binary to $BUILDS_DIR/"
    mkdir -p "$BUILDS_DIR"

    if pgrep -f "ludos-dashboard" >/dev/null 2>&1; then
        echo "    Stopping running instance…"
        pkill -f "ludos-dashboard" || true
        sleep 1
    fi

    cp -f "$BINARY" "$BUILDS_DIR/ludos-dashboard"

    echo ""
    echo "==> Done! Launch with:"
    echo "    \"$BUILDS_DIR/ludos-dashboard\""
else
    echo "ERROR: Build produced neither .app bundle nor binary"
    exit 1
fi
