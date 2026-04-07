#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/src/vendor/excalidraw"
ASSET_SRC="$ROOT_DIR/../node_modules/@excalidraw/excalidraw/dist/excalidraw-assets"

mkdir -p "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR/excalidraw-assets"

cp "$ROOT_DIR/../node_modules/react/umd/react.production.min.js" "$VENDOR_DIR/react.production.min.js"
cp "$ROOT_DIR/../node_modules/react-dom/umd/react-dom.production.min.js" "$VENDOR_DIR/react-dom.production.min.js"
cp "$ROOT_DIR/../node_modules/@excalidraw/excalidraw/dist/excalidraw.production.min.js" "$VENDOR_DIR/excalidraw.production.min.js"
cp -R "$ASSET_SRC/." "$VENDOR_DIR/excalidraw-assets/"
