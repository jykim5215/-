#!/usr/bin/env bash
# VocaCard 서명 키를 GitHub Actions 시크릿 4개로 등록한다.
#
#   scripts/register-secrets.sh <keystore.jks> [alias]
#
# 필요한 것
#   - GitHub CLI (gh)  : https://cli.github.com  →  gh auth login  한 번만 하면 된다
#   - keytool          : JDK 에 포함(안드로이드 스튜디오를 깔았다면 이미 있다)
#
# 비밀번호는 인자로 받지 않고 화면에 찍지도 않는다. 쉘 히스토리에 남지 않게 하기 위함이다.
set -euo pipefail

REPO="${VOCA_REPO:-jykim5215/-}"
KEYSTORE="${1:-}"
ALIAS="${2:-vocacard}"

die() { echo "✗ $*" >&2; exit 1; }

[ -n "$KEYSTORE" ] || die "사용법: scripts/register-secrets.sh <keystore.jks> [alias]"
[ -f "$KEYSTORE" ] || die "키스토어를 찾을 수 없습니다: $KEYSTORE"
command -v gh >/dev/null || die "gh(GitHub CLI)가 필요합니다. https://cli.github.com 에서 설치 후 'gh auth login'"
command -v keytool >/dev/null || die "keytool 이 필요합니다(JDK 설치 필요)."

gh auth status >/dev/null 2>&1 || die "GitHub 로그인이 필요합니다: gh auth login"

printf "키스토어 비밀번호: "
read -rs PW
echo

# 비밀번호가 맞는지 먼저 확인한다. 틀린 값을 시크릿에 넣으면 CI 가 나중에 실패한다.
keytool -list -keystore "$KEYSTORE" -storepass "$PW" -alias "$ALIAS" >/dev/null 2>&1 \
  || die "비밀번호 또는 별칭이 맞지 않습니다 (별칭: $ALIAS)"

FP=$(keytool -list -v -keystore "$KEYSTORE" -storepass "$PW" 2>/dev/null \
     | grep -m1 "SHA256:" | sed 's/.*SHA256: //')
echo "✓ 키 확인됨 — SHA-256 $FP"

# base64 는 GNU(-w0) / macOS(옵션 없음) 둘 다 대응
if base64 --help 2>&1 | grep -q -- '-w'; then
  B64=$(base64 -w0 "$KEYSTORE")
else
  B64=$(base64 "$KEYSTORE" | tr -d '\n')
fi

echo "→ $REPO 에 시크릿 4개 등록 중..."
printf '%s' "$B64" | gh secret set VOCA_KEYSTORE_BASE64   --repo "$REPO"
printf '%s' "$PW"  | gh secret set VOCA_KEYSTORE_PASSWORD --repo "$REPO"
printf '%s' "$ALIAS" | gh secret set VOCA_KEY_ALIAS       --repo "$REPO"
printf '%s' "$PW"  | gh secret set VOCA_KEY_PASSWORD      --repo "$REPO"

unset PW B64

echo
echo "✓ 등록 완료. 확인:"
gh secret list --repo "$REPO" | grep VOCA_ || true
echo
echo "다음 빌드부터 이 키로 서명됩니다."
echo "지금 바로 다시 빌드하려면:"
echo "  gh workflow run 'Build & Release APK' --repo $REPO --ref claude/android-vocabulary-app-820e26"
