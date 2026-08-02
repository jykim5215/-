# HANDOFF.md — VocaCard (안드로이드 단어장 앱)

> 이 문서는 Codex/다른 코딩 에이전트가 **이 파일 하나만 읽고도** 프로젝트를 그대로 이어받을 수 있도록
> 자기완결적으로 작성되었다. 대화 히스토리를 볼 수 없다는 전제로 씌어졌다.
> 코드나 진행 상황이 바뀌면 6절(현재 상태)과 관련 항목을 반드시 갱신할 것.

---

## 1. 프로젝트 개요와 목표

**VocaCard** 는 토익/기초 영단어 30일 커리큘럼(1,222 단어)을 내장한 **안드로이드 네이티브 단어장 앱**이다.
"Class Card" 앱의 학습 포맷(플래시카드 → 리콜 → 객관식 퀴즈 → 스펠링)을 따르며,
사용자가 몰랐던 단어를 자동/수동으로 모아 간격 반복(spaced repetition)으로 계속 복습하게 만든다.
**부드러운 모션이 제품의 핵심 가치**다.

---

## 2. 사용자 요구사항 정리 (원문 의도 그대로)

사용자가 채팅에서 실제로 요구한 내용:

1. **안드로이드 기반 단어장 앱**을 만들어 달라.
2. 단어장은 기본적으로 **"Class Card" 애플리케이션의 포맷**을 따라 달라.
3. **아카이브 란**에는 제공한 **엑셀 파일을 정리해서 "데이(Day)별"로** 넣어 달라.
   - 제공된 엑셀: `Day / 단어 / 뜻 / 외움` 4열, `Sheet1` 기준 1,222행, `day1`~`day30`.
4. **내가 몰랐던 단어를 스스로 정리해서 계속 보게 하는 기능**이 필요하다.
5. **내가 영어(단어)를 적으면 추천 뜻을 띄워 주고(다의어 같은 경우), 거기서 내가 선택해서 저장**할 수 있게 해 달라.
6. **예문도 함께 추천**해 주고, **정리해서 저장**할 수 있게 해 달라.
7. **부드러운 모션이 핵심인 앱**이다.

### 해석하며 바꾼/보강한 부분과 그 이유

| 항목 | 결정 | 이유 |
|---|---|---|
| "Class Card 포맷" | 정확한 UI 복제가 아니라 **학습 흐름**(암기 카드 → 리콜 → 객관식 → 스펠링, 세트/폴더 개념, 진도율)만 차용 | 상용 앱의 화면·에셋 그대로 베끼면 저작권 문제. 학습 포맷은 교육 관례이므로 안전. |
| "몰랐던 단어" 수집 | 학습 중 "몰라요" 처리 시 **자동으로 내 단어장에 적재** + 직접 추가도 같은 목록으로 통합 | 사용자가 별도로 정리하는 수고를 없애기 위함("스스로 정리해서"의 의도). |
| "계속 보게 하는" | SM-2 lite **간격 반복 스케줄러**로 복습 예정일 계산, 홈에 "오늘 복습 N개" 노출 | 단순 목록 나열보다 실제로 다시 보게 만드는 장치가 필요. |
| 추천 뜻 소스 | ① 내장 wordbank 1,222단어의 sense 분리 ② 온라인 사전 API(dictionaryapi.dev, 무인증) ③ 사용자 직접 입력 | 오프라인에서도 반드시 동작해야 하므로 로컬 우선, 네트워크는 보강용. |
| 예문 추천 | 사전 API 예문 + 내장 코퍼스(단어가 등장하는 문장) + 품사 추정 템플릿 폴백, 모두 **편집 가능** | 네트워크 없이도 예문 후보가 최소 1개는 나와야 함. |

---

## 3. 기술 방향

### 스택
- **Kotlin 2.0.21**, **Jetpack Compose (BOM 2024.12.01)**, **Material 3**
- minSdk 26 / targetSdk 35 / compileSdk 35, Gradle 8.11, AGP 8.7.3
- **Room 2.6.1** (+ KSP) — 로컬 DB. 서버 없음, 전부 온디바이스.
- **DataStore Preferences** — 설정/진행 상태
- **kotlinx.serialization** — 에셋 JSON 및 API 응답 파싱
- **OkHttp 4.12** — 사전 API + GitHub 릴리즈 확인 (Retrofit 없이 경량 유지)
- **Navigation Compose** — 화면 전환 애니메이션 커스터마이즈
- DI 프레임워크 없음. `AppContainer` 수동 DI (빌드 복잡도/실패 지점 최소화)

