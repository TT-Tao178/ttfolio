; 自解压外壳：把「安装器宿主 + payload」压成一个 exe。
; 运行时先把文件解到临时目录（这一步 15~25 秒，必须有进度可见），再启动自绘界面。
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APPEXE "TT项目管理工作台 安装程序.exe"

Name "TT项目管理工作台 安装程序"
OutFile "..\dist-electron\ttFolio-Setup-custom.exe"
Icon "assets\icon.ico"

; 只保留"文件释放"这一页：它天然带进度条，解压完自动关窗
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Main"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\app"

  ; 宿主按 LZMA 压（省 40MB 左右）；payload 本身已是 zip，再压没收益还拖慢启动 → 直接存储
  File /r /x "payload.zip" "..\dist-installer\win-unpacked\*.*"
  SetCompress off
  File "/oname=$PLUGINSDIR\app\resources\payload.zip" "payload.zip"
  SetCompress auto

  ${GetParameters} $R0
  SetOutPath "$PLUGINSDIR\app"
  ExecWait '"$PLUGINSDIR\app\${APPEXE}" $R0' $R1

  ; 宿主退出后再清理（个别文件可能仍被占用，失败无妨，系统会清临时目录）
  RMDir /r "$PLUGINSDIR\app"
  SetErrorLevel $R1
SectionEnd
