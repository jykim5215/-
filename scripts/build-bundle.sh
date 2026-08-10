#!/usr/bin/env bash
# Google Play 업로드용 AAB(Android App Bundle) 빌드.
#
#   scripts/build-bundle.sh
#
# 서명 키는 환경 변수로만 넘긴다(저장소에 두지 않는다):
#   VOCA_KEYSTORE=/path/vocacard-release.jks \
#   VOCA_KEYSTORE_PASSWORD=... VOCA_KEY_ALIAS=vocacard VOCA_KEY_PASSWORD=... \
#   scripts/build-bundle.sh
#
# 결과: VocaCard-<version>.aab (저장소 루트)
#
# play 플레이버로 빌드하므로 자체 업데이트 기능과
# REQUEST_INSTALL_PACKAGES 권한이 빠진다(Play 정책 준수).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/android"

VERSION=$(grep -o '"version"[^,]*' "$ROOT/version.json" | cut -d'"' -f4)
CODE=$(grep -o '"versionCode"[^,]*' "$ROOT/version.json" | grep -o '[0-9]\+')

echo "▶ VocaCard $VERSION (versionCode $CODE) — Play 번들 빌드"

if [ -z "${VOCA_KEYSTORE:-}" ]; then
  echo "⚠ VOCA_KEYSTORE 가 없습니다. 서명되지 않은 번들이 나오며 Play 에 업로드할 수 없습니다." >&2
fi

chmod +x ./gradlew
./gradlew --no-daemon bundlePlayRelease < /dev/null

AAB=$(find app/build/outputs/bundle -name "*.aab" | head -1)
[ -n "$AAB" ] || { echo "✗ AAB 를 찾지 못했습니다." >&2; exit 1; }

DEST="$ROOT/VocaCard-$VERSION.aab"
cp "$AAB" "$DEST"
echo "▶ 번들: $DEST"
ls -lh "$DEST"

cat <<EOF

다음 단계
  1. Play Console → 앱 만들기(최초 1회)
  2. 프로덕션(또는 내부 테스트) → 새 버전 만들기 → 위 .aab 업로드
  3. docs/play/RELEASE_CHECKLIST.md 의 항목을 순서대로 채우기

버전을 올릴 때는 version.json 의 version 과 versionCode 를 **둘 다** 올려야 합니다.
Play 는 같은 versionCode 를 두 번 받지 않습니다.
EOF
