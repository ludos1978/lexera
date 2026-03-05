#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILDS_DIR="$SCRIPT_DIR/builds"
DEFAULT_REMOTE_BASE_DIR="lexera-deploy"
DEFAULT_REMOTE_TARGET="netuser@192.168.1.211"
DEFAULT_REMOTE_DIR="d:"

REMOTE_TARGET="$DEFAULT_REMOTE_TARGET"
REMOTE_PORT=""
SSH_IDENTITY=""
BUILD_DIR=""
REMOTE_BASE_DIR="$DEFAULT_REMOTE_DIR"
RUN_LOCAL=1
BUILD_WINDOWS=1
HOST_KEY_CHECKING="accept-new"
REMOTE_KANBAN=1

usage() {
  cat <<'EOF'
Usage:
  ./run-lexera-remote-win.sh [options]

Options:
  --target USER@HOST    SSH target (default: netuser@192.168.1.211)
  --port PORT           SSH port
  --identity PATH       SSH private key path
  --build-dir PATH      Local build dir to deploy (default: latest builds/windows-*)
  --remote-dir PATH     Remote base dir under the remote user profile (default: d:)
  --run-local           Start ./run-lexera.sh locally in parallel (default: enabled)
  --no-run-local        Disable local ./run-lexera.sh startup
  --remote-kanban       Also start lexera-kanban.exe on the remote Windows host (default: enabled)
  --no-remote-kanban    Disable remote kanban startup (backend only)
  --build-win           Run ./lexera-build-win.sh before deployment (default: enabled)
  --no-build-win        Skip Windows build and use latest existing build
  --host-key-checking MODE
                        SSH host key mode: accept-new|yes|no (default: accept-new)
  -h, --help            Show help

Behavior:
  1) Copies lexera-backend.exe and lexera-kanban.exe to Windows host.
  2) Kills running lexera* processes on that host.
  3) Starts backend remotely (kanban by default).
  4) On Ctrl+C, kills all lexera* processes remotely.
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
    --build-dir)
      BUILD_DIR="${2:-}"
      shift 2
      ;;
    --remote-dir)
      REMOTE_BASE_DIR="${2:-}"
      shift 2
      ;;
    --run-local)
      RUN_LOCAL=1
      shift
      ;;
    --no-run-local)
      RUN_LOCAL=0
      shift
      ;;
    --remote-kanban)
      REMOTE_KANBAN=1
      shift
      ;;
    --no-remote-kanban)
      REMOTE_KANBAN=0
      shift
      ;;
    --build-win)
      BUILD_WINDOWS=1
      shift
      ;;
    --no-build-win)
      BUILD_WINDOWS=0
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

if [[ "$BUILD_WINDOWS" -eq 1 ]]; then
  echo "Building Windows artifacts..."
  "$SCRIPT_DIR/lexera-build-win.sh"
fi

if [[ -z "$BUILD_DIR" ]]; then
  BUILD_DIR="$(ls -dt "$BUILDS_DIR"/windows-* 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$BUILD_DIR" || ! -d "$BUILD_DIR" ]]; then
  echo "No Windows build directory found. Pass --build-dir or run ./lexera-build-win.sh first." >&2
  exit 1
fi

BACKEND_EXE="$BUILD_DIR/lexera-backend.exe"
KANBAN_EXE="$BUILD_DIR/lexera-kanban.exe"

if [[ ! -f "$BACKEND_EXE" ]]; then
  echo "Missing backend executable: $BACKEND_EXE" >&2
  exit 1
fi
if [[ ! -f "$KANBAN_EXE" ]]; then
  echo "Missing frontend executable: $KANBAN_EXE" >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh command not found" >&2
  exit 1
fi
if ! command -v scp >/dev/null 2>&1; then
  echo "scp command not found" >&2
  exit 1
fi
SSH_ARGS=()
SCP_ARGS=()
SSH_ARGS+=(-o "StrictHostKeyChecking=$HOST_KEY_CHECKING")
SCP_ARGS+=(-o "StrictHostKeyChecking=$HOST_KEY_CHECKING")
# Keep ControlPath short to avoid macOS/OpenSSH 104-byte socket path limit.
SSH_CONTROL_PATH="/tmp/lxrw-%C"
SSH_ARGS+=(-o "ControlMaster=auto" -o "ControlPersist=600" -o "ControlPath=$SSH_CONTROL_PATH")
SCP_ARGS+=(-o "ControlMaster=auto" -o "ControlPersist=600" -o "ControlPath=$SSH_CONTROL_PATH")
if [[ -n "$REMOTE_PORT" ]]; then
  SSH_ARGS+=(-p "$REMOTE_PORT")
  SCP_ARGS+=(-P "$REMOTE_PORT")
