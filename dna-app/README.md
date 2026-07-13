# DNA 편집실 (dna-desk) — 디지스트신문 DNA 편집 지원 앱

기자 한 명이 기사 기획부터 카드뉴스 발행까지 핵심 워크플로우를 한 곳에서 진행하는 Electron 데스크톱 앱.

```
[1] 브레인스토밍 → [2] 자료 수집 → [3] 분석·제언 → [4] 기사 초안 → [5] 카드뉴스
메일함: 취재 요청·회신·반송 확인과 발송을 독립 업무면에서 처리
```

## 실행 방법

```bash
cd dna-app/app
npm install        # 최초 1회 (Electron 포함)
npm start          # 앱 실행
npm run shortcut   # 바탕화면 바로가기 생성 (신문/펜/DNA 아이콘)
npm test           # 테스트
npm run eval       # 골드셋 평가 + 회귀 검사 (하락 시 배포 차단)
npm run analyze:references -- --article 기사.docx --cardnews 카드뉴스.pptx --out reference_pairs/review/slug
npm run dist       # 보안 스캔 + 배포 zip 생성 (dna-app/dist/)
npm run installer  # electron-builder 설치본 (AppImage/NSIS/DMG)
npm run release    # GitHub Releases에 설치본 + latest.yml 업로드

# 부트스트랩 임포트 (네트워크 되는 PC에서)
node scripts/import-archive.mjs --db <userData>/dna-data/dna.sqlite            # dgistdna.com 기사
node scripts/import-archive.mjs --db <...> --pptx 과거카드뉴스.pptx --match-title "기사제목"
node scripts/export-dataset.mjs --db <...> --tag dataset-v0.1 --finetune       # 데이터셋 export
```

- Google 연결: 프로필에서 Google 계정만 연결하면 Gemini AI 기능을 호출합니다. OAuth 토큰은 OS 키체인(safeStorage)에 암호화 저장되어 다시 묻지 않습니다. OAuth는 PKCE·로컬 콜백을 사용하고 만료 토큰을 자동 갱신합니다.
- 학교 메일 송수신: 앱 내 프로필 또는 메일함에서 DGIST 주소와 비밀번호를 저장합니다. 기본 SMTP는 `mail.dgist.ac.kr:587`(STARTTLS), 기본 IMAP은 `mail.dgist.ac.kr:993`(SSL/TLS)입니다.
- 앱 업데이트: 패키징된 설치본은 GitHub Releases의 `latest.yml`을 확인해 새 버전을 다운로드하고, 앱 안에서 재시작 설치합니다. 새 버전을 배포할 때는 `package.json`의 version을 올린 뒤 `npm run release`를 사용합니다.
- 실제 SQLite·Gemini·메일·PPTX 기능은 Electron 앱에서만 동작합니다. 브라우저 직접 실행은 차단됩니다.

## 진행 상태

| 마일스톤 | 상태 |
|---|---|
| 1. UI 스타일 시안 3종 → **시안 C(파이프라인 스튜디오) 선택됨** | ✅ |
| 2. 프로젝트 구조 + 데이터 스키마 + 저장 계층 (학습 데이터 파이프라인 Layer 1) | ✅ |
| 3. 기사 초안 + 카드뉴스 PPTX 생성 | ✅ |
| 4. 브레인스토밍·자료 수집·분석과 독립 메일함 | ✅ |
| 5. RAG 스타일 엔진(BM25 few-shot) + 평가 하네스(검사기·judge·회귀 차단·대시보드) | ✅ |
| 6. 과거 자산 임포트(WP REST/RSS·pptx 쌍) + 파인튜닝 트랙(LoRA 스캐폴드·발동 조건 강제) | ✅ |
| 7. 아이콘·바로가기·electron-builder·배포 zip·보안 점검 | ✅ |

### 기자 워크플로우 편의 기능 (v0.5)

