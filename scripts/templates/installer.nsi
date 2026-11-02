; Qwerty Learner Windows 安装器（NSIS 3.10）
;
; 由 scripts/package.mjs 调用，所有路径与版本通过 /D 传入，脚本本身不含本机路径。
; 安装范围：当前用户（HKCU + %LOCALAPPDATA%\Programs），不需要管理员权限。
; 卸载：保留用户学习数据（%APPDATA% 下的浏览器存储），只删程序目录与快捷方式。

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef APP_NAME
  !define APP_NAME "Qwerty Learner"
!endif
!ifndef APP_EXE
  !define APP_EXE "Qwerty Learner.exe"
!endif
!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!ifndef APP_FILE_VERSION
  !define APP_FILE_VERSION "1.0.0.0"
!endif
!ifndef APP_DIR
  !error "缺少 /DAPP_DIR=<外壳目录>"
!endif
!ifndef OUT_FILE
  !error "缺少 /DOUT_FILE=<安装器输出路径>"
!endif
!ifndef ICON_FILE
  !error "缺少 /DICON_FILE=<icon.ico>"
!endif

!define APP_REG_KEY "Software\Qwerty Learner"
!define APP_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Qwerty Learner"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${APP_REG_KEY}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "${APP_NAME} ${APP_VERSION}"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${APP_FILE_VERSION}"
VIAddVersionKey /LANG=2052 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey /LANG=2052 "CompanyName" "Qwerty Learner Contributors"
VIAddVersionKey /LANG=2052 "LegalCopyright" "GPL-3.0-or-later"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_FILE_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"

!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "将把 ${APP_NAME} 安装到当前用户目录，不需要管理员权限。$\r$\n$\r$\n版本：${APP_VERSION}$\r$\n$\r$\n点「下一步」继续。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "主程序（必需）" SEC_MAIN
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; 应用目录可能包含中文路径：makensis 3.x（Unicode）可直接处理
  File /r "${APP_DIR}\*.*"
  ; 标记文件：卸载时用来确认这是本安装器创建的目录，避免误删用户自选目录里的其它文件
  FileOpen $0 "$INSTDIR\.qz-install" w
  FileWrite $0 "Qwerty Learner ${APP_VERSION}$\r$\n"
  FileClose $0

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "" "" "" "" "${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "${APP_REG_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${APP_REG_KEY}" "Version" "${APP_VERSION}"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "Publisher" "Qwerty Learner Contributors"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${APP_UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${APP_UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${APP_UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${APP_UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${APP_UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "桌面快捷方式" SEC_DESKTOP
  ; 自动化测试用 /NODESKTOP 跳过，避免在真实桌面留下快捷方式
  ${GetParameters} $R0
  ${GetOptions} $R0 "/NODESKTOP" $R1
  StrCmp $R1 "" 0 +2
    CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "" "" "" "" "${APP_NAME}"
SectionEnd

LangString DESC_SEC_MAIN ${LANG_SIMPCHINESE} "程序文件、开始菜单项与卸载信息。"
LangString DESC_SEC_MAIN ${LANG_ENGLISH} "Application files, Start Menu entry and uninstall information."
LangString DESC_SEC_DESKTOP ${LANG_SIMPCHINESE} "在桌面创建快捷方式。"
LangString DESC_SEC_DESKTOP ${LANG_ENGLISH} "Create a desktop shortcut."

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} $(DESC_SEC_MAIN)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} $(DESC_SEC_DESKTOP)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  ; 卸载器默认会把自己复制到临时目录再运行；这里显式切走 cwd，保证能删掉安装目录
  SetOutPath $TEMP
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  DeleteRegKey HKCU "${APP_UNINST_KEY}"
  DeleteRegKey HKCU "${APP_REG_KEY}"

  ; 只有带 .qz-install 标记才整目录删除；否则只删本程序已知文件，避免误删用户目录
  IfFileExists "$INSTDIR\.qz-install" 0 no_marker
    RMDir /r "$INSTDIR"
    Goto done
  no_marker:
    Delete "$INSTDIR\${APP_EXE}"
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$INSTDIR\LICENSE"
    Delete "$INSTDIR\FORK-NOTICE.md"
    Delete "$INSTDIR\shell-info.json"
    RMDir /r "$INSTDIR\resources"
    RMDir /r "$INSTDIR\locales"
    RMDir "$INSTDIR"
  done:
SectionEnd
