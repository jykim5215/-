# HANDOFF.md — DNA 편집 스튜디오 (Claude Code ↔ Codex 핸드오프 브리프)

> 이 문서는 코딩 에이전트(Codex 등)가 이전 채팅 히스토리 없이도 작업을 이어받을 수 있도록 쓰는 자기완결적 브리프입니다.
> 코드를 수정할 때마다 "현재 상태" 섹션을 갱신합니다.

## 1) 프로젝트 개요와 목표

DGIST 학보사 "디지스트신문 DNA" 기자단을 위한 **Windows 데스크톱 편집 지원 앱**.
기획(브레인스토밍) → 자료 수집 → 분석 → 초안 → 교열 → 카드뉴스의 6단계 워크플로우를 Gemini AI로 보조하고,
DGIST 메일(IMAP/SMTP)로 취재 메일을 앱 안에서 읽고 보낼 수 있다. Electron 기반, 로컬 서버 없이 디바이스 내 구동.

## 2) 사용자 요구사항 정리 (2026-07-11 세션)

사용자(김유준, DNA 기자)가 이번 세션에서 말한 요구사항 원문 요지:

1. **"디자인이 너무 구리다. 갈아치우고 세련되게 바꿔달라"** — 현재 UI(웜 페이퍼 + 테라코타 액센트, 다크 레일)를 전면 리디자인. 스킬 규칙에 따라 HTML 스타일 후보 3개 이상을 만들어 사용자가 직접 선택한 뒤 적용한다.
2. **"이메일 함도 제대로 개편해달라"** — 현재 메일함은 로그인 배너 + 4열 그리드(폴더/목록/읽기/작성)가 한 화면에 전부 떠 있어 산만함. 실사용 시뮬레이션 기준으로 구조를 재편한다 (읽기 중심 2~3열 + 작성은 필요할 때만 나타나는 컴포저, 로그인은 미연결 시에만 노출 등).
3. **"특히 보내기 기능이 잘 안된다"** — SMTP 발송 실패를 수리. 원인 후보와 수리 방향은 아래 4) 참고.

## 3) 기술 방향 / 구조

- 스택: Electron 43 + vanilla JS 렌더러(`renderer/app.js` 단일 파일 SPA, `renderer/styles.css`), main 프로세스 모듈은 `src/main/*`, sql.js 로컬 DB, 비밀값은 `safeStorage` 암호화.
- 메일 스택: 발송 `src/main/mailer.js` (nodemailer, DGIST `mail.dgist.ac.kr:587` STARTTLS 기본), 수신 `src/main/imap.js` (imapflow, `:993` SSL).
- IPC: `main.js`의 `registerIpc()` → `preload.js` contextBridge(`window.dnaAPI`).
- 메일함 UI: `renderer/app.js`의 `renderMailCenter()` (약 1252행부터).
- 테스트: `npm test` (node --test, `tests/*.test.mjs`). 배포 zip: `npm run dist` (`scripts/make-dist-zip.mjs`, 보안 스캔 포함).

## 4) 구현 계획

### A. 메일 보내기 수리 (`src/main/mailer.js`, `main.js`, `renderer/app.js`)
원인 진단:
- DGIST SMTP가 587 STARTTLS를 거부하거나 망이 587을 차단하면 그대로 실패 — **465 SSL ↔ 587 STARTTLS 자동 폴백**을 넣고, 성공한 포트를 설정에 저장해 다음부터 바로 사용.
- 일부 그룹웨어는 SMTP 로그인 ID로 전체 주소가 아니라 **로컬파트(아이디)만** 요구 — 인증 실패 시 로컬파트로 1회 재시도.
- 렌더러 `generateMailDraftInMailbox()`가 `prompt()` 사용 — **Electron은 prompt() 미지원으로 예외 발생**. 인라인 입력으로 교체.
- 발송 전 `confirm()` 네이티브 다이얼로그 → 앱 내 확인 UI로 교체(리디자인과 함께).
- 실패 시 사용자 안내 문구에 "어느 호스트:포트로 시도했는지"를 포함해 디버깅 가능하게.

### B. UI 전면 리디자인 (`renderer/styles.css`, `renderer/index.html`, `renderer/app.js`의 마크업 부분)
- `dna-app/design-mockups/`에 새 스타일 후보 3개(HTML)를 만들어 사용자 선택 → 선택안을 `styles.css`에 전면 적용.
- 기존 클래스명은 최대한 유지(앱 로직이 클래스명에 의존)하고 토큰(:root 변수)·컴포넌트 스타일을 교체하는 방식.

