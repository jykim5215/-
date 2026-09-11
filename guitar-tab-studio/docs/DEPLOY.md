# Cloudflare Pages 배포

이 앱은 **빌드 스텝이 없는 정적 사이트**입니다. `guitar-tab-studio/` 폴더를 그대로 올리면 끝입니다.

> ⚠️ **가장 중요한 설정**: 저장소 루트에는 다른 앱(철봉.com)의 `index.html` 이 있습니다.
> 반드시 **루트 디렉터리를 `guitar-tab-studio` 로 지정**해야 이 앱이 배포됩니다.

---

## 방법 A — 대시보드에서 GitHub 연결 (권장)

토큰을 어디에도 넘기지 않아도 되고, 앞으로 `main` 에 푸시하면 자동 배포됩니다.

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 저장소 `jykim5215/-` 선택
3. 빌드 설정을 다음과 같이:

   | 항목 | 값 |
   |---|---|
   | Project name | `guitar-tab-studio` |
   | Production branch | `main` |
   | Framework preset | **None** |
   | Build command | *(비워둠)* |
   | Build output directory | `/` |
   | **Root directory (advanced)** | **`guitar-tab-studio`** ← 반드시 |

4. **Save and Deploy**

몇 초 뒤 `https://guitar-tab-studio.pages.dev` 에서 열립니다.

## 방법 B — 명령줄에서 직접 업로드

```bash
npm i -g wrangler
wrangler login                        # 브라우저로 계정 인증
bash tools/deploy-cloudflare.sh       # guitar-tab-studio/ 를 그대로 업로드
```

## 방법 C — GitHub Actions 자동 배포

`.github/workflows/deploy-guitar-tab-studio.yml` 이 이미 들어 있습니다.
저장소 **Settings → Secrets and variables → Actions** 에 두 개만 등록하면 `main` 푸시마다 자동 배포됩니다.

| 시크릿 | 값 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → 권한 **Account · Cloudflare Pages · Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 대시보드 우측 사이드바의 Account ID |

시크릿이 없으면 워크플로는 **조용히 건너뛰고 성공 처리**됩니다(빨간 CI가 뜨지 않습니다).

---

## 배포하면 달라지는 것

| | `file://` (로컬) | 배포된 사이트 (HTTPS) |
|---|---|---|
| 유튜브 탭 오디오 캡처 | 브라우저·OS 에 따라 막힐 수 있음 | **안정적으로 동작** (보안 컨텍스트) |
| 업데이트 | 새 버전 zip 을 받아 폴더 덮어쓰기 | **새로고침만 하면 최신** |
| 저장된 악보 | 이 브라우저의 IndexedDB | 같음 (출처가 달라지면 별개로 저장됨) |
| 설치 | 파일 복사 | 없음 — 링크만 있으면 됨 |

앱이 `location.protocol` 로 실행 환경을 구분해서 업데이트 안내를 알아서 바꿉니다(`app/core/update.js` 의 `runtime()`).

> 로컬에서 쓰던 악보는 **자동으로 따라오지 않습니다.** 브라우저 저장소는 출처(origin)별로 분리되기 때문입니다.
> 옮기려면 로컬에서 **내보내기 → 프로젝트(.json)** 로 저장한 뒤, 배포된 사이트에서 **소리 가져오기 → 오디오 파일 → 저장해둔 프로젝트 불러오기** 하세요.

---

## 보안 설정 (`_headers`)

배포본에는 아래 헤더가 붙습니다. 외부 스크립트를 하나도 쓰지 않는 구조라 CSP 를 아주 좁게 잠글 수 있었습니다.

- `Content-Security-Policy` — 스크립트는 같은 출처만(`script-src 'self'`, 인라인 스크립트 없음).
  바깥으로 나가는 연결은 `api.github.com`(업데이트 확인)과 `api.anthropic.com`(선택 기능 AI 다듬기) **두 곳뿐**.
- `Permissions-Policy` — `display-capture` 는 이 사이트에만 허용(탭 오디오 캡처에 필요),
  마이크·카메라·위치·결제·USB 는 전부 차단.
- `X-Frame-Options: DENY` + `frame-ancestors 'none'` — 다른 사이트가 이 앱을 iframe 으로 감싸 클릭재킹하는 것을 막음.
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`

이 CSP 아래에서 실제 브라우저로 전 기능(분석 → 편집 → PDF/악보집/MIDI/TXT 내보내기)을 돌려 **CSP 위반 0건**을 확인했습니다.

`.assetsignore` 로 `dist/`, `tools/`, `docs/`, `ui-candidates/`, `HANDOFF.md` 는 배포에서 제외됩니다
(소스와 개발 도구는 GitHub 에만 둡니다).

## 커스텀 도메인

Pages 프로젝트 → **Custom domains** → **Set up a domain**.
도메인이 Cloudflare 에 있으면 DNS 가 자동으로 붙고 인증서도 자동 발급됩니다.
