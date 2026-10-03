; Registers the Onstage Camera driver (native/vcam, MIT-licensed UnityCapture filter) with Windows.
; The installer is a 32-bit program, so Sysnative reaches the 64-bit regsvr32 and SYSDIR the 32-bit one.
!macro customInstall
  ExecWait '"$WINDIR\Sysnative\regsvr32.exe" /s "$INSTDIR\resources\vcam\UnityCaptureFilter64.dll" "/i:UnityCaptureName=Onstage Camera"'
  ExecWait '"$SYSDIR\regsvr32.exe" /s "$INSTDIR\resources\vcam\UnityCaptureFilter32.dll" "/i:UnityCaptureName=Onstage Camera"'
!macroend

!macro customUnInstall
  ExecWait '"$WINDIR\Sysnative\regsvr32.exe" /u /s "$INSTDIR\resources\vcam\UnityCaptureFilter64.dll"'
  ExecWait '"$SYSDIR\regsvr32.exe" /u /s "$INSTDIR\resources\vcam\UnityCaptureFilter32.dll"'
!macroend
