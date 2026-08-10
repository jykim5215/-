#!/usr/bin/env bash
# Play 스토어 등록용 스크린샷을 실제 기기에서 캡처한다.
#
#   scripts/capture-screenshots.sh [출력폴더]
#
# 필요한 것: adb, USB 디버깅이 켜진 안드로이드 기기(또는 에뮬레이터),
#            그 기기에 설치된 단어장 앱
#
# 화면을 직접 조작해 가며 엔터로 한 장씩 찍는다. 자동으로 화면을 옮기지 않는 이유는
# 앱 상태(학습 진행, 쌓인 단어 수)에 따라 좋은 그림이 달라지기 때문이다.
set -euo pipefail

OUT="${1:-play-assets/screenshots}"
mkdir -p "$OUT"

command -v adb >/dev/null || { echo "✗ adb 가 필요합니다 (Android Platform Tools)" >&2; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "✗ 연결된 기기가 없습니다. USB 디버깅을 켜고 연결하세요." >&2; exit 1; }

DEVICE=$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\r')
SIZE=$(adb shell wm size 2>/dev/null | tr -d '\r' | awk '{print $NF}')
echo "기기: $DEVICE ($SIZE)"
echo

shots=(
  "01-home:홈 — '완전히 아는 단어' 숫자와 쌓인 단어가 보이게"
  "02-flashcard:암기 카드 — 단어 면"
  "03-pile:쌓기 보기 — 단어가 통에 쌓인 화면"
  "04-add:단어 추가 — 뜻 후보가 여러 개 뜬 상태 (예: cover)"
  "05-archive:아카이브 — Day 1~30 그리드"
  "06-mywords:내 단어 — 복습 예정 목록"
)

for entry in "${shots[@]}"; do
  name="${entry%%:*}"
  desc="${entry#*:}"
  echo "▶ $desc"
  read -r -p "  기기에서 그 화면을 띄운 뒤 Enter (건너뛰려면 s + Enter): " ans
  [ "$ans" = "s" ] && { echo "  건너뜀"; continue; }
  adb exec-out screencap -p > "$OUT/$name.png"
  echo "  저장: $OUT/$name.png"
done

echo
echo "완료. Play 요건 확인:"
for f in "$OUT"/*.png; do
  [ -f "$f" ] || continue
  if command -v python3 >/dev/null; then
    python3 - "$f" <<'PY'
import sys
try:
    from PIL import Image
    with Image.open(sys.argv[1]) as im:
        w, h = im.size
        ok = min(w, h) >= 320 and max(w, h) <= 3840
        ratio = max(w, h) / min(w, h)
        ok = ok and ratio <= 2.0
        print(f"  {sys.argv[1]}  {w}×{h}  {'OK' if ok else '규격 확인 필요(짧은 변 320px 이상, 비율 2:1 이하)'}")
except ImportError:
    print(f"  {sys.argv[1]}  (Pillow 없음 — 크기 확인 생략)")
PY
  else
    echo "  $f"
  fi
done
echo
echo "최소 2장이 필요합니다. Play Console → 스토어 등록정보 → 휴대전화 스크린샷 에 올리세요."
