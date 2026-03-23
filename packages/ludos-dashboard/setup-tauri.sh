#!/usr/bin/env bash
# One-time setup: install Rust toolchain and Tauri CLI.
#
# Run this once before build-dashboard.sh.
# Safe to re-run — skips what's already installed.

set -euo pipefail

echo "==> Tauri toolchain setup"
echo ""

# ── 1. Rust / Cargo ────────────────────────────────────────────
if command -v cargo &>/dev/null; then
    echo "    Cargo found: $(cargo --version)"
else
    echo "    Installing Rust via rustup…"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo "    Installed: $(cargo --version)"
fi
echo ""

# ── 2. Tauri CLI ───────────────────────────────────────────────
if cargo tauri --version &>/dev/null; then
    echo "    Tauri CLI found: $(cargo tauri --version)"
else
    echo "    Installing tauri-cli v2 (this takes a few minutes)…"
    cargo install tauri-cli --version "^2"
    echo "    Installed: $(cargo tauri --version)"
fi
echo ""

echo "==> Done. You can now run build-dashboard.sh"
