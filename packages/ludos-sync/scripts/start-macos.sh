#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  ludos-sync  —  macOS startup script
#
#  Usage:
#    ./start-macos.sh                     Start in foreground
#    ./start-macos.sh --background        Start as background daemon
#    ./start-macos.sh --install           Register as Login Item (launchd)
#    ./start-macos.sh --uninstall         Remove Login Item
#    ./start-macos.sh --status            Check if running
#    ./start-macos.sh --config <path>     Custom config file
#    ./start-macos.sh --port <number>     Override port
#    ./start-macos.sh --verbose           Enable verbose logging
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$PACKAGE_DIR/dist/cli.js"
PLIST_LABEL="com.ludos.sync"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
LOG_FILE="$HOME/.ludos-sync.log"
ERR_LOG="$HOME/.ludos-sync.err.log"

CONFIG_PATH=""
PORT_ARG=""
VERBOSE_ARG=""
ACTION="foreground"

# ── Parse arguments ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --background) ACTION="background"; shift ;;
    --install)    ACTION="install";    shift ;;
    --uninstall)  ACTION="uninstall";  shift ;;
    --status)     ACTION="status";     shift ;;
    --config)     CONFIG_PATH="$2";    shift 2 ;;
    --port)       PORT_ARG="--port $2"; shift 2 ;;
    --verbose|-v) VERBOSE_ARG="--verbose"; shift ;;
    -h|--help)
      sed -n '2,13p' "$0" | sed 's/^#  //'
      exit 0 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Locate Node.js ──────────────────────────────────────────────
find_node() {
  if command -v node &>/dev/null; then
    command -v node
  elif [ -f "$HOME/.nvm/current/bin/node" ]; then
    echo "$HOME/.nvm/current/bin/node"
  elif [ -f "/usr/local/bin/node" ]; then
    echo "/usr/local/bin/node"
  elif [ -f "/opt/homebrew/bin/node" ]; then
    echo "/opt/homebrew/bin/node"
  else
    echo ""
  fi
}

NODE_BIN="$(find_node)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: Node.js not found."
  echo "Install it with:  brew install node"
  echo "             or:  https://nodejs.org/"
  exit 1
fi

echo "Using Node.js: $NODE_BIN ($(\"$NODE_BIN\" --version))"

# ── Build if needed ─────────────────────────────────────────────
if [ ! -f "$CLI" ]; then
  echo "Building ludos-sync..."
  cd "$PACKAGE_DIR"
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run build
  echo "Build complete."
fi

# ── Resolve config path ─────────────────────────────────────────
if [ -z "$CONFIG_PATH" ]; then
  CONFIG_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/ludos-sync/sync.json"
fi
CONFIG_ARG="--config $CONFIG_PATH"

# ── Actions ─────────────────────────────────────────────────────

case "$ACTION" in

  foreground)
    echo "Starting ludos-sync in foreground..."
    echo "Press Ctrl+C to stop."
    echo ""
    exec "$NODE_BIN" "$CLI" start $CONFIG_ARG $PORT_ARG $VERBOSE_ARG
    ;;

  background)
    echo "Starting ludos-sync in background..."
    nohup "$NODE_BIN" "$CLI" start $CONFIG_ARG $PORT_ARG $VERBOSE_ARG \
      >> "$LOG_FILE" 2>> "$ERR_LOG" &
    BG_PID=$!
    echo "PID: $BG_PID"
    echo "Log: $LOG_FILE"
    echo "Errors: $ERR_LOG"
    echo ""
    sleep 2
    if kill -0 "$BG_PID" 2>/dev/null; then
      echo "Server is running."
    else
      echo "ERROR: Server failed to start. Check $ERR_LOG"
      exit 1
    fi
    ;;

  install)
    echo "Installing ludos-sync as macOS Login Item (launchd)..."

    mkdir -p "$(dirname "$PLIST_PATH")"

    cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$CLI</string>
        <string>start</string>
        <string>--config</string>
        <string>$CONFIG_PATH</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$ERR_LOG</string>
</dict>
</plist>
PLIST

    launchctl load "$PLIST_PATH" 2>/dev/null || true
    echo "Installed: $PLIST_PATH"
    echo "Log:       $LOG_FILE"
    echo ""
    echo "ludos-sync will start automatically on login."
    echo "To start now:   launchctl start $PLIST_LABEL"
    echo "To stop:        launchctl stop $PLIST_LABEL"
    echo "To uninstall:   $0 --uninstall"
    ;;

  uninstall)
    if [ -f "$PLIST_PATH" ]; then
      launchctl unload "$PLIST_PATH" 2>/dev/null || true
      rm -f "$PLIST_PATH"
      echo "Uninstalled launchd service."
    else
      echo "No launchd service found at $PLIST_PATH"
    fi
    ;;

  status)
    echo "=== ludos-sync status ==="
    echo ""

    # Check launchd
    if [ -f "$PLIST_PATH" ]; then
      echo "Launchd service: INSTALLED ($PLIST_PATH)"
      if launchctl list "$PLIST_LABEL" &>/dev/null; then
        echo "Launchd state:   LOADED"
      else
        echo "Launchd state:   NOT LOADED"
      fi
    else
      echo "Launchd service: NOT INSTALLED"
    fi
    echo ""

    # Check process
    PIDS=$(pgrep -f "ludos-sync.*cli" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "Running PIDs:    $PIDS"
    else
      echo "Process:         NOT RUNNING"
    fi
    echo ""

    # Probe HTTP status
    "$NODE_BIN" "$CLI" status $CONFIG_ARG 2>/dev/null || true
    ;;

esac
