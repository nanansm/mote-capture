# Register the bridge to launch at user login (HKCU\...\Run, no admin needed).
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$LaunchScript = Join-Path $InstallDir "installer-scripts\launch-bridge.ps1"
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RegName = "MoteCaptureBridge"

if (-not (Test-Path $LaunchScript)) {
    throw "Launch script tidak ditemukan: $LaunchScript"
}

$RunCommand = "powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$LaunchScript`""

if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
}

Set-ItemProperty -Path $RegPath -Name $RegName -Value $RunCommand -Type String

Write-Host "✓ Auto-start registered:"
Write-Host "  HKCU\Software\Microsoft\Windows\CurrentVersion\Run\$RegName"
Write-Host "  → $RunCommand"

exit 0