### 폴더 구조
```
/(repo root)
├── HANDOFF.md                  ← 이 문서
├── version.json                ← 배포 버전 단일 소스 (앱이 GitHub raw/release로 조회)
├── README.md
├── design/                     ← UI 스타일 후보 3종 HTML 목업 (사용자 선택용)
│   ├── style-a-aurora.html
│   ├── style-b-paper.html
│   ├── style-c-neon.html
│   └── index.html
├── tools/
│   ├── build_wordbank.py       ← 엑셀 → assets/wordbank.json 변환기
│   └── source_wordbook.xlsx    ← 원본 엑셀(개인정보 없음: Day/단어/뜻만)
├── scripts/
│   ├── build-release.sh        ← 릴리즈 APK 빌드 + dist zip 생성
│   └── install-shortcut.sh     ← 연결된 기기에 원클릭 설치(adb)
├── dist/                       ← 배포용 압축(zip) 산출물
└── android/
    ├── settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml
    └── app/
        ├── build.gradle.kts
        └── src/main/
            ├── AndroidManifest.xml
            ├── assets/wordbank.json         ← 30일 × 약 40단어 = 1,222
            ├── res/…                        ← 앱 아이콘(적응형, 카드+글자 모티프), 테마
            └── java/com/vocacard/app/
                ├── VocaApp.kt               ← Application, AppContainer 생성
                ├── MainActivity.kt          ← edge-to-edge, NavHost
                ├── core/            Motion.kt, Result.kt, Hz(haptic)
                ├── data/
                │   ├── db/          VocaDatabase, WordEntity, StudyStateEntity, ExampleEntity, Daos
                │   ├── archive/     ArchiveRepository (assets/wordbank.json 로더 + 캐시)
                │   ├── mywords/     MyWordRepository (추가/수정/삭제/검색)
                │   ├── study/       Scheduler(SM-2 lite), StudySessionBuilder
                │   ├── suggest/     MeaningSuggester, ExampleSuggester, DictionaryApi
                │   └── settings/    SettingsStore (DataStore)
                ├── update/          UpdateChecker (GitHub releases API), UpdateInstaller
                └── ui/
                    ├── theme/       Color, Type, Theme, Motion
                    ├── components/  FlipCard, SwipeDeck, ProgressRing, StaggeredList, WavyBottomBar
                    └── screens/     home/ archive/ archiveDay/ study/ mywords/ compose(추가)/ settings/
```

### 데이터 모델
- `assets/wordbank.json` (읽기 전용 아카이브)
  `{"version":1,"days":[{"id":"day1","index":1,"title":"Day 1","words":[{"id":"day1-0001","word":"resume","meaning":"이력서","senses":["이력서"]}]}]}`
  - `senses` 는 원본 뜻에서 `\n`, `;` 로 분리한 다의어 목록(쉼표는 동의어 나열이므로 분리하지 않음). 193개 단어가 2개 이상 sense를 가짐.
- Room
  - `words` : id, word, meanings(List<String> JSON), examples(List<Example> JSON), source(ARCHIVE|MANUAL), sourceDayId, createdAt, note
  - `study_state` : wordId(PK), box, ease, intervalDays, dueAt, correctCount, wrongCount, lastResult, updatedAt
  - `day_progress` : dayId(PK), learnedCount, lastStudiedAt
- 아카이브 단어는 DB에 복제하지 않는다. "몰라요"가 뜬 순간에만 `words` 로 승격(source=ARCHIVE)한다 → DB 크기·중복 최소화.

### GitHub / 버전 관리
- 저장소: **`jykim5215/-`**, 개발 브랜치 **`claude/android-vocabulary-app-820e26`**
- 루트 `version.json` = `{"version":"1.0.0","versionCode":1,"changelog":"...","apkName":"VocaCard-1.0.0.apk"}`
- 앱은 `https://api.github.com/repos/jykim5215/-/releases/latest` (공개 API, 인증 토큰 없음) 를 호출하여
  태그/자산 목록을 읽고 내장 `BuildConfig.VERSION_NAME` 과 semver 비교.
- 코드 수정 시 version.json 도 같이 올린다(patch=버그, minor=기능, major=호환성 파괴).

---

## 4. 구현 계획 (순서와 설계 결정)

