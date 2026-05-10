; Включаем поддержку длинных путей (Win10 1607+) на машине пользователя.
; Без этого git может падать с "Filename too long" даже при core.longpaths=true.
; Требует прав администратора (HKLM); в обычном NSIS installer это норма.
!macro customInstall
  ${IfNot} ${AtMostWin8.1}
    SetRegView 64
    WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1
    SetRegView lastused
  ${EndIf}
!macroend
