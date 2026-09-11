#!/usr/bin/env bash
# (선택) yt-dlp 로 영상에서 오디오만 뽑아내는 헬퍼.
# 앱 본체는 이 스크립트 없이도 동작합니다 — 탭 오디오 캡처나 파일 드롭을 쓰세요.
#   사용:  bash tools/fetch-youtube.sh "<영상 URL>" [출력폴더]
set -euo pipefail

URL="${1:-}"
OUTDIR="${2:-$PWD}"

if [ -z "$URL" ]; then
  echo "사용법: bash tools/fetch-youtube.sh \"<영상 URL>\" [출력폴더]" >&2
  exit 1
fi
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp 가 없습니다. 먼저 설치해주세요:" >&2
  echo "  macOS   : brew install yt-dlp" >&2
  echo "  리눅스   : pipx install yt-dlp   (또는 pip install -U yt-dlp)" >&2
  exit 1
fi

mkdir -p "$OUTDIR"
yt-dlp -x --audio-format m4a --audio-quality 0 \
       -o "$OUTDIR/%(title).80s.%(ext)s" "$URL"

echo
echo "완료. 받은 m4a 파일을 앱의 [소리 가져오기 → 오디오 파일] 에 끌어다 놓으세요."
echo "내려받은 음원과 채보 결과는 본인 연습 용도로만 사용하세요."
