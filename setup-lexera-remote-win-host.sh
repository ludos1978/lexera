#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETUP_PS1="$SCRIPT_DIR/setup-lexera-win-host.ps1"

REMOTE_TARGET=""
REMOTE_PORT=""
SSH_IDENTITY=""
REMOTE_DIR="lexera-deploy"
BACKEND_PORT="13080"
BIND_ADDRESS="0.0.0.0"
SKIP_SSH_SETUP=0
SKIP_RUNTIMES=0
HOST_KEY_CHECKING="accept-new"

usage() {
  cat <<'EOF'
Usage:
  ./setup-lexera-remote-win-host.sh --target USER@HOST [options]

Options:
  --target USER@HOST     SSH target (required)
  --port PORT            SSH port
  --identity PATH        SSH key path
  --remote-dir PATH      Remote deploy base dir under remote home (default: lexera-deploy)
  --backend-port PORT    Lexera backend port in sync.json + firewall (default: 13080)
  --bind-address ADDR    Lexera bind_address in sync.json (default: 0.0.0.0)
  --skip-ssh-setup       Do not install/configure OpenSSH service on remote host
  --skip-runtimes        Do not install/check WebView2 + VC++ runtime
  --host-key-checking MODE
                        SSH host key mode: accept-new|yes|no (default: accept-new)
  -h, --help             Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      REMOTE_TARGET="${2:-}"
      shift 2
      ;;
    --port)
      REMOTE_PORT="${2:-}"
      shift 2
      ;;
    --identity)
      SSH_IDENTITY="${2:-}"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="${2:-}"
      shift 2
      ;;
    --backend-port)
      BACKEND_PORT="${2:-}"
      shift 2
      ;;
    --bind-address)
      BIND_ADDRESS="${2:-}"
      shift 2
      ;;
    --skip-ssh-setup)
      SKIP_SSH_SETUP=1
      shift
      ;;
    --skip-runtimes)
      SKIP_RUNTIMES=1
      shift
      ;;
    --host-key-checking)
      HOST_KEY_CHECKING="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$REMOTE_TARGET" ]]; then
  echo "Missing required --target USER@HOST" >&2
  usage
  exit 1
fi

if [[ ! -f "$SETUP_PS1" ]]; then
  echo "Missing setup script: $SETUP_PS1" >&2
  exit 1
fi

SSH_ARGS=()
SCP_ARGS=()
SSH_ARGS+=(-o "StrictHostKeyChecking=$HOST_KEY_CHECKING")
SCP_ARGS+=(-o "StrictHostKeyChecking=$HOST_KEY_CHECKING")
if [[ -n "$REMOTE_PORT" ]]; then
  SSH_ARGS+=(-p "$REMOTE_PORT")
  SCP_ARGS+=(-P "$REMOTE_PORT")
fi
if [[ -n "$SSH_IDENTITY" ]]; then
  SSH_ARGS+=(-i "$SSH_IDENTITY")
  SCP_ARGS+=(-i "$SSH_IDENTITY")
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh command not found" >&2
  exit 1
fi
if ! command -v scp >/dev/null 2>&1; then
  echo "scp command not found" >&2
  exit 1
fi
run_remote_ps() {
  local script="$1"
  local wrapped
  local local_tmp=""
  local remote_tmp=""
  wrapped="\$ProgressPreference='SilentlyContinue';\$ErrorView='ConciseView';try {$script} finally { Remove-Item -LiteralPath \$PSCommandPath -Force -ErrorAction SilentlyContinue }"

  local_tmp="$(mktemp "${TMPDIR:-/tmp}/lexera-remote-ps-XXXXXX.ps1")"
  remote_tmp="lexera-remote-ps-$(date +%s)-$RANDOM.ps1"
  printf '%s\n' "$wrapped" > "$local_tmp"

  scp "${SCP_ARGS[@]}" "$local_tmp" "$REMOTE_TARGET:$remote_tmp" >/dev/null
  rm -f "$local_tmp"
  ssh "${SSH_ARGS[@]}" "$REMOTE_TARGET" "powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -OutputFormat Text -File \"$remote_tmp\""
}

REMOTE_DIR_SCP="${REMOTE_DIR//\\//}"
if [[ "$REMOTE_DIR_SCP" =~ ^[A-Za-z]:$ ]]; then
  REMOTE_DIR_SCP="${REMOTE_DIR_SCP}/"
fi
if [[ "$REMOTE_DIR_SCP" == */ && ! "$REMOTE_DIR_SCP" =~ ^[A-Za-z]:/$ ]]; then
  REMOTE_DIR_SCP="${REMOTE_DIR_SCP%/}"
fi
if [[ -z "$REMOTE_DIR_SCP" ]]; then
  REMOTE_DIR_SCP="lexera-deploy"
fi
REMOTE_SETUP_PATH="$REMOTE_DIR_SCP/setup-lexera-win-host.ps1"
REMOTE_DIR_PS="${REMOTE_DIR//\'/''}"
ENABLE_SSH_BOOL="\$true"
INSTALL_RUNTIMES_BOOL="\$true"
if [[ "$SKIP_SSH_SETUP" -eq 1 ]]; then
  ENABLE_SSH_BOOL="\$false"
fi
if [[ "$SKIP_RUNTIMES" -eq 1 ]]; then
  INSTALL_RUNTIMES_BOOL="\$false"
fi

echo "Preparing remote host: $REMOTE_TARGET"
echo "Remote setup path: $REMOTE_SETUP_PATH"

run_remote_ps "\$ErrorActionPreference = 'Stop';
\$dir = '$REMOTE_DIR_PS';
if (\$dir -match '^[A-Za-z]:$') { \$dir = \$dir + '\' }
if (!(\$dir -match '^[A-Za-z]:([\\/].*)?$' -or \$dir -match '^\\\\')) {
  \$dir = Join-Path \$HOME \$dir;
}
New-Item -ItemType Directory -Force -Path \$dir | Out-Null;
Write-Output ('Deploy dir: ' + \$dir);"

echo "Copying setup script..."
scp "${SCP_ARGS[@]}" "$SETUP_PS1" "$REMOTE_TARGET:$REMOTE_SETUP_PATH"

REMOTE_CMD="\$ErrorActionPreference = 'Stop';
\$deployBase = '$REMOTE_DIR_PS';
if (\$deployBase -match '^[A-Za-z]:$') { \$deployBase = \$deployBase + '\' }
if (!(\$deployBase -match '^[A-Za-z]:([\\/].*)?$' -or \$deployBase -match '^\\\\')) {
  \$deployBase = Join-Path \$HOME \$deployBase;
}
\$script = Join-Path \$deployBase 'setup-lexera-win-host.ps1';
if (!(Test-Path \$script)) { throw 'Setup script missing: ' + \$script }
\$args = @(
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  \$script,
  '-BackendPort',
  '$BACKEND_PORT',
  '-BindAddress',
  '$BIND_ADDRESS',
  '-DeployBase',
  \$deployBase,
  '-EnableSsh:$ENABLE_SSH_BOOL',
  '-InstallRuntimes:$INSTALL_RUNTIMES_BOOL'
);
"
REMOTE_CMD+="Write-Output ('Running: powershell ' + (\$args -join ' '));
& powershell @args;"

echo "Running setup on remote host..."
run_remote_ps "$REMOTE_CMD"

echo ""
echo "Remote host setup finished."
echo "Next step: ./run-lexera-remote-win.sh --target $REMOTE_TARGET --build-win --run-local"
