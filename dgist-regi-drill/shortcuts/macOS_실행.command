#!/bin/bash
# 수강신청 연습 시뮬레이터 - macOS 실행기
# 이 파일을 더블클릭하면 기본 브라우저로 app.html 이 열립니다.
# (최초 1회) 더블클릭이 막히면: 우클릭 → 열기, 또는 터미널에서
#   chmod +x "macOS_실행.command"  실행 후 사용하세요.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$DIR/app.html"
if [ ! -f "$APP" ]; then
  echo "app.html 을 찾을 수 없습니다: $APP"
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다..."
  exit 1
fi
open "$APP"
