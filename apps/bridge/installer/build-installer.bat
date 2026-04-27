@echo off
REM Build the Mote Capture Bridge installer on Windows.
REM Requires: Node.js (for asset generation) + Inno Setup 6 (https://jrsoftware.org/isdl.php).

setlocal
cd /d "%~dp0"

echo === Mote Capture Bridge - Building Installer ===
echo.

REM 1) Regenerate wizard assets (icon.ico, banner.bmp, small.bmp)
echo [1/2] Generating installer assets...
node "assets\generate-installer-assets.cjs"
if errorlevel 1 (
    echo.
    echo X Asset generation failed. Have you run "pnpm install" at the repo root?
    exit /b 1
)
echo.

REM 2) Compile with Inno Setup
echo [2/2] Compiling installer with Inno Setup...

set "ISCC_EXE="
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set "ISCC_EXE=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not defined ISCC_EXE if exist "C:\Program Files\Inno Setup 6\ISCC.exe" set "ISCC_EXE=C:\Program Files\Inno Setup 6\ISCC.exe"
if not defined ISCC_EXE (
    where ISCC.exe >nul 2>&1
    if not errorlevel 1 set "ISCC_EXE=ISCC.exe"
)

if not defined ISCC_EXE (
    echo X Inno Setup tidak ditemukan.
    echo   Download dari https://jrsoftware.org/isdl.php
    exit /b 1
)

echo Using ISCC: %ISCC_EXE%
"%ISCC_EXE%" "MoteCaptureBridge.iss"
if errorlevel 1 (
    echo X Inno Setup compile failed
    exit /b 1
)

echo.
echo +-------------------------------------------------------------+
echo ^| Installer built successfully:                               ^|
echo ^|   output\MoteCaptureBridge-Setup-0.1.0.exe                  ^|
echo +-------------------------------------------------------------+
endlocal
