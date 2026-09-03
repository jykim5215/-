# HANDOFF.md — 부스 배치도 플래너 (Booth Layout Planner)

이 문서는 Claude Code 와 Codex 사이에서 작업을 이어받기 위한 자기완결적 핸드오프 브리프입니다.
이 문서를 읽는 에이전트는 사용자와 Claude Code 사이의 채팅 기록을 볼 수 없다는 전제로 작성했습니다.
이 문서 하나만 읽고도 요구사항·설계·현재 상태를 그대로 이어받을 수 있어야 합니다.

---

## 1. 프로젝트 개요와 목표

전시 부스(및 그 바깥 공간)의 배치도를 그리기 위한 **2D 평면도 편집기**입니다.
사용자는 실측 치수(너비·깊이)를 가진 박스(가구·집기)를 캔버스에 놓고, 모양과 이름(예: 의자, 책상)을 바꾸며,
드래그·회전·크기 조절로 자유롭게 배치합니다. 브라우저에서 `index.html` 을 더블클릭하면 바로 실행됩니다(서버 없음).

## 2. 사용자 요구사항 정리 (사용자가 채팅에서 실제로 말한 내용)

사용자 원문 요지: *"부스 내·외의 배치도를 위한 평면도를 그려보려고 해. 박스 형태에 실측 길이·너비를 넣을 수 있게 하고,
모양도 바꾸고, 의자인지 책상인지 이름도 넣을 수 있게 해서 자유롭게 조작할 수 있는 프로그램을 만들어줘."*

항목별 정리:

1. **부스 내부와 외부 모두** 배치할 수 있는 평면도 → 부스는 캔버스 위의 '구역(zone)' 하나이며, 캔버스는 부스보다 넓다. 부스 밖에도 물건을 둘 수 있고, 구역(zone)을 여러 개 추가할 수 있다.
2. **박스 형태의 객체에 실측 길이·너비를 입력** → 각 객체는 실제 단위(cm 기본, mm/m 표시 전환)의 너비(w)와 깊이(d)를 가진다. 숫자를 직접 입력하거나 핸들을 드래그해서 바꾼다. 캔버스에 치수(예: `120 × 60`)를 함께 표시한다.
3. **모양을 바꿀 수 있어야 함** → 사각형 / 둥근 사각형 / 원·타원 / 삼각형 / 마름모 / 반원 / 구역(점선 외곽선). 선택된 객체의 모양을 언제든 바꿀 수 있다.
4. **이름을 넣을 수 있어야 함** (의자인지 책상인지) → 객체마다 자유 텍스트 이름. 자주 쓰는 집기(책상·의자·테이블·파티션·배너·모니터 등)는 프리셋 라이브러리로 원클릭 추가.
5. **자유롭게 조작** → 드래그 이동, 8방향 크기 조절 핸들, 회전 핸들 + 각도 입력, 복제, 삭제, 앞/뒤 순서, 잠금, 격자 스냅, 실행취소/다시실행, 키보드(방향키 이동, Delete, Ctrl+Z/Y/D), 휠 확대·축소, 스페이스+드래그 팬.

Claude Code 가 해석해서 덧붙인 부분(이유 포함):
- **저장/불러오기(JSON), PNG/SVG 내보내기, 인쇄, 자동 저장(localStorage)** — 배치도는 남에게 공유하거나 다음에 이어 그리는 용도가 대부분이므로 필수라고 판단.
- **부스 자체의 실측 치수 입력** — 부스 내/외 배치라는 목적상 부스 크기가 기준이 되어야 하기 때문.
- **테마 3종(블루프린트 / 페이퍼 / 스튜디오)** — 스킬 규칙(UI 스타일 후보 3개 제시)을 만족시키면서, 사용자가 앱 안에서 바로 고를 수 있게 함.

## 3. 기술 방향

- **스택**: 순수 HTML + CSS + JavaScript (프레임워크·빌드 도구·npm 없음). 캔버스는 **SVG** (DOM 히트테스트와 벡터 내보내기가 쉬움).
- **실행 방식**: `file://` 로 `index.html` 을 직접 열어 구동. ES module 을 쓰지 않는다(`file://` 에서 CORS 로 막힘). 외부 CDN 의존 없음(오프라인 동작).
- **저장소**: GitHub `jykim5215/-` (기존에 '철봉.com' 이라는 별개 앱이 루트에 있음 → 이 앱은 `booth-planner/` 하위 폴더에만 존재. 루트 파일은 건드리지 않는다.)
- **작업 브랜치**: `claude/booth-layout-floor-plan-m5w3hs`
- **버전 관리**: `booth-planner/version.json` → `{"version": "x.y.z", "changelog": "..."}` (semver). `app.js` 상단의 `APP_VERSION` 상수와 항상 같은 값이어야 한다.
- **릴리즈**: GitHub Release 태그 형식 `booth-planner-v1.0.0` (루트의 다른 앱과 태그 충돌을 피하기 위해 접두사 사용). 릴리즈에 `dist/booth-planner-v{version}.zip` 과 `version.json` 첨부.

