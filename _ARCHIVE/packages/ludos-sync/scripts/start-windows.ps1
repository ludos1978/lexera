<#
.SYNOPSIS
  ludos-sync - Windows startup script

.DESCRIPTION
  Start, install, or manage the ludos-sync WebDAV server on Windows.

.PARAMETER Action
  foreground  - Start in current terminal (default)
  background  - Start as background job
  install     - Register as Windows Task Scheduler task (runs on login)
  uninstall   - Remove Task Scheduler task
  status      - Check if running

.PARAMETER Config
  Path to sync config file (default: .kanban\sync.json)

.PARAMETER Port
  Override server port

.PARAMETER Verbose
  Enable verbose logging

.EXAMPLE
  .\start-windows.ps1
  .\start-windows.ps1 -Action background
  .\start-windows.ps1 -Action install -Config C:\Users\me\.kanban\sync.json
  .\start-windows.ps1 -Action status
#>

param(
    [ValidateSet("foreground", "background", "install", "uninstall", "status")]
    [string]$Action = "foreground",

    [string]$Config = "",

    [int]$Port = 0,

    [switch]$VerboseLog
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageDir = Split-Path -Parent $ScriptDir
$CliJs = Join-Path $PackageDir "dist\cli.js"
$TaskName = "LudosSync"
$LogFile = Join-Path $env:USERPROFILE ".ludos-sync.log"
$ErrLog = Join-Path $env:USERPROFILE ".ludos-sync.err.log"

# ── Find Node.js ────────────────────────────────────────────────

function Find-Node {
    # Check PATH
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { return $node.Source }

    # Common install locations
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:APPDATA\nvm\current\node.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

$NodeBin = Find-Node
if (-not $NodeBin) {
    Write-Error @"
Node.js not found.
Install it from: https://nodejs.org/
Or with winget:  winget install OpenJS.NodeJS.LTS
Or with scoop:   scoop install nodejs-lts
"@
    exit 1
}

$NodeVersion = & $NodeBin --version
Write-Host "Using Node.js: $NodeBin ($NodeVersion)"

# ── Build if needed ─────────────────────────────────────────────

if (-not (Test-Path $CliJs)) {
    Write-Host "Building ludos-sync..."
    Push-Location $PackageDir
    if (-not (Test-Path "node_modules")) {
        npm install
    }
    npm run build
    Pop-Location
    Write-Host "Build complete."
}

# ── Resolve config path ────────────────────────────────────────

if ([string]::IsNullOrEmpty($Config)) {
    $Config = Join-Path $env:USERPROFILE ".config\ludos-sync\sync.json"
}
$Config = [System.IO.Path]::GetFullPath($Config)

$CliArgs = @("start", "--config", $Config)
if ($Port -gt 0) {
    $CliArgs += @("--port", $Port.ToString())
}
if ($VerboseLog) {
    $CliArgs += @("--verbose")
}

# ── Actions ─────────────────────────────────────────────────────

switch ($Action) {

    "foreground" {
        Write-Host "Starting ludos-sync in foreground..."
        Write-Host "Press Ctrl+C to stop."
        Write-Host ""
        & $NodeBin $CliJs @CliArgs
    }

    "background" {
        Write-Host "Starting ludos-sync in background..."
        $argString = ($CliArgs | ForEach-Object { "`"$_`"" }) -join " "
        $proc = Start-Process -FilePath $NodeBin `
            -ArgumentList "`"$CliJs`" $argString" `
            -WindowStyle Hidden `
            -RedirectStandardOutput $LogFile `
            -RedirectStandardError $ErrLog `
            -PassThru

        Write-Host "PID: $($proc.Id)"
        Write-Host "Log: $LogFile"
        Write-Host "Errors: $ErrLog"
        Write-Host ""

        Start-Sleep -Seconds 2
        if (-not $proc.HasExited) {
            Write-Host "Server is running."
        } else {
            Write-Error "Server failed to start. Check $ErrLog"
            exit 1
        }
    }

    "install" {
        Write-Host "Installing ludos-sync as Windows Task Scheduler task..."

        $argString = "`"$CliJs`" start --config `"$Config`""
        if ($Port -gt 0) {
            $argString += " --port $Port"
        }

        # Remove existing task if present
        schtasks /Delete /TN $TaskName /F 2>$null

        # Create task that runs on user logon
        schtasks /Create /TN $TaskName `
            /SC ONLOGON `
            /TR "`"$NodeBin`" $argString" `
            /F `
            /RL LIMITED

        Write-Host ""
        Write-Host "Installed Task Scheduler task: $TaskName"
        Write-Host "ludos-sync will start automatically on login."
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  schtasks /Run /TN $TaskName          # Start now"
        Write-Host "  schtasks /End /TN $TaskName          # Stop"
        Write-Host "  schtasks /Query /TN $TaskName        # Check status"
        Write-Host "  .\start-windows.ps1 -Action uninstall  # Remove"
        Write-Host ""

        # Start it now
        $startNow = Read-Host "Start the server now? (Y/n)"
        if ($startNow -ne "n" -and $startNow -ne "N") {
            schtasks /Run /TN $TaskName
            Write-Host "Server started."
        }
    }

    "uninstall" {
        Write-Host "Removing ludos-sync Task Scheduler task..."
        try {
            schtasks /End /TN $TaskName 2>$null
        } catch { }
        try {
            schtasks /Delete /TN $TaskName /F
            Write-Host "Removed task: $TaskName"
        } catch {
            Write-Host "No task found: $TaskName"
        }
    }

    "status" {
        Write-Host "=== ludos-sync status ==="
        Write-Host ""

        # Check Task Scheduler
        $taskExists = schtasks /Query /TN $TaskName 2>$null
        if ($taskExists) {
            Write-Host "Task Scheduler: INSTALLED"
            schtasks /Query /TN $TaskName /V /FO LIST 2>$null | Select-String "Status|Next Run|Last Run"
        } else {
            Write-Host "Task Scheduler: NOT INSTALLED"
        }
        Write-Host ""

        # Check process
        $procs = Get-Process -Name "node" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*ludos-sync*" -or $_.CommandLine -like "*cli.js*" }
        if ($procs) {
            Write-Host "Running PIDs:   $($procs.Id -join ', ')"
        } else {
            Write-Host "Process:        NOT RUNNING"
        }
        Write-Host ""

        # Probe HTTP
        & $NodeBin $CliJs status --config $Config 2>$null
    }
}
