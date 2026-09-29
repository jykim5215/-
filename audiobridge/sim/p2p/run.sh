#!/usr/bin/env bash
# Wi-Fi Direct 가상 시뮬레이션 실행: 실제 WifiDirect.kt + v2.8 원본을 가상 Android 위에서 돌린다.
# 필요: JDK 17+. 앱과 같은 Kotlin 2.0.21을 ~/.cache에 내려받아 쓴다(KOTLINC로 직접 지정 가능).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../android/app/src/main/java/app/audiobridge/net/WifiDirect.kt"
OUT="${TMPDIR:-/tmp}/audiobridge-p2p-sim"
KVER=2.0.21

KOTLINC="${KOTLINC:-}"   # PATH의 kotlinc는 버전이 달라 결과가 흔들릴 수 있어 쓰지 않는다
if [ -z "$KOTLINC" ]; then
  CACHE="$HOME/.cache/audiobridge-kotlinc-$KVER"
  if [ ! -x "$CACHE/kotlinc/bin/kotlinc" ]; then
    mkdir -p "$CACHE"
    curl -fsSL -o "$CACHE/k.zip" "https://github.com/JetBrains/kotlin/releases/download/v$KVER/kotlin-compiler-$KVER.zip"
    unzip -q -o "$CACHE/k.zip" -d "$CACHE" && rm "$CACHE/k.zip"
  fi
  KOTLINC="$CACHE/kotlinc/bin/kotlinc"
fi
KHOME="$(cd "$(dirname "$KOTLINC")/.." && pwd)"

rm -rf "$OUT" && mkdir -p "$OUT/stubs" "$OUT/app"
javac -nowarn -d "$OUT/stubs" $(find "$HERE/android-stubs" -name '*.java')
"$KOTLINC" -nowarn -cp "$OUT/stubs" -d "$OUT/app" "$SRC" "$HERE/baseline/WifiDirectV28.kt" "$HERE/VirtualP2p.kt" 2>&1 \
  | grep -v '^warning: unable to find kotlin-stdlib' || true
java -Dstdout.encoding=UTF-8 -Dfile.encoding=UTF-8 -cp "$OUT/stubs:$OUT/app:$KHOME/lib/kotlin-stdlib.jar" sim.p2p.VirtualP2pKt
