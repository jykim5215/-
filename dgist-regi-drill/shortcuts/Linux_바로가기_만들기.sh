#!/usr/bin/env bash
# 수강신청 연습 시뮬레이터 - Linux 바탕화면 바로가기 생성
# 실행:  bash Linux_바로가기_만들기.sh   (또는 chmod +x 후 더블클릭)
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$DIR/app.html"
ICON="$DIR/assets/icon.png"

if [ ! -f "$APP" ]; then
  echo "app.html 을 찾을 수 없습니다: $APP"
  exit 1
fi

DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -z "$DESKTOP" ] && DESKTOP="$HOME/Desktop"
mkdir -p "$DESKTOP"
F="$DESKTOP/dgist-regi-drill.desktop"

cat > "$F" <<EOF
[Desktop Entry]
Type=Application
Name=수강신청 연습
Comment=수강신청 연습 시뮬레이터 (오프라인)
Exec=xdg-open "$APP"
Icon=$ICON
Terminal=false
Categories=Education;
EOF

chmod +x "$F"
gio set "$F" metadata::trusted true 2>/dev/null || true
echo "바탕화면에 '수강신청 연습' 바로가기를 만들었습니다:"
echo "  $F"
