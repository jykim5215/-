# 부스 배치도 플래너 — 바탕화면 바로가기 만들기 (Windows)
# 사용법: 이 파일을 우클릭 → "PowerShell 로 실행"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here 'index.html'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop '부스 배치도 플래너.lnk'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $target
$sc.WorkingDirectory = $here
$sc.Description = '부스 배치도 플래너'
# 브라우저 아이콘 대신 도면 느낌의 시스템 아이콘 사용 (imageres.dll: 그리드/도면)
$sc.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
$sc.Save()
Write-Host "바탕화면에 바로가기를 만들었습니다: $lnk"
