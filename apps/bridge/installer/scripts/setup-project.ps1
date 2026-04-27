# Run pnpm install + generate icons + pre-build bridge so first launch is fast.
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$RepoFolder = Join-Path $InstallDir "mote-capture"
$NodeMarker = Join-Path $InstallDir "node-marker.txt"
$NpmGlobalDir = Join-Path $InstallDir "npm-global"
$PnpmCmd = Join-Path $NpmGlobalDir "pnpm.cmd"

if (-not (Test-Path $RepoFolder)) {
    throw "Repo folder tidak ditemukan: $RepoFolder"
}
if (-not (Test-Path $PnpmCmd)) {
    throw "pnpm.cmd tidak ditemukan: $PnpmCmd"
}

# Resolve Node folder
if ((Get-Content $NodeMarker -Raw).Trim() -match "^USE_SYSTEM:(.+)$") {
    $NodeBinDir = $Matches[1].Trim()
} else {
    $NodeBinDir = Join-Path $InstallDir "node"
}

# Session-scoped PATH so child processes find node + pnpm
$env:PATH = "$NodeBinDir;$NpmGlobalDir;$env:PATH"
$env:NPM_CONFIG_PREFIX = $NpmGlobalDir
# Pin pnpm store location inside install dir for clean uninstall
$env:PNPM_HOME = Join-Path $InstallDir "pnpm-store"

Push-Location $RepoFolder
try {
    Write-Host "Installing dependencies (pnpm install) - biasanya 5-10 menit..."
    & $PnpmCmd install --prefer-offline
    if ($LASTEXITCODE -ne 0) {
        Write-Host "pnpm install --prefer-offline gagal, retry tanpa offline..."
        & $PnpmCmd install
        if ($LASTEXITCODE -ne 0) { throw "pnpm install gagal (exit $LASTEXITCODE)" }
    }

    Write-Host "Generating tray icons..."
    $iconScript = Join-Path $RepoFolder "apps\bridge\assets\generate-icons.cjs"
    if (Test-Path $iconScript) {
        & node $iconScript
        if ($LASTEXITCODE -ne 0) {
            Write-Host "WARN: generate-icons gagal, continue (tray icons akan fallback)"
        }
    } else {
        Write-Host "WARN: $iconScript tidak ditemukan, skip"
    }

    Write-Host "Pre-building bridge (vite + esbuild)..."
    & $PnpmCmd --filter bridge build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARN: pre-build gagal, akan re-build saat dev:bridge dijalankan"
    }

    Write-Host "[OK] Project setup complete"
}
finally {
    Pop-Location
}

exit 0