| 기능 | 내용 |
|---|---|
| 자동 저장 | 초안 2초 디바운스 자동 저장 + 이탈 시 강제 플러시, 저장 타임스탬프 표시 |
| 프로필·시작 흐름 | 이름·직함·Google 계정·DGIST 메일·앱 디자인을 한 화면에서 관리하고, 앱 내부 프로젝트 창에서 브레인스토밍으로 바로 진입 |
| 자동 업데이트 | GitHub Releases 기반 업데이트 확인·다운로드·재시작 설치 |
| 글자 수 | 공백 포함/제외 + 예상 카드 수 실시간 |
| 버전 복원 | 저장할 때마다 버전 축적 → 목록/복원 |
| 자료·프로젝트 관리 | 자료 삭제·편집(출처 필수 유지), 프로젝트 이름변경·삭제 |
| 프로젝트·메뉴 구조 | 모든 프로젝트를 제목·현재 단계와 함께 표시하고, 메뉴를 기사 제작·소통·관리로 구분하며 새 프로젝트 항목을 한 화면에서 연속 입력 |
| 통합 파일 수집 | 파일 드롭 또는 Drive 다중 선택으로 모든 형식을 받고, 문서·녹취·사진·첨부로 자동 분류하며 원본 보관 |
| 메일함 | 메일앱식 폴더·목록·읽기·작성 4열 화면, 작성 자동 임시저장, SMTP 발송 + IMAP 받은메일 확인·자료 저장 |
| 개발자 모드 | 설정에서 켜고 끄며, 기사 지침·표본을 Google Drive에 보관하고 AI 분석 결과를 런타임 자동화 프로필로 적용 |
| 카드뉴스 내보내기 | 공식 PPTX 템플릿 유지, PPTX/PNG 선택 저장, 로컬·Google Drive 동시 활용 |
| 카드뉴스 사진 | 커버·카드별 사진을 로컬 또는 Google Drive에서 선택 → pptx 원본 이미지 교체(프레임·잠금 유지) |
| 문서 미리보기 | DOCX/PPTX를 앱 안에서 미리보고 원본 파일을 기본 앱으로 열기 |
| 참고자료 품질 게이트 | DOCX 댓글·추적 변경, PPTX 규격·숨은 문구, Q&A 원문 발췌를 감사해 미통과 쌍을 학습에서 격리 |
| 인라인 하이라이트 | 편집창에서 직접인용을 검증색(초록/노랑/빨강)으로 표시 |
| 인터뷰 받아쓰기 | 오디오 → 텍스트(로컬 whisper.cpp, 취재원 보호), 녹취로 자동 저장 |
| 온보딩·단축키·PDF | 첫 실행 3스텝 안내, Ctrl+S 저장·Ctrl+Enter AI 실행, 초안 PDF(Electron 내장) |

남은 작업: 실사용 데이터 축적 후 골드셋 20~30케이스 확장, 임베딩 검색 업그레이드(BM25 → 벡터),
아카이브 임포트 실행(네트워크 가능한 PC에서), Windows용 icon.ico 변환.

## 구조

```
dna-app/
├── templates/                     # 공식 pptx 템플릿 + 구조 분석(ANALYSIS.md)
├── design-mockups/                # 마일스톤 1 UI 시안 3종
└── app/
    ├── main.js / preload.js       # Electron (contextIsolation, sandbox, safeStorage)
    ├── renderer/                  # UI (시안 C) — Electron 전용
    ├── rules/                     # 불변 규칙 (하드코딩) ← 스타일과 분리
    ├── style_corpus/              # DNA 문체 코퍼스 (RAG, gold/ 골드 스탠다드)
    ├── prompts/v1/                # 버전 관리되는 프롬프트 (변경 = 모델 버전 변경)
    ├── src/main/                  # SQLite 저장 계층, 학습 레코드, Gemini 연동
    ├── src/shared/                # 검증기 (인용 대조·따옴표·edit distance·글자 가중치)
    ├── src/pptx/                  # pptx XML 직접 편집 엔진 + 카드뉴스 생성기
    ├── reference_pairs/           # 기사→카드뉴스 구조화 쌍 (ready/review 품질 상태)
    ├── tests/                     # node --test
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
- **카드뉴스 발췌 검증기**: Q&A의 발화자별 문장을 기사 원문과 대조해 재서술된 답변은
  구성안 생성과 PPTX 내보내기 단계에서 차단.
- **pptx 엔진**: 원본 zip의 XML만 직접 편집. `<a:t xml:space="preserve">` + 유니코드 수동
  이스케이프, 슬라이드 복제 시 rId 최댓값+1 할당 + `<p:sldIdLst>` 수동 등록, 서식(`a:rPr`)
  불변. 검증: 자체 테스트 + python-pptx 교차 파싱.
- **출처 강제**: 출처 없는 자료는 DB CHECK + 앱 레벨 이중 방어로 저장 불가.
