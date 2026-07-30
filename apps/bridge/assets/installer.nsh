; Custom NSIS install steps for Mote Capture Bridge.
; Included by electron-builder via `nsis.include` in electron-builder.yml.
; LogicLib (${If}/${FileExists}/...) is already available in electron-builder's
; NSIS context — do not re-include it here.

; URL the booth kiosk opens. Edit here if the cloud domain changes.
!define MOTE_KIOSK_URL "https://mote-capture.smnanan.workers.dev"

!macro customInstall
  ; --- 1. digiCamControl: install the bundled setup if not already present ---
  ; The bridge's Windows camera driver shells out to
  ;   C:\Program Files (x86)\digiCamControl\CameraControlRemoteCmd.exe
  ; so digiCamControl must exist before the booth can capture.
  ${IfNot} ${FileExists} "$PROGRAMFILES32\digiCamControl\CameraControlRemoteCmd.exe"
    DetailPrint "Menginstall digiCamControl (kontrol kamera)..."
    ${If} ${FileExists} "$INSTDIR\resources\digiCamControl-setup.exe"
      ; digiCamControl ships an Inno Setup installer; these are its silent flags.
      ; It raises its own UAC prompt because it writes to Program Files — so the
      ; Mote installer itself can stay per-user (no elevation required up front).
      ExecWait '"$INSTDIR\resources\digiCamControl-setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART' $0
      DetailPrint "digiCamControl installer keluar dengan kode $0"
    ${Else}
      DetailPrint "PERINGATAN: digiCamControl-setup.exe tidak ada di bundle — dilewati. Install manual."
    ${EndIf}
  ${Else}
    DetailPrint "digiCamControl sudah terpasang. Lewati."
  ${EndIf}

  ; --- 1b. Auto-start the digiCamControl GUI at login ---
  ; The bridge's capture driver talks to digiCamControl's localhost webserver,
  ; which only exists while the GUI is running. So the GUI must launch at login.
  ; (One-time manual step still required per booth: enable Settings -> Webserver
  ; and open a capture session. See installer-deps/README.md.)
  ${If} ${FileExists} "$PROGRAMFILES32\digiCamControl\CameraControl.exe"
    CreateShortcut "$SMSTARTUP\digiCamControl.lnk" \
      "$PROGRAMFILES32\digiCamControl\CameraControl.exe"
    DetailPrint "digiCamControl GUI ditambahkan ke Startup."
  ${EndIf}

  ; --- 2. Kiosk Edge shortcuts (Desktop + Startup) ---
  ; Resolve msedge.exe from App Paths (registry), fallback to the default path.
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  ${If} $1 == ""
    StrCpy $1 "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
  ${EndIf}

  ${If} ${FileExists} "$1"
    CreateShortcut "$DESKTOP\Mote Capture Booth.lnk" "$1" \
      "--kiosk ${MOTE_KIOSK_URL} --edge-kiosk-type=fullscreen" "$1" 0
    ; Startup folder -> the kiosk launches automatically at user login, alongside
    ; the bridge (which auto-starts via its login item).
    CreateShortcut "$SMSTARTUP\Mote Capture Booth.lnk" "$1" \
      "--kiosk ${MOTE_KIOSK_URL} --edge-kiosk-type=fullscreen" "$1" 0
    DetailPrint "Shortcut kiosk Edge dibuat (Desktop + Startup)."
  ${Else}
    DetailPrint "PERINGATAN: Microsoft Edge tidak ditemukan. Shortcut kiosk dilewati."
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Mote Capture Booth.lnk"
  Delete "$SMSTARTUP\Mote Capture Booth.lnk"
  Delete "$SMSTARTUP\digiCamControl.lnk"
  ; digiCamControl is intentionally NOT removed on uninstall: the operator may
  ; use it outside the booth, and it has its own entry in Apps & Features.
!macroend
