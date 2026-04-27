; Mote Capture Bridge - All-in-One Windows Installer
; Compiles with Inno Setup 6 (https://jrsoftware.org/isinfo.php)
;
; The compiled .exe is small (~5 MB) - it bundles only the orchestration
; PowerShell scripts. All real assets (Node.js, Git, the app code) are
; downloaded at install-time by the scripts.

#define MyAppName "Mote Capture Bridge"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Mote Kreatif"
#define MyAppURL "https://capture.motekreatif.com"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-1234567890AB}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\MoteCapture
DefaultGroupName={#MyAppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
DisableFinishedPage=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=
OutputDir=output
OutputBaseFilename=MoteCaptureBridge-Setup-{#MyAppVersion}
SetupIconFile=assets\installer-icon.ico
WizardImageFile=assets\installer-banner.bmp
WizardSmallImageFile=assets\installer-small.bmp
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no
LanguageDetectionMethod=none
UninstallDisplayIcon={app}\installer-icon.ico
UninstallDisplayName={#MyAppName}
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
; Default.isl is English; we override the visible strings via [Messages] in Bahasa Indonesia.
Name: "id"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "scripts\*"; DestDir: "{app}\installer-scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "assets\installer-icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; Note: runhidden flag deliberately omitted so PowerShell errors are visible
; to the user during install. The PS scripts already redirect their own output.
Filename: "powershell.exe"; \
    Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\installer-scripts\bootstrap.ps1"" -InstallDir ""{app}"""; \
    StatusMsg: "Mengunduh & menginstall Node.js, Git, dan kode aplikasi (10-20 menit, mohon tunggu)..."; \
    Flags: waituntilterminated

[Icons]
; Per-user shortcut paths (no admin needed). Real shortcuts are also created
; by create-shortcuts.ps1 so they survive uninstall / partial reinstall;
; the entries below are Inno Setup bookkeeping copies pointing to the same target.
Name: "{userdesktop}\{#MyAppName}"; \
    Filename: "powershell.exe"; \
    Parameters: "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File ""{app}\installer-scripts\launch-bridge.ps1"""; \
    IconFilename: "{app}\installer-icon.ico"; \
    WorkingDir: "{app}"; \
    Comment: "Mote Capture Bridge"

Name: "{userprograms}\{#MyAppName}\{#MyAppName}"; \
    Filename: "powershell.exe"; \
    Parameters: "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File ""{app}\installer-scripts\launch-bridge.ps1"""; \
    IconFilename: "{app}\installer-icon.ico"; \
    WorkingDir: "{app}"; \
    Comment: "Mote Capture Bridge"

Name: "{userprograms}\{#MyAppName}\Uninstall {#MyAppName}"; \
    Filename: "{uninstallexe}"

[Registry]
; Auto-start on Windows login (HKCU - no admin required)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "MoteCaptureBridge"; \
    ValueData: """powershell.exe"" -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File ""{app}\installer-scripts\launch-bridge.ps1"""; \
    Flags: uninsdeletevalue

[UninstallRun]
Filename: "powershell.exe"; \
    Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\installer-scripts\uninstall-cleanup.ps1"" -InstallDir ""{app}"""; \
    Flags: runhidden; \
    RunOnceId: "CleanupMoteCaptureBridge"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\node"
Type: filesandordirs; Name: "{app}\git"
Type: filesandordirs; Name: "{app}\npm-global"
Type: filesandordirs; Name: "{app}\pnpm-store"
Type: filesandordirs; Name: "{app}\mote-capture"
Type: filesandordirs; Name: "{app}\installer-scripts"
Type: files;          Name: "{app}\install.log"
Type: files;          Name: "{app}\runtime.log"
Type: files;          Name: "{app}\node-marker.txt"
Type: files;          Name: "{app}\installer-icon.ico"

[Messages]
; Bahasa Indonesia overrides for the visible wizard strings.
SetupAppTitle=Setup Mote Capture Bridge
SetupWindowTitle=Setup - %1
WelcomeLabel1=Selamat Datang di Setup [name]
WelcomeLabel2=Setup ini akan menginstall [name/ver] di komputer Anda.%n%nProses ini membutuhkan koneksi internet aktif dan akan memakan waktu 10-20 menit tergantung kecepatan internet.%n%nDirekomendasikan untuk menutup semua aplikasi lain sebelum melanjutkan.
ClickNext=Klik Lanjut untuk melanjutkan, atau Batal untuk keluar dari Setup.
ButtonNext=&Lanjut >
ButtonBack=< &Kembali
ButtonInstall=&Install
ButtonCancel=Batal
ButtonFinish=&Selesai
ButtonYes=&Ya
ButtonNo=&Tidak
ButtonOK=OK
ReadyMemoUserInfo=Informasi user:
ReadyMemoDir=Folder tujuan:
ReadyLabel1=Setup siap untuk mulai menginstall [name] di komputer Anda.
ReadyLabel2a=Klik Install untuk memulai instalasi, atau Kembali untuk meninjau kembali pilihan Anda.
StatusInstallProgress=Sedang menginstall, mohon tunggu...
SetupAppRunningError=Setup mendeteksi [name] sedang berjalan.%n%nMohon tutup semua instance, lalu klik OK untuk melanjutkan, atau Batal untuk keluar.
FinishedHeadingLabel=Selesai Menginstall [name]
FinishedLabelNoIcons=Setup telah selesai menginstall [name] di komputer Anda.
FinishedLabel=Setup telah selesai menginstall [name] di komputer Anda. Aplikasi dapat dijalankan dari shortcut Desktop atau Start Menu yang sudah dibuat.%n%nBridge akan otomatis berjalan setiap kali Windows menyala.
ClickFinish=Klik Selesai untuk keluar dari Setup.
RunEntryExec=Jalankan %1
ExitSetupTitle=Keluar dari Setup
ExitSetupMessage=Setup belum selesai. Apakah Anda yakin ingin keluar?
AboutSetupNote=

[Code]
function InitializeSetup(): Boolean;
var
  FreeMB, TotalMB: Cardinal;
begin
  Result := True;

  // Disk space sanity check on the install drive (need ~2 GB free).
  if GetSpaceOnDisk(ExpandConstant('{localappdata}'), True, FreeMB, TotalMB) then
  begin
    if FreeMB < 2048 then
    begin
      MsgBox('Ruang disk tidak cukup. Setup memerlukan minimal 2 GB free di drive ' +
             ExtractFileDrive(ExpandConstant('{localappdata}')) +
             ' (tersedia: ' + IntToStr(FreeMB) + ' MB).',
             mbError, MB_OK);
      Result := False;
      exit;
    end;
  end;
end;
