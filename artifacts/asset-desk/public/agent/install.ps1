# ============================================================================
# Miles IT Assets — Windows Agent Installer (bootstrap)
#
# Run via the one-line command shown in the portal. It expects these env vars:
#   MILES_AGENT_TOKEN     (required) one-time agent key
#   MILES_AGENT_URL       (required) public URL of laptop_agent.py
#   MILES_ASSET_HOSTNAME  (optional) asset tag to rename the PC to
#   MILES_AGENT_API_BASE  (optional) override the agent API base URL
#
# Why a script instead of a chained one-liner: each step is validated, failures
# stop cleanly with a plain-English message, and everything is logged to
# %ProgramData%\MilesAgent\install.log for IT to review.
#
# ADMIN REQUIRED: device-lock enforcement only works when the agent runs as
# LocalSystem, so this installer auto-elevates (UAC prompt). Without admin a
# normal user cannot block Windows sign-in, so the lock could not be enforced.
# ============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference     = 'SilentlyContinue'
# Don't let a native tool's stderr/non-zero exit raise a PS terminating error;
# we check $LASTEXITCODE explicitly where it matters.
$PSNativeCommandUseErrorActionPreference = $false

$InstallDir  = Join-Path $env:ProgramData 'MilesAgent'
$VenvDir     = Join-Path $InstallDir 'venv'
$VenvPy      = Join-Path $VenvDir 'Scripts\python.exe'
$AgentScript = Join-Path $InstallDir 'laptop_agent.py'
$LogFile     = Join-Path $InstallDir 'install.log'
$PyUrl       = 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe'

$Token      = $env:MILES_AGENT_TOKEN
$AgentUrl   = $env:MILES_AGENT_URL
$TargetName = $env:MILES_ASSET_HOSTNAME
$ApiBase    = $env:MILES_AGENT_API_BASE

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $ts   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $line = "[$ts] [$Level] $Message"
  switch ($Level) {
    'ERROR' { Write-Host $line -ForegroundColor Red }
    'WARN'  { Write-Host $line -ForegroundColor Yellow }
    'OK'    { Write-Host $line -ForegroundColor Green }
    default { Write-Host $line }
  }
  try { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue } catch { }
}

function Stop-Install {
  param([string]$Message)
  Write-Log $Message 'ERROR'
  Write-Log 'Installation FAILED — nothing further was changed.' 'ERROR'
  Write-Log ("Full log: " + $LogFile) 'ERROR'
  exit 1
}

# A venv is only usable if BOTH the interpreter AND its pyvenv.cfg exist and the
# interpreter actually runs. Checking python.exe alone lets a broken/partial venv
# (left by a previous failed or force-removed install) slip through, which later
# fails with "No pyvenv.cfg file" the moment pip is invoked.
function Test-VenvReady {
  if (-not (Test-Path $VenvPy)) { return $false }
  if (-not (Test-Path (Join-Path $VenvDir 'pyvenv.cfg'))) { return $false }
  try { & $VenvPy -c 'import sys' 2>$null | Out-Null } catch { return $false }
  return ($LASTEXITCODE -eq 0)
}

# Remove any half-built venv so we always recreate from a clean slate.
function Remove-Venv {
  if (Test-Path $VenvDir) {
    try { Remove-Item -Path $VenvDir -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  }
}

function Try-Venv {
  param([string]$Exe, [string[]]$Pre = @())
  Remove-Venv
  try { & $Exe @Pre -m venv $VenvDir 2>$null | Out-Null } catch { }
  return (Test-VenvReady)
}

function New-Venv {
  if (Test-VenvReady) { return $true }
  Remove-Venv
  if (Try-Venv 'py' @('-3')) { return $true }
  if (Try-Venv 'python' @())  { return $true }
  return $false
}

# Run a native command (python/pip) capturing combined stdout+stderr WITHOUT
# letting a stderr line become a terminating error. In Windows PowerShell 5.1,
# `nativecmd 2>&1` under $ErrorActionPreference='Stop' turns ANY stderr output
# (e.g. pip's harmless "Cache entry deserialization failed" warning) into a fatal
# NativeCommandError that aborts the script. We localise EAP to 'Continue' here
# and rely on $LASTEXITCODE (preserved after the call) to judge success/failure.
function Invoke-Native {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$CmdArgs = @())
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = (& $Exe @CmdArgs 2>&1 | Out-String) }
  finally { $ErrorActionPreference = $prev }
  return $out
}

