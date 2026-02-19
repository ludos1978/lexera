#!/usr/bin/env bash
set -euo pipefail

# Build shared package first (temporalParser etc.)
(cd packages/shared && npm run build)

npm run package
vsce package
