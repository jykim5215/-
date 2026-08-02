#!/usr/bin/env bash
# 원클릭 설치 — USB 디버깅이 켜진 안드로이드 기기에 바로 설치하고 실행한다.
#
#   scripts/install.sh [apk-path]
#
# apk 경로를 주지 않으면 android/app/build/outputs 에서 가장 최근 APK 를 찾는다.
# 설치가 끝나면 런처에 "단어장" 아이콘이 생기고, 길게 누르면
# "오늘 복습 / 단어 추가 / 아카이브" 바로가기가 함께 뜬다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="${1:-}"

if [ -z "$APK" ]; then
  APK=$(find "$ROOT/android/app/build/outputs" "$ROOT" -maxdepth 6 -name "*.apk" -newer "$ROOT/version.json" 2>/dev/null | head -1)
fi
if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "APK 를 찾지 못했습니다. 먼저 빌드하세요:" >&2
  echo "  cd android && ./gradlew assembleRelease" >&2
  exit 1
fi

if ! command -v adb >/dev/null; then
  echo "adb 가 없습니다. Android Platform Tools 를 설치하거나, APK 를 기기로 직접 옮겨 설치하세요:" >&2
  echo "  $APK" >&2
  exit 1
fi

echo "설치 중: $APK"
adb install -r "$APK"
adb shell monkey -p com.vocacard.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
echo "완료. 홈 화면의 '단어장' 아이콘으로 언제든 바로 실행됩니다."
