#!/usr/bin/env bash
# 배포용 압축 생성 + 개인정보 스크럽 점검
#   사용:  bash tools/package.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

VERSION="$(python3 -c 'import json;print(json.load(open("version.json"))["version"])')"
STAGE="$(mktemp -d)"
PKG="guitar-tab-studio-${VERSION}"
DEST="$STAGE/$PKG"

mkdir -p "$DEST"
cp -r index.html version.json README.md HANDOFF.md app assets tools docs "$DEST/" 2>/dev/null || true
rm -rf "$DEST/dist" "$DEST"/**/__pycache__ 2>/dev/null || true
find "$DEST" -name '.DS_Store' -delete 2>/dev/null || true
find "$DEST" -name '*.pyc' -delete 2>/dev/null || true

echo "── 개인정보 · 비밀값 스크럽 점검 ──"
FAIL=0
scan() {  # 패턴, 설명
  local hits
  hits="$(grep -rInE "$1" "$DEST" --exclude-dir=.git 2>/dev/null | grep -v 'package.sh' || true)"
  if [ -n "$hits" ]; then
    echo "  [!] $2"
    echo "$hits" | head -5 | sed 's/^/      /'
    FAIL=1
  else
    echo "  [ok] $2 — 없음"
  fi
}
scan 'sk-ant-[A-Za-z0-9_-]{10,}'                 'Anthropic API 키'
scan '(ghp|gho|github_pat)_[A-Za-z0-9_]{20,}'    'GitHub 토큰'
scan 'AKIA[0-9A-Z]{16}'                          'AWS 액세스 키'
scan '/(Users|home)/[a-z0-9._-]+/'               '로컬 사용자 경로'
scan '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' '이메일 주소'

mkdir -p dist
rm -f "dist/${PKG}.zip"
( cd "$STAGE" && zip -qr "${PKG}.zip" "$PKG" -x '*.DS_Store' )
mv "$STAGE/${PKG}.zip" "dist/${PKG}.zip"
rm -rf "$STAGE"

echo
echo "만들었습니다: dist/${PKG}.zip  ($(du -h "dist/${PKG}.zip" | cut -f1))"
[ "$FAIL" = "1" ] && echo "⚠ 위 항목을 확인한 뒤 배포하세요." || echo "스크럽 점검 통과."
