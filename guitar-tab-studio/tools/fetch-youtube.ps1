# (선택) yt-dlp 로 영상에서 오디오만 뽑아내는 헬퍼 (윈도우)
#   사용:  powershell -ExecutionPolicy Bypass -File tools\fetch-youtube.ps1 "<영상 URL>"
param([Parameter(Mandatory=$true)][string]$Url, [string]$OutDir = (Get-Location).Path)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) {
  Write-Error "yt-dlp 가 없습니다. 설치: winget install yt-dlp.yt-dlp  (또는 pip install -U yt-dlp)"
  exit 1
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
yt-dlp -x --audio-format m4a --audio-quality 0 -o "$OutDir\%(title).80s.%(ext)s" $Url

Write-Host ""
Write-Host "완료. 받은 m4a 파일을 앱의 [소리 가져오기 -> 오디오 파일] 에 끌어다 놓으세요."
Write-Host "내려받은 음원과 채보 결과는 본인 연습 용도로만 사용하세요."