### C. 메일함 UX 개편 (`renderMailCenter()`)
- 미연결 상태: 로그인 카드만 크게. 연결 후: 폴더+목록 / 읽기 2단 중심, "새 메일/회신"은 슬라이드 컴포저로.
- 회신·AI 초안·자료 저장은 읽기 화면 문맥 버튼으로 통합(기능 중복 제거).

### D. 마무리
- 테스트 갱신(`tests/mailer.test.mjs` 폴백 로직 반영), `npm test`, `npm run dist`로 배포 zip 재생성, 보안 점검 보고.

## 4-1) 배포·자동 업데이트 절차 (2026-07-11 확립)

- 저장소: `github.com/jykim5215/-` (public) — electron-builder publish 설정에 연결됨(`releaseType: release`).
- **새 버전 낼 때**: ① `package.json` version 올리기 → ② `npm run release:github` (gh CLI 토큰 자동 사용,
  NSIS exe + blockmap + latest.yml을 GitHub Releases에 업로드) → 끝.
- 스크립트에 자가 복구 있음: electron-builder 업로드가 중간에 끊겨도 latest.yml을 재생성해 gh로 마저 올린다.
  (v0.4.0 발행 때 실제로 exe만 올라가는 사고가 있었고, latest.yml·blockmap을 수동 보정해 완성함)
- 첫 자동 업데이트 대상 버전: **v0.4.0** — 그 이전 설치본 사용자는 v0.4.0을 한 번 수동 설치해야 하며 이후부터 앱 내 업데이트.
- 설치된 앱은 시작 8초 후 + 프로필 → "앱 업데이트 → 업데이트 확인"에서 새 버전을 감지·다운로드하고
  "재시작하여 설치"로 갱신된다 (`src/main/updater.js`, electron-updater). 지우고 재설치할 필요 없음.
- 개발 모드(`npm start`)에선 자동 업데이트 비활성(패키징된 설치본 전용). 강제 테스트: `DNA_ENABLE_DEV_UPDATES=1`.

## 5) 제약 조건

- 로컬 서버 금지 — Electron 앱으로 디바이스 내 구동 (`npm start`, 설치본은 dist의 NSIS exe).
- 개인정보·API 키 하드코딩 금지 — `scripts/make-dist-zip.mjs`의 보안 스캔이 위반 시 빌드를 중단시킴.
- 비밀번호는 반드시 `safeStorage` 암호화 저장 (main의 `setSecret`/`getSecret`).
- 원클릭 바로가기: `npm run shortcut` (`scripts/create-shortcut.mjs`) 유지.
- 렌더러 CSP: `script-src 'self'` — 외부 CDN 금지, 인라인 스크립트 금지.
- 코드 수정 결과 보고 때마다: 보안 취약점 개선 여부 + HANDOFF.md 갱신 내역 한 줄 보고.

## 6) 현재 상태

- **2026-07-11 (1차)**: 설계 완료 후 구현 진행.
  - **A. 보내기 수리 완료**: `mailer.js`에 포트 폴백(587↔465)·DGIST 로컬파트 인증 재시도·시도 내역 오류 메시지(`withFallback`/`candidatePlans`). 성공한 포트는 `mail:send`/`mail:verify`에서 설정에 저장. 렌더러 `prompt()` 제거(Electron 미지원), 발송 전 confirm()을 2단계 버튼 확인으로 교체.
  - **B. 리디자인 완료**: 사용자 결정 — 후보 3종(D Ink Editorial / E Midnight Signal / F Porcelain Studio, `dna-app/design-mockups/style-{d,e,f}-*.html`)을 **모두 테마로 제공**. 기본 `ink`, `body[data-theme="midnight"|"porcelain"]`. 구 테마(newsroom/paper/signal/graphite)는 `normalizeTheme()`이 ink로 흡수. styles.css는 토큰 전면 교체(+`--card2/--soft/--rail-*/--doc-*/--display` 등).
  - **C. 메일함 개편 완료**: `renderMailCenter()`를 계정 바+탭+2단(목록/읽기)+슬라이드 컴포저(`.mailx-*`)로 재구성. 로그인 카드는 미연결 시에만. **받는 사람 자동완성** 추가: 보낸 수신자·받은 발신자를 `src/main/contacts.js`로 수집(`mailContacts` 설정, IPC `mail:contacts`), To/Cc/Bcc에서 이름·이메일 부분일치 추천(↓↑/Enter/Tab/Esc, 쉼표 다중 수신 지원).
  - **기능 정리**: 죽어 있던 '취재 이메일' 단계를 STAGES에 선택 단계로 복원하고, 그 안의 중복 발송·받은메일 UI는 제거(발송은 "메일함에서 보내기" 핸드오프로 일원화). `wrapSelectionWithHighlight` 스코프 버그 수정(카드뉴스 강조 버튼 복구), `note()` 늦은 비동기 알림 방어, FLOW_META/체크리스트에 email 단계 추가. 렌더러에 `?demo` 쿼리로 목 API 구동 경로 추가(UI 점검용).
  - 테스트 78개 통과. 데모 모드로 전 화면·메일 플로우·테마 3종 구동 확인 완료.
