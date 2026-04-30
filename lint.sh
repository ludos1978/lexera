#!/usr/bin/env bash
# Repo-wide lint: JS via eslint (errors only — `--quiet` suppresses 89k+
# style warnings so we surface real invariants), Rust via cargo clippy
# (run-only, baseline warnings remain). Both stages are non-style:
# only structural issues fail the run.
#
# Run order: JS first (fast), then Rust (slow). Stops on the first failing
# stage so the second stage's noise doesn't drown the first one.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")" && pwd)"
cd "$repo_root"

echo "=== eslint (JS, errors only) ==="
npm run --silent lint:js

echo
echo "=== cargo clippy (Rust workspace) ==="
npm run --silent lint:rust

echo
echo "lint OK"
