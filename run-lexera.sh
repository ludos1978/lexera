#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  run-kanban.sh  —  Kill existing instances, then start fresh
#
#  Usage:
#    ./run-kanban.sh          Restart backend + kanban
#    ./run-kanban.sh --kill   Just kill running instances
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/packages/lexera-backend"
KANBAN_DIR="$SCRIPT_DIR/packages/lexera-kanban"

# ── Kill existing instances ──────────────────────────────────────
echo "Killing existing instances..."
pkill -f "target/debug/lexera-kanban" 2>/dev/null && echo "  Killed lexera-kanban" || true
pkill -f "target/debug/lexera-backend" 2>/dev/null && echo "  Killed lexera-backend" || true
pkill -f "cargo-tauri.*lexera-kanban" 2>/dev/null || true
pkill -f "cargo-tauri.*lexera-backend" 2>/dev/null || true
sleep 1

if [[ "${1:-}" == "--kill" ]]; then
  echo "Done."
  exit 0
fi

# ── Cleanup on exit ─────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Shutting down..."
  pkill -f "target/debug/lexera-kanban" 2>/dev/null || true
  pkill -f "target/debug/lexera-backend" 2>/dev/null || true
  pkill -f "cargo-tauri.*lexera-kanban" 2>/dev/null || true
  pkill -f "cargo-tauri.*lexera-backend" 2>/dev/null || true
  pkill -f "cargo.*lexera-backend" 2>/dev/null || true
  pkill -f "cargo.*lexera-kanban" 2>/dev/null || true
  # Kill our direct children
  jobs -p | xargs kill 2>/dev/null || true
  wait 2>/dev/null
  echo "Done."
}
trap cleanup INT TERM
trap 'cleanup; exit' EXIT

# ── Start backend ────────────────────────────────────────────────
echo "Starting lexera-backend..."
(cd "$BACKEND_DIR" && exec cargo tauri dev) 2>&1 | sed 's/^/[backend] /' &

# ── Wait for backend to compile and start ────────────────────────
echo "Waiting for backend..."
sleep 5

# ── Start kanban ─────────────────────────────────────────────────
echo "Starting lexera-kanban..."
(cd "$KANBAN_DIR" && exec cargo tauri dev) 2>&1 | sed 's/^/[kanban]  /' &

echo ""
echo "Both services running. Press Ctrl+C to stop."
echo ""

# ── Wait for either to exit ──────────────────────────────────────
wait
