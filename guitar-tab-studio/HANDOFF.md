# HANDOFF.md — Guitar Tab Studio (기타 탭 스튜디오)

> 이 문서는 **Codex(또는 다른 코딩 에이전트)가 이 파일 하나만 읽고도 작업을 그대로 이어받을 수 있도록** 쓴 자기완결적 인수인계 브리프다.
> Claude Code와 사용자가 나눈 대화 히스토리는 Codex에서 볼 수 없다는 전제로 작성했다.
> 최종 갱신: 2026-09-11 / 작성 시점 상태: **설계 완료, 구현 시작 전 → 이후 구현 진행에 따라 §6을 갱신할 것**

---

## 1. 프로젝트 개요와 목표

**유튜브의 기타 연주 영상에서 오디오를 가져와, 신호처리 + AI로 음을 받아쓰고(transcription), 기타 타브(TAB) 악보로 변환해서, 여러 곡을 묶은 "타브 악보집" PDF 파일로 내보내는 데스크톱/모바일 겸용 앱.**

- 최종 산출물은 **악보 PDF 파일**이다. (앱의 성공 조건 = 인쇄 가능한 타브 악보 PDF가 나오는 것)
- 한 곡짜리 악보뿐 아니라 **여러 곡을 모은 악보집(book)** — 표지 + 목차 + 각 곡 악보 — 을 하나의 PDF로 묶어 내보낼 수 있어야 한다.

---

## 2. 사용자 요구사항 정리 (사용자가 채팅에서 직접 말한 것)

사용자 원문 요구사항:
> "유튜브에서 기타 동영상을 긁어서 ai를 활용해 타브 악보집을 만드는 앱을 만들거야. 최종본은 악보 pdf 파일이 되도록."

이를 항목으로 풀면:

| # | 요구사항 | 해석/구현 방향 |
|---|---|---|
| R1 | 유튜브에서 기타 동영상을 "긁어온다" | 오디오를 앱으로 가져오는 경로를 확보한다. **해석 변경 있음 → §2.1 참고** |
| R2 | AI를 활용해 분석한다 | (a) 브라우저 내장 DSP 채보 엔진(오프라인, 필수) + (b) 선택적 Claude API 보정 레이어(사용자 본인 키, 선택) |
| R3 | 타브(TAB) 악보로 만든다 | 6현 타브 표기, 튜닝/카포 지원, 운지(fingering) 최적화 |
| R4 | "악보집" — 여러 곡 모음 | 라이브러리에 곡을 쌓고, 선택한 곡들을 표지+목차와 함께 한 PDF로 합본 |
| R5 | 최종본은 PDF 파일 | 벡터 PDF 직접 생성(외부 라이브러리 없음), A4/Letter, 다중 페이지 |

### 2.1 요구사항 해석을 바꾼 부분과 그 이유 (중요 — 임의 변경이 아니라 기술적 제약 때문)

**"유튜브에서 긁어서"를 "앱이 유튜브 서버에서 직접 영상을 다운로드한다"로 구현하지 않았다.** 이유:

1. 이 프로젝트는 별도 제약으로 **로컬 서버 없이 디바이스 안에서(`file://`) 구동**해야 한다(§5). 브라우저 단독으로는 CORS 때문에 `youtube.com` / `googlevideo.com`에 직접 요청할 수 없다. 서버형 다운로더를 넣는 순간 이 제약이 깨진다.
2. 유튜브 약관상 무단 대량 다운로드는 문제가 될 수 있다.

그래서 **"오디오를 앱으로 들여오는 3가지 경로"**로 대체했다. 사용자 의도(유튜브 기타 영상 → 타브)는 세 경로 모두에서 그대로 달성된다:

