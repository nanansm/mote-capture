# Clone (or update) the mote-capture repo into $InstallDir\mote-capture.
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$GitExe = Join-Path $InstallDir "git\cmd\git.exe"
$RepoUrl = "https://github.com/nanansm/mote-capture.git"
$RepoFolder = Join-Path $InstallDir "mote-capture"

if (-not (Test-Path $GitExe)) {
    throw "Git tidak terinstall ($GitExe)"
}

if ((Test-Path $RepoFolder) -and (Test-Path (Join-Path $RepoFolder ".git"))) {
    Write-Host "Repo sudah ada — pull latest dari main..."
    Push-Location $RepoFolder
    try {
        & $GitExe fetch origin main
        if ($LASTEXITCODE -ne 0) { throw "git fetch gagal" }
        & $GitExe reset --hard origin/main
        if ($LASTEXITCODE -ne 0) { throw "git reset gagal" }
    } finally {
        Pop-Location
    }
} else {
    if (Test-Path $RepoFolder) {
        Write-Host "Folder $RepoFolder ada tapi bukan git repo — hapus dan clone ulang"
        Remove-Item -Recurse -Force $RepoFolder
    }
    Write-Host "Cloning $RepoUrl ke $RepoFolder..."
    & $GitExe clone --depth 1 --branch main $RepoUrl $RepoFolder
    if ($LASTEXITCODE -ne 0) {
        throw "git clone gagal (exit $LASTEXITCODE)"
    }
}

if (-not (Test-Path (Join-Path $RepoFolder ".git"))) {
    throw "Clone gagal: folder .git tidak ditemukan di $RepoFolder"
}

$head = & $GitExe -C $RepoFolder rev-parse --short HEAD
Write-Host "✓ Repository ready @ $RepoFolder (HEAD=$head)"

exit 0
