; 品牌化钩子（T-155）：给 electron-builder 的 NSIS 脚本打补丁。
;
; 只做两件事：
;  ① 卸载时给一个"是否删除用户数据"的勾选（默认不删）；
;  ② 卸载页写得具体一点，说明数据在哪、删了会怎样。
;
; 注意：这个文件被 electron-builder **在 MUI2 之前** include，
; 所以不能用 `!insertmacro MUI_HEADER_TEXT`（那时宏还没定义），页面文字全部走 nsDialogs 自己画。
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; 下面全部是卸载器专用的：安装器那一趟也会 include 本文件，
; 如果不加这个开关，安装器里会出现一堆 un. 函数却没有 WriteUninstaller，
; NSIS 报 warning 6020，而 electron-builder 把 warning 当错误。
!ifdef BUILD_UNINSTALLER

; 下面全部是卸载器专用的：安装器那一趟也会 include 本文件，
; 如果不加这个开关，安装器里会出现一堆 un. 函数却没有 WriteUninstaller，
; NSIS 报 warning 6020，而 electron-builder 把 warning 当错误。
!ifdef BUILD_UNINSTALLER

Var DeleteUserData
Var DataCheckbox
Var DataDialog

; 卸载向导第一页（替代 MUI 自带的欢迎页）
!macro customUnWelcomePage
  UninstPage custom un.DataPageCreate un.DataPageLeave
!macroend

Function un.DataPageCreate
  nsDialogs::Create 1018
  Pop $DataDialog
  ${If} $DataDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 16u "卸载 TT项目管理工作台"
  Pop $0
  CreateFont $1 "Microsoft YaHei" 10 700
  SendMessage $0 ${WM_SETFONT} $1 1

  ${NSD_CreateLabel} 0 20u 100% 40u "卸载只移除程序本体。项目索引、回收站、备份与缩略图都存在下面这个目录里，默认会保留：$\r$\n$APPDATA\ttFolio"
  Pop $0

  ${NSD_CreateCheckbox} 0 62u 100% 12u "同时删除我的数据（删除后无法恢复）"
  Pop $DataCheckbox
  ${NSD_SetState} $DataCheckbox ${BST_UNCHECKED}

  ${NSD_CreateLabel} 0 80u 100% 22u "建议保留：以后重装可以直接接着用。确定不再需要，再勾选上面这一项。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.DataPageLeave
  ${NSD_GetState} $DataCheckbox $DeleteUserData
FunctionEnd

; 卸载执行阶段：勾了才删数据目录
!macro customUnInstall
  ${If} $DeleteUserData == ${BST_CHECKED}
    DetailPrint "正在删除用户数据：$APPDATA\ttFolio"
    RMDir /r "$APPDATA\ttFolio"
  ${EndIf}
!macroend

!endif

!endif
