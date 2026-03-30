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
WEB_CLIPPER_DIR="$SCRIPT_DIR/packages/lexera-web-clipper"
TARGET_DIR="$SCRIPT_DIR/packages/target"
PATH_MARKER="$TARGET_DIR/.project-path"
BACKEND_READY_PORTS=(13080 8083 1431 12080 14080 11080 15080)

read_configured_backend_port() {
  node <<'EOF'
const fs = require('fs');
const path = require('path');
const configPath = path.join(process.env.HOME || '', '.config', 'lexera', 'sync.json');
try {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  const port = Number(parsed && parsed.port);
  if (Number.isFinite(port) && port > 0) {
    process.stdout.write(String(port));
  }
} catch (_) {}
EOF
}

wait_for_backend_ready() {
  local configured_port
  local port
  local host
  local ready_url=""
  local attempt
  configured_port="$(read_configured_backend_port || true)"

  for attempt in $(seq 1 60); do
    for port in "${BACKEND_READY_PORTS[@]}"; do
      if [[ -n "$configured_port" && "$port" != "$configured_port" ]]; then
        continue
      fi
      for host in 127.0.0.1 localhost; do
        if curl -sf "http://$host:$port/status" >/dev/null 2>&1 && \
           curl -sf "http://$host:$port/collab/me" >/dev/null 2>&1; then
          ready_url="http://$host:$port"
          echo "$ready_url"
          return 0
        fi
      done
    done

    # If the configured port did not work, fall back to the standard scan.
    if [[ -n "$configured_port" ]]; then
      for port in "${BACKEND_READY_PORTS[@]}"; do
        if [[ "$port" == "$configured_port" ]]; then
          continue
        fi
        for host in 127.0.0.1 localhost; do
          if curl -sf "http://$host:$port/status" >/dev/null 2>&1 && \
             curl -sf "http://$host:$port/collab/me" >/dev/null 2>&1; then
            ready_url="http://$host:$port"
            echo "$ready_url"
            return 0
          fi
        done
      done
    fi

    sleep 1
  done

  return 1
}

# ── Clean stale build cache if project folder was renamed ────────
if [[ -d "$TARGET_DIR" ]]; then
  if [[ -f "$PATH_MARKER" ]]; then
    CACHED_PATH="$(cat "$PATH_MARKER")"
    if [[ "$CACHED_PATH" != "$SCRIPT_DIR" ]]; then
      echo "Project path changed ($CACHED_PATH -> $SCRIPT_DIR), cleaning build cache..."
      (cd "$SCRIPT_DIR/packages" && cargo clean)
    fi
  else
    # No marker exists but target dir does — could be stale from before
    # the marker was introduced. Write the marker now; if paths are wrong
    # cargo will error and the user can re-run after a manual cargo clean.
    echo "$SCRIPT_DIR" > "$PATH_MARKER"
  fi
fi
mkdir -p "$TARGET_DIR"
echo "$SCRIPT_DIR" > "$PATH_MARKER"

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

# ── Build browser clipper assets ────────────────────────────────
if [[ -d "$WEB_CLIPPER_DIR" ]]; then
  echo "Building lexera-web-clipper..."
  (cd "$WEB_CLIPPER_DIR" && npm run build) 2>&1 | sed 's/^/[clipper] /'
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
BACKEND_READY_URL="$(wait_for_backend_ready || true)"
if [[ -z "$BACKEND_READY_URL" ]]; then
  echo "Backend did not become ready within 60 seconds."
  exit 1
fi
echo "Backend ready at $BACKEND_READY_URL"

# ── Start kanban ─────────────────────────────────────────────────
echo "Starting lexera-kanban..."
(cd "$KANBAN_DIR" && exec cargo tauri dev) 2>&1 | sed 's/^/[kanban]  /' &

echo ""
echo "Both services running. Press Ctrl+C to stop."
echo ""

# ── Wait for either to exit ──────────────────────────────────────
wait
