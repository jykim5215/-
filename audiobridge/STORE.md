# STORE.md — 스토어 등록 가이드 (Google Play / Microsoft Store)

앱 자체는 준비돼 있고, 스토어 등록은 **본인 명의 개발자 계정과 서명 키**가 필요해서
아래 단계는 직접 진행해야 합니다. CI가 필요한 산출물(AAB)은 이미 자동으로 만들어 줍니다.

## 1. Google Play (안드로이드)

### 1-1. 개발자 계정
- https://play.google.com/console 에서 개인 계정 등록 (1회 $25, 신분증 인증 필요)

### 1-2. 릴리스 서명 키 만들기 (필수 — 한 번만)
지금 APK는 저장소에 공개된 사이드로딩용 키로 서명돼 있어서 **그대로 스토어에 올리면 안 됩니다.**
아무 PC에서 (JDK 설치 후):
```
keytool -genkeypair -v -keystore release.keystore -alias release \
  -keyalg RSA -keysize 2048 -validity 10000
```
비밀번호는 잘 보관하세요(잃어버리면 업데이트 불가).

### 1-3. GitHub에 키 등록 → CI가 자동으로 스토어용 서명
저장소 **Settings → Secrets and variables → Actions**에 아래 4개 추가:

| Secret 이름 | 값 |
|---|---|
| `RELEASE_KEYSTORE_B64` | `base64 -w0 release.keystore` 출력 문자열 |
| `RELEASE_KEYSTORE_PASSWORD` | keystore 비밀번호 |
| `RELEASE_KEY_ALIAS` | `release` |
| `RELEASE_KEY_PASSWORD` | 키 비밀번호 |

등록 후 다시 빌드하면 릴리스 페이지의 **`AudioBridge.aab`** 가 이 키로 서명됩니다.
(주의: 키를 바꾸면 기존 사이드로딩 설치와 서명이 달라져 그 폰들은 한 번 삭제 후 재설치 필요)

### 1-4. Play Console 등록
1. 앱 만들기 → 이름 "AudioBridge", 무료, 앱
2. **App Bundle 업로드**: 릴리스 페이지의 `AudioBridge.aab`
3. 필수 양식:
   - **개인정보처리방침 URL**: 저장소의 `PRIVACY.md`를 GitHub Pages 등으로 공개하고 그 URL 사용
   - **데이터 안전(Data safety)**: "수집하는 데이터 없음" — 이 앱은 어떤 데이터도 외부 서버로 보내지 않음(LAN 안에서만 통신)
   - **권한 신고**: `RECORD_AUDIO`(마이크 소리 전송 기능), MediaProjection(미디어 소리 전송 기능) 용도 설명
   - 콘텐츠 등급 설문(전체이용가), 대상 연령
4. 내부 테스트 트랙으로 먼저 올려 본인 폰에서 확인 → 프로덕션 심사 제출 (보통 1~7일)

## 2. Microsoft Store (윈도우)

두 가지 길이 있습니다:

- **A. 스토어 없이 배포 (현재 방식, 추천)** — exe를 그대로 배포. 스토어 심사 불필요.
  처음 실행 시 SmartScreen 경고("확인되지 않은 앱")가 뜰 수 있는데 "추가 정보 → 실행"으로 진행.
  경고를 없애려면 코드서명 인증서(연 10~40만원대) 구매 후 exe 서명.
- **B. Microsoft Store 등록** — https://partner.microsoft.com 개발자 계정(개인 1회 $19) →
  exe를 **MSIX로 패키징**(Windows에서 MSIX Packaging Tool 사용) → 파트너 센터에 제출.
  Win32 앱은 MSIX 패키징이 필수라 윈도우 PC에서 한 번 작업이 필요합니다.

## 3. 준비돼 있는 것 / 직접 할 것 요약

| 항목 | 상태 |
|---|---|
| AAB 자동 빌드 (Play 업로드 형식) | ✅ CI가 릴리스에 `AudioBridge.aab` 게시 |
| targetSdk 35, 버전코드 자동 증가 | ✅ |
| 개인정보처리방침 문서 | ✅ `PRIVACY.md` (URL로 공개만 하면 됨) |
| 릴리스 서명 키 | 🔲 직접 생성 후 GitHub Secrets 등록 (§1-2, 1-3) |
| Play 개발자 계정 ($25) | 🔲 직접 등록 |
| MS Store 계정 ($19) + MSIX | 🔲 선택 (exe 직배포로 충분하면 불필요) |
