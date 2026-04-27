# Detect existing Node.js (>= v18) or download portable Node.js v20 LTS.
# Writes a marker file at $InstallDir\node-marker.txt:
#   USE_LOCAL                  -> use $InstallDir\node\
#   USE_SYSTEM:<path-to-bin>   -> use system Node located at <path>
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$NodeVersion = "20.18.1"
$NodeArch = "x64"
$NodeFolder = Join-Path $InstallDir "node"
$NodeMarker = Join-Path $InstallDir "node-marker.txt"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-$NodeArch.zip"
$NodeZip = Join-Path $env:TEMP "mote-nodejs.zip"

function Test-NodeUsable {
    param([string]$NodeExe)
    if (-not (Test-Path $NodeExe)) { return $false }
    try {
        $version = & $NodeExe --version 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        if ($version -match "v(\d+)\.") {
            return [int]$Matches[1] -ge 18
        }
    } catch { }
    return $false
}

# 1) Already installed locally from a previous run?
$localNodeExe = Join-Path $NodeFolder "node.exe"
if (Test-NodeUsable -NodeExe $localNodeExe) {
    Write-Host "Local Node.js sudah terinstall: $(& $localNodeExe --version)"
    "USE_LOCAL" | Out-File -FilePath $NodeMarker -Encoding ASCII
    exit 0
}

# 2) System Node.js available and recent enough?
$systemNode = Get-Command node -ErrorAction SilentlyContinue
if ($systemNode) {
    $systemNodeExe = $systemNode.Source
    if (Test-NodeUsable -NodeExe $systemNodeExe) {
        $systemVersion = & $systemNodeExe --version
        Write-Host "System Node.js terdeteksi: $systemVersion ($systemNodeExe)"
        Write-Host "Skip install - pakai system Node.js."
        $systemNodeDir = Split-Path $systemNodeExe -Parent
        "USE_SYSTEM:$systemNodeDir" | Out-File -FilePath $NodeMarker -Encoding ASCII
        exit 0
    } else {
        Write-Host "System Node.js terdeteksi tapi versi terlalu lama. Install Node.js v$NodeVersion lokal..."
    }
} else {
    Write-Host "System Node.js tidak terdeteksi. Install Node.js v$NodeVersion lokal..."
}

# 3) Download & extract portable Node.js
Write-Host "Mengunduh Node.js v$NodeVersion dari $NodeUrl..."
if (Test-Path $NodeZip) { Remove-Item -Force $NodeZip }
try {
    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip -UseBasicParsing
} catch {
    throw "Download Node.js gagal: $_"
}

Write-Host "Extracting Node.js ($([math]::Round((Get-Item $NodeZip).Length / 1MB, 1)) MB)..."
$extractRoot = Join-Path $env:TEMP "mote-node-extract"
if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
Expand-Archive -Path $NodeZip -DestinationPath $extractRoot -Force

$extractedFolder = Join-Path $extractRoot "node-v$NodeVersion-win-$NodeArch"
if (-not (Test-Path $extractedFolder)) {
    throw "Ekstraksi gagal: folder $extractedFolder tidak ditemukan"
}

if (Test-Path $NodeFolder) { Remove-Item -Recurse -Force $NodeFolder }
Move-Item -Path $extractedFolder -Destination $NodeFolder

Remove-Item -Force $NodeZip
Remove-Item -Recurse -Force $extractRoot -ErrorAction SilentlyContinue

if (-not (Test-Path $localNodeExe)) {
    throw "Node.js installation failed: node.exe tidak ditemukan di $localNodeExe"
}

$installedVersion = & $localNodeExe --version
Write-Host "[OK] Node.js installed: $installedVersion @ $NodeFolder"
"USE_LOCAL" | Out-File -FilePath $NodeMarker -Encoding ASCII

exit 0