fi
if [[ -n "$SSH_IDENTITY" ]]; then
  SSH_ARGS+=(-i "$SSH_IDENTITY")
  SCP_ARGS+=(-i "$SSH_IDENTITY")
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

RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_STAGE_NAME="run-$RUN_STAMP"
REMOTE_BASE_SCP="${REMOTE_BASE_DIR//\\//}"
if [[ -z "$REMOTE_BASE_SCP" ]]; then
  REMOTE_BASE_SCP="$DEFAULT_REMOTE_BASE_DIR"
fi
if [[ "$REMOTE_BASE_SCP" == */ && ! "$REMOTE_BASE_SCP" =~ ^[A-Za-z]:/$ ]]; then
  REMOTE_BASE_SCP="${REMOTE_BASE_SCP%/}"
fi
if [[ "$REMOTE_BASE_SCP" =~ ^[A-Za-z]:/?$ ]]; then
  REMOTE_STAGE_SCP_PATH="${REMOTE_BASE_SCP%/}/$REMOTE_STAGE_NAME"
else
  REMOTE_STAGE_SCP_PATH="$REMOTE_BASE_SCP/$REMOTE_STAGE_NAME"
fi
REMOTE_BASE_PS="${REMOTE_BASE_DIR//\'/''}"

cleanup_ran=0
LOCAL_RUN_PID=""
REMOTE_PROCESSES_STARTED=0
REMOTE_HEALTH_TICK=0
REMOTE_HEALTH_INTERVAL_SECONDS=8
if [[ "$REMOTE_KANBAN" -eq 1 ]]; then
  REMOTE_EXPECT_KANBAN_PS="\$true"
else
  REMOTE_EXPECT_KANBAN_PS="\$false"
fi

cleanup_all() {
  if [[ "$cleanup_ran" -eq 1 ]]; then
    return
  fi
  cleanup_ran=1

  if [[ -n "$LOCAL_RUN_PID" ]]; then
    if kill -0 "$LOCAL_RUN_PID" 2>/dev/null; then
      echo ""
      echo "Stopping local run-lexera.sh (PID $LOCAL_RUN_PID)..."
      kill -TERM "$LOCAL_RUN_PID" 2>/dev/null || true
      wait "$LOCAL_RUN_PID" 2>/dev/null || true
    fi
  fi
  if [[ "$RUN_LOCAL" -eq 1 ]]; then
    echo "Ensuring local Lexera children are stopped..."
    "$SCRIPT_DIR/run-lexera.sh" --kill >/dev/null 2>&1 || true
  fi

  if [[ "$REMOTE_PROCESSES_STARTED" -eq 1 ]]; then
    echo ""
    echo "Stopping remote Lexera processes on $REMOTE_TARGET..."
    run_remote_ps "\$ErrorActionPreference = 'Continue';
\$procs = Get-Process | Where-Object { \$_.ProcessName -like 'lexera*' };
if (\$procs) {
  \$count = @(\$procs).Count;
  \$procs | Stop-Process -Force -ErrorAction SilentlyContinue;
  Write-Output ('Stopped lexera* processes: ' + \$count);
} else {
  Write-Output 'No lexera* process found.';
}" || true
  fi

  ssh "${SSH_ARGS[@]}" -O exit "$REMOTE_TARGET" >/dev/null 2>&1 || true
}

on_signal() {
  cleanup_all
  exit 130
}

trap on_signal INT TERM
trap cleanup_all EXIT

echo "Deploying from build: $BUILD_DIR"
echo "Remote target: $REMOTE_TARGET"
echo "Remote stage dir (scp path): $REMOTE_STAGE_SCP_PATH"

echo "Establishing SSH control connection..."
ssh "${SSH_ARGS[@]}" "$REMOTE_TARGET" "exit"

