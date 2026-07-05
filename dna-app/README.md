# DNA 편집실 (dna-desk) — 디지스트신문 DNA 편집 지원 앱

기자 한 명이 기사 기획부터 카드뉴스 발행까지 6단계 워크플로우를 한 곳에서 진행하는 Electron 데스크톱 앱.

```
[1] 브레인스토밍 → [2] 취재 이메일 → [3] 자료 수집 → [4] 분석·제언 → [5] 기사 초안 → [6] 카드뉴스
```

## 실행 방법

```bash
cd dna-app/app
npm install        # 최초 1회 (Electron 포함)
npm start          # 앱 실행
npm test           # 테스트 (13개)
npm run dist       # 보안 스캔 + 배포 zip 생성 (dna-app/dist/)
```

- Claude API 키: 앱 내 ⚙설정에서 입력 → OS 키체인(safeStorage)으로 암호화 저장. 또는 `ANTHROPIC_API_KEY` 환경변수.
- Electron 없이 UI만 보려면 `app/renderer/index.html`을 브라우저로 열면 **데모 모드**(인메모리 + 캔드 응답)로 동작.

## 진행 상태

| 마일스톤 | 상태 |
|---|---|
| 1. UI 스타일 시안 3종 → **시안 C(파이프라인 스튜디오) 선택됨** | ✅ |
| 2. 프로젝트 구조 + 데이터 스키마 + 저장 계층 (학습 데이터 파이프라인 Layer 1) | ✅ |
| 3. 단계 5(기사 초안) + 단계 6(카드뉴스 pptx 생성) | ✅ |
| 4. 단계 1~4 | ⬜ |
| 5. RAG 스타일 엔진 + 평가 하네스 | ⬜ (구조만: `rules/` vs `style_corpus/` 분리, 프롬프트 버전 관리) |
| 6. 과거 자산 임포트 + 파인튜닝 트랙 스캐폴딩 | ⬜ (골드 스탠다드 1호 등록됨) |
| 7. 패키징·바로가기·최종 보안 점검 | ⬜ (배포 zip 스크립트는 동작) |

## 구조

```
dna-app/
├── templates/                     # 공식 pptx 템플릿 + 구조 분석(ANALYSIS.md)
├── design-mockups/                # 마일스톤 1 UI 시안 3종
└── app/
    ├── main.js / preload.js       # Electron (contextIsolation, sandbox, safeStorage)
    ├── renderer/                  # UI (시안 C) — 브라우저 데모 모드 내장
    ├── rules/                     # 불변 규칙 (하드코딩) ← 스타일과 분리
    ├── style_corpus/              # DNA 문체 코퍼스 (RAG, gold/ 골드 스탠다드)
    ├── prompts/v1/                # 버전 관리되는 프롬프트 (변경 = 모델 버전 변경)
    ├── src/main/                  # SQLite 저장 계층, 학습 레코드, Claude 연동
    ├── src/shared/                # 검증기 (인용 대조·따옴표·edit distance·글자 가중치)
    ├── src/pptx/                  # pptx XML 직접 편집 엔진 + 카드뉴스 생성기
    ├── tests/                     # node --test (13개)
    └── scripts/make-dist-zip.mjs  # 보안 스캔 + 배포 zip
```

## 핵심 설계 결정

- **학습 데이터 파이프라인 (Layer 1)**: 모든 AI 호출이 `records`에 (입력, AI 초안) 저장 →
  기자가 최종본 저장 시 human_final + edit distance 자동 기록 → 별점·태그 피드백 위젯.
  export 시 이메일·전화번호 자동 마스킹 + 취재원 실명 마스킹 옵션.
- **규칙 vs 스타일 분리**: 따옴표 규칙·카드뉴스 규격은 `rules/`(시스템 프롬프트 상수),
  문체는 `style_corpus/`(RAG 예시)로 분리. 프롬프트는 `prompts/v1/` 디렉터리 버전 관리.
- **인용 검증기**: 초안의 큰따옴표 문장을 수집 자료와 정규화·퍼지 매칭으로 대조.
  exact(초록) / fuzzy(노랑 — 토씨 확인) / missing(빨강 — 간접인용 전환).
- **pptx 엔진**: 원본 zip의 XML만 직접 편집. `<a:t xml:space="preserve">` + 유니코드 수동
  이스케이프, 슬라이드 복제 시 rId 최댓값+1 할당 + `<p:sldIdLst>` 수동 등록, 서식(`a:rPr`)
  불변. 검증: 자체 테스트 + python-pptx 교차 파싱.
- **출처 강제**: 출처 없는 자료는 DB CHECK + 앱 레벨 이중 방어로 저장 불가.
