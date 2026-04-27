# Pre-uninstall cleanup. Inno Setup's [UninstallRun] invokes this BEFORE removing $InstallDir.
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Uninstall cleanup running..."

# 1) Remove auto-start registry entry
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "MoteCaptureBridge" -ErrorAction SilentlyContinue
Write-Host "  - Registry HKCU\Run\MoteCaptureBridge removed"

# 2) Kill any running processes from inside the install dir (electron, node, pnpm helpers)
$installDirLower = $InstallDir.ToLower()
Get-Process | ForEach-Object {
    try {
        $p = $_
        if ($p.Path -and $p.Path.ToLower().StartsWith($installDirLower)) {
            Write-Host "  - Killing PID $($p.Id) ($($p.ProcessName))"
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    } catch { }
}

# 3) Delete shortcuts
$Desktop = [Environment]::GetFolderPath("Desktop")
$DesktopLink = Join-Path $Desktop "Mote Capture Bridge.lnk"
if (Test-Path $DesktopLink) {
    Remove-Item -Force $DesktopLink
    Write-Host "  - Desktop shortcut removed"
}

$StartMenu = [Environment]::GetFolderPath("Programs")
$StartMenuFolder = Join-Path $StartMenu "Mote Capture Bridge"
if (Test-Path $StartMenuFolder) {
    Remove-Item -Recurse -Force $StartMenuFolder
    Write-Host "  - Start Menu folder removed"
}

# Inno Setup uninstaller will remove $InstallDir itself after this script.
Write-Host "[OK] Cleanup complete"
exit 0