- **경로 A — 탭 오디오 캡처 (기본/권장)**: `navigator.mediaDevices.getDisplayMedia({ video:true, audio:true })`로 사용자가 유튜브가 재생 중인 **브라우저 탭을 선택하고 "탭 오디오 공유"를 체크**하면, 그 탭의 소리를 앱이 직접 받아 녹음한다. 서버 없이, 브라우저 안에서 유튜브 소리를 그대로 "긁어오는" 경로다.
- **경로 B — 파일 드롭 (항상 동작하는 폴백)**: mp3/m4a/wav/ogg/mp4/webm 파일을 드래그&드롭 → `decodeAudioData`.
- **경로 C — yt-dlp 헬퍼 (선택, CLI)**: `tools/fetch-youtube.sh` / `.ps1`. 사용자 PC에 `yt-dlp`가 설치돼 있으면 URL → m4a로 뽑아주고, 그 파일을 경로 B로 넣는다. 앱 본체는 이 도구에 의존하지 않는다.

> Codex 참고: 경로 A는 보안 컨텍스트가 필요하다. `file://`은 대부분의 Chromium 계열에서 secure context로 취급되지만 `getDisplayMedia`가 차단되는 환경이 있다. **반드시 feature-detect 하고, 실패 시 경로 B/C 안내 문구로 graceful degrade** 시킬 것. 캡처 실패가 앱 사용 자체를 막으면 안 된다.

### 2.2 저작권 관련 설계 원칙 (반드시 유지)

- 앱은 **채보 도구**다. 곡 데이터베이스나 기성 타브를 내장/배포하지 않는다.
- PDF 푸터와 앱 최초 실행 안내에 **"개인 연습·학습 목적의 채보"** 고지를 넣는다.
- 가사(lyrics)는 다루지 않는다. 음정/리듬/코드만 다룬다.

---

## 3. 기술 방향 (스택 · 아키텍처 · 파일 구조)

### 3.1 스택

- **런타임**: 순수 브라우저. HTML + CSS + **클래식 스크립트 JS(ES5+ 문법, `type="module"` 금지)**.
  - 이유: `file://`에서 `<script type="module">`은 CORS로 차단된다. 클래식 `<script src>`는 동작한다. 전역 네임스페이스 `window.GT.*`로 모듈을 나눈다.
- **의존성 0개**. CDN 금지(오프라인 구동 보장). FFT, PDF 라이터, 신디사이저, MIDI 라이터 전부 자체 구현.
- **빌드 스텝 없음**. 파일을 그대로 열면 실행된다.
- **저장소**: `localStorage`(설정·API 키) + `IndexedDB`(곡 라이브러리·오디오 캐시). 용량 문제로 오디오 원본은 기본 저장하지 않고 채보 결과(JSON)만 저장.

### 3.2 GitHub 저장소 · 버전 관리

- 저장소: `https://github.com/jykim5215/-` (owner `jykim5215`, repo 이름이 `-` 한 글자)
- 개발 브랜치: `claude/vibrant-gauss-ka8kf3`
- 이 앱은 저장소 루트가 아니라 **`guitar-tab-studio/` 하위 폴더**에 있다. (루트에는 `철봉.com`이라는 무관한 기존 앱이 있으므로 건드리지 말 것.)
- 버전 파일: `guitar-tab-studio/version.json`
  ```json
  { "version": "1.0.0", "changelog": "...", "released": "YYYY-MM-DD", "assets": { "zip": "guitar-tab-studio-1.0.0.zip", "html": "GuitarTabStudio.html" } }
  ```
- semantic versioning. patch=버그수정 / minor=기능추가 / major=호환성 깨짐. **코드 수정 시 `version.json`도 같이 올린다.**
- 릴리즈 태그 형식: `guitar-tab-studio-v{version}` (루트의 다른 앱과 태그가 충돌하지 않도록 접두사 사용)

### 3.3 파일/폴더 구조

