#!/usr/bin/env bash
# Cloudflare Pages 수동 배포
#
#   1) 한 번만:  npm i -g wrangler && wrangler login
#   2) 배포:     bash tools/deploy-cloudflare.sh
#
# 토큰을 쓰려면 (CI 등):
#   export CLOUDFLARE_API_TOKEN=...   # 권한: Account > Cloudflare Pages > Edit
#   export CLOUDFLARE_ACCOUNT_ID=...
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${CF_PAGES_PROJECT:-guitar-tab-studio}"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler 가 없습니다. 먼저 설치하세요:  npm i -g wrangler" >&2
  exit 1
fi

VERSION="$(python3 -c 'import json;print(json.load(open("'"$APP_DIR"'/version.json"))["version"])')"
echo "기타 탭 스튜디오 v$VERSION → Cloudflare Pages 프로젝트 '$PROJECT'"
echo

# 배포 전 마지막 점검: 비밀값이 섞여 들어가지 않았는지
if grep -rInE 'sk-ant-[A-Za-z0-9_-]{10,}|(ghp|github_pat)_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}' \
     "$APP_DIR/app" "$APP_DIR/index.html" 2>/dev/null; then
  echo "중단: 배포 대상에 자격증명처럼 보이는 문자열이 있습니다. 위 내용을 확인하세요." >&2
  exit 1
fi
echo "[ok] 자격증명 스캔 통과"

wrangler pages deploy "$APP_DIR" --project-name="$PROJECT"

echo
echo "배포 완료. 첫 배포라면 Cloudflare 대시보드에서 프로젝트가 생성됩니다."
echo "주의: Git 연동으로 쓸 경우 Pages 설정의 '루트 디렉터리'를 guitar-tab-studio 로 지정해야 합니다"
echo "      (저장소 루트에는 다른 앱의 index.html 이 있습니다)."
