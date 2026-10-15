; //TR: Bu NSIS include (M1a c2: kullanıcı verisi yolu ve başlık ${PRODUCT_NAME}/${PRODUCT_FILENAME} ile yazılır; RELEASE için metin "UASCO" olarak aynı kalır, TEST varyantında "UASCO Test" olur) UASCO imzasız geliştirme kurulumuna ön-kurulum kontrollerini (hedef sürücü var mı, boş alan >= gereken boyut + pay, ağ sürücüsü uyarısı), imzasız sürüm karşılama metnini, kullanıcı verisini varsayılan olarak koruyan kaldırma seçeneğini ("kullanıcı verilerini de sil", varsayılan işaretsiz) ve YALNIZ otomatik testlerde kullanılan kısayolsuz kurulum anahtarını ekler.
;
; Test-only switches (documented in docs/installer/README.md; never used by the Founder's normal install):
;   /UASCO_TEST_NO_SHORTCUTS      desktop + Start menu shortcut paths are redirected into $PLUGINSDIR (a temp dir
;                                 removed when the installer exits), so a silent test install never touches the real
;                                 Desktop or Start menu. Combine with electron-builder's --no-desktop-shortcut.
;   /UASCO_TEST_REQUIRE_MB=<n>    raise the required free space to <n> MB to exercise the refusal path.
; Uninstaller: "--keep-shortcuts" (electron-builder flag) makes a test uninstall leave shortcut paths untouched.

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"

!define UASCO_SPACE_MARGIN_MB 256
!ifdef ESTIMATED_SIZE
  !define /math UASCO_APP_SIZE_MB ${ESTIMATED_SIZE} / 1024
!else
  !define UASCO_APP_SIZE_MB 600
!endif
!define /math UASCO_REQUIRED_MB ${UASCO_APP_SIZE_MB} + ${UASCO_SPACE_MARGIN_MB}

!macro customHeader
  ; electron-builder copies the installer into %LOCALAPPDATA%\<app>-updater for its auto-updater. UASCO ships no
  ; auto-updater, so the copy is redirected under %LOCALAPPDATA%\Temp and deleted again in customInstall (no
  ; ~100 MB residue outside the install dir and user data).
  !ifdef APP_INSTALLER_STORE_FILE
    !undef APP_INSTALLER_STORE_FILE
    !define APP_INSTALLER_STORE_FILE "Temp\uasco-installer-copy\installer.exe"
  !endif
!macroend

; Functions that call plugins (System, nsDialogs) are defined inside macros that electron-builder inserts at page
; declaration time, i.e. after its own !addplugindir lines; using a plugin earlier makes makensis report a
; plugin-directory conflict.
!ifndef BUILD_UNINSTALLER
  Var uascoTestNoShortcuts
  Var uascoRequiredMB
!endif

!macro uascoDefineInstallerFunctions
  Function uascoReadSwitches
    Push $R0
    Push $R1
    StrCpy $uascoTestNoShortcuts "0"
    StrCpy $uascoRequiredMB "${UASCO_REQUIRED_MB}"
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/UASCO_TEST_NO_SHORTCUTS" $R1
    ${IfNot} ${Errors}
      StrCpy $uascoTestNoShortcuts "1"
    ${EndIf}
    ClearErrors
    ${GetOptions} $R0 "/UASCO_TEST_REQUIRE_MB=" $R1
    ${IfNot} ${Errors}
      IntOp $R1 $R1 + 0
      ${If} $R1 > 0
        StrCpy $uascoRequiredMB $R1
      ${EndIf}
    ${EndIf}
    ClearErrors
    Pop $R1
    Pop $R0
  FunctionEnd

  ; Result in $R9: "1" = continue, "0" = refuse. Checks: target drive exists/reachable, free space >= required
  ; size + margin, network drive warning (UNC path or DRIVE_REMOTE).
  Function uascoPreInstallChecks
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    StrCpy $R9 "1"
    StrCpy $R3 "0"
    ${GetRoot} "$INSTDIR" $R0
    StrCpy $R1 $R0 2
    ${If} $R0 == ""
      MessageBox MB_OK|MB_ICONSTOP "Geçersiz kurulum dizini: $INSTDIR$\r$\n$\r$\nInvalid installation directory." /SD IDOK
      StrCpy $R9 "0"
      Goto uasco_checks_done
    ${EndIf}
    ${If} $R1 == "\\"
      StrCpy $R3 "1"
    ${Else}
      System::Call 'kernel32::GetDriveTypeW(w "$R0\") i .R4'
      ${If} $R4 <= 1
        MessageBox MB_OK|MB_ICONSTOP "Hedef sürücü bulunamadı: $R0$\r$\nLütfen var olan bir sürücü seçin.$\r$\n$\r$\nTarget drive does not exist: $R0. Please choose an existing drive." /SD IDOK
        StrCpy $R9 "0"
        Goto uasco_checks_done
      ${EndIf}
      ${If} $R4 == 4
        StrCpy $R3 "1"
      ${EndIf}
    ${EndIf}
    ; free bytes available to the current user -> MB
    System::Call 'kernel32::GetDiskFreeSpaceExW(w "$R0\", *l .R2, *l .R1, *l .R1) i .R4'
    ${If} $R4 == 0
      MessageBox MB_OK|MB_ICONSTOP "Hedef sürücüye erişilemiyor: $R0$\r$\n$\r$\nThe target drive cannot be accessed: $R0" /SD IDOK
      StrCpy $R9 "0"
      Goto uasco_checks_done
    ${EndIf}
    System::Int64Op $R2 / 1048576
    Pop $R2
    ${If} $R2 < $uascoRequiredMB
      MessageBox MB_OK|MB_ICONSTOP "Yetersiz disk alanı: $R0 sürücüsünde $R2 MB boş, en az $uascoRequiredMB MB gerekli (uygulama + ${UASCO_SPACE_MARGIN_MB} MB pay). Kurulum yapılmadı.$\r$\n$\r$\nInsufficient disk space: $R2 MB free on $R0, at least $uascoRequiredMB MB required (application + ${UASCO_SPACE_MARGIN_MB} MB margin). Nothing was installed." /SD IDOK
      StrCpy $R9 "0"
      Goto uasco_checks_done
    ${EndIf}
    ${If} $R3 == "1"
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "Uyarı: seçilen dizin bir ağ sürücüsünde ($R0). UASCO yerel bir sürücüde (tercihen SSD) daha güvenilir çalışır. Yine de devam edilsin mi?$\r$\n$\r$\nWarning: the selected directory is on a network drive ($R0). UASCO is more reliable on a local drive (preferably an SSD). Continue anyway?" /SD IDYES IDYES uasco_checks_done
      StrCpy $R9 "0"
    ${EndIf}
    uasco_checks_done:
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd

  ; interactive installs: runs after the directory page; on refusal it returns to the directory page
  Function uascoChecksPageCreate
    Call uascoPreInstallChecks
    ${If} $R9 == "0"
      SendMessage $HWNDPARENT 0x408 -1 0
    ${EndIf}
    Abort
  FunctionEnd
!macroend

!macro customWelcomePage
  !insertmacro uascoDefineInstallerFunctions
  !define MUI_WELCOMEPAGE_TITLE "${PRODUCT_NAME} ${VERSION} Kurulumu"
  !define MUI_WELCOMEPAGE_TEXT "Bu, UASCO'nun İMZASIZ GELİŞTİRME kurulumudur (Authenticode imzası yok). Windows SmartScreen uyarısı göstermesi beklenir.$\r$\n$\r$\nKurulum yalnız bu Windows kullanıcısı için yapılır (yönetici izni gerekmez). Program dosyaları seçtiğiniz dizine, kullanıcı verileri %APPDATA%\${PRODUCT_FILENAME} altına yazılır.$\r$\n$\r$\nThis is an UNSIGNED DEVELOPMENT installer (no Authenticode signature); a SmartScreen warning is expected. Per-user install, no administrator rights; user data lives in %APPDATA%\${PRODUCT_FILENAME}."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom uascoChecksPageCreate
!macroend

!macro customInit
  Call uascoReadSwitches
  ${If} ${Silent}
    Call uascoPreInstallChecks
    ${If} $R9 == "0"
      ; electron-builder's .onInit already ran SetOutPath $INSTDIR; remove that directory again only if it is empty
      SetOutPath $TEMP
      RMDir "$INSTDIR"
      SetErrorLevel 3
      Quit
    ${EndIf}
  ${EndIf}
!macroend

; Inserted by electron-builder between setLinkVars and the shortcut creation (handleUninstallResult for
; SHELL_CONTEXT). Test mode redirects the shortcut targets into $PLUGINSDIR first, then keeps the default
; uninstall-result handling of electron-builder byte-for-byte equivalent.
!macro customUnInstallCheck
  ${If} $uascoTestNoShortcuts == "1"
    StrCpy $newDesktopLink "$PLUGINSDIR\uasco-test-desktop.lnk"
    StrCpy $newStartMenuLink "$PLUGINSDIR\uasco-test-startmenu.lnk"
  ${EndIf}
  IfErrors 0 +3
  DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  Return

  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0" /SD IDOK
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
!macroend

!macro customInstall
  !ifdef APP_INSTALLER_STORE_FILE
    Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    RMDir "$LOCALAPPDATA\Temp\uasco-installer-copy"
  !endif
!macroend

!ifdef BUILD_UNINSTALLER
  Var uascoDeleteUserData
  Var uascoDeleteCheckbox
!endif

!macro uascoDefineUninstallerFunctions
  Function un.uascoDataPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 48u "UASCO program dosyaları kaldırılacak. Kullanıcı verileriniz (%APPDATA%\${PRODUCT_FILENAME}: projeler, görevler, kayıtlar) varsayılan olarak KORUNUR.$\r$\n$\r$\nProgram files will be removed. Your user data (%APPDATA%\${PRODUCT_FILENAME}) is KEPT by default."
    Pop $0
    ${NSD_CreateCheckbox} 0 56u 100% 14u "Kullanıcı verilerini de sil / Also delete user data (%APPDATA%\${PRODUCT_FILENAME})"
    Pop $uascoDeleteCheckbox
    ${NSD_Uncheck} $uascoDeleteCheckbox
    nsDialogs::Show
  FunctionEnd

  Function un.uascoDataPageLeave
    ${NSD_GetState} $uascoDeleteCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $uascoDeleteUserData "1"
    ${Else}
      StrCpy $uascoDeleteUserData "0"
    ${EndIf}
  FunctionEnd
!macroend

!macro customUnWelcomePage
  !insertmacro uascoDefineUninstallerFunctions
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.uascoDataPageCreate un.uascoDataPageLeave
!macroend

!macro customUnInit
  StrCpy $uascoDeleteUserData "0"
!macroend

; Upgrades (old uninstaller run with --updated) and the default path never delete user data; only the explicit,
; default-unchecked "kullanıcı verilerini de sil" choice (or electron-builder's explicit --delete-app-data flag) does.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    ${If} $uascoDeleteUserData == "1"
      SetShellVarContext current
      RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
    ${EndIf}
  ${EndIf}
!macroend
