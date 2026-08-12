$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
  throw "Open PowerShell with Run as administrator, then run this repair command again."
}

$d = Join-Path $env:ProgramData "MilesAgent"
$tokenFile = Join-Path $d "agent.token"
$token = if (Test-Path $tokenFile) {
  (Get-Content $tokenFile -Raw).Trim()
} else {
  [Environment]::GetEnvironmentVariable("MILES_AGENT_TOKEN", "Machine")
}
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "This is not a complete installation: no saved Windows agent key was found. Use Generate Key, then run the Windows install command instead of Repair."
}

$py = Join-Path $d "venv\Scripts\python.exe"
$script = Join-Path $d "laptop_agent.py"
if (-not (Test-Path $py)) {
  throw "Existing MilesAgent Python service was not found under $d."
}

New-Item -ItemType Directory -Force -Path $d | Out-Null
$tmp = Join-Path $env:TEMP "miles-agent-repair.py"
$agentUrl = "https://it.assets.mileseducation.org/agent/laptop_agent.py"
Invoke-WebRequest -Uri $agentUrl -OutFile $tmp -UseBasicParsing `
  -Headers @{ "User-Agent" = "miles-agent-bootstrap/Windows" }
if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 1000) {
  throw "The updated agent download was empty or incomplete."
}

Move-Item -Force $tmp $script
Set-Content -Path $tokenFile -Value $token -NoNewline
$env:MILES_AGENT_TOKEN = $token
& $py $script install-service
if ($LASTEXITCODE -ne 0) {
  throw "MilesAgent SYSTEM service repair failed with exit code $LASTEXITCODE."
}

Write-Host "MilesAgent repair completed successfully."