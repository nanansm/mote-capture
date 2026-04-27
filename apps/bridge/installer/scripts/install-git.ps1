# Install MinGit (portable Git for Windows, ~50 MB, no shell/GUI).
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$GitVersion = "2.47.0"
$GitFolder = Join-Path $InstallDir "git"
$GitExe = Join-Path $GitFolder "cmd\git.exe"
$GitUrl = "https://github.com/git-for-windows/git/releases/download/v$GitVersion.windows.1/MinGit-$GitVersion-64-bit.zip"
$GitZip = Join-Path $env:TEMP "mote-mingit.zip"

if (Test-Path $GitExe) {
    $existing = & $GitExe --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Git sudah terinstall di $GitFolder ($existing)"
        exit 0
    }
}

Write-Host "Mengunduh MinGit v$GitVersion dari GitHub releases..."
if (Test-Path $GitZip) { Remove-Item -Force $GitZip }
try {
    Invoke-WebRequest -Uri $GitUrl -OutFile $GitZip -UseBasicParsing
} catch {
    throw "Download Git gagal: $_"
}

Write-Host "Extracting Git ($([math]::Round((Get-Item $GitZip).Length / 1MB, 1)) MB)..."
if (Test-Path $GitFolder) { Remove-Item -Recurse -Force $GitFolder }
New-Item -ItemType Directory -Force -Path $GitFolder | Out-Null
Expand-Archive -Path $GitZip -DestinationPath $GitFolder -Force

Remove-Item -Force $GitZip

if (-not (Test-Path $GitExe)) {
    throw "Git installation failed: git.exe tidak ditemukan di $GitExe"
}

$installedVersion = & $GitExe --version
Write-Host "[OK] Git installed: $installedVersion @ $GitFolder"

# Disable Git's safe.directory check inside our install - single-user box.
& $GitExe config --global --add safe.directory "*" 2>$null | Out-Null

exit 0
