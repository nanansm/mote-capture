# Install pnpm globally into $InstallDir\npm-global so it doesn't pollute %APPDATA%.
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$NodeMarker = Join-Path $InstallDir "node-marker.txt"
$NpmGlobalDir = Join-Path $InstallDir "npm-global"
$PnpmCmd = Join-Path $NpmGlobalDir "pnpm.cmd"

if (-not (Test-Path $NodeMarker)) {
    throw "Node marker file tidak ditemukan ($NodeMarker) — install-nodejs.ps1 belum dijalankan?"
}

$marker = (Get-Content $NodeMarker -Raw).Trim()
if ($marker -match "^USE_SYSTEM:(.+)$") {
    $NpmCmd = Join-Path $Matches[1].Trim() "npm.cmd"
} else {
    $NpmCmd = Join-Path $InstallDir "node\npm.cmd"
}

if (-not (Test-Path $NpmCmd)) {
    throw "npm.cmd tidak ditemukan di $NpmCmd"
}

# Quick exit if pnpm already installed
if (Test-Path $PnpmCmd) {
    $existing = & $PnpmCmd --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ pnpm sudah terinstall: $existing"
        exit 0
    }
}

Write-Host "Installing pnpm via $NpmCmd ke $NpmGlobalDir..."
New-Item -ItemType Directory -Force -Path $NpmGlobalDir | Out-Null

# Force npm prefix to local dir for this invocation
$env:NPM_CONFIG_PREFIX = $NpmGlobalDir

& $NpmCmd install --global --prefix=$NpmGlobalDir pnpm@9
if ($LASTEXITCODE -ne 0) {
    throw "npm install -g pnpm failed (exit $LASTEXITCODE)"
}

if (-not (Test-Path $PnpmCmd)) {
    throw "pnpm installation failed: pnpm.cmd tidak ditemukan di $PnpmCmd"
}

$pnpmVersion = & $PnpmCmd --version
Write-Host "✓ pnpm installed: $pnpmVersion @ $PnpmCmd"

exit 0