```
guitar-tab-studio/
├─ HANDOFF.md              ← 이 문서 (살아있는 문서, 계속 갱신)
├─ README.md               ← 사용자용 설명서
├─ version.json            ← 버전 + changelog (업데이트 확인의 기준)
├─ index.html              ← 앱 진입점 (file:// 로 바로 열림)
├─ app/
│  ├─ style.css            ← 선택된 UI 스타일의 실제 구현
│  ├─ core/                ← 화면과 무관한 순수 로직 (테스트 가능)
│  │  ├─ fft.js            ← radix-2 FFT, Hann window, STFT
│  │  ├─ audio.js          ← 디코드/리샘플/모노화, 탭 캡처 녹음, 파일 입력
│  │  ├─ transcribe.js     ← 온셋·다중음고·노트 트래킹·템포·조성·코드
│  │  ├─ fretboard.js      ← 음 → (현,프렛) DP 최적 운지, 튜닝/카포
│  │  ├─ tabmodel.js       ← 악보 데이터 모델(마디/보이스/노트), 편집 연산
│  │  ├─ render.js         ← Canvas 타브 렌더링 + 히트테스트(편집용)
│  │  ├─ synth.js          ← Karplus-Strong 발현음 + 메트로놈 재생
│  │  ├─ pdf.js            ← 의존성 없는 벡터 PDF 생성기 (악보집 합본 포함)
│  │  ├─ exporters.js      ← ASCII tab(.txt), MIDI(.mid), 프로젝트 JSON
│  │  ├─ library.js        ← IndexedDB 곡 라이브러리 CRUD
│  │  ├─ ai.js             ← (선택) Claude API 보정 레이어
│  │  └─ update.js         ← GitHub releases 기반 업데이트 확인
│  └─ ui/
│     ├─ app.js            ← 화면 조립 · 상태 머신 · 이벤트 배선
│     └─ i18n.js           ← 한국어 기본 / 영어
├─ ui-candidates/          ← UI 스타일 후보 3종 (사용자 선택용, 실행 가능한 html)
│  ├─ style-a-studio-dark.html
│  ├─ style-b-paper-score.html
│  └─ style-c-neo-tape.html
├─ tools/
│  ├─ fetch-youtube.sh / fetch-youtube.ps1   ← (선택) yt-dlp 헬퍼
│  ├─ make-shortcut.sh / make-shortcut.ps1   ← 원클릭 바로가기 생성
│  ├─ make-icons.py                          ← SVG 기반 PNG/ICO 아이콘 생성(표준 라이브러리만)
│  └─ package.sh                             ← 배포 zip + 개인정보 스크럽
├─ assets/
│  ├─ icon.svg, icon-256.png, icon.ico
├─ docs/SECURITY.md        ← 보안 점검 기록
└─ dist/                   ← 배포 zip 산출물 (git에는 zip 미포함, 릴리즈에 첨부)
```

### 3.4 데이터 흐름

```
[유튜브 탭 오디오 캡처 | 파일 드롭 | yt-dlp 산출물]
        ↓  Float32 PCM (모노 22050Hz)
   core/audio.js
        ↓
   core/fft.js  →  STFT 스펙트로그램
        ↓
   core/transcribe.js
     ├ 스펙트럴 플럭스 온셋 검출
     ├ 온셋 엔벨로프 자기상관 → BPM/비트 그리드
     ├ 스펙트럼 화이트닝 + 하모닉 살리언스 → 프레임별 다중 음고
     ├ 노트 트래킹(연속성 + 온셋 경계) → NoteEvent[]
     ├ 크로마 → 코드 템플릿 매칭 / Krumhansl 조성 추정
        ↓  NoteEvent[] {midi, startSec, durSec, velocity, confidence}
   (선택) core/ai.js  → Claude가 구간 라벨·운지 힌트·코드 정정
        ↓
   core/fretboard.js  → DP로 (string, fret) 배정
        ↓
   core/tabmodel.js   → 마디/박자 양자화된 Score 객체 (편집 가능)
        ↓
   core/render.js (화면) / core/synth.js (재생) / core/pdf.js (최종 PDF)
        ↓
   ★ 최종 산출물: 타브 악보집 PDF
```

**핵심 중간 자료형** (Codex는 이 형태를 유지할 것):

