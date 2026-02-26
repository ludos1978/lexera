#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  lexera-build-win.sh  —  Cross-compile Lexera packages for Windows
#
#  Builds Windows (x86_64) executables for:
#    - lexera-backend   (headless Tauri + Axum backend)
#    - lexera-kanban    (Tauri GUI frontend)
#
#  Prerequisites (macOS → Windows cross-compile):
#    1. Rust Windows target:
#         rustup target add x86_64-pc-windows-msvc
#    2. cargo-xwin (uses Microsoft CRT headers/libs without needing MSVC):
#         cargo install cargo-xwin
#    3. Tauri CLI v2:
#         cargo install tauri-cli
#
#  For native builds ON Windows, only the Rust toolchain + Tauri CLI
#  are needed (no cargo-xwin required).
#
#  Usage:
#    ./lexera-build-win.sh                Build both packages
#    ./lexera-build-win.sh --only backend Build only lexera-backend
#    ./lexera-build-win.sh --only kanban  Build only lexera-kanban
#    ./lexera-build-win.sh --release      Build in release mode (default)
#    ./lexera-build-win.sh --debug        Build in debug mode
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/packages/lexera-backend"
KANBAN_DIR="$SCRIPT_DIR/packages/lexera-kanban"
BUILDS_DIR="$SCRIPT_DIR/builds"
TARGET="x86_64-pc-windows-msvc"

ONLY=""
BUILD_MODE=""
MODE_LABEL="release"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only)    ONLY="$2"; shift 2 ;;
    --release) BUILD_MODE=""; MODE_LABEL="release"; shift ;;
    --debug)   BUILD_MODE="--debug"; MODE_LABEL="debug"; shift ;;
    -h|--help)
      sed -n '2,26p' "$0" | sed 's/^#  \?//'
      exit 0 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

should_build() {
  [[ -z "$ONLY" || "$ONLY" == "$1" ]]
}

# ── Detect environment ──────────────────────────────────────────
IS_WINDOWS=false
CARGO_CMD="cargo"

if [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == CYGWIN* ]] || [[ -n "${OS:-}" && "${OS}" == "Windows_NT" ]]; then
  IS_WINDOWS=true
fi

if ! $IS_WINDOWS; then
  # Cross-compiling from macOS/Linux — need cargo-xwin
  if ! command -v cargo-xwin &>/dev/null; then
    echo "ERROR: cargo-xwin is required for cross-compiling to Windows."
    echo "  Install with: cargo install cargo-xwin"
    exit 1
  fi
  CARGO_CMD="cargo xwin"
fi

# ── Check Rust target is installed ──────────────────────────────
if ! $IS_WINDOWS; then
  if ! rustup target list --installed | grep -q "$TARGET"; then
    echo "ERROR: Rust target '$TARGET' is not installed."
    echo "  Install with: rustup target add $TARGET"
    exit 1
  fi
fi

# ── Check Tauri CLI ─────────────────────────────────────────────
if ! cargo tauri --version &>/dev/null; then
  echo "ERROR: Tauri CLI not found."
  echo "  Install with: cargo install tauri-cli"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "  Lexera Windows Build"
echo "  Target:  $TARGET"
echo "  Mode:    $MODE_LABEL"
if $IS_WINDOWS; then
  echo "  Host:    Windows (native build)"
else
  echo "  Host:    $(uname -s) (cross-compile via cargo-xwin)"
fi
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Build lexera-backend ────────────────────────────────────────
if should_build "backend"; then
  echo "── Building lexera-backend for Windows ──"
  cd "$BACKEND_DIR"

  if $IS_WINDOWS; then
    cargo tauri build ${BUILD_MODE:+"$BUILD_MODE"}
  else
    cargo tauri build ${BUILD_MODE:+"$BUILD_MODE"} --target "$TARGET" \
      --runner "cargo-xwin"
  fi

  echo ""
  echo "  lexera-backend built successfully."
  echo ""
fi

# ── Build lexera-kanban ─────────────────────────────────────────
if should_build "kanban"; then
  echo "── Building lexera-kanban for Windows ──"
  cd "$KANBAN_DIR"

  if $IS_WINDOWS; then
    cargo tauri build ${BUILD_MODE:+"$BUILD_MODE"}
  else
    cargo tauri build ${BUILD_MODE:+"$BUILD_MODE"} --target "$TARGET" \
      --runner "cargo-xwin"
  fi

  echo ""
  echo "  lexera-kanban built successfully."
  echo ""
fi

# ── Collect artifacts into builds/ ───────────────────────────────
WIN_OUT="$BUILDS_DIR/windows"
mkdir -p "$WIN_OUT"

echo "── Collecting build artifacts ──"

# Locate the target directory (shared workspace target)
# Tauri uses the workspace-level target/ when packages share a workspace,
# otherwise it's inside src-tauri/target/
if $IS_WINDOWS; then
  TARGET_SUBDIR="$MODE_LABEL"
else
  TARGET_SUBDIR="$TARGET/$MODE_LABEL"
fi

# Try workspace-level target first, then per-package
for candidate in "$SCRIPT_DIR/packages/target" "$BACKEND_DIR/src-tauri/target" "$KANBAN_DIR/src-tauri/target"; do
  if [[ -d "$candidate/$TARGET_SUBDIR" ]]; then
    TARGET_BASE="$candidate/$TARGET_SUBDIR"
    break
  fi
done

if should_build "backend"; then
  if [[ -f "$TARGET_BASE/lexera-backend.exe" ]]; then
    cp "$TARGET_BASE/lexera-backend.exe" "$WIN_OUT/"
    echo "  Copied lexera-backend.exe"
  fi
  # Copy NSIS installer if it was generated
  for installer in "$TARGET_BASE/bundle/nsis/"*.exe; do
    [[ -f "$installer" ]] && cp "$installer" "$WIN_OUT/" && echo "  Copied $(basename "$installer")"
  done
  for installer in "$TARGET_BASE/bundle/msi/"*.msi; do
    [[ -f "$installer" ]] && cp "$installer" "$WIN_OUT/" && echo "  Copied $(basename "$installer")"
  done
fi

if should_build "kanban"; then
  if [[ -f "$TARGET_BASE/lexera-kanban.exe" ]]; then
    cp "$TARGET_BASE/lexera-kanban.exe" "$WIN_OUT/"
    echo "  Copied lexera-kanban.exe"
  fi
  for installer in "$TARGET_BASE/bundle/nsis/"*.exe; do
    [[ -f "$installer" ]] && cp "$installer" "$WIN_OUT/" && echo "  Copied $(basename "$installer")"
  done
  for installer in "$TARGET_BASE/bundle/msi/"*.msi; do
    [[ -f "$installer" ]] && cp "$installer" "$WIN_OUT/" && echo "  Copied $(basename "$installer")"
  done
fi

# ── Summary ─────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Build complete!"
echo ""
echo "  Output: builds/windows/"
ls -lh "$WIN_OUT/" 2>/dev/null | tail -n +2
echo ""
echo "═══════════════════════════════════════════════════════════"