- **2026-07-11 (2차) — 레퍼런스 자료 반영**: 사용자 제공 OneDrive 복구 폴더(`Downloads/OneDrive_2026-07-09.repair`) 분석.
  - 폴더 내 42개 docx/pptx는 전부 **0바이트 껍데기**(클라우드 미다운로드). 실제 내용은 루트에 풀린 OOXML 1세트뿐 → `_recovered/`에 docx(추경호 인터뷰 기사)·pptx(병합 카드뉴스 17장)로 재조립해 복구.
  - `scripts/analyze-reference-batch.mjs` 신규(npm run analyze:batch): 자료 폴더 일괄 감사+집계.
  - `referenceAudit.js`에 **혼합 덱 감지** 추가(커버 서체 재등장 + 서로 다른 러닝 헤더 반복 → blocker). 복구 덱이 실제로 차단됨.
  - `cardnewsRules.verifyCardExcerpts`가 **서면 인터뷰(화자 표기 없음) Q&A도 원문 발췌 검증**하도록 확장.
  - 코퍼스: `reference_pairs/review/chugyeongho-2026/`(구조화 데이터), `style_corpus/review/추경호_인터뷰기사_2026.md`(서면 인터뷰 구조 지침). `prompts/v1/cardnews_planner.md`에 실물 표기 관례(시리즈 원문자 회차, photoCredit 형식, 본문 180~350자, ▲나열) 추가.
  - 다음 할 일: 원본 파일들은 OneDrive에서 다시 내려받아 `npm run analyze:batch -- --src <폴더>`로 재감사 → ready 쌍을 gold로 승격.
- **2026-07-12 (3차) — 실물 자료 반영 + 수집·받아쓰기·맞춤법 강화 (v0.5.0)**:
  - **실물 코퍼스 10건 감사 완료** (`reference_pairs/review/uploads-2026-07/`): 9쌍 + 기사 1건.
    전부 작업본(댓글·추적변경)이라 needs_review — 발행본 입수 시 재감사해 승격.
    발행팀 **공식 템플릿 사양서**를 확보해 `rules/cardnews_template_spec.md`로 성문화(폰트 pt·색·커버·본문·이미지·발행 절차).
  - **혼합 덱 감지 교정**: 정상 덱도 섹션 제목을 연속 반복하므로(LMS 가이드 사례) "비연속 교차 반복"만 차단하도록 수정.
  - `prompts/v1/cardnews_planner.md`: 실사용 카테고리(캠퍼스·문화·포토·DGIST 사람들·DGIST 꿀팁실록), 장수 4~11 표준,
    직접 촬영 무표기, 가이드형 "1. 2. 3." 구조 등 실물 관례 반영. 파일명 규칙(`기사유형_제목_기자명`)은 style_corpus/README에 기록.
  - **파일 수집 형식 무제한**: `extract.js`가 hwpx·xlsx·rtf·html·srt/vtt·csv/json 등 추출 + 모르는 확장자는 zip/텍스트 스니핑,
    오디오·이미지는 코드로 라우팅. 수집 화면은 다중 파일 지원, 음성은 자동 받아쓰기, 이미지·바이너리도 참고 자료로 기록(절대 거절 안 함).
  - **Whisper 원클릭 설치**: `src/main/whisperSetup.js` — whisper.cpp Windows 바이너리 + 한국어 모델(small 467MB)을
    자동 다운로드해 userData/whisper에 설치, 설정 자동 기록. 수집 화면 "자동 설치" 버튼 + 진행률(IPC transcribe:setupEvent).
  - **맞춤법 검사 확대**: 취재 이메일 단계에 검사 버튼 추가(부산대 검사기+로컬 폴백, 모두 적용 지원).
  - 릴리스 스크립트에 `--bump patch|minor|major` 추가 — "코드 수정 → `npm run release:github -- --bump patch` → 앱에서 업데이트" 완성.
  - 테스트 83개 통과 (extract 5종 신규 포함).
