# Create Desktop + Start Menu shortcuts that launch the bridge via launch-bridge.ps1.
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$LaunchScript = Join-Path $InstallDir "installer-scripts\launch-bridge.ps1"
$IconFile = Join-Path $InstallDir "installer-icon.ico"

if (-not (Test-Path $LaunchScript)) {
    throw "Launch script tidak ditemukan: $LaunchScript"
}
if (-not (Test-Path $IconFile)) {
    Write-Host "WARN: icon $IconFile tidak ada, shortcut pakai icon default powershell"
    $IconFile = "powershell.exe,0"
}

$WshShell = New-Object -ComObject WScript.Shell
$ShortcutArgs = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$LaunchScript`""

# Desktop shortcut (current user)
$Desktop = [Environment]::GetFolderPath("Desktop")
$DesktopLink = Join-Path $Desktop "Mote Capture Bridge.lnk"
$Shortcut = $WshShell.CreateShortcut($DesktopLink)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = $ShortcutArgs
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.IconLocation = $IconFile
$Shortcut.Description = "Mote Capture Bridge"
$Shortcut.WindowStyle = 7   # Minimized
$Shortcut.Save()
Write-Host "[OK] Desktop shortcut: $DesktopLink"

# Start Menu shortcut
$StartMenu = [Environment]::GetFolderPath("Programs")
$StartMenuFolder = Join-Path $StartMenu "Mote Capture Bridge"
New-Item -ItemType Directory -Force -Path $StartMenuFolder | Out-Null

$StartMenuLink = Join-Path $StartMenuFolder "Mote Capture Bridge.lnk"
$Shortcut2 = $WshShell.CreateShortcut($StartMenuLink)
$Shortcut2.TargetPath = "powershell.exe"
$Shortcut2.Arguments = $ShortcutArgs
$Shortcut2.WorkingDirectory = $InstallDir
$Shortcut2.IconLocation = $IconFile
$Shortcut2.Description = "Mote Capture Bridge"
$Shortcut2.WindowStyle = 7
$Shortcut2.Save()
Write-Host "[OK] Start Menu shortcut: $StartMenuLink"

exit 0
