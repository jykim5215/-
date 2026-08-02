#!/usr/bin/env bash
# 릴리즈 APK 빌드 + 배포 zip 생성.
#
#   scripts/build.sh
#
# 서명 키가 필요하면 환경 변수로 넘긴다(저장소에 절대 커밋하지 않는다):
#   VOCA_KEYSTORE=/path/to/vocacard.jks \
#   VOCA_KEYSTORE_PASSWORD=... VOCA_KEY_ALIAS=vocacard VOCA_KEY_PASSWORD=... \
#   scripts/build.sh
#
# 키가 없으면 서명되지 않은 릴리즈 APK 가 나온다(기기 설치에는 서명이 필요).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/android"

VERSION=$(grep -o '"version"[^,]*' "$ROOT/version.json" | cut -d'"' -f4)

echo "▶ VocaCard $VERSION 릴리즈 빌드"
chmod +x ./gradlew
./gradlew --no-daemon assembleRelease

APK=$(find app/build/outputs/apk/release -name "*.apk" | head -1)
DEST="$ROOT/VocaCard-$VERSION.apk"
cp "$APK" "$DEST"
echo "▶ APK: $DEST"

bash "$ROOT/scripts/package.sh" "$VERSION" "$DEST"
