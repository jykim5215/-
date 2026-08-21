# 프로젝트 이전 안내 — 새 노트북 세팅

이전 노트북에서 작업하던 GitHub 저장소 **10개**를 새 PC로 옮기고, 각각 로컬에서 실행하고
Claude Code로 이어서 개발할 수 있게 만드는 문서입니다.

---

## 1. 한 번에 세팅하기

### Windows (권장)

```powershell
# 이 폴더에서
powershell -ExecutionPolicy Bypass -File .\setup-all.ps1

# 위치를 바꾸고 싶다면
powershell -ExecutionPolicy Bypass -File .\setup-all.ps1 -Root "D:\dev"

# 비공개 저장소까지 (먼저 GitHub 로그인 필요)
powershell -ExecutionPolicy Bypass -File .\setup-all.ps1 -IncludePrivate
```

### macOS / Linux

```bash
chmod +x setup-all.sh
./setup-all.sh                    # ~/projects 아래로
ROOT=~/dev ./setup-all.sh         # 위치 지정
INCLUDE_PRIVATE=1 ./setup-all.sh  # 비공개 저장소까지
```

스크립트가 하는 일: **클론(이미 있으면 pull) → 프로젝트별 의존성 설치 → 정적 앱 바로가기 생성**.
여러 번 실행해도 안전합니다.

### 미리 깔아둘 것