echo "Verifying remote PowerShell channel..."
REMOTE_PS_PROBE_TOKEN="LEXERA_REMOTE_PS_OK"
remote_ps_probe_output="$(run_remote_ps "Write-Output '$REMOTE_PS_PROBE_TOKEN'" 2>&1 || true)"
if ! printf '%s\n' "$remote_ps_probe_output" | grep -q "$REMOTE_PS_PROBE_TOKEN"; then
  echo "ERROR: Remote PowerShell channel did not return expected output."
  if [[ -n "$remote_ps_probe_output" ]]; then
    echo "$remote_ps_probe_output"
  else
    echo "<no output from remote PowerShell probe>"
  fi
  raw_ssh_probe_output="$(ssh "${SSH_ARGS[@]}" "$REMOTE_TARGET" "echo LEXERA_REMOTE_SSH_OK" 2>&1 || true)"
  if [[ -n "$raw_ssh_probe_output" ]]; then
    echo "Raw SSH probe:"
    echo "$raw_ssh_probe_output"
  fi
  exit 1
fi

echo "Creating remote stage directory..."
run_remote_ps "\$ErrorActionPreference = 'Stop';
\$baseRaw = '$REMOTE_BASE_PS';
if (\$baseRaw -match '^[A-Za-z]:$') {
  \$baseRaw = \$baseRaw + [IO.Path]::DirectorySeparatorChar;
}
if (\$baseRaw -match '^[A-Za-z]:' -or \$baseRaw -match '^\\\\') {
  \$base = \$baseRaw;
} else {
  \$base = Join-Path \$HOME \$baseRaw;
}
if (\$base -match '^[A-Za-z]:[\\/]?$') {
  \$stage = \$base + '$REMOTE_STAGE_NAME';
} else {
  \$stage = Join-Path \$base '$REMOTE_STAGE_NAME';
}
New-Item -ItemType Directory -Force -Path \$stage | Out-Null;
Write-Output ('Stage: ' + \$stage);"

echo "Copying executables..."
scp "${SCP_ARGS[@]}" "$BACKEND_EXE" "$KANBAN_EXE" "$REMOTE_TARGET:$REMOTE_STAGE_SCP_PATH/"

