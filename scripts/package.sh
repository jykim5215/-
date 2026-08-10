#!/usr/bin/env bash
# 배포용 압축 패키지를 만든다.
#
#   scripts/package.sh [version] [apk-path]
#
# 결과: dist/VocaCard-<version>.zip
#   - HANDOFF.md, version.json, README.md
#   - android/ 소스 전체 (빌드 산출물·로컬 설정·keystore 는 제외)
#   - APK (인자로 주어졌고 파일이 있을 때만)
#
# 개인정보/자격증명은 애초에 저장소에 없으며, 아래 제외 목록으로 한 번 더 걸러낸다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(jq -r .version version.json 2>/dev/null || grep -o '"version"[^,]*' version.json | cut -d'"' -f4)}"
APK="${2:-}"

STAGE="$(mktemp -d)"
PKG="$STAGE/VocaCard-$VERSION"
mkdir -p "$PKG"

cp HANDOFF.md version.json README.md "$PKG/" 2>/dev/null || true
mkdir -p "$PKG/tools" "$PKG/design" "$PKG/scripts"
cp tools/build_wordbank.py tools/make_store_assets.py "$PKG/tools/"
cp design/index.html "$PKG/design/"
cp scripts/*.sh "$PKG/scripts/"

# Play 출시 문서와 그래픽 자산도 함께 넣는다(스크린샷은 실기 캡처라 제외).
if [ -d docs/play ]; then mkdir -p "$PKG/docs" && cp -r docs/play "$PKG/docs/"; fi
if [ -d play-assets ]; then
  mkdir -p "$PKG/play-assets"
  cp play-assets/*.png "$PKG/play-assets/" 2>/dev/null || true
fi

# 소스 복사 — 빌드 산출물과 비밀 정보가 될 수 있는 파일은 제외
rsync -a --quiet \
  --exclude '.gradle/' \
  --exclude 'build/' \
  --exclude '**/build/' \
  --exclude 'local.properties' \
  --exclude '*.jks' \
  --exclude '*.keystore' \
  --exclude '*.p12' \
  --exclude '.idea/' \
  --exclude 'captures/' \
  android "$PKG/"

if [ -n "$APK" ] && [ -f "$APK" ]; then
  cp "$APK" "$PKG/"
fi

# 혹시라도 섞여 들어간 비밀 파일이 있으면 여기서 멈춘다.
if find "$PKG" \( -name '*.jks' -o -name '*.keystore' -o -name 'local.properties' -o -name '.env' \) | grep -q .; then
  echo "ERROR: 패키지에 자격증명 파일이 포함되어 있습니다. 중단합니다." >&2
  exit 1
fi

mkdir -p dist
rm -f "dist/VocaCard-$VERSION.zip"
(cd "$STAGE" && zip -qr "$ROOT/dist/VocaCard-$VERSION.zip" "VocaCard-$VERSION")
rm -rf "$STAGE"

echo "생성됨: dist/VocaCard-$VERSION.zip"
ls -lh "dist/VocaCard-$VERSION.zip"
