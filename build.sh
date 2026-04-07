#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Build active shared/tooling packages first.
"$SCRIPT_DIR/build-packages.sh"

echo "Building lexera-web-clipper..."
(cd "$SCRIPT_DIR/lexera-web-clipper" && npm run build)

echo ""
echo "Build complete."