| 도구 | 필요한 프로젝트 | 비고 |
|---|---|---|
| **Git** | 전부 | [git-scm.com](https://git-scm.com/download/win) |
| **Node.js** LTS | `72` | [nodejs.org](https://nodejs.org) |
| **Python 3.12 이상** | `dgist-lms-autosaver`, `fileflow-lite` | ⚠️ `fileflow-lite` 는 **3.12 미만에서 설치 실패**(실측 확인) |
| **.NET 10 SDK** | `fileflow-lite` v0.2 탐색기 확장 빌드 시에만 | 파이썬 프로토타입만 쓸 거면 불필요 |

---

## 2. 프로젝트 한눈에 보기

| 로컬 폴더 | 저장소 | 무엇 | 스택 | 실행 |
|---|---|---|---|---|
| `cheolbong-map` | [`-`](https://github.com/jykim5215/-) | 철봉 위치·상태 지도 | Python 표준 라이브러리 + 정적 | `python server.py` |
| `72` | [`72`](https://github.com/jykim5215/72) | 무명 개인 웹사이트 발견 플랫폼 | Astro SSR + Cloudflare Pages/D1/R2 | `npm run dev` |
| `seat-preview` | [`seat-preview`](https://github.com/jykim5215/seat-preview) | 영화관 좌석 시야 미리보기 | 순수 정적 (빌드 없음) | `index.html` 더블클릭 |
| `dgist-lms-autosaver` | [`dgist-lms-autosaver`](https://github.com/jykim5215/dgist-lms-autosaver) | LMS 자료 자동 정리 → Google Drive | Python + Playwright + pywebview | `pythonw app.py` |
| `dongseon` | [`dongseon`](https://github.com/jykim5215/dongseon) | 일정·동선 플래너 PWA | 순수 정적 PWA | `index.html` 더블클릭 |
| `houseman-os` | [`houseman-os`](https://github.com/jykim5215/houseman-os) | 비발디파크 하우스맨 업무 PWA | 순수 정적 PWA (`docs/`) | `docs/index.html` |
| `houseman-os-data` 🔒 | [`houseman-os-data`](https://github.com/jykim5215/houseman-os-data) | 위 앱의 비공개 데이터 | JSON 데이터만 | 앱이 동기화로 사용 |
| `fileflow-lite` | [`fileflow-lite`](https://github.com/jykim5215/fileflow-lite) | 탐색기 폴더 평탄화·순번 이름짓기 | Python 3.12+ / .NET 10 WPF (Windows 전용) | `fileflow-lite` |
| `biology-note` | [`Essential-...-exam-`](https://github.com/jykim5215/Essential-biology-note-for-final-exam-) | 생명과학 기말 학습노트 | HTML 파일 하나 | HTML 더블클릭 |
| — | [`Essential-...-exam`](https://github.com/jykim5215/Essential-biology-note-for-final-exam) | **빈 저장소** (중복) | — | 정리 대상, 아래 5장 참고 |

> 저장소 이름 `-` 는 셸에서 다루기 불편해서 로컬 폴더만 **`cheolbong-map`** 으로 둡니다.
> git 원격은 그대로라 push/pull 은 정상 동작합니다.

---

## 3. 프로젝트별 실행과 준비물

### `cheolbong-map` — 철봉 지도
```bash
cd cheolbong-map
python server.py          # http://127.0.0.1:8000
```
외부 의존성 없음(표준 라이브러리만). 포트/호스트는 `CHEOLBONG_PORT`, `CHEOLBONG_HOST` 환경변수로 조정합니다.

> **수정됨**: 기본 바인드 주소가 `0.0.0.1` 로 되어 있어 서버가 아예 뜨지 않았습니다(유효하지 않은 주소).
> `127.0.0.1` 로 고쳤습니다. 다른 기기에서도 접속하려면 `CHEOLBONG_HOST=0.0.0.0` 으로 실행하세요.

### `72` — 웹사이트 발견 플랫폼
```bash
cd 72
npm run db:local          # 로컬 D1 에 스키마 적용 (최초 1회)
npm run dev
```
**직접 채워야 하는 값** — 배포할 때만 필요합니다(로컬 개발은 없이도 동작).
```bash
wrangler d1 create seventy-two-db          # 발급된 id 를 wrangler.toml 에 기입
wrangler r2 bucket create seventy-two-og
npm run db:remote
wrangler pages secret put TURNSTILE_SECRET # 선택 (스팸 방어)
wrangler pages secret put ADMIN_KEY        # /mod 접근용
```
시크릿은 저장소에 넣지 않습니다. `PUBLIC_TURNSTILE_SITEKEY` 만 공개값이라 `wrangler.toml` 의 `[vars]` 에 둡니다.

### `seat-preview` — 좌석 시야 미리보기
`index.html` 더블클릭 또는 `실행.bat`. 로컬 서버 불필요.
데스크톱 Chrome/Edge, 1280×800 이상 권장. 좌석 데이터가 커서(약 **62MB**) 클론이 가장 오래 걸립니다.

### `dgist-lms-autosaver` — LMS 자동 정리
```powershell
cd dgist-lms-autosaver
python setup.py                          # config.py 생성 — 계정·API 키 입력
.\.venv\Scripts\pythonw.exe app.py       # 데스크톱 창
.\.venv\Scripts\python.exe web_ui.py     # 브라우저 모드
```
**직접 채워야 하는 값** (`config.py`, 저장소에 커밋하지 말 것):
`LMS_ID` · `LMS_PASSWORD` · `GEMINI_API_KEY` · `EMAIL_ADDRESS` · `EMAIL_PASSWORD`(Gmail 앱 비밀번호) · `EMAIL_TO` · `DOWNLOAD_PATH`

Playwright 브라우저는 세팅 스크립트가 자동으로 내려받습니다. 수동으로 하려면
`python -m playwright install chromium`.

> **Windows 전용 요소**: 알림에 `winotify` 를 씁니다. macOS/Linux 에서는 해당 패키지 설치가
> 실패하며(스크립트가 건너뜁니다) 알림 기능만 동작하지 않습니다.

### `dongseon` — 일정·동선 플래너
`index.html` 더블클릭. 빌드·서버 없음. 데이터는 기기 안에만 저장됩니다.
**앱 설정 화면에서** ODsay 키(대중교통 경로), Anthropic 키(AI 코칭)를 넣습니다 — 코드에 넣지 않습니다.

### `houseman-os` — 하우스맨 OS
`docs/index.html` 더블클릭. 빌드 파이프라인 없음 — **`docs/` 를 GitHub Pages 가 그대로 서빙**하므로
푸시가 곧 배포입니다. 라이브: https://jykim5215.github.io/houseman-os/

작업 전 `CLAUDE.md` 와 `project/HANDOFF.md` 를 먼저 읽으세요. 저장소 규칙에 비밀값 금지가 명시돼 있습니다
(도어락 번호·연락처·API 키는 비공개 저장소 `houseman-os-data` 에만 둡니다).

### `houseman-os-data` 🔒 — 비공개 데이터
비공개라 인증 없이는 클론되지 않습니다. 새 PC에서 **먼저 GitHub 로그인**한 뒤 `-IncludePrivate` 로 다시 실행하세요.
```powershell
winget install GitHub.cli   # 없다면
gh auth login               # 또는 Git Credential Manager 로 최초 1회 인증
powershell -ExecutionPolicy Bypass -File .\setup-all.ps1 -IncludePrivate
```

### `fileflow-lite` — 탐색기 확장
```powershell
cd fileflow-lite
.\.venv\Scripts\fileflow-lite.exe     # v0.1 파이썬 프로토타입
```
**Windows 전용**입니다. 실제 제품인 v0.2 탐색기 우클릭 확장은 GitHub Releases 의
`FileFlow-Lite-Explorer-v0.2.0.zip` 을 받아 `Install-FileFlowLite.cmd` 를 한 번 실행해 설치합니다
(자체 서명 MSIX라 최초 1회 UAC 승인 필요). 소스에서 빌드하려면 .NET 10 SDK 가 필요합니다.

> ⚠️ `pyproject.toml` 이 **Python 3.12 이상**을 요구합니다. 3.11 이하에서는 설치가 실패합니다(실측 확인).

### `biology-note` — 생명과학 기말 노트
`생명과학개론_기말_학습노트_Ch21-28_통합.html` 더블클릭. 그 외 준비물 없음.

---

## 4. Claude Code 로 이어서 작업하기

```bash
cd <프로젝트폴더>
claude
```

이 저장소들은 이미 에이전트 인계 문서를 갖고 있습니다. 새 세션에서 맥락이 끊기지 않게 먼저 읽히세요.

| 프로젝트 | 먼저 읽을 파일 |
|---|---|
| `houseman-os` | `CLAUDE.md` → `project/HANDOFF.md` |
| `72` | `HANDOFF.md` |
| `dongseon` | `HANDOFF.md` |
| `seat-preview` | `HANDOFF.md`, `CODEX_PROMPT.md` |
| `fileflow-lite` | `HANDOFF.md` |

---

## 5. 정리하면 좋을 것

1. **중복 저장소** — `Essential-biology-note-for-final-exam` 은 **완전히 빈 저장소**이고,
   내용은 하이픈이 붙은 `Essential-biology-note-for-final-exam-` 에만 있습니다.
   빈 쪽을 삭제하고 남은 쪽 이름에서 끝 하이픈을 떼면 깔끔합니다.
2. **저장소 이름 `-`** — 셸·스크립트에서 계속 불편합니다. GitHub 설정에서 `cheolbong-map` 같은
   이름으로 바꾸면(리다이렉트가 자동으로 걸립니다) 이후 작업이 편합니다.
3. **비공개 데이터 저장소** — `houseman-os` 를 새 PC에서 제대로 쓰려면
   `houseman-os-data` 접근 인증이 먼저 필요합니다.

---

## 6. 이 폴더에 들어 있는 것

| 파일 | 용도 |
|---|---|
| `setup-all.ps1` | Windows 일괄 세팅 스크립트 |
| `setup-all.sh` | macOS/Linux 일괄 세팅 스크립트 |
| `PROJECTS.md` | 이 문서 |