echo "Starting remote Windows Lexera processes..."
remote_start_output=""
if ! remote_start_output="$(run_remote_ps "\$ErrorActionPreference = 'Stop';
\$baseRaw = '$REMOTE_BASE_PS';
if (\$baseRaw -match '^[A-Za-z]:$') {
  \$baseRaw = \$baseRaw + [IO.Path]::DirectorySeparatorChar;
}
if (\$baseRaw -match '^[A-Za-z]:' -or \$baseRaw -match '^\\\\') {
  \$base = \$baseRaw;
} else {
  \$base = Join-Path \$HOME \$baseRaw;
}
if (\$base -match '^[A-Za-z]:[\\/]?$') {
  \$stage = \$base + '$REMOTE_STAGE_NAME';
} else {
  \$stage = Join-Path \$base '$REMOTE_STAGE_NAME';
}
\$backendExe = Join-Path \$stage 'lexera-backend.exe';
\$kanbanExe = Join-Path \$stage 'lexera-kanban.exe';
\$backendOut = Join-Path \$stage 'lexera-backend.stdout.log';
\$backendErr = Join-Path \$stage 'lexera-backend.stderr.log';
\$kanbanOut = Join-Path \$stage 'lexera-kanban.stdout.log';
\$kanbanErr = Join-Path \$stage 'lexera-kanban.stderr.log';
\$launcherScript = Join-Path \$stage 'lexera-remote-launch.ps1';
\$taskName = 'LexeraRemoteLaunch-' + [Guid]::NewGuid().ToString('N');
\$expectKanban = $REMOTE_EXPECT_KANBAN_PS;
if (!(Test-Path \$backendExe)) { throw 'Missing backend exe: ' + \$backendExe }
if (\$expectKanban -and !(Test-Path \$kanbanExe)) { throw 'Missing kanban exe: ' + \$kanbanExe }
Remove-Item -Path @(\$backendOut,\$backendErr,\$kanbanOut,\$kanbanErr) -ErrorAction SilentlyContinue;
Remove-Item -Path \$launcherScript -ErrorAction SilentlyContinue;
Get-Process | Where-Object { \$_.ProcessName -like 'lexera*' } | Stop-Process -Force -ErrorAction SilentlyContinue;
Start-Sleep -Milliseconds 300;
\$interactive = Get-Process -Name 'explorer' -ErrorAction SilentlyContinue | Where-Object { \$_.SessionId -ne 0 } | Sort-Object Id -Descending | Select-Object -First 1;
if (!\$interactive) {
  \$sessions = (quser 2>\$null | Out-String).Trim();
  if (-not \$sessions) { \$sessions = '<no active interactive user session found>'; }
  throw ('No interactive Windows desktop session detected (explorer.exe with SessionId != 0). Log in to the Windows desktop as ' + \$env:USERNAME + '. Sessions: ' + \$sessions)
}
Write-Output ('Interactive desktop session detected sessionId=' + \$interactive.SessionId + ' user=' + \$env:USERNAME);
\$backendLine = 'Start-Process -FilePath "{0}" -WorkingDirectory "{1}" -PassThru -RedirectStandardOutput "{2}" -RedirectStandardError "{3}" | Out-Null' -f \$backendExe, \$stage, \$backendOut, \$backendErr;
\$launcherLines = @(
  '\$ErrorActionPreference = ''Continue''',
  \$backendLine
);
if (\$expectKanban) {
  \$kanbanLine = 'Start-Process -FilePath "{0}" -WorkingDirectory "{1}" -PassThru -RedirectStandardOutput "{2}" -RedirectStandardError "{3}" | Out-Null' -f \$kanbanExe, \$stage, \$kanbanOut, \$kanbanErr;
  \$launcherLines += 'Start-Sleep -Seconds 1';
  \$launcherLines += \$kanbanLine;
}
Set-Content -Path \$launcherScript -Value (\$launcherLines -join [Environment]::NewLine) -Encoding UTF8;
\$runAt = (Get-Date).AddMinutes(1).ToString('HH:mm');
\$taskCmd = 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f \$launcherScript;
\$createOut = & schtasks.exe /Create /F /SC ONCE /ST \$runAt /TN \$taskName /TR \$taskCmd /RL LIMITED /IT 2>&1;
if (\$LASTEXITCODE -ne 0) {
  throw ('Failed to create interactive scheduled task: ' + ((\$createOut | Out-String).Trim()))
}
\$runOut = & schtasks.exe /Run /TN \$taskName 2>&1;
if (\$LASTEXITCODE -ne 0) {
  throw ('Failed to run interactive scheduled task: ' + ((\$runOut | Out-String).Trim()))
}
Write-Output ('Scheduled task launched name=' + \$taskName + ' at=' + \$runAt);
Start-Sleep -Seconds 2;
\$backendAlive = Get-Process -Name 'lexera-backend' -ErrorAction SilentlyContinue | Sort-Object Id -Descending | Select-Object -First 1;
\$kanbanAlive = if (\$expectKanban) { Get-Process -Name 'lexera-kanban' -ErrorAction SilentlyContinue | Sort-Object Id -Descending | Select-Object -First 1 } else { \$null };
if (!\$backendAlive -or (\$expectKanban -and !\$kanbanAlive)) {
  Write-Output ('Remote launch verification failed. stage=' + \$stage);
  if (!\$backendAlive) { Write-Output 'backend_missing process=lexera-backend'; }
  if (\$expectKanban -and !\$kanbanAlive) { Write-Output 'kanban_missing process=lexera-kanban'; }
  foreach (\$log in @(\$backendOut,\$backendErr,\$kanbanOut,\$kanbanErr)) {
    if (Test-Path \$log) {
      Write-Output ('--- BEGIN LOG ' + \$log + ' ---');
      Get-Content -Path \$log -Tail 120;
      Write-Output ('--- END LOG ' + \$log + ' ---');
    } else {
      Write-Output ('Log missing: ' + \$log);
    }
  }
  & schtasks.exe /Delete /TN \$taskName /F *> \$null;
  throw 'Remote launch verification failed';
}
if (\$expectKanban) {
  Write-Output ('Started lexera-backend PID=' + \$backendAlive.Id + ' session=' + \$backendAlive.SessionId + ' lexera-kanban PID=' + \$kanbanAlive.Id + ' session=' + \$kanbanAlive.SessionId + ' stage=' + \$stage);
  if (\$kanbanAlive.SessionId -eq 0) {
    Write-Output 'WARNING: lexera-kanban is running in Session 0 (non-interactive); window/taskbar will not be visible.';
  }
} else {
  Write-Output ('Started lexera-backend PID=' + \$backendAlive.Id + ' session=' + \$backendAlive.SessionId + ' stage=' + \$stage + ' (remote kanban disabled)');
  if (\$backendAlive.SessionId -eq 0) {
    Write-Output 'WARNING: lexera-backend is running in Session 0 (non-interactive); tray icon will not be visible.';
  }
}
& schtasks.exe /Delete /TN \$taskName /F *> \$null;
Write-Output ('Logs backend=' + \$backendOut + ',' + \$backendErr + ' kanban=' + \$kanbanOut + ',' + \$kanbanErr);" 2>&1)"; then
  echo "ERROR: failed to start remote Windows Lexera processes."
  if [[ -n "$remote_start_output" ]]; then
    echo "$remote_start_output"
  fi
  exit 1
