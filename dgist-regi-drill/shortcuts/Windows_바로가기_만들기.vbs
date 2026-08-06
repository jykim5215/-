' 수강신청 연습 시뮬레이터 - Windows 바탕화면 바로가기 생성
' 이 파일을 더블클릭하면 바탕화면에 아이콘이 있는 바로가기가 만들어집니다.
Option Explicit
Dim sh, fso, scriptDir, appPath, iconPath, workDir, desktop, lnk
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appPath   = fso.GetAbsolutePathName(scriptDir & "\..\app.html")
iconPath  = fso.GetAbsolutePathName(scriptDir & "\..\assets\icon.ico")
workDir   = fso.GetAbsolutePathName(scriptDir & "\..")

If Not fso.FileExists(appPath) Then
  MsgBox "app.html 을 찾을 수 없습니다. 압축을 푼 폴더 구조를 확인하세요." & vbCrLf & appPath, 16, "오류"
  WScript.Quit
End If

desktop = sh.SpecialFolders("Desktop")
Set lnk = sh.CreateShortcut(desktop & "\수강신청 연습.lnk")
lnk.TargetPath = appPath
lnk.WorkingDirectory = workDir
If fso.FileExists(iconPath) Then lnk.IconLocation = iconPath & ",0"
lnk.Description = "수강신청 연습 시뮬레이터 (오프라인)"
lnk.Save

MsgBox "바탕화면에 '수강신청 연습' 바로가기를 만들었습니다." & vbCrLf & _
       "아이콘을 더블클릭하면 기본 브라우저로 열립니다.", 64, "완료"
