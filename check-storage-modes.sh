#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")" && pwd)"
cd "$repo_root"

echo "=== lexera-core without CRDT ==="
cargo check -p lexera-core --no-default-features

echo
echo "=== lexera-backend default markdown-only mode ==="
cargo check -p lexera-backend

echo
echo "=== lexera-backend explicit CRDT mode ==="
cargo check -p lexera-backend --features crdt

echo
echo "=== lexera-kanban Tauri shell ==="
cargo check -p lexera-kanban

echo
echo "storage mode checks OK"
