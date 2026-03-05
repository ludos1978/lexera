param(
  [switch]$EnableSsh = $true,
  [switch]$InstallRuntimes = $true,
  [int]$BackendPort = 13080,
  [string]$BindAddress = "0.0.0.0",
  [string]$DeployBase = "$HOME\lexera-deploy"
)

$ErrorActionPreference = "Stop"
$ScriptVersion = "20260305-setupfix4"

function Write-Step([string]$Message) {
  Write-Host "==> $Message"
}

function Test-IsAdmin {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Ensure-FirewallRule {
  param(
    [string]$DisplayName,
    [int]$Port
  )
  $existing = Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-NetFirewallRule `
      -DisplayName $DisplayName `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $Port | Out-Null
  }
}

function Ensure-WebView2Runtime {
  $runtimeGuid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  $paths = @(
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$runtimeGuid",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$runtimeGuid"
  )
  foreach ($path in $paths) {
    if (Test-Path $path) {
      $version = (Get-ItemProperty -Path $path -Name pv -ErrorAction SilentlyContinue).pv
      if ($version) {
        Write-Host "WebView2 runtime detected: $version"
        return
      }
    }
  }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Step "Installing WebView2 runtime via winget"
    winget install --id Microsoft.EdgeWebView2Runtime -e --accept-package-agreements --accept-source-agreements --silent | Out-Host
  } else {
    Write-Warning "WebView2 runtime not found and winget is unavailable. Install WebView2 runtime manually."
  }
}

function Ensure-VcRedist {
  $vcReg = "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
  $installed = $false
  if (Test-Path $vcReg) {
    $installedValue = (Get-ItemProperty -Path $vcReg -Name Installed -ErrorAction SilentlyContinue).Installed
    if ($installedValue -eq 1) {
      $installed = $true
    }
  }
  if ($installed) {
    Write-Host "VC++ runtime detected."
    return
  }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Step "Installing VC++ runtime via winget"
    winget install --id Microsoft.VCRedist.2015+.x64 -e --accept-package-agreements --accept-source-agreements --silent | Out-Host
  } else {
    Write-Warning "VC++ runtime not found and winget is unavailable. Install Visual C++ 2015-2022 x64 Redistributable manually."
  }
}

function Ensure-LexeraConfig {
  param(
    [int]$Port,
    [string]$Bind
  )

  $configDir = Join-Path $env:APPDATA "lexera"
  $syncPath = Join-Path $configDir "sync.json"
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null

  $cfg = $null
  if (Test-Path $syncPath) {
    try {
      $cfg = Get-Content -Raw -Path $syncPath | ConvertFrom-Json
    } catch {
      Write-Warning "Existing sync.json is invalid JSON. Recreating file."
      $cfg = [pscustomobject]@{}
    }
  } else {
    $cfg = [pscustomobject]@{}
  }

  if ($cfg -is [System.Array]) {
    Write-Warning "Existing sync.json is not an object. Recreating file."
    $cfg = [pscustomobject]@{}
  }

  function Set-OrAddConfigProperty {
    param(
      [Parameter(Mandatory = $true)] [object]$Obj,
      [Parameter(Mandatory = $true)] [string]$Name,
      [AllowNull()] $Value
    )
    $prop = $Obj.PSObject.Properties[$Name]
    if ($null -eq $prop) {
      $Obj | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    } else {
      $prop.Value = $Value
    }
  }

  function Get-ConfigPropertyOrDefault {
    param(
      [Parameter(Mandatory = $true)] [object]$Obj,
      [Parameter(Mandatory = $true)] [string]$Name,
      [AllowNull()] $DefaultValue
    )
    $prop = $Obj.PSObject.Properties[$Name]
    if ($null -eq $prop -or $null -eq $prop.Value) {
      return $DefaultValue
    }
    return $prop.Value
  }

  $boards = Get-ConfigPropertyOrDefault -Obj $cfg -Name "boards" -DefaultValue @()
  if ($null -eq $boards -or $boards -isnot [System.Array]) { $boards = @() }
  $workspaces = Get-ConfigPropertyOrDefault -Obj $cfg -Name "workspaces" -DefaultValue @()
  if ($null -eq $workspaces -or $workspaces -isnot [System.Array]) { $workspaces = @() }
  $incoming = Get-ConfigPropertyOrDefault -Obj $cfg -Name "incoming" -DefaultValue $null

  Set-OrAddConfigProperty -Obj $cfg -Name "boards" -Value $boards
  Set-OrAddConfigProperty -Obj $cfg -Name "incoming" -Value $incoming
  Set-OrAddConfigProperty -Obj $cfg -Name "workspaces" -Value $workspaces
  Set-OrAddConfigProperty -Obj $cfg -Name "port" -Value $Port
  Set-OrAddConfigProperty -Obj $cfg -Name "bind_address" -Value $Bind

  # Ensure arrays are arrays even when malformed values existed before.
  if (-not ($cfg.boards -is [System.Array])) { $cfg.boards = @() }
  if (-not ($cfg.workspaces -is [System.Array])) { $cfg.workspaces = @() }

  $json = $cfg | ConvertTo-Json -Depth 32
  Set-Content -Path $syncPath -Value $json -Encoding UTF8
  Write-Host "Updated config: $syncPath (bind_address=$Bind, port=$Port)"
}

$isAdmin = Test-IsAdmin
Write-Step "Starting Lexera Windows host setup"
Write-Host "Script version: $ScriptVersion"
Write-Host "Admin: $isAdmin"
Write-Host "Deploy base: $DeployBase"
Write-Host "Backend bind: $BindAddress"
Write-Host "Backend port: $BackendPort"

Write-Step "Creating deploy directory"
New-Item -ItemType Directory -Force -Path $DeployBase | Out-Null

if ($InstallRuntimes) {
  Write-Step "Checking/installing required runtimes"
  Ensure-WebView2Runtime
  Ensure-VcRedist
}

Write-Step "Configuring Lexera backend sync.json"
Ensure-LexeraConfig -Port $BackendPort -Bind $BindAddress

if ($EnableSsh) {
  if (-not $isAdmin) {
    Write-Warning "OpenSSH setup requested but script is not running as Administrator. Skipping SSH setup."
  } else {
    Write-Step "Installing/enabling OpenSSH Server"
    $cap = Get-WindowsCapability -Online | Where-Object { $_.Name -like "OpenSSH.Server*" } | Select-Object -First 1
    if (-not $cap) {
      throw "OpenSSH.Server capability not found on this Windows installation."
    }
    if ($cap.State -ne "Installed") {
      Add-WindowsCapability -Online -Name $cap.Name | Out-Host
    }
    Set-Service -Name sshd -StartupType Automatic
    Start-Service -Name sshd
    Ensure-FirewallRule -DisplayName "OpenSSH-Server-In-TCP" -Port 22
    Write-Host "OpenSSH Server ready."
  }
}

if ($isAdmin) {
  Write-Step "Ensuring firewall allows Lexera backend TCP port $BackendPort"
  Ensure-FirewallRule -DisplayName "Lexera-Backend-TCP-$BackendPort" -Port $BackendPort
} else {
  Write-Warning "Not Administrator: could not manage firewall rules for backend port."
}

Write-Step "Setup complete"
Write-Host "You can now deploy with run-lexera-remote-win.sh"