1. **[완료] 엑셀 → wordbank.json 변환** (`tools/build_wordbank.py`). 다의어 sense 분리 규칙 확정.
2. **[완료] HANDOFF.md / version.json 작성** (코드보다 먼저).
3. **UI 스타일 후보 3종 HTML 목업** 제작 → 사용자 선택. 선택된 팔레트를 `ui/theme/Color.kt` 에 반영.
4. **Gradle 프로젝트 스캐폴딩** — version catalog, 서명 없는 release 빌드 가능하게 구성.
5. **데이터 계층** — Room 엔티티/DAO/DB, ArchiveRepository(에셋 파싱 + StateFlow 캐시), SettingsStore.
6. **모션 기반 코어 컴포넌트** (이 앱의 핵심이므로 화면보다 먼저 만든다)
   - `Motion.kt` : spring/tween 스펙 단일 출처 (`Spring.DampingRatioMediumBouncy`, 220ms emphasized easing 등)
   - `FlipCard` : `graphicsLayer{rotationY; cameraDistance=12*density}` + spring, 앞/뒤 면 alpha 크로스페이드
   - `SwipeDeck` : 3장 스택(뒤 카드 scale 0.94/0.88, y offset), `draggable` + `Animatable` fling,
     좌/우 임계값 초과 시 dismiss, 드래그 진행도에 따라 "알아요/몰라요" 오버레이 색 보간
   - `ProgressRing` : `animateFloatAsState(spring)` 로 sweep 각도
   - 화면 전환 : `NavHost` 에 shared-axis X (slideIn/Out + fade, 300ms) 지정, 상세 진입은 scale-in
   - 리스트 진입 : index 기반 stagger (delay = index*25ms, 최대 300ms)
7. **화면 구현**
   - `Home` : 오늘 복습 due 카드 수, 이어서 학습, 최근 Day, 진행률 링
   - `Archive` : Day 1~30 그리드(진도율 표시) → `ArchiveDay`(단어 리스트, 뜻 가리기 토글, 학습 시작)
   - `Study` : **모든 학습 진입점이 공유하는 단일 화면**(아카이브/내 단어장/오늘 복습 전부 여기로).
     모드 = FLASHCARD / QUIZ(4지선다) / SPELLING. "몰라요" → 자동으로 내 단어장 적재 + 스케줄러 갱신.
   - `MyWords` : 몰랐던 단어 목록(필터: 복습예정/전체/어려움), 스와이프 액션, 상세 편집
   - `Compose(단어 추가)` : 영어 입력 → 디바운스 300ms → 추천 뜻 칩 목록(로컬+API, 다의어는 sense 단위로 여러 칩)
     → 복수 선택 → 예문 후보 카드(선택/편집) → 저장. **검색과 추가를 한 화면에 통합**(중복 기능 금지 원칙).
   - `Settings` : 테마, 업데이트 확인, 데이터 내보내기/초기화
8. **업데이트 기능** — `UpdateChecker` (GitHub releases API, 실패해도 앱 사용에 지장 없음) +
   사용자 승인 후 APK 다운로드 → `FileProvider` 로 설치 인텐트.
9. **배포 패키징** — `scripts/build-release.sh` 로 APK + `dist/VocaCard-<ver>.zip` 생성, GitHub Release 업로드.

### 주요 설계 결정 요약
- **기능 중복 제거**: 학습 기능은 `Study` 한 화면에만, 검색은 `Compose` 화면 한 곳에만 존재한다.
  아카이브/내 단어장/홈은 모두 같은 Study·Compose 화면으로 라우팅한다.
- **오프라인 우선**: 로컬 서버를 절대 띄우지 않는다. 네트워크는 (a) 사전 추천 보강 (b) 업데이트 확인, 두 곳뿐이며 둘 다 실패해도 앱은 정상 동작한다.
- **아카이브 불변**: 원본 30일 데이터는 사용자가 수정하지 않는다. 편집은 항상 "내 단어장" 사본에서.

---

## 5. 제약 조건

- **개인정보/자격증명 금지**: 저장소·APK 어디에도 토큰, 키, 계정 정보, 기기 식별자를 포함하지 않는다.
  GitHub 릴리즈 확인은 **공개 API 무인증** 호출만 사용한다.
- **로컬 서버 없이 디바이스 내 구동**: 웹뷰/로컬 HTTP 서버 방식 금지. 순수 네이티브로 언제 실행해도 동작.
- **원클릭 바로가기**: 설치 즉시 런처 아이콘(적응형 아이콘, 카드+"A" 모티프)으로 실행. 
  추가로 `Archive`/`오늘 복습` 은 안드로이드 **동적 바로가기(ShortcutManager)** 로 노출.
- **자체 업데이트**: 5절 GitHub 릴리즈 기반. 확인 실패 시 에러 토스트만 띄우고 앱 사용은 계속 가능.
- **보안 점검 보고**: 코드 수정·보고 시마다 개선한 취약점을 명시(없으면 "없음").
- **모션 성능**: 애니메이션은 60fps 유지가 목표. 리스트에서 `AnimatedVisibility` 남용 대신 `graphicsLayer` 기반 변환 사용.

---

## 6. 현재 상태

- **최종 갱신**: 2026-08-02
- **단계**: **v1.0.0 구현 완료 / 컴파일 검증 대기**