fi

if [[ -n "$remote_start_output" ]]; then
  echo "$remote_start_output"
else
  echo "WARNING: remote start command returned no output."
fi

if ! printf '%s\n' "$remote_start_output" | grep -q "Started lexera-backend"; then
  echo "ERROR: remote launcher did not confirm backend startup."
  remote_diag_output="$(run_remote_ps "\$procs = Get-Process | Where-Object { \$_.ProcessName -like 'lexera*' } | Select-Object Id, ProcessName, SessionId | Sort-Object ProcessName;
if (!\$procs) {
  Write-Output 'Remote diagnostic: no lexera* process currently running.';
} else {
  Write-Output 'Remote diagnostic process snapshot:';
  \$procs | Format-Table -AutoSize | Out-String | Write-Output;
}" 2>&1 || true)"
  if [[ -n "$remote_diag_output" ]]; then
    echo "$remote_diag_output"
  fi
  exit 1
fi
REMOTE_PROCESSES_STARTED=1

echo "Remote process snapshot after startup..."
snapshot_output="$(run_remote_ps "\$procs = Get-Process | Where-Object { \$_.ProcessName -like 'lexera*' } | Select-Object Id, ProcessName | Sort-Object ProcessName;
if (!\$procs) {
  Write-Output 'No lexera* process is running on remote host right after startup.';
} else {
  Write-Output 'Remote lexera* processes:';
  (Get-Process | Where-Object { \$_.ProcessName -like 'lexera*' } | Select-Object Id, ProcessName, SessionId | Sort-Object ProcessName) | Format-Table -AutoSize | Out-String | Write-Output;
}" 2>&1 || true)"
if [[ -n "$snapshot_output" ]]; then
  echo "$snapshot_output"
else
  echo "WARNING: remote process snapshot returned no output."
fi

immediate_health_output=""
if ! immediate_health_output="$(run_remote_ps "\$ErrorActionPreference = 'Stop';
\$expectKanban = $REMOTE_EXPECT_KANBAN_PS;
\$backendAlive = Get-Process -Name 'lexera-backend' -ErrorAction SilentlyContinue | Sort-Object Id -Descending | Select-Object -First 1;
\$kanbanAlive = if (\$expectKanban) { Get-Process -Name 'lexera-kanban' -ErrorAction SilentlyContinue | Sort-Object Id -Descending | Select-Object -First 1 } else { \$null };
if (!\$backendAlive -or (\$expectKanban -and !\$kanbanAlive)) {
  throw 'Immediate health check failed after startup.';
}
if (\$expectKanban) {
  Write-Output ('Immediate remote health OK backendPid=' + \$backendAlive.Id + ' backendSession=' + \$backendAlive.SessionId + ' kanbanPid=' + \$kanbanAlive.Id + ' kanbanSession=' + \$kanbanAlive.SessionId);
} else {
  Write-Output ('Immediate remote health OK backendPid=' + \$backendAlive.Id + ' backendSession=' + \$backendAlive.SessionId + ' kanbanPid=disabled');
}" 2>&1)"; then
  echo "ERROR: immediate remote health check failed."
  if [[ -n "$immediate_health_output" ]]; then
    echo "$immediate_health_output"
  fi
  exit 1
fi
if [[ -n "$immediate_health_output" ]]; then
  echo "$immediate_health_output"
fi

if [[ "$RUN_LOCAL" -eq 1 ]]; then
  echo "Starting local ./run-lexera.sh ..."
  "$SCRIPT_DIR/run-lexera.sh" &
  LOCAL_RUN_PID=$!
  echo "Local run PID: $LOCAL_RUN_PID"
fi

echo ""
if [[ "$RUN_LOCAL" -eq 1 && "$REMOTE_KANBAN" -eq 1 ]]; then
  echo "Local + remote Lexera (backend+kanban) are running. Press Ctrl+C to stop both."
elif [[ "$RUN_LOCAL" -eq 1 ]]; then
  echo "Local Lexera and remote backend are running. Press Ctrl+C to stop both."
elif [[ "$REMOTE_KANBAN" -eq 1 ]]; then
  echo "Remote Lexera (backend+kanban) is running. Press Ctrl+C to stop all remote lexera* processes."