# Write each non-empty line of captured native output to the log.
function Write-NativeOutput {
  param([string]$Text)
  foreach ($ln in ($Text -split "`r?`n")) { if ($ln.Trim()) { Write-Log $ln.TrimEnd() } }
}

# ── Pre-flight ──────────────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Token)) {
  Write-Host 'ERROR: MILES_AGENT_TOKEN is not set. Copy the full command from the portal.' -ForegroundColor Red
  exit 2
}
if ([string]::IsNullOrWhiteSpace($AgentUrl)) {
  Write-Host 'ERROR: MILES_AGENT_URL is not set. Copy the full command from the portal.' -ForegroundColor Red
  exit 2
}

# ── Auto-elevate ────────────────────────────────────────────────────────────
# The agent must run as LocalSystem to enforce device lock, which requires admin
# to install. If we're not elevated, relaunch this installer through UAC with the
# same settings, then exit this (non-admin) instance.
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $IsAdmin) {
  Write-Host 'Administrator rights are required to enable device-lock enforcement.' -ForegroundColor Yellow
  Write-Host 'Please approve the Windows security (UAC) prompt that appears...' -ForegroundColor Yellow
  $installerUrl = $AgentUrl -replace 'laptop_agent\.py$', 'install.ps1'
  if ($installerUrl -eq $AgentUrl) { $installerUrl = $AgentUrl -replace '[^/]+$', 'install.ps1' }
  $inner = "`$env:MILES_AGENT_TOKEN='$Token'; `$env:MILES_AGENT_URL='$AgentUrl';"
  if (-not [string]::IsNullOrWhiteSpace($TargetName)) { $inner += " `$env:MILES_ASSET_HOSTNAME='$TargetName';" }
  if (-not [string]::IsNullOrWhiteSpace($ApiBase))    { $inner += " `$env:MILES_AGENT_API_BASE='$ApiBase';" }
  $inner += " irm '$installerUrl' | iex"
  $b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $b64)
  } catch {
    Write-Host 'ERROR: Administrator approval was declined. Re-run the command and approve the UAC prompt.' -ForegroundColor Red
    exit 3
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Log '=== Miles agent installation started ==='
Write-Log ("Install folder: " + $InstallDir)

# ── 1. Download the agent ───────────────────────────────────────────────────
Write-Log 'Downloading the agent...'
try {
  Invoke-WebRequest -Uri $AgentUrl -OutFile $AgentScript -UseBasicParsing
} catch {
  Stop-Install ("Could not download the agent from " + $AgentUrl + " — " + $_.Exception.Message)
}
if (-not (Test-Path $AgentScript) -or (Get-Item $AgentScript).Length -lt 1000) {
  Stop-Install 'The agent file did not download correctly (missing or too small). Check the internet connection and try again.'
}
Write-Log 'Agent downloaded.' 'OK'

# ── 2. Python environment (install Python if missing) ───────────────────────
Write-Log 'Preparing the Python environment...'
if (-not (New-Venv)) {
  Write-Log 'Python was not found — installing the official Python (one-time, no admin needed). This can take a couple of minutes...' 'WARN'
  $pySetup = Join-Path $env:TEMP 'miles-python-setup.exe'
  try {
    Invoke-WebRequest -Uri $PyUrl -OutFile $pySetup -UseBasicParsing
    Start-Process -FilePath $pySetup -ArgumentList '/quiet','InstallAllUsers=0','PrependPath=1','Include_launcher=1' -Wait
  } catch {
    Stop-Install ("Could not download or install Python automatically — " + $_.Exception.Message + ". Install Python 3 from https://www.python.org/downloads/ (tick 'Add python.exe to PATH'), then run this installer again.")
  }
  $fallbackPy = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
  if (Test-Path $fallbackPy) { Remove-Venv; Invoke-Native $fallbackPy @('-m','venv',$VenvDir) | Out-Null }
  if (-not (Test-VenvReady)) { New-Venv | Out-Null }
}
if (-not (Test-VenvReady)) {
  Stop-Install 'The Python environment could not be created. Install Python 3 from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this installer again.'
}
Write-Log 'Python environment ready.' 'OK'

# ── 3. Dependencies ─────────────────────────────────────────────────────────
Write-Log 'Installing agent dependencies...'
# Make sure pip exists inside the venv (some minimal Pythons ship without it),
# then install with a few retries. pip/python write progress AND warnings to
# stderr, so every call goes through Invoke-Native to avoid a stderr warning
# aborting the script; we log the real output for diagnosability.
Write-NativeOutput (Invoke-Native $VenvPy @('-m','ensurepip','--upgrade'))
$pipOk = $false
foreach ($attempt in 1..3) {
  $pipOut = Invoke-Native $VenvPy @('-m','pip','install','--disable-pip-version-check','requests','websockets','mss','Pillow','pynput')
  $pipCode = $LASTEXITCODE
  Write-NativeOutput $pipOut
  if ($pipCode -eq 0) { $pipOk = $true; break }
  Write-Log ("pip attempt $attempt failed (exit $pipCode); retrying...") 'WARN'
  Start-Sleep -Seconds 3
}
if (-not $pipOk) {
  Stop-Install 'Could not install the Python dependencies (pip failed). Check the internet connection (or proxy/SSL) and try again — see the pip output above in this log.'
}
Write-Log 'Dependencies installed.' 'OK'

# ── 4. Save the agent key ───────────────────────────────────────────────────
# Persist at MACHINE scope so the LocalSystem service can read the token/url/api
# (a User-scope var is invisible to SYSTEM). We also set the current process env
# so register/sync below work in this same elevated session.
[Environment]::SetEnvironmentVariable('MILES_AGENT_TOKEN', $Token, 'Machine')
$env:MILES_AGENT_TOKEN = $Token
if (-not [string]::IsNullOrWhiteSpace($ApiBase)) {
  [Environment]::SetEnvironmentVariable('MILES_AGENT_API_BASE', $ApiBase, 'Machine')
  $env:MILES_AGENT_API_BASE = $ApiBase
}
# Persist the agent download URL so silent self-update works after install.
# (Without MILES_AGENT_URL the update check falls back to a 404 path and the
#  device never upgrades.)
if (-not [string]::IsNullOrWhiteSpace($AgentUrl)) {
  [Environment]::SetEnvironmentVariable('MILES_AGENT_URL', $AgentUrl, 'Machine')
  $env:MILES_AGENT_URL = $AgentUrl
}
Write-Log 'Agent key saved.' 'OK'

# ── 5. Register (the agent prints JSON; we confirm success in the output) ────
Write-Log 'Registering this device with the portal...'
$regOut = Invoke-Native $VenvPy @($AgentScript, 'register')
if ($regOut -notmatch '"success"\s*:\s*true') {
  Stop-Install ("Device registration failed: " + ($regOut.Trim()))
}
Write-Log 'Device registered.' 'OK'

# ── 6. First sync (non-fatal — the service retries) ─────────────────────────
Write-Log 'Sending the first system sync...'
$syncOut = Invoke-Native $VenvPy @($AgentScript, 'sync')
if ($syncOut -match '"success"\s*:\s*true') {
  Write-Log 'Device synced.' 'OK'
} else {
  Write-Log ('First sync did not complete cleanly; the background service will retry. ' + $syncOut.Trim()) 'WARN'
}

# ── 7. Background service (auto-start at logon) ─────────────────────────────
Write-Log 'Installing the background service (auto-start at logon)...'
$svcOut  = Invoke-Native $VenvPy @($AgentScript, 'install-service')
$svcCode = $LASTEXITCODE
Write-NativeOutput $svcOut
if ($svcCode -ne 0) {
  Stop-Install 'The background service could not be installed.'
}
Write-Log 'Background service installed.' 'OK'

# ── 8. Rename the computer (skip when it already matches) ───────────────────
if (-not [string]::IsNullOrWhiteSpace($TargetName)) {
  $current = $env:COMPUTERNAME
  if ($current -ieq $TargetName) {
    Write-Log ("Computer name already matches '" + $TargetName + "'. No rename needed.") 'OK'
  } else {
    try {
      Rename-Computer -NewName $TargetName -Force -ErrorAction Stop
      Write-Log ("Computer renamed from '" + $current + "' to '" + $TargetName + "'. The new name takes effect after the next restart.") 'OK'
    } catch {
      Write-Log ("Could not rename the computer to '" + $TargetName + "' — " + $_.Exception.Message) 'WARN'
      Write-Log 'Renaming usually needs administrator rights. You can do it later in Settings > System > About > Rename this PC, or from an elevated PowerShell. The agent is fully installed regardless.' 'WARN'
    }
  }
}

Write-Log '=== Installation completed successfully ===' 'OK'
Write-Log ("Full log: " + $LogFile) 'OK'
exit 0
