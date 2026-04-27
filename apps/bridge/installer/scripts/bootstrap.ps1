# Master installer orchestrator. Called by Inno Setup [Run] section.
# Runs in user privilege context - no admin needed.
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Speeds up Invoke-WebRequest dramatically
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile = Join-Path $InstallDir "install.log"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$timestamp] [$Level] $Message"
    Add-Content -Path $LogFile -Value $entry -Encoding UTF8
    Write-Host $entry
}

function Show-Step {
    param([int]$Percent, [string]$Message)
    Write-Progress -Activity "Mote Capture Bridge Setup" -Status $Message -PercentComplete $Percent
    Write-Log "[$Percent%] $Message"
}

function Invoke-SubScript {
    param([string]$ScriptName, [string]$FailureMessage)
    $scriptPath = Join-Path $ScriptDir $ScriptName
    Write-Log "Running $ScriptName..."
    & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $scriptPath -InstallDir $InstallDir 2>&1 |
        ForEach-Object { Write-Log "  $_" }
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit $LASTEXITCODE) - see $LogFile"
    }
}

try {
    Write-Log "=== Starting Mote Capture Bridge Installation ==="
    Write-Log "Install Directory: $InstallDir"
    Write-Log "PowerShell Version: $($PSVersionTable.PSVersion)"
    Write-Log "User: $env:USERNAME"

    Show-Step -Percent 5  -Message "Memeriksa Node.js..."
    Invoke-SubScript -ScriptName "install-nodejs.ps1" -FailureMessage "Node.js installation failed"

    Show-Step -Percent 25 -Message "Menginstall Git portable..."
    Invoke-SubScript -ScriptName "install-git.ps1" -FailureMessage "Git installation failed"

    Show-Step -Percent 40 -Message "Menginstall pnpm..."
    Invoke-SubScript -ScriptName "install-pnpm.ps1" -FailureMessage "pnpm installation failed"

    Show-Step -Percent 50 -Message "Mengunduh kode aplikasi (git clone)..."
    Invoke-SubScript -ScriptName "clone-repo.ps1" -FailureMessage "Repository clone failed"

    Show-Step -Percent 65 -Message "Menyiapkan aplikasi (5-10 menit, mohon tunggu)..."
    Invoke-SubScript -ScriptName "setup-project.ps1" -FailureMessage "Project setup failed"

    Show-Step -Percent 90 -Message "Membuat shortcuts..."
    Invoke-SubScript -ScriptName "create-shortcuts.ps1" -FailureMessage "Shortcut creation failed"

    Show-Step -Percent 95 -Message "Mengaktifkan auto-start..."
    Invoke-SubScript -ScriptName "register-autostart.ps1" -FailureMessage "Auto-start registration failed"

    Show-Step -Percent 100 -Message "Selesai!"
    Write-Log "=== Installation Complete ==="
    Write-Progress -Activity "Mote Capture Bridge Setup" -Completed
    exit 0
}
catch {
    Write-Log "FATAL: $_" -Level "ERROR"
    Write-Log "Stack: $($_.ScriptStackTrace)" -Level "ERROR"
    Write-Progress -Activity "Mote Capture Bridge Setup" -Completed

    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            "Setup gagal:`n`n$_`n`nLog lengkap: $LogFile`n`nMohon kirim file log tersebut ke support.",
            "Mote Capture Bridge - Setup Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    } catch { }

    exit 1
}
