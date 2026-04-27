# Launcher invoked by Desktop/Start Menu shortcut + HKCU\Run auto-start.
# Resolves install dir from its own location, sets PATH, optionally pulls latest,
# then runs `pnpm dev:bridge` which keeps the Electron tray app alive.

$ScriptPath = $MyInvocation.MyCommand.Path
$ScriptDir = Split-Path -Parent $ScriptPath
$InstallDir = Split-Path -Parent $ScriptDir

$RepoFolder = Join-Path $InstallDir "mote-capture"
$NodeMarker = Join-Path $InstallDir "node-marker.txt"
$NpmGlobalDir = Join-Path $InstallDir "npm-global"
$PnpmCmd = Join-Path $NpmGlobalDir "pnpm.cmd"
$GitExe = Join-Path $InstallDir "git\cmd\git.exe"
$RuntimeLog = Join-Path $InstallDir "runtime.log"

function Write-RuntimeLog {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $RuntimeLog -Value "[$ts] $Message" -Encoding UTF8
}

Write-RuntimeLog "=== Bridge launcher start ==="

# Resolve Node binary directory
if ((Test-Path $NodeMarker) -and (Get-Content $NodeMarker -Raw).Trim() -match "^USE_SYSTEM:(.+)$") {
    $NodeBinDir = $Matches[1].Trim()
} else {
    $NodeBinDir = Join-Path $InstallDir "node"
}

$env:PATH = "$NodeBinDir;$NpmGlobalDir;$env:PATH"
$env:NPM_CONFIG_PREFIX = $NpmGlobalDir
$env:PNPM_HOME = Join-Path $InstallDir "pnpm-store"
$env:MOTE_CAPTURE_INSTALL_MODE = "true"

if (-not (Test-Path $RepoFolder)) {
    Write-RuntimeLog "FATAL: Repo folder tidak ditemukan: $RepoFolder"
    exit 1
}
if (-not (Test-Path $PnpmCmd)) {
    Write-RuntimeLog "FATAL: pnpm.cmd tidak ditemukan: $PnpmCmd"
    exit 1
}

Push-Location $RepoFolder
try {
    # Auto-update — silent fail if no internet.
    if (Test-Path $GitExe) {
        Write-RuntimeLog "Checking for updates..."
        try {
            & $GitExe fetch origin main 2>&1 | Out-Null
            $local  = & $GitExe rev-parse HEAD 2>$null
            $remote = & $GitExe rev-parse origin/main 2>$null
            if ($LASTEXITCODE -eq 0 -and $local -ne $remote) {
                Write-RuntimeLog "Update tersedia ($local -> $remote), reset --hard origin/main..."
                & $GitExe reset --hard origin/main 2>&1 | Out-Null
                # Refresh deps + rebuild after pull
                Write-RuntimeLog "Re-running pnpm install + build setelah update..."
                & $PnpmCmd install --prefer-offline 2>&1 | Out-Null
                & $PnpmCmd --filter bridge build 2>&1 | Out-Null
            } else {
                Write-RuntimeLog "Sudah up-to-date ($local)"
            }
        } catch {
            Write-RuntimeLog "WARN: update check gagal: $_"
        }
    }

    Write-RuntimeLog "Starting Mote Capture Bridge (pnpm dev:bridge)..."
    & $PnpmCmd dev:bridge
    Write-RuntimeLog "Bridge exited with code $LASTEXITCODE"
}
finally {
    Pop-Location
}

exit 0
