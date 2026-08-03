# 단어장 (VocaCard)

Class Card 학습 포맷을 따르는 **안드로이드 네이티브 단어장 앱**.
엑셀로 정리해 둔 30일 커리큘럼(1,222 단어)을 아카이브로 담고,
몰랐던 단어를 자동으로 모아 간격 반복으로 계속 보여 준다.
부드러운 스프링 모션이 제품의 핵심이다.

<img src="design/index.html" alt="" width="0" height="0">

## 무엇이 들어 있나

| | |
|---|---|
| **아카이브** | 엑셀을 Day 1~30 으로 정리(`day1`~`day30`, 총 1,222 단어). 뜻 가리기 토글로 목록 자체가 셀프테스트가 된다. |
| **학습** | 앱의 유일한 학습 화면. 시작할 때마다 **암기 카드 / 뜻→단어 / 4지선다 / 스펠링** 중에서 고른다. |
| **내 단어** | 학습 중 "몰라요"를 누른 단어가 **자동으로** 쌓인다. SM-2 계열 스케줄러가 10분 → 1일 → 3일 → 7일 → 16일 → 35일 간격으로 다시 꺼내 온다. |
| **단어 추가** | 영어를 입력하면 **추천 뜻**(다의어는 뜻마다 하나씩)과 **추천 예문**이 뜬다. 원하는 것만 골라 저장하고, 직접 입력해 보탤 수도 있다. |
| **쌓기 보기** | 내 단어 탭의 목록/쌓기 토글, 또는 홈의 '완전히 아는 단어'를 누르면 진입. 회전 있는 강체 물리 — 단어가 부딪히는 지점에 따라 굴러가고 뒤집힌다. 기기를 기울이면 그쪽으로 구르고 흔들면 튀어 오른다. 손가락으로 집어 던질 수 있고, 톡 누르면 상세로 간다. |
| **발음** | 학습 카드·단어 상세·단어 추가에서 스피커 버튼으로 듣는다. 암기 카드는 단어가 나올 때 자동 재생(설정에서 끔). 기기 내장 TTS 를 쓰며 음성 엔진이 없으면 버튼이 나타나지 않는다. |
| **업데이트** | 설정에서 GitHub 릴리즈를 확인해 새 버전을 내려받아 설치한다. 실패해도 앱 사용에는 영향이 없다. |

추천 뜻의 출처는 세 가지다.

1. **내장 아카이브** — 1,222 단어의 한국어 뜻. `;` 과 줄바꿈으로 다의어를 분리해 뜻마다 별도 후보로 만든다(193 단어가 2개 이상).
2. **내 단어장** — 이미 저장한 같은 단어의 뜻(중복 저장 대신 병합).
3. **온라인 영영사전**(dictionaryapi.dev, 무인증) — 품사별 정의와 원어민 예문. 오프라인이면 조용히 생략된다.

## 폴더 구조

```
HANDOFF.md                  Codex/다른 에이전트가 이어받기 위한 인수인계 브리프
version.json                버전 단일 출처 (앱 versionName/versionCode 가 여기서 나온다)
design/index.html           UI 스타일 후보 3종 목업 (선택: B · Paper)
tools/build_wordbank.py     엑셀 → assets/wordbank.json 변환기
scripts/build.sh            릴리즈 APK 빌드 + 배포 zip
scripts/package.sh          배포용 zip 패키징(자격증명 검사 포함)
scripts/install.sh          연결된 기기에 원클릭 설치
android/                    Gradle 프로젝트 (Kotlin + Jetpack Compose)
dist/                       배포 zip 산출물
```

## 빌드

Android SDK(API 35)와 JDK 17 이 필요하다.

```bash
cd android && ./gradlew assembleRelease
# 또는 zip 패키징까지 한 번에
scripts/build.sh
```

서명 키는 저장소에 두지 않는다. 필요하면 환경 변수로만 넘긴다:

```bash
VOCA_KEYSTORE=/path/vocacard.jks VOCA_KEYSTORE_PASSWORD=... \
VOCA_KEY_ALIAS=vocacard VOCA_KEY_PASSWORD=... scripts/build.sh
```

GitHub Actions(`.github/workflows/release.yml`)가 `version.json` 변경 시 APK 를 빌드해
`vocacard-v<version>` 태그로 릴리즈를 게시한다.
앱의 "업데이트 확인"은 **이 접두사가 붙은 릴리즈만** 골라 읽는다 —
이 저장소에는 다른 프로젝트의 릴리즈도 함께 있어서, `releases/latest` 를 그대로 쓰면
엉뚱한 앱의 APK 를 업데이트로 착각할 수 있기 때문이다.

## 설치 / 바로가기

```bash
scripts/install.sh            # adb 로 연결된 기기에 설치 후 실행
```

설치하면 런처에 **단어장** 아이콘이 생긴다(카드 두 장 + 세리프 A 모티프의 적응형 아이콘).
아이콘을 길게 누르면 **오늘 복습 / 단어 추가 / 아카이브** 바로가기가 바로 뜬다.

## 데이터와 프라이버시

- 로컬 서버를 띄우지 않는다. 모든 학습 데이터는 기기 안 SQLite(Room)에만 저장된다.
- 네트워크는 두 곳에서만 쓴다: 사전 추천(dictionaryapi.dev), 업데이트 확인(GitHub 공개 API).
  둘 다 인증 토큰 없이 호출하며, 실패해도 앱은 완전히 동작한다.
- 계정·로그인·광고·분석 SDK 가 없다. 개인 식별 정보를 수집하거나 전송하지 않는다.

## 엑셀 다시 넣기

단어 목록을 갱신하려면:

```bash
python3 tools/build_wordbank.py <새-엑셀.xlsx>
# → android/app/src/main/assets/wordbank.json 갱신
```

엑셀은 `Day / 단어 / 뜻` 3열(첫 행은 헤더)을 읽는다. 뜻의 `;` 과 줄바꿈은 다의어 구분으로 해석되고,
쉼표는 동의어 나열로 보아 자르지 않는다.
