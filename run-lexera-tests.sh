#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  run-lexera-tests.sh  —  Automated frontend-test runner
#
#  Starts backend + lexera-kanban + lexera-capture-ios (desktop),
#  auto-runs the frontend test suite after a short boot delay, and
#  writes the formatted results to `logs/frontend-tests.log`.
#  When the suite finishes, the kanban app quits itself so the
#  script can exit cleanly — allowing a parent process (or human)
#  to tail the log file for results without manual interaction.
#
#  Usage:
#    ./run-lexera-tests.sh                 Default: 10s boot delay,
#                                          writes to logs/frontend-tests.log
#    ./run-lexera-tests.sh --delay=5000    Override boot delay (ms)
#    ./run-lexera-tests.sh --output=path   Override log path
#    ./run-lexera-tests.sh --board=<id>    Pin a specific board for tests
#    ./run-lexera-tests.sh --filter=text   Run tests whose names contain text
#    ./run-lexera-tests.sh --no-capture    Skip starting capture app
#    ./run-lexera-tests.sh --kill          Just kill running instances
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/lexera-backend"
KANBAN_DIR="$SCRIPT_DIR/lexera-kanban"
CAPTURE_DIR="$SCRIPT_DIR/lexera-capture-ios"
WEB_CLIPPER_DIR="$SCRIPT_DIR/lexera-web-clipper"
TARGET_DIR="$SCRIPT_DIR/target"
PATH_MARKER="$TARGET_DIR/.project-path"
BACKEND_READY_PORTS=(13080 8083 1431 12080 14080 11080 15080)

# ── Defaults (overridable via flags below) ──────────────────────
DELAY_MS=10000
OUTPUT_PATH="$SCRIPT_DIR/logs/frontend-tests.log"
BOARD_ID=""
TEST_FILTER=""
START_CAPTURE=1
KILL_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --kill) KILL_ONLY=1 ;;
    --no-capture) START_CAPTURE=0 ;;
    --delay=*) DELAY_MS="${arg#--delay=}" ;;
    --output=*) OUTPUT_PATH="${arg#--output=}" ;;
    --board=*) BOARD_ID="${arg#--board=}" ;;
    --filter=*) TEST_FILTER="${arg#--filter=}" ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 1
      ;;
  esac
done

# Ensure parent dir for the log file exists.
mkdir -p "$(dirname "$OUTPUT_PATH")"
# Truncate any prior results so `cat $OUTPUT_PATH` at the end shows
# ONLY the current run.
: > "$OUTPUT_PATH"

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
  local configured_port port host ready_url="" attempt
  configured_port="$(read_configured_backend_port || true)"
  for attempt in $(seq 1 60); do
    for port in "${BACKEND_READY_PORTS[@]}"; do
      if [[ -n "$configured_port" && "$port" != "$configured_port" ]]; then continue; fi
      for host in 127.0.0.1 localhost; do
        if curl -sf "http://$host:$port/status" >/dev/null 2>&1 && \
           curl -sf "http://$host:$port/collab/me" >/dev/null 2>&1; then
          ready_url="http://$host:$port"
          echo "$ready_url"
          return 0
        fi
      done
    done
    if [[ -n "$configured_port" ]]; then
      for port in "${BACKEND_READY_PORTS[@]}"; do
        if [[ "$port" == "$configured_port" ]]; then continue; fi
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

bring_kanban_front() {
  # WKWebView can throttle timers aggressively while the Tauri window is
  # backgrounded. Full frontend test runs need the window frontmost long
  # enough for the auto-run readiness poll and progress timers to advance.
  if ! command -v osascript >/dev/null 2>&1; then return 0; fi
  local attempt
  for attempt in $(seq 1 20); do
    if osascript -e 'tell application "System Events" to set frontmost of first process whose name is "lexera-kanban" to true' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 0
}

# ── Clean stale build cache if project folder was renamed ────────
if [[ -d "$TARGET_DIR" ]]; then
  if [[ -f "$PATH_MARKER" ]]; then
    CACHED_PATH="$(cat "$PATH_MARKER")"
    if [[ "$CACHED_PATH" != "$SCRIPT_DIR" ]]; then
      echo "Project path changed ($CACHED_PATH -> $SCRIPT_DIR), cleaning build cache..."
      (cd "$SCRIPT_DIR" && cargo clean)
    fi
  else
    echo "$SCRIPT_DIR" > "$PATH_MARKER"
  fi
fi
mkdir -p "$TARGET_DIR"
echo "$SCRIPT_DIR" > "$PATH_MARKER"

# ── Kill existing instances ──────────────────────────────────────
echo "Killing existing instances..."
pkill -f "target/debug/lexera-kanban" 2>/dev/null && echo "  Killed lexera-kanban" || true
pkill -f "target/debug/lexera-backend" 2>/dev/null && echo "  Killed lexera-backend" || true
pkill -f "target/debug/lexera-capture" 2>/dev/null && echo "  Killed lexera-capture" || true
pkill -f "cargo-tauri.*lexera-kanban" 2>/dev/null || true
pkill -f "cargo-tauri.*lexera-backend" 2>/dev/null || true
pkill -f "cargo-tauri.*lexera-capture" 2>/dev/null || true
sleep 1

