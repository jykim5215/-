#!/usr/bin/env bash
# jykim5215 의 GitHub 프로젝트를 새 PC(macOS/Linux)에 한 번에 내려받고 실행 준비까지 마칩니다.
# 여러 번 실행해도 안전합니다(멱등).
#
#   ./setup-all.sh                      # ~/projects 아래로
#   ROOT=~/dev ./setup-all.sh           # 위치 지정
#   SKIP_DEPS=1 ./setup-all.sh          # 클론만
#   INCLUDE_PRIVATE=1 ./setup-all.sh    # 비공개 저장소도 시도

set -uo pipefail

OWNER="jykim5215"
ROOT="${ROOT:-$HOME/projects}"
SKIP_DEPS="${SKIP_DEPS:-0}"
INCLUDE_PRIVATE="${INCLUDE_PRIVATE:-0}"

C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_OFF=$'\033[0m'
step() { printf '\n%s>> %s%s\n' "$C_INFO" "$1" "$C_OFF"; }
ok()   { printf '   %sOK  %s%s\n' "$C_OK" "$1" "$C_OFF"; }
warn() { printf '   %s!!  %s%s\n' "$C_WARN" "$1" "$C_OFF"; }

# repo|dir|title|setup(none/npm/venv)|launch
REPOS=(
  "-|cheolbong-map|철봉 지도|none|"
  "72|72|72 (웹사이트 발견)|npm|"
  "seat-preview|seat-preview|좌석 시야 미리보기|none|index.html"
  "dgist-lms-autosaver|dgist-lms-autosaver|DGIST LMS AutoSaver|venv|"
  "dongseon|dongseon|동선 (일정 플래너)|none|index.html"
  "houseman-os|houseman-os|하우스맨 OS|none|docs/index.html"
  "fileflow-lite|fileflow-lite|FileFlow Lite|venv|"
  "Essential-biology-note-for-final-exam-|biology-note|생명과학 기말 노트|none|생명과학개론_기말_학습노트_Ch21-28_통합.html"
)
PRIVATE_REPOS=(
  "houseman-os-data|houseman-os-data|하우스맨 OS 데이터(비공개)|none|"
)

have() { command -v "$1" >/dev/null 2>&1; }

step "필수 도구 확인"
if ! have git; then
  echo "git 이 없습니다. 설치 후 다시 실행하세요 (macOS: xcode-select --install)." >&2
  exit 1
fi
ok "git    $(git --version)"

HAS_NODE=0
if have node; then HAS_NODE=1; ok "node   $(node --version)"
else warn "node 없음 — 72 프로젝트 설치를 건너뜁니다 (https://nodejs.org)"; fi

PY=""
if have python3; then PY=python3; elif have python; then PY=python; fi
if [ -n "$PY" ]; then ok "python $($PY --version 2>&1)"
else warn "python 없음 — Python 프로젝트 설치를 건너뜁니다"; fi

ALL=("${REPOS[@]}")
[ "$INCLUDE_PRIVATE" = "1" ] && ALL+=("${PRIVATE_REPOS[@]}")

mkdir -p "$ROOT"
step "저장소를 $ROOT 아래로 내려받는 중"

DONE=()
for entry in "${ALL[@]}"; do
  IFS='|' read -r repo dir title setup launch <<< "$entry"
  dest="$ROOT/$dir"
  url="https://github.com/$OWNER/$repo.git"

  if [ -d "$dest/.git" ]; then
    echo "   ~   $dir — 이미 있음, 최신으로 갱신"
    git -C "$dest" pull --ff-only >/dev/null 2>&1 || warn "$dir pull 실패 (로컬 변경사항 확인 필요)"
  else
    if ! git clone --quiet -- "$url" "$dest" >/dev/null 2>&1; then
      warn "$dir 클론 실패 — 비공개 저장소라면 GitHub 인증(gh auth login)이 필요합니다"
      continue
    fi
  fi
  ok "$dir  ($title)"
  DONE+=("$entry")
done

