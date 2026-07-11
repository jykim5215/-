# HANDOFF.md — AudioBridge (안드로이드 ↔ 윈도우 양방향 오디오 스트리밍)

> 이 문서는 자기완결적(self-contained)입니다. 다른 대화 기록 없이 이 파일만 읽어도
> 요구사항·설계·진행 상태를 그대로 이어받아 구현을 계속할 수 있어야 합니다.
> **살아있는 문서**입니다 — 진행 상황이 바뀔 때마다 맨 아래 "현재 상태"를 갱신하세요.

---

## 1. 프로젝트 개요 · 목표

같은 Wi-Fi/LAN에 있는 **안드로이드 폰과 윈도우 PC가 서로의 스피커가 되어 주는**
저지연 양방향 오디오 스트리밍 앱. 프로젝트명: **AudioBridge**.

- **핵심 산출물: 설치 가능한 Android APK** (디버그 서명 허용)
- 부산출물: 윈도우 동반 프로그램(단일 .exe 우선), `PROTOCOL.md`, `README.md`,
  개인정보 제거된 배포용 압축 패키지, 원클릭 런처 아이콘

### 양방향의 정의
- **모드 A (PC → 폰):** PC 소리를 폰이 재생 → *폰이 PC의 스피커*
- **모드 B (폰 → PC):** 폰 소리를 PC가 재생 → *PC가 폰의 스피커*
- 두 모드는 각각 독립적으로 켜고 끌 수 있어야 하며, 가능하면 동시 동작 지원

## 2. 사용자 요구사항 정리 (원문 의도 유지)

1. **블루투스 금지.** 안드로이드는 A2DP sink를 기본 지원하지 않으므로
   Wi-Fi/LAN 소켓 기반으로 구현한다.
2. **오디오 캡처 제약을 설계에 반영:**
   - 윈도우 시스템 소리: WASAPI **loopback** 캡처
   - 안드로이드 내부(앱) 소리: `MediaProjection` + `AudioPlaybackCapture`
     (Android 10 / API 29+). 앱별로 캡처 거부 가능 → **마이크 캡처(`RECORD_AUDIO`)를
     대체/선택 옵션**으로 제공. 모드 B의 소스는 사용자가 ①마이크 ②내부 캡처 중 선택.
3. **코덱:** 기본 PCM 16-bit 48kHz 스테레오. 대역폭 옵션으로 Opus 압축 선택 가능.
4. **전송:** 기본 UDP(저지연), 옵션 TCP(안정성). 지터 버퍼 + 버퍼 크기 조절 UI.
5. **연결:** LAN 자동 검색(NSD/mDNS 또는 UDP 브로드캐스트) + 수동 IP:포트 입력 둘 다.
6. **안드로이드:** Kotlin, Gradle, `minSdk 26`, 최신 안정 `targetSdk`. 재생 `AudioTrack`,
   캡처 `AudioRecord`/`MediaProjection`. 스트리밍 중 포그라운드 서비스 + 상태바 알림.
   권한: `INTERNET`, `RECORD_AUDIO`, `FOREGROUND_SERVICE`(+mediaProjection 타입).
7. **윈도우:** 스택 자율 결정하되 근거 명시(→ §3 참고). PC loopback 캡처 송신(모드 A),
   폰 오디오 재생(모드 B). 폰과 동일 프로토콜. 단일 .exe 배포 우선.
8. **프로토콜 문서화:** 패킷 헤더 포맷, 샘플레이트/채널/시퀀스/타임스탬프를
   `PROTOCOL.md`로 남긴다. 폰·PC 양쪽이 같은 규약 공유.
9. **실패 처리:** 네트워크 끊김/재연결, 포트 충돌, 권한 거부, 코덱 미지원 시
   명확한 안내 메시지.

## 3. 기술 방향 (스택 최종 결정과 근거)

### 안드로이드 (APK 본체)
- **Kotlin + Gradle(KTS), minSdk 26, targetSdk 35**, 단일 모듈 `app`.
- UI: 단일 액티비티 + **Jetpack Compose** (화면 수가 적고 상태 중심 UI라 적합).
- 오디오 재생: `AudioTrack` (low-latency `PERFORMANCE_MODE_LOW_LATENCY`).
- 오디오 캡처: `AudioRecord`(마이크) / `MediaProjection`+`AudioPlaybackCaptureConfiguration`(내부, API 29+에서만 노출).
- 네트워크: `java.net.DatagramSocket`(UDP) / `Socket`(TCP), 자동 검색은 **UDP 브로드캐스트 디스커버리**
  (NSD보다 윈도우 쪽 대응 구현이 단순하고 의존성이 없음 — 윈도우에서 mDNS 응답기를 만드는 것보다
  UDP 브로드캐스트 질의/응답이 확실함).
- Opus: `libopus` JNI 바인딩 대신 **초기 버전은 PCM만** 구현하고 Opus는 프로토콜에
  코덱 필드를 예약해 두는 방식으로 단계화(불확실성 축소). → 프로토콜은 처음부터 코덱 ID 포함.