else
  echo "Remote backend is running. Press Ctrl+C to stop all remote lexera* processes."
fi
echo ""

while true; do
  sleep 1
  if [[ -n "$LOCAL_RUN_PID" ]] && ! kill -0 "$LOCAL_RUN_PID" 2>/dev/null; then
    echo "Local run-lexera.sh exited. Remote continues; press Ctrl+C to stop remote."
    LOCAL_RUN_PID=""
  fi

  if [[ "$REMOTE_PROCESSES_STARTED" -eq 1 ]]; then
    REMOTE_HEALTH_TICK=$((REMOTE_HEALTH_TICK + 1))
    if (( REMOTE_HEALTH_TICK >= REMOTE_HEALTH_INTERVAL_SECONDS )); then
      REMOTE_HEALTH_TICK=0
      if health_output="$(run_remote_ps "\$ErrorActionPreference = 'Stop';
\$baseRaw = '$REMOTE_BASE_PS';
if (\$baseRaw -match '^[A-Za-z]:$') {
  \$baseRaw = \$baseRaw + [IO.Path]::DirectorySeparatorChar;
}
if (\$baseRaw -match '^[A-Za-z]:' -or \$baseRaw -match '^\\\\') {
  \$base = \$baseRaw;
} else {
  \$base = Join-Path \$HOME \$baseRaw;
}
if (\$base -match '^[A-Za-z]:[\\/]?$') {
  \$stage = \$base + '$REMOTE_STAGE_NAME';
} else {
  \$stage = Join-Path \$base '$REMOTE_STAGE_NAME';
}
\$backendOut = Join-Path \$stage 'lexera-backend.stdout.log';
\$backendErr = Join-Path \$stage 'lexera-backend.stderr.log';
\$kanbanOut = Join-Path \$stage 'lexera-kanban.stdout.log';
\$kanbanErr = Join-Path \$stage 'lexera-kanban.stderr.log';
\$expectKanban = $REMOTE_EXPECT_KANBAN_PS;
\$backendAlive = Get-Process -Name 'lexera-backend' -ErrorAction SilentlyContinue | Sort-Object Id -Descending | Select-Object -First 1;
\$kanbanAlive = if (\$expectKanban) { Get-Process -Name 'lexera-kanban' -ErrorAction SilentlyContinue | Sort-Object Id -Descending | Select-Object -First 1 } else { \$null };
\$backendPidOut = if (\$backendAlive) { \$backendAlive.Id } else { -1 };
\$kanbanPidOut = if (\$kanbanAlive) { \$kanbanAlive.Id } else { -1 };
if (!\$backendAlive -or (\$expectKanban -and !\$kanbanAlive)) {
  Write-Output ('Remote health check failed in stage=' + \$stage + ' backendPid=' + \$backendPidOut + ' kanbanPid=' + \$kanbanPidOut);
  Write-Output 'Running lexera* process snapshot:';
  \$snapshot = Get-Process | Where-Object { \$_.ProcessName -like 'lexera*' } | Select-Object Id, ProcessName, SessionId | Format-Table -AutoSize | Out-String;
  Write-Output \$snapshot;
  foreach (\$log in @(\$backendOut,\$backendErr,\$kanbanOut,\$kanbanErr)) {
    if (Test-Path \$log) {
      Write-Output ('--- BEGIN LOG ' + \$log + ' ---');
      Get-Content -Path \$log -Tail 120;
      Write-Output ('--- END LOG ' + \$log + ' ---');
    } else {
      Write-Output ('Log missing: ' + \$log);
    }
  }
  throw 'Remote health check failed';
}
if (\$expectKanban) {
  Write-Output ('Remote health OK backendPid=' + \$backendAlive.Id + ' backendSession=' + \$backendAlive.SessionId + ' kanbanPid=' + \$kanbanAlive.Id + ' kanbanSession=' + \$kanbanAlive.SessionId);
} else {
  Write-Output ('Remote health OK backendPid=' + \$backendAlive.Id + ' backendSession=' + \$backendAlive.SessionId + ' kanbanPid=disabled');
}" 2>&1)"; then
        echo "$health_output"
      else
        echo ""
        echo "ERROR: Remote Windows processes are no longer healthy."
        echo "$health_output"
        echo "Remote stage for investigation: $REMOTE_STAGE_SCP_PATH"
        REMOTE_PROCESSES_STARTED=0
      fi
    fi
  fi
done