if [[ "$KILL_ONLY" == "1" ]]; then
  echo "Done."
  exit 0
fi

# ── Purge WKWebView resource cache so frontend test edits are picked up ──
# Keep this in sync with run-lexera.sh. Tauri's custom asset protocol can let
# WKWebView reuse stale JS/CSS across runs; stale test/bootstrap JS makes this
# wrapper hang even when the normal app launcher works.
for app in lexera-kanban lexera-backend; do
  cache_root="$HOME/Library/Caches/$app/WebKit"
  if [[ -d "$cache_root" ]]; then
    rm -rf "$cache_root/NetworkCache" "$cache_root/CacheStorage" 2>/dev/null || true
    echo "  Cleared WKWebView cache for $app"
  fi
done

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
  pkill -f "target/debug/lexera-capture" 2>/dev/null || true
  pkill -f "cargo-tauri.*lexera-kanban" 2>/dev/null || true
  pkill -f "cargo-tauri.*lexera-backend" 2>/dev/null || true
  pkill -f "cargo-tauri.*lexera-capture" 2>/dev/null || true
  pkill -f "cargo.*lexera-backend" 2>/dev/null || true
  pkill -f "cargo.*lexera-kanban" 2>/dev/null || true
  pkill -f "cargo.*lexera-capture" 2>/dev/null || true
  jobs -p | xargs kill 2>/dev/null || true
  wait 2>/dev/null
  echo "Done."
}
trap cleanup INT TERM

# ── Start backend ────────────────────────────────────────────────
echo "Starting lexera-backend..."
(cd "$BACKEND_DIR" && exec cargo tauri dev) 2>&1 | sed 's/^/[backend] /' &
BACKEND_PID=$!

echo "Waiting for backend..."
BACKEND_READY_URL="$(wait_for_backend_ready || true)"
if [[ -z "$BACKEND_READY_URL" ]]; then
  echo "Backend did not become ready within 60 seconds."
  cleanup
  exit 1
fi
echo "Backend ready at $BACKEND_READY_URL"

# ── Start capture (desktop build) ────────────────────────────────
if [[ "$START_CAPTURE" == "1" && -d "$CAPTURE_DIR" ]]; then
  echo "Starting lexera-capture..."
  (cd "$CAPTURE_DIR" && exec cargo tauri dev) 2>&1 | sed 's/^/[capture] /' &
else
  echo "Skipping capture (--no-capture or dir missing)."
fi

# ── Start kanban via cargo tauri dev with --run-tests ────────────
# Using `cargo tauri dev` instead of a direct binary because the
# embedded binary's WKWebView stalls JS when the window is in the
# background (0% CPU, tests hang). `cargo tauri dev` serves files
# via a dev server, keeping the event loop active.
KANBAN_CLI_ARGS=(
  --run-tests
  "--run-tests-delay=$DELAY_MS"
  "--run-tests-output=$OUTPUT_PATH"
  --quit-after-tests
)
if [[ -n "$BOARD_ID" ]]; then
  KANBAN_CLI_ARGS+=("--run-tests-board=$BOARD_ID")
fi
if [[ -n "$TEST_FILTER" ]]; then
  KANBAN_CLI_ARGS+=("--run-tests-filter=$TEST_FILTER")
fi
if [[ -n "$BOARD_ID" || -n "$TEST_FILTER" ]]; then
  echo "Starting lexera-kanban with --run-tests (board=${BOARD_ID:-auto}, filter=${TEST_FILTER:-none}, delay=${DELAY_MS}ms, output=$OUTPUT_PATH)..."
else
  echo "Starting lexera-kanban with --run-tests (delay=${DELAY_MS}ms, output=$OUTPUT_PATH)..."
fi
(cd "$KANBAN_DIR" && exec cargo tauri dev -- -- "${KANBAN_CLI_ARGS[@]}") 2>&1 | sed 's/^/[kanban]  /' &
KANBAN_CARGO_PID=$!
bring_kanban_front &

echo ""
echo "Services running. Waiting for frontend tests to finish..."
echo "Log file: $OUTPUT_PATH"
echo ""

# ── Wait for the kanban process to exit (tests finished + quit) ──
# `wait $KANBAN_CARGO_PID` blocks on the cargo-tauri wrapper that
# runs our kanban binary. The frontend calls quit_app after writing
# the log, which terminates the binary, which bubbles up to cargo.
wait "$KANBAN_CARGO_PID" 2>/dev/null || true

# Give the OS a beat to finish flushing the file.
# The autoRunBootstrap writes results via POST /test-results, then
# waits 2s before calling quit_app. The kanban process exits, cargo
# tauri dev detects the exit, and wait returns. But the backend may
# still be processing the last POST. Give it time.
sleep 3

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Frontend test results  ($OUTPUT_PATH)"
echo "─────────────────────────────────────────────────────────────"
if [[ -s "$OUTPUT_PATH" ]]; then
  cat "$OUTPUT_PATH"
else
  echo "(no results — log file is empty; check [kanban] output above)"
fi
echo "─────────────────────────────────────────────────────────────"

# Shut down everything else (backend, capture) before exiting.
cleanup
exit 0