### 확정된 사용자 선택
- **UI 스타일: B · Paper** (따뜻한 종이 배경 `#F6F1E8`, 잉크 `#241F1A`, 테라코타 포인트 `#C2603C`,
  제목은 세리프 / 본문은 산세리프). 다크 모드 팔레트도 `ui/theme/Theme.kt` 에 함께 정의됨.
- **학습 진행 방식: 매번 모드 직접 선택.** 학습을 시작할 때마다
  암기 카드 / 뜻→단어 / 4지선다 / 스펠링 중 하나를 고르는 `ModePicker` 가 먼저 뜬다.
  (자동 4단계 진행이 아님 — 이 선택을 바꾸려면 `StudyScreen` 의 `state.mode == null` 분기를 수정)

### 완료된 것
- 엑셀 분석 및 변환: Sheet1 1,222행 → `assets/wordbank.json` (day1~day30, 다의어 193개)
- Gradle 스캐폴딩(AGP 8.7.3 / Kotlin 2.0.21 / Compose BOM 2024.12.01 / Room 2.6.1 + KSP), 래퍼 포함
- 데이터 계층: Room(5 엔티티/4 DAO), `ArchiveRepository`, `WordRepository`, `SettingsStore`
- 스케줄러: `data/study/Scheduler.kt` — SM-2 lite, 오답은 10분 뒤 재등장
- 추천 엔진: `data/suggest/Suggester.kt` (아카이브 → 내 단어장 → 온라인 사전 → 템플릿 폴백)
- 모션: `ui/theme/Motion.kt`(스펙 단일 출처), `FlipCard`, `SwipeDeck`, `StaggerIn`, `ProgressRing/Line`,
  `pressable`(누름 0.97 스케일), NavHost 전환(탭=fade+scale, 계층=shared axis X, 학습=아래→위)
- 화면 7종: Home / Archive / ArchiveDay / Study / MyWords / WordDetail / AddWord / Settings
- 업데이트: `update/UpdateChecker.kt` — GitHub 공개 릴리즈 API, 호스트 화이트리스트, FileProvider 설치
- 배포: `scripts/build.sh`, `scripts/package.sh`(자격증명 혼입 검사), `scripts/install.sh`,
  `.github/workflows/release.yml`(version.json 변경 시 APK 빌드 → `v<version>` 릴리즈 게시)

### 알려진 제약 / 다음 할 일
1. **컴파일 미검증.** 작업 환경의 프록시가 `dl.google.com` 을 차단해 Android SDK 를 설치할 수 없었고,
   CI 실행 결과를 확인하기 전에 작업 세션이 끝났다.
   따라서 이 저장소의 코드는 **정적 검토만 거쳤고 실제 컴파일은 CI(GitHub Actions)에서 처음 수행된다.**
   Codex 가 이어받는다면 **가장 먼저 `cd android && ./gradlew assembleRelease` 를 돌리거나
   Actions 탭에서 최신 실행 로그를 열어 컴파일 오류를 잡는 것**이 1순위 작업이다.
   (참고: 워크플로의 SDK 사전 설치 / stdin 차단 / 타임아웃 설정은 "빌드가 멈춘 것 같다"는
   잘못된 관찰에서 추가됐다. 실제로는 빌드가 정상 진행 중이었다. 설정 자체는 유효하므로 유지한다.)
2. 릴리즈 서명: 저장소 시크릿 `VOCA_KEYSTORE_BASE64`(+ `VOCA_KEYSTORE_PASSWORD`,
   `VOCA_KEY_ALIAS`, `VOCA_KEY_PASSWORD`)가 없으면 CI 가 잡 내부에서 임시 키를 만들어 서명한다.
   임시 키로 서명된 APK 는 **이전 버전 위에 덮어 설치되지 않으므로**, 자체 업데이트 기능을
   제대로 쓰려면 고정 keystore 를 시크릿으로 등록해야 한다.
3. 계측 테스트/유닛 테스트 미작성. `Scheduler`, `Semver`, `ExampleTemplates` 가 순수 로직이라 우선순위가 높다.
4. 예문의 한국어 번역은 비어 있다(사전 API 가 영어 예문만 제공). 사용자가 직접 입력할 수 있게만 열어 두었다.

- **GitHub 최신 업로드 버전**: 브랜치 `claude/android-vocabulary-app-820e26` 에 v1.0.0 소스 푸시.
  릴리즈 게시는 CI 워크플로 실행 시(또는 기본 브랜치 병합 시) 이루어진다.
- **앱 내 업데이트 확인 기능**: **구현 완료** (설정 → 업데이트 확인, 자동 확인은 하루 1회).
