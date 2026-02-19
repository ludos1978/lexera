#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Build all packages (shared, marp-engine, ludos-sync)
"$SCRIPT_DIR/build-packages.sh"

npm run package
vsce package