```js
NoteEvent = { midi:int, start:sec, dur:sec, vel:0..1, conf:0..1 }
Placed    = NoteEvent & { string:0..5(0=1번줄/가장 얇은 줄), fret:int }
Score = {
  meta:{ title, artist, sourceUrl, tuning:[midi x6], capo:int, bpm, timeSig:[4,4], key },
  measures:[ { index, beats, events:[ {tick, durTicks, notes:[Placed], chord?:string, section?:string, tech?:'h'|'p'|'/'|'\\'|'b'|'~' } ] } ]
}
Book = { title, author, songs:[scoreId], cover:{...} }   // 악보집
```

---

## 4. 구현 계획 (순서와 설계 결정 이유)

### Phase 0 — 인수인계·설계 (완료)
- `HANDOFF.md` 작성 → **코드보다 먼저** (프로젝트 규칙)

### Phase 1 — UI 스타일 3안 제시 (사용자 선택 필요)
- `ui-candidates/`에 실행 가능한 HTML 목업 3종. 사용자가 반드시 하나를 고른다.
- 3안 모두 **동일한 정보구조(IA)**를 쓰고 시각 언어만 다르게 한다. 그래야 선택 후 `app/style.css`만 갈아끼우면 되고 로직을 다시 안 짠다.

### Phase 2 — 코어 엔진 (UI 무관, 먼저 만들 것)
`fft.js → audio.js → transcribe.js → fretboard.js → tabmodel.js` 순.
- **설계 결정**: 다성(polyphonic) 채보는 완벽할 수 없다. 그래서 **"엔진 80% + 사람이 고치는 편집기 20%"** 구조로 간다. 자동 결과를 신뢰도(confidence)와 함께 내보내고, 낮은 신뢰 노트는 화면에서 흐리게 표시해 사용자가 빠르게 교정하게 한다. 완벽한 자동화를 노리다 못 쓰는 앱이 되는 것보다 낫다.
- **설계 결정**: 22050Hz 리샘플. 기타 최고 실용 음역(~C7, 2093Hz)의 하모닉을 충분히 보고, 연산량은 절반으로 줄인다.
- **설계 결정**: 운지 배정은 그리디가 아니라 **DP(Viterbi)**. 비용 = 프렛 이동거리 + 현 이동 + 손 위치 유지 + 개방현 보너스 + 동시발음 스트레치 페널티. 그리디는 중간에 손이 지판 끝으로 튀는 결과가 자주 나온다.

### Phase 3 — 렌더·편집·재생
`render.js → app.js → synth.js`. Canvas 2D로 타브 그리기 + 클릭/드래그 편집 + Karplus-Strong 재생(오프라인 사운드폰트 불필요).

### Phase 4 — PDF / 악보집 / 내보내기 ★최종 목표
`pdf.js`: 외부 라이브러리 없이 PDF 1.4를 직접 작성한다(선·텍스트만 쓰므로 충분하다. 표준 14폰트 Helvetica/Courier 사용).
- 단일 곡 PDF + **여러 곡 합본 악보집 PDF(표지 → 목차 → 각 곡)**
- 부가 내보내기: ASCII 타브 `.txt`, `.mid`, 프로젝트 `.json`

### Phase 5 — 업데이트 · 바로가기 · 패키징 · 보안
`update.js`, `tools/*`, `docs/SECURITY.md`, `dist/*.zip`

### Phase 6 — (선택) AI 보정 레이어
`ai.js`. Anthropic API를 브라우저에서 직접 호출(`anthropic-dangerous-direct-browser-access: true`). **사용자 본인 키를 앱에 입력받아 localStorage에 저장. 키 하드코딩 절대 금지.** 키 없으면 이 기능만 비활성화되고 나머지는 정상 동작.

---

## 5. 제약 조건 (프로젝트 규칙 — 반드시 지킬 것)