### 폴더 구조

```
booth-planner/
├── HANDOFF.md              ← 이 문서
├── README.md               ← 사용자용 사용법
├── index.html              ← 앱 셸 (툴바 / 좌측 라이브러리 / SVG 캔버스 / 우측 속성 패널 / 모달)
├── app.css                 ← 레이아웃 + 테마 3종 (body[data-theme])
├── app.js                  ← 전체 로직 (상태, 렌더, 입력 처리, 저장, 내보내기, 업데이트 확인)
├── version.json            ← 버전·changelog
├── icon.svg                ← 앱 아이콘 (평면도 모티브)
├── 부스배치도.bat            ← Windows 원클릭 실행
├── 부스배치도.command        ← macOS 원클릭 실행
├── 부스배치도.desktop        ← Linux 원클릭 실행
├── make-shortcut.ps1       ← Windows 바탕화면 .lnk 바로가기 생성(아이콘 포함)
├── style-candidates/       ← UI 스타일 후보 3개 미리보기(HTML)
│   ├── index.html          ← 3종 비교 갤러리 (각 카드의 링크로 해당 테마 실행)
│   ├── blueprint.png / paper.png / studio.png  ← 실제 앱 스크린샷 (Playwright 로 생성)
└── dist/
    └── booth-planner-v{version}.zip  ← 배포용 압축 (개인정보 없음)
```

### 데이터 모델 (`app.js`)

```js
state = {
  schema: 1,
  unit: 'cm' | 'mm' | 'm',        // 표시 단위. 내부 저장은 항상 cm
  grid: 10,                       // 격자 간격(cm)
  snap: true,
  showDims: true,                 // 캔버스에 치수 텍스트 표시
  theme: 'blueprint' | 'paper' | 'studio',
  booth: { name: '부스', w: 300, d: 300 },   // 기준 부스(구역). 캔버스 원점(0,0)이 부스 좌상단
  items: [ {
    id, name, shape: 'rect'|'round'|'ellipse'|'triangle'|'diamond'|'semicircle'|'zone',
    x, y,        // 중심 좌표(cm), 부스 좌상단 기준
    w, d,        // 너비·깊이(cm)
    rot,         // 회전(deg)
    color,       // 채움색(hex)
    locked, showDim, note
  } ],
}
```

### 주요 모듈(함수) 계획 — `app.js`

- `state`, `history` (undo/redo 스택, JSON 스냅샷), `commit(label)` — 변경 확정 시 스냅샷 push + autosave.
- `render()` — 상태 → SVG 전체 재그리기(격자, 부스, 항목, 치수, 선택 핸들). 색은 `THEMES[state.theme]` 의 JS 객체에서 읽어 **속성으로 직접** 넣는다(내보내기 시 CSS 없이도 동일하게 보이도록).
- `shapePath(shape, w, d)` — 로컬 좌표(중심 0,0) 기준 path/element 생성.
- 포인터 처리: `onPointerDown/Move/Up` 하나로 통합. 모드: `move` / `resize(handle)` / `rotate` / `pan` / `marquee`. 회전된 객체의 리사이즈는 포인터 델타를 객체 로컬 좌표로 역회전해서 적용.
- `toWorld(clientX, clientY)` — 화면 → cm 좌표(뷰박스/줌/팬 반영).
- 속성 패널: `bindInspector()` — 선택 항목의 값 표시, 입력 시 즉시 반영 후 `commit`.
- 라이브러리: `PRESETS` 배열(이름, 모양, w, d, 색). 클릭 시 부스 중앙 근처에 추가.
- 저장/불러오기: `saveJSON()` / `loadJSON(file)` (`validateState()` 로 스키마 검증 — 신뢰할 수 없는 파일 대비), `autosave` (localStorage 키 `boothPlanner.v1`).
- 내보내기: `exportSVG()`, `exportPNG()` (SVG → Image → canvas → PNG), `print` (CSS @media print 로 캔버스만 출력).
- URL 해시 옵션: `#theme=paper` 로 테마 지정, `#demo` 로 예시 배치 강제 로드 (스타일 미리보기·스크린샷용). 첫 실행(자동 저장 없음)에도 예시 배치를 보여준다.
- 업데이트: `checkUpdate()` — `https://api.github.com/repos/jykim5215/-/releases` 를 fetch 해 태그가 `booth-planner-v` 로 시작하는 최신 릴리즈를 찾고 `APP_VERSION` 과 semver 비교. 새 버전이면 changelog 를 모달로 보여주고, 사용자가 승인하면 릴리즈의 zip 자산을 다운로드(브라우저 다운로드). `file://` 로 실행되는 정적 페이지는 스스로 파일을 덮어쓸 수 없으므로, 다운로드 후 "압축을 풀어 같은 폴더에 덮어쓰기" 안내를 표시한다. 네트워크 실패 시 에러 토스트만 띄우고 앱은 계속 동작.

