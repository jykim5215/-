#!/usr/bin/env bash
# 원클릭 바로가기 생성 (macOS / 리눅스)
#   사용:  bash tools/make-shortcut.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HTML="$APP_DIR/index.html"
NAME="기타 탭 스튜디오"

if [ ! -f "$HTML" ]; then
  echo "index.html 을 찾지 못했습니다: $HTML" >&2
  exit 1
fi

DESKTOP="${HOME}/Desktop"
[ -d "$DESKTOP" ] || DESKTOP="${HOME}/바탕화면"
[ -d "$DESKTOP" ] || DESKTOP="$HOME"

case "$(uname -s)" in
  Darwin)
    TARGET="$DESKTOP/$NAME.command"
    cat > "$TARGET" <<EOF
#!/bin/bash
open "$HTML"
EOF
    chmod +x "$TARGET"
    echo "만들었습니다: $TARGET"
    echo "  · 더블클릭하면 기본 브라우저로 앱이 열립니다."
    echo "  · 아이콘을 바꾸려면: 파일 정보 보기(⌘I)에서 assets/icon-256.png 를 왼쪽 위 아이콘에 끌어다 놓으세요."
    ;;
  Linux)
    TARGET="$DESKTOP/guitar-tab-studio.desktop"
    cat > "$TARGET" <<EOF
[Desktop Entry]
Type=Application
Name=$NAME
Name[en]=Guitar Tab Studio
Comment=기타 연주를 타브 악보 PDF로
Exec=xdg-open "$HTML"
Icon=$APP_DIR/assets/icon-256.png
Terminal=false
Categories=AudioVideo;Audio;Education;
EOF
    chmod +x "$TARGET"
    # GNOME 등에서 "신뢰함" 표시가 필요한 경우
    command -v gio >/dev/null 2>&1 && gio set "$TARGET" metadata::trusted true 2>/dev/null || true
    mkdir -p "$HOME/.local/share/applications"
    cp "$TARGET" "$HOME/.local/share/applications/guitar-tab-studio.desktop" 2>/dev/null || true
    echo "만들었습니다: $TARGET"
    echo "  · 앱 목록에도 등록했습니다."
    ;;
  *)
    echo "이 운영체제는 자동 생성이 안 됩니다. 브라우저에서 아래 파일을 열고 북마크해주세요:"
    echo "  $HTML"
    ;;
esac