1. **배포용 압축 + 보안 점검**: 코드를 만들 때마다 `dist/`에 배포 zip을 만들고, 개인정보(로컬 경로, 키, 이메일 등)를 제거한 상태로 패키징한다. 수정·보고할 때마다 **어떤 취약점을 개선했는지(없으면 "없음")**를 보고 끝에 적는다.
2. **UI/UX**: 사용자 말을 그대로만 따르지 말고, 실제 사용자를 가정해 시뮬레이션하고 개편한다. **서로 다른 섹션에 같은/유사 기능이 중복 등장하면 통합한다.** UI 스타일 후보는 3개 이상 HTML로 보여주고 사용자가 고르게 한다.
3. **로컬 서버 없이 디바이스 내 구동**: `python -m http.server` 같은 방식 금지. `file://`로 열어서 언제든 정상 동작해야 한다. → CDN·ES module·fetch(상대경로 JSON) 사용 금지. 필요한 데이터는 JS에 인라인.
4. **원클릭 바로가기**: 주제(기타/악보)와 관련된 아이콘으로 바로가기를 만든다.
5. **GitHub 릴리즈 기반 자체 업데이트**: 앱 안에 "업데이트 확인" 버튼 + 실행 시 자동 확인. `https://api.github.com/repos/jykim5215/-/releases/latest` 호출 → 내장 버전과 비교 → changelog 보여주고 승인 시 최신 산출물 내려받기. 네트워크 실패해도 앱은 계속 쓸 수 있어야 한다. 토큰 하드코딩 금지(공개 API만 사용).
6. **HANDOFF.md는 살아있는 문서**: 진행 상황이 바뀌면 §6을 갱신한다.

### 이 프로젝트 고유의 제약
7. `file://`에서 `fetch('./version.json')`은 CORS로 실패한다. → **앱 내장 버전 상수는 JS 안에 하드코딩**하고(`GT.VERSION`), `version.json`은 릴리즈/서버 쪽 진실 소스로만 쓴다. 둘이 어긋나지 않게 릴리즈 시 같이 올린다.
8. `getDisplayMedia` 미지원/차단 환경을 항상 가정하고 폴백(파일 드롭)을 1급 시민으로 둔다.
9. 저장소 루트의 `철봉.com` 앱(`index.html`, `script.js`, `styles.css`, `server.py`)은 **무관한 기존 프로젝트이므로 수정·삭제 금지.**

---

## 6. 현재 상태 (Living — 작업할 때마다 갱신)

> 최종 갱신: 2026-09-11 · **v1.1.0 — 구현 완료 + Cloudflare Pages 배포 준비 완료, 브라우저 E2E 검증 통과**

### 끝난 것
- **Phase 0** `HANDOFF.md` (코드보다 먼저 작성)
- **Phase 1** UI 스타일 후보 3종 → 사용자가 **B · 페이퍼 스코어** 선택 → `app/style.css` 로 구현
- **Phase 2** 코어 엔진: `fft.js` `audio.js` `transcribe.js` `fretboard.js` `tabmodel.js`
- **Phase 3** `render.js`(캔버스 + 히트테스트) `synth.js`(Karplus-Strong) `ui/app.js`
- **Phase 4** `pdf.js` — 의존성 0개 벡터 PDF. 단일 곡 + 악보집(표지·목차·쪽번호). `exporters.js`(ASCII/MIDI/JSON)
- **Phase 5** `update.js` `library.js`, `tools/*`, `assets/*`, `docs/SECURITY.md`, `dist/*.zip`
- **Phase 6** `ai.js` — 선택 기능. 키 없으면 이 기능만 꺼진다.
- **Phase 7 (v1.1.0) 웹 배포** — `_headers`(CSP·Permissions-Policy) `_redirects` `wrangler.toml` `.assetsignore`,
  `tools/deploy-cloudflare.sh`, `.github/workflows/deploy-guitar-tab-studio.yml`(저장소 루트), `docs/DEPLOY.md`

### v1.1.0 에서 바뀐 앱 동작
`app/core/update.js` 에 `runtime()` 추가 — `location.protocol` 로 실행 환경을 구분한다.
- `web`(http/https) → 업데이트 모달이 **"새로고침해서 적용"** 버튼을 보여준다 (사이트 자체가 갱신되므로)
- `file` → 기존대로 릴리즈 zip 내려받기 안내

