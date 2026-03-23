#!/bin/bash
# screenshots.sh — Capture screenshots of the running Lexera Kanban app
#
# Usage:
#   ./scripts/screenshots.sh                    # single screenshot of the main window
#   ./scripts/screenshots.sh --all              # capture all open Lexera windows
#   ./scripts/screenshots.sh --delay 3          # wait 3 seconds before capture
#   ./scripts/screenshots.sh --name "dashboard" # custom filename suffix
#   ./scripts/screenshots.sh --output ~/Desktop # custom output directory
#   ./scripts/screenshots.sh --retina           # capture at retina resolution (default)
#   ./scripts/screenshots.sh --1x               # capture at 1x resolution (72 dpi)
#   ./scripts/screenshots.sh --no-shadow        # omit window shadow
#   ./scripts/screenshots.sh --list             # list all Lexera windows (no capture)
#   ./scripts/screenshots.sh --interactive      # pick window interactively
#
# The app must be running (cargo tauri dev or built .app).
# Screenshots are saved to ../../web/ by default (project root /web/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DEFAULT_OUTPUT="$PROJECT_ROOT/web"

# Defaults
DELAY=0
NAME=""
OUTPUT_DIR="$DEFAULT_OUTPUT"
CAPTURE_ALL=false
NO_SHADOW=true
LIST_ONLY=false
INTERACTIVE=false
DOWNSCALE=false  # retina by default

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)        CAPTURE_ALL=true; shift ;;
    --delay)      DELAY="$2"; shift 2 ;;
    --name)       NAME="$2"; shift 2 ;;
    --output)     OUTPUT_DIR="$2"; shift 2 ;;
    --no-shadow)  NO_SHADOW=true; shift ;;
    --shadow)     NO_SHADOW=false; shift ;;
    --retina)     DOWNSCALE=false; shift ;;
    --1x)         DOWNSCALE=true; shift ;;
    --list)       LIST_ONLY=true; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

# ── Find Lexera Kanban windows via CoreGraphics ────────────────────────────

find_windows() {
  osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var infos = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID);
    var count = ObjC.unwrap(infos).length;
    var results = [];
    for (var i = 0; i < count; i++) {
      var w = ObjC.unwrap(ObjC.unwrap(infos)[i]);
      var owner = ObjC.unwrap(w["kCGWindowOwnerName"] || "");
      var name  = ObjC.unwrap(w["kCGWindowName"]      || "");
      var wid   = ObjC.unwrap(w["kCGWindowNumber"]);
      var layer = ObjC.unwrap(w["kCGWindowLayer"]);
      var bounds = ObjC.unwrap(w["kCGWindowBounds"]);
      if ((owner.indexOf("Lexera") >= 0 || owner.indexOf("lexera") >= 0) && layer === 0) {
        var bw = ObjC.unwrap(bounds["Width"]);
        var bh = ObjC.unwrap(bounds["Height"]);
        results.push(wid + "\t" + bw + "x" + bh + "\t" + name);
      }
    }
    results.join("\n");
  ' 2>/dev/null
}

WINDOWS="$(find_windows)"

if [[ -z "$WINDOWS" ]]; then
  echo "No Lexera Kanban windows found. Is the app running?" >&2
  echo "" >&2
  echo "Start it with:" >&2
  echo "  cd packages/lexera-kanban && cargo tauri dev" >&2
  exit 1
fi

# ── List mode ──────────────────────────────────────────────────────────────

if $LIST_ONLY; then
  echo "Lexera Kanban windows:"
  echo ""
  printf "  %-12s %-12s %s\n" "WINDOW_ID" "SIZE" "TITLE"
  printf "  %-12s %-12s %s\n" "---------" "----" "-----"
  while IFS=$'\t' read -r wid size title; do
    printf "  %-12s %-12s %s\n" "$wid" "$size" "${title:-<untitled>}"
  done <<< "$WINDOWS"
  exit 0
fi

# ── Interactive mode ───────────────────────────────────────────────────────

if $INTERACTIVE; then
  TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  SUFFIX="${NAME:+-$NAME}"
  OUTFILE="$OUTPUT_DIR/screenshot-${TIMESTAMP}${SUFFIX}.png"

  if [[ "$DELAY" -gt 0 ]]; then
    echo "Capturing in $DELAY seconds... click the window you want."
    sleep "$DELAY"
  fi

  EXTRA_FLAGS="-x"
  $NO_SHADOW && EXTRA_FLAGS="$EXTRA_FLAGS -o"

  screencapture -w $EXTRA_FLAGS "$OUTFILE"

  if [[ -f "$OUTFILE" ]]; then
    if $DOWNSCALE; then
      sips --resampleWidth "$(sips -g pixelWidth "$OUTFILE" | awk '/pixelWidth/{printf "%d", $2/2}')" "$OUTFILE" --out "$OUTFILE" >/dev/null 2>&1
    fi
    echo "Saved: $OUTFILE"
  else
    echo "Capture cancelled."
  fi
  exit 0
fi

# ── Capture function ──────────────────────────────────────────────────────

capture_window() {
  local wid="$1"
  local title="$2"
  local index="$3"

  local TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  local SUFFIX=""
  if [[ -n "$NAME" ]]; then
    SUFFIX="-$NAME"
  elif $CAPTURE_ALL; then
    SUFFIX="-$index"
  fi
  local OUTFILE="$OUTPUT_DIR/screenshot-${TIMESTAMP}${SUFFIX}.png"

  local EXTRA_FLAGS="-x"
  $NO_SHADOW && EXTRA_FLAGS="$EXTRA_FLAGS -o"

  if [[ "$DELAY" -gt 0 ]]; then
    echo "Waiting $DELAY seconds before capture..."
    sleep "$DELAY"
  fi

  screencapture -l"$wid" $EXTRA_FLAGS "$OUTFILE"

  if [[ -f "$OUTFILE" ]]; then
    if $DOWNSCALE; then
      local PX_WIDTH
      PX_WIDTH="$(sips -g pixelWidth "$OUTFILE" | awk '/pixelWidth/{printf "%d", $2/2}')"
      if [[ -n "$PX_WIDTH" && "$PX_WIDTH" -gt 0 ]]; then
        sips --resampleWidth "$PX_WIDTH" "$OUTFILE" --out "$OUTFILE" >/dev/null 2>&1
      fi
    fi
    local SIZE
    SIZE="$(du -h "$OUTFILE" | cut -f1 | tr -d ' ')"
    echo "Saved: $OUTFILE ($SIZE)"
  else
    echo "Failed to capture window $wid" >&2
  fi
}

# ── Main capture loop ─────────────────────────────────────────────────────

WINDOW_COUNT=0
while IFS=$'\t' read -r wid size title; do
  WINDOW_COUNT=$((WINDOW_COUNT + 1))
done <<< "$WINDOWS"

echo "Found $WINDOW_COUNT Lexera window(s)"

if $CAPTURE_ALL; then
  INDEX=1
  while IFS=$'\t' read -r wid size title; do
    echo "Capturing window $INDEX/$WINDOW_COUNT ($size): ${title:-<untitled>}"
    capture_window "$wid" "$title" "$INDEX"
    INDEX=$((INDEX + 1))
  done <<< "$WINDOWS"
else
  # Capture just the first (main) window
  IFS=$'\t' read -r wid size title <<< "$(echo "$WINDOWS" | head -1)"
  echo "Capturing main window ($size): ${title:-<untitled>}"
  capture_window "$wid" "$title" "1"
fi

echo "Done."