## 4. 구현 계획 (순서와 설계 결정)

1. `HANDOFF.md` (이 문서) 작성 → 2. 스타일 후보 3개 HTML → 3. `index.html`/`app.css`/`app.js` 본체 → 4. 아이콘·바로가기 → 5. `version.json`/README/zip → 6. 보안 점검 → 7. 커밋·푸시·PR.

설계 결정과 이유:
- **SVG 채택**: 객체별 DOM 요소가 있어 클릭/드래그 처리와 벡터(SVG) 내보내기가 간단. 수백 개 객체 수준에서는 성능 문제 없음.
- **내부 단위 cm 고정, 표시 단위만 전환**: 단위 변환 버그를 줄이기 위해 저장 데이터는 항상 cm.
- **상태 전체를 매번 다시 그리는 단순 렌더**: 코드 이해와 Codex 인계가 쉬움. 성능 최적화보다 단순성을 우선.
- **테마를 JS 객체 + CSS 변수 이중으로 정의**: UI 는 CSS 변수, 캔버스는 JS 객체(내보내기에서 CSS 를 참조할 수 없기 때문).
- **좌측 = 추가(라이브러리·도형·부스 설정), 우측 = 선택 항목 편집, 상단 = 파일·보기·편집 툴바**: '추가'와 '편집' 기능이 두 곳에 중복 등장하지 않도록 역할을 분리. 치수 편집은 우측 속성 패널 한 곳에서만 한다(캔버스 라벨 더블클릭은 이름 편집 바로가기로만 씀).

## 5. 제약 조건

- 개인정보·자격증명(토큰, 이메일, 로컬 경로)을 코드나 배포 압축에 넣지 않는다. GitHub 공개 API 만 무인증으로 사용한다.
- 로컬 서버 없이 `file://` 로 동작해야 한다. ES module, `fetch` 로 로컬 파일 읽기, 외부 CDN 금지.
- 사용자 입력(이름·메모)은 반드시 `textContent` 로만 DOM 에 넣는다(`innerHTML` 금지). 불러온 JSON 은 `validateState()` 로 타입·범위 검증.
- 원클릭 바로가기(bat/command/desktop + Windows .lnk 생성 스크립트)와 주제에 맞는 아이콘을 제공한다.
- 루트의 다른 앱(철봉.com: `index.html`, `script.js`, `server.py` 등)은 수정하지 않는다.
- 코드를 바꿀 때마다 `version.json` 과 `APP_VERSION` 을 함께 올리고, `dist/` zip 을 다시 만들고, 이 문서의 "현재 상태"를 갱신한다.

## 6. 현재 상태

- **검증**: Playwright(Chromium, `file://`)로 프리셋 추가 → 드래그 → 리사이즈 → 회전 → 이름/모양 변경 → 단위 전환 → 실행 취소 → JSON 저장 → PNG 내보내기 → 악성 JSON 불러오기(스크립트 문자열·잘못된 타입·범위 초과) → 업데이트 확인 실패 처리까지 자동 시나리오로 통과. 발견해 고친 버그: `.modal-backdrop{display:flex}` 가 `hidden` 속성을 덮어써 투명 모달이 클릭을 막던 문제(`[hidden]{display:none!important}` 추가).
- **완료**: 설계, 스타일 후보 3종, 앱 v1.0.0 전체 기능(객체 추가/이름/모양/실측 치수/이동/회전/크기조절/복제/삭제/순서/잠금/격자 스냅/실행취소/저장·불러오기/PNG·SVG 내보내기/인쇄/자동저장/테마 3종/업데이트 확인), 바로가기, 아이콘, 배포 zip, README.
- **GitHub**: 브랜치 `claude/booth-layout-floor-plan-m5w3hs` 에 푸시, PR 생성. **GitHub Release 는 아직 게시하지 않음** (사용자 확인 필요 — 릴리즈 태그 `booth-planner-v1.0.0` 로 zip + version.json 첨부 예정).
- **업데이트 확인 기능**: 구현 완료. 릴리즈가 하나도 없으면 "최신 버전입니다(릴리즈 없음)" 로 처리. 실제 동작 확인은 첫 릴리즈 게시 후 가능.
- **다음 할 일**: (1) 사용자에게 스타일 기본값 확정받기(현재 기본 'blueprint'), (2) 사용자 승인 후 첫 릴리즈 게시, (3) 피드백 반영.