### 검증 결과 (Playwright + Chromium)
합성 기타 아르페지오(7.8초, 실제 100 BPM)로 **`file://` 와 `http://`(실제 `_headers` CSP 적용) 양쪽에서** 전 구간 실행.
- 모듈 13개 로드, 페이지 에러 0건, **CSP 위반 0건**
- BPM 99 추정(실제 100), 조성 Am, 2마디 24음, 신뢰도 63%
- 단일 PDF 1페이지 / 악보집 PDF 3페이지(표지+목차+악보) — 헤더·xref·`%%EOF` 유효
- ASCII 타브·MIDI(`MThd`/`MTrk`) 정상
- `runtime()` 이 http 에서 `web`, file 에서 `file` 로 정확히 판별됨
- 업데이트 확인이 네트워크 실패해도 앱은 정상 동작 (요구사항대로 graceful degrade)

### 배포 상태 — **사용자 조치 필요**
- **Cloudflare Pages: 아직 게시 전.** 설정 파일과 워크플로는 전부 준비됐지만, 계정 자격증명이 없어
  실제 배포는 실행하지 못했다. `docs/DEPLOY.md` 의 방법 A(대시보드 Git 연결) / B(wrangler) / C(Actions 시크릿) 중 하나 선택 필요.
  **⚠️ Pages 설정에서 루트 디렉터리를 반드시 `guitar-tab-studio` 로 지정할 것** — 저장소 루트에는 무관한 다른 앱의 `index.html` 이 있다.
- **GitHub 릴리즈: 아직 게시 전.** 태그 `guitar-tab-studio-v1.1.0` + `dist/guitar-tab-studio-1.1.0.zip` 첨부 예정.
  계정에 반영되는 작업이라 승인 전에는 올리지 않는다. 릴리즈가 올라가야 앱의 업데이트 확인이 실제로 동작한다.
- **브랜치**: `claude/vibrant-gauss-ka8kf3` · **PR**: jykim5215/-#7 (draft, mergeable)
- **앱 내 업데이트 확인**: 구현 완료. **배포 zip**: `dist/guitar-tab-studio-1.1.0.zip` (약 104KB)

### 알려진 품질 이슈 / 다음에 손볼 것 (우선순위 순)
1. **다성 채보 정확도** — 감쇠가 긴 아르페지오에서 유령음(16음 연주 → 24음 검출). `transcribe.js` 의
   `subtractHarmonics` 감쇠 계수(현재 0.15)와 `trackNotes` 임계값 튜닝 여지.
2. **리듬 양자화** — 16분음표 고정 격자(`SUBDIV=4`). 셋잇단·스윙 미지원. `tabmodel.js` 에 `subdiv=12` 경로 추가하면 된다.
3. **PDF 리듬 표기** — 타브에 음표 길이(기둥/깃발)를 그리지 않는다. `pdf.js` 의 `drawMeasure` 아래에 스템 추가.
4. **마디 수동 편집** — `insertMeasure`/`deleteMeasure` 는 있으나 UI 미노출.
5. **구간 반복 감지** — 현재는 AI 있을 때만 구간 라벨. 자기유사도 행렬로 오프라인 검출 가능.

### Codex가 이어받을 때
```bash
cd guitar-tab-studio
python3 tools/make-icons.py        # 아이콘 재생성
bash tools/package.sh              # 배포 zip + 스크럽 점검
bash tools/deploy-cloudflare.sh    # Cloudflare Pages 배포 (wrangler 필요)
# 브라우저로 index.html 을 열면 서버 없이 바로 실행된다
```
코드 수정 시 **세 곳의 버전을 같이 올릴 것**: `version.json`, `app/core/update.js` 의 `VERSION` 상수,
`index.html` 의 버전 배지 텍스트. 어긋나면 업데이트 확인이 잘못 동작한다.