- 스트리밍 중 **Foreground Service** (`mediaPlayback` + `mediaProjection` 타입) + 알림.

### 윈도우 (동반 프로그램)
- **C#/.NET 8 + NAudio** 선택. 근거:
  - NAudio의 `WasapiLoopbackCapture` / `WasapiOut`이 WASAPI loopback·재생을 검증된 API로 제공.
  - `dotnet publish -r win-x64 --self-contained -p:PublishSingleFile=true`로
    **런타임 포함 단일 .exe** 생성 가능 — Python+PyInstaller보다 산출물이 안정적이고 AV 오탐도 적음.
  - 이 저장소의 빌드 환경(리눅스 컨테이너)에서도 크로스 컴파일로 win-x64 exe를 뽑을 수 있음.
- 형태: 콘솔 앱(트레이 GUI는 후순위). 설정은 명령행 인자 + 대화형 프롬프트.

### 프로토콜 (요약 — 확정본은 PROTOCOL.md)
- 컨트롤: TCP(핸드셰이크·모드 협상·킵얼라이브), 오디오: UDP(기본) 또는 동일 TCP 스트림(옵션).
- 오디오 패킷 헤더: magic(2B) `AB` / version(1B) / codec(1B: 0=PCM16,1=Opus예약) /
  flags(1B) / channels(1B) / sampleRate(4B) / seq(4B) / timestampUs(8B) / payloadLen(2B).
- 디스커버리: UDP 브로드캐스트 포트 48551, `ABDISC?` 질의 → `ABDISC!{json}` 응답(이름·포트·버전).
- 기본 포트: 컨트롤 TCP 48550, 오디오 UDP 48552. 모두 UI에서 변경 가능.

### 폴더 구조 (배포 패키지 루트 = `audiobridge/`)
```
audiobridge/
  HANDOFF.md            ← 이 문서
  PROTOCOL.md           ← 전송 규약 (UI 선택 후 확정)
  README.md             ← 설치·페어링·사용법
  design/               ← UI 스타일 후보 HTML (3안)
  android/              ← Kotlin 앱 (Gradle 프로젝트)
  windows/              ← C#/.NET 동반 프로그램
  dist/                 ← APK·exe·배포 zip (빌드 산출물)
```

## 4. 구현 계획 (순서 · 주요 설계 결정과 이유)

1. **HANDOFF.md 작성** ← 완료 (이 문서)
2. **UI 스타일 3안 HTML** 제시 → 사용자 선택 대기 (`design/ui-styles.html`)
   - 3안 공통 화면 구성(기능 통합 원칙): 연결 카드(자동검색+수동입력),
     모드 A/B 각각의 토글+상태, 모드 B 소스 선택(마이크/내부캡처),
     지연 슬라이더(버퍼), 고급(전송 UDP/TCP·포트) — **한 화면**에 통합.
3. 선택 후: `PROTOCOL.md` 확정 → 안드로이드 앱 구현 → 윈도우 동반 프로그램 구현.
4. APK 빌드(디버그 서명) + 윈도우 exe(크로스 publish) + 배포용 zip.
5. `README.md` (설치·페어링·모드 A/B·마이크/내부캡처 선택·방화벽/포트 안내).

## 5. 제약 조건 (워크플로우 규칙 — 예외 없이)

1. **배포용 압축 + 개인정보 제거 + 보안 점검:** 배포 zip을 항상 생성.
   실험용 개인정보(IP, 기기명, 절대경로, 키/토큰) 제거 상태 유지.
   매 결과 보고 끝에 "개선한 취약점(없으면 '없음')" 한 단락 명시.
   점검 항목: 하드코딩 IP/포트, 검증 없는 입력, 브로드캐스트 남용, 평문 전송 위험.
2. **UI/UX:** 문자 그대로가 아니라 실제 사용자 시뮬레이션 기반으로 편의 위주 재구성.
   유사 기능은 한 화면에 통합. UI 스타일 3안 HTML 제시 후 반드시 사용자가 선택.
3. **독립 구동:** 로컬 개발 서버 의존 금지. 설치하면 바로 동작하는 독립 앱.
   (폰↔PC 오디오 소켓 통신은 여기 해당 없음 — 당연히 허용.)
4. **원클릭 바로가기:** 런처 아이콘 = 주제 관련(스피커+양방향 화살표+음파).
5. **HANDOFF.md 유지:** 진행마다 "현재 상태" 갱신 + 보고 끝에 갱신 내역 한 줄.

## 6. 현재 상태

- [x] HANDOFF.md 작성 (설계 완료)
- [x] UI 스타일 3안 HTML 작성 (`design/ui-styles.html`) — **사용자 선택 대기 중**
- [ ] PROTOCOL.md 확정
- [ ] 안드로이드 앱 구현
- [ ] 윈도우 동반 프로그램 구현
- [ ] APK 빌드 + exe 빌드 + 배포 zip
- [ ] README.md

**다음 할 일:** 사용자가 UI 스타일(A/B/C)을 고르면 PROTOCOL.md 확정 후 안드로이드 구현 시작.