if [ "$SKIP_DEPS" != "1" ]; then
  step "프로젝트별 의존성 설치"
  for entry in "${DONE[@]}"; do
    IFS='|' read -r repo dir title setup launch <<< "$entry"
    d="$ROOT/$dir"

    case "$setup" in
      npm)
        [ "$HAS_NODE" = "1" ] || { warn "$dir — node 없음, 건너뜀"; continue; }
        echo "   ... $dir: npm install"
        ( cd "$d" && npm install --no-fund --no-audit >/dev/null 2>&1 ) \
          && ok "$dir 의존성 설치 완료" || warn "$dir npm install 실패"
        ;;
      venv)
        [ -n "$PY" ] || { warn "$dir — python 없음, 건너뜀"; continue; }
        vpy="$d/.venv/bin/python"
        echo "   ... $dir: 가상환경 + 패키지"
        [ -x "$vpy" ] || "$PY" -m venv "$d/.venv" || { warn "$dir venv 생성 실패"; continue; }
        "$vpy" -m pip install --quiet --upgrade pip >/dev/null 2>&1

        if [ -f "$d/requirements.txt" ]; then
          # pywebview/winotify 등 Windows 전용 패키지는 여기서 실패할 수 있음 — 개별 설치로 최대한 진행
          if ! "$vpy" -m pip install --quiet -r "$d/requirements.txt" >/dev/null 2>&1; then
            warn "$dir: requirements 일괄 설치 실패 (Windows 전용 패키지 가능) — 개별 설치 시도"
            while read -r pkg; do
              [ -z "$pkg" ] && continue
              case "$pkg" in \#*) continue ;; esac
              "$vpy" -m pip install --quiet "$pkg" >/dev/null 2>&1 || warn "    건너뜀: $pkg"
            done < "$d/requirements.txt"
          fi
          if grep -q '^playwright' "$d/requirements.txt" 2>/dev/null; then
            echo "   ... $dir: playwright chromium 내려받는 중 (수 분 소요)"
            "$vpy" -m playwright install chromium >/dev/null 2>&1 || warn "$dir playwright 설치 실패"
          fi
        fi

        if [ -f "$d/pyproject.toml" ]; then
          ( cd "$d" && "$vpy" -m pip install --quiet -e . >/dev/null 2>&1 ) || warn "$dir 패키지 설치 실패"
        fi
        ok "$dir 가상환경 준비 완료 (.venv)"

        if [ -f "$d/config.example.py" ] && [ ! -f "$d/config.py" ]; then
          warn "$dir: config.py 없음 — 'python setup.py' 로 계정·API 키를 입력하세요"
        fi
        ;;
    esac
  done
fi

# 정적 앱 실행 스크립트 (저장소 밖에 생성 — git 상태를 더럽히지 않음)
step "정적 앱 실행 스크립트 생성"
LAUNCH_DIR="$ROOT/_실행"
mkdir -p "$LAUNCH_DIR"
opener="xdg-open"; [ "$(uname)" = "Darwin" ] && opener="open"

for entry in "${DONE[@]}"; do
  IFS='|' read -r repo dir title setup launch <<< "$entry"
  [ -z "$launch" ] && continue
  target="$ROOT/$dir/$launch"
  [ -f "$target" ] || continue
  script="$LAUNCH_DIR/$title.command"
  printf '#!/usr/bin/env bash\n%s "%s"\n' "$opener" "$target" > "$script"
  chmod +x "$script"
  ok "$title"
done

cat <<EOF

────────────────────────────────────────────
 완료. 프로젝트 위치: $ROOT
────────────────────────────────────────────

 바로 실행:   $LAUNCH_DIR

 개발 서버로 실행:
   철봉 지도       cd "$ROOT/cheolbong-map"       && python3 server.py
   72              cd "$ROOT/72"                  && npm run db:local && npm run dev
   DGIST LMS       cd "$ROOT/dgist-lms-autosaver" && ./.venv/bin/python web_ui.py   # ※ Windows 전용 기능 있음
   FileFlow Lite   cd "$ROOT/fileflow-lite"       && ./.venv/bin/fileflow-lite      # ※ Windows 전용

 Claude Code 로 열기:
   cd "$ROOT/<프로젝트폴더>" && claude

 남은 수동 작업은 PROJECTS.md 의 "직접 채워야 하는 값"을 확인하세요.

EOF
