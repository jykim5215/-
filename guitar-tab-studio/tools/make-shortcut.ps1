# 원클릭 바로가기 생성 (윈도우)
#   사용:  powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1
$ErrorActionPreference = 'Stop'

$AppDir = Split-Path -Parent $PSScriptRoot
$Html   = Join-Path $AppDir 'index.html'
$Icon   = Join-Path $AppDir 'assets\icon.ico'
$Name   = '기타 탭 스튜디오'

if (-not (Test-Path $Html)) { Write-Error "index.html 을 찾지 못했습니다: $Html"; exit 1 }

$Desktop = [Environment]::GetFolderPath('Desktop')
$LnkPath = Join-Path $Desktop "$Name.lnk"

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($LnkPath)
$sc.TargetPath       = $Html          # 기본 브라우저로 열린다
$sc.WorkingDirectory = $AppDir
$sc.Description      = '기타 연주를 타브 악보 PDF로'
if (Test-Path $Icon) { $sc.IconLocation = "$Icon,0" }
$sc.Save()

Write-Host "만들었습니다: $LnkPath"
Write-Host "  · 더블클릭하면 기본 브라우저로 앱이 열립니다."
Write-Host "  · 크롬/엣지로 열어야 '유튜브 탭 소리 캡처'가 동작합니다."
