#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  ludos-sync  —  Linux startup script
#
#  Usage:
#    ./start-linux.sh                     Start in foreground
#    ./start-linux.sh --background        Start as background daemon
#    ./start-linux.sh --install           Register as systemd user service
#    ./start-linux.sh --uninstall         Remove systemd user service
#    ./start-linux.sh --status            Check if running
#    ./start-linux.sh --config <path>     Custom config file
#    ./start-linux.sh --port <number>     Override port
#    ./start-linux.sh --verbose           Enable verbose logging
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$PACKAGE_DIR/dist/cli.js"
SERVICE_NAME="ludos-sync"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"
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
  elif [ -f "/usr/bin/node" ]; then
    echo "/usr/bin/node"
  else
    echo ""
  fi
}

NODE_BIN="$(find_node)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: Node.js not found."
  echo "Install with your package manager:"
  echo "  Ubuntu/Debian:  sudo apt install nodejs npm"
  echo "  Fedora:         sudo dnf install nodejs npm"
  echo "  Arch:           sudo pacman -S nodejs npm"
  echo "  Or:             https://nodejs.org/"
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
    disown "$BG_PID"
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
    echo "Installing ludos-sync as systemd user service..."

    mkdir -p "$SERVICE_DIR"

    cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Ludos Sync WebDAV Server
After=network.target

[Service]
Type=simple
ExecStart=$NODE_BIN $CLI start --config $CONFIG_PATH
Restart=on-failure
RestartSec=5
StandardOutput=append:$LOG_FILE
StandardError=append:$ERR_LOG

[Install]
WantedBy=default.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_NAME"
    systemctl --user start "$SERVICE_NAME"

    echo "Installed: $SERVICE_FILE"
    echo "Log:       $LOG_FILE"
    echo ""
    echo "ludos-sync will start automatically on login."
    echo "Commands:"
    echo "  systemctl --user status $SERVICE_NAME"
    echo "  systemctl --user stop $SERVICE_NAME"
    echo "  systemctl --user restart $SERVICE_NAME"
    echo "  journalctl --user -u $SERVICE_NAME -f"
    echo "  $0 --uninstall"
    ;;

  uninstall)
    if [ -f "$SERVICE_FILE" ]; then
      systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
      systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
      rm -f "$SERVICE_FILE"
      systemctl --user daemon-reload
      echo "Uninstalled systemd service."
    else
      echo "No systemd service found at $SERVICE_FILE"
    fi
    ;;

  status)
    echo "=== ludos-sync status ==="
    echo ""

    # Check systemd
    if [ -f "$SERVICE_FILE" ]; then
      echo "Systemd service: INSTALLED ($SERVICE_FILE)"
      systemctl --user status "$SERVICE_NAME" --no-pager 2>/dev/null || true
    else
      echo "Systemd service: NOT INSTALLED"
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
