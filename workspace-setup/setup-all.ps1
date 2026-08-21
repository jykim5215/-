<#
.SYNOPSIS
  jykim5215 의 GitHub 프로젝트를 새 PC에 한 번에 내려받고 실행 준비까지 마칩니다.

.DESCRIPTION
  저장소 클론(이미 있으면 pull) → 프로젝트별 의존성 설치 → 정적 앱 실행용 바로가기 생성.
  여러 번 실행해도 안전합니다(멱등).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-all.ps1
  powershell -ExecutionPolicy Bypass -File .\setup-all.ps1 -Root "D:\dev" -IncludePrivate
#>
param(
    # 프로젝트를 모아 둘 최상위 폴더
    [string]$Root = (Join-Path $env:USERPROFILE 'projects'),
    # 의존성 설치를 건너뛰고 클론만 수행
    [switch]$SkipDeps,
    # 비공개 저장소(houseman-os-data)도 함께 클론 시도
    [switch]$IncludePrivate
)

# 네이티브 명령(git/npm)이 진행상황을 stderr 로 내보내므로 'Stop' 을 쓰면 정상 동작이 오류로 승격된다.
$ErrorActionPreference = 'Continue'
$Owner = 'jykim5215'

# ── 프로젝트 정의 ────────────────────────────────────────────────────────────
# Repo   : GitHub 저장소 이름
# Dir    : 로컬 폴더 이름 (저장소 이름이 쓰기 불편할 때만 다르게 둠)
# Setup  : none | npm | venv
# Launch : 정적 앱일 때 더블클릭으로 열 파일 (바로가기 생성용)
$Repos = @(
    @{ Repo='-';                                    Dir='cheolbong-map';  Title='철봉 지도';              Setup='none'; Launch=$null }
    @{ Repo='72';                                   Dir='72';             Title='72 (웹사이트 발견)';     Setup='npm';  Launch=$null }
    @{ Repo='seat-preview';                         Dir='seat-preview';   Title='좌석 시야 미리보기';     Setup='none'; Launch='index.html' }
    @{ Repo='dgist-lms-autosaver';                  Dir='dgist-lms-autosaver'; Title='DGIST LMS AutoSaver'; Setup='venv'; Launch=$null }
    @{ Repo='dongseon';                             Dir='dongseon';       Title='동선 (일정 플래너)';     Setup='none'; Launch='index.html' }
    @{ Repo='houseman-os';                          Dir='houseman-os';    Title='하우스맨 OS';            Setup='none'; Launch='docs\index.html' }
    @{ Repo='fileflow-lite';                        Dir='fileflow-lite';  Title='FileFlow Lite';          Setup='venv'; Launch=$null }
    @{ Repo='Essential-biology-note-for-final-exam-'; Dir='biology-note';  Title='생명과학 기말 노트';     Setup='none'; Launch='생명과학개론_기말_학습노트_Ch21-28_통합.html' }
)
$PrivateRepos = @(
    @{ Repo='houseman-os-data'; Dir='houseman-os-data'; Title='하우스맨 OS 데이터(비공개)'; Setup='none'; Launch=$null }
)

# ── 유틸 ─────────────────────────────────────────────────────────────────────
function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok  ($msg) { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "   !!  $msg" -ForegroundColor Yellow }

function Test-Cmd($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

function Get-PythonExe {
    if (Test-Cmd 'py')     { return 'py' }
    if (Test-Cmd 'python') { return 'python' }
    return $null
}

# ── 사전 점검 ────────────────────────────────────────────────────────────────
Write-Step '필수 도구 확인'
if (-not (Test-Cmd 'git')) {
    throw 'git 이 없습니다. https://git-scm.com/download/win 에서 설치한 뒤 다시 실행하세요.'
}
Write-Ok  ('git    ' + (git --version))

$HasNode = Test-Cmd 'node'
if ($HasNode) { Write-Ok ('node   ' + (node --version)) }
else          { Write-Warn2 'node 없음 — 72 프로젝트 설치를 건너뜁니다. https://nodejs.org 에서 LTS 설치 권장.' }

$PyExe = Get-PythonExe
if ($PyExe) {
    $PyVer = (& $PyExe --version) -replace '[^\d\.]', ''
    Write-Ok ('python ' + $PyVer)
    # fileflow-lite 의 pyproject.toml 이 requires-python >= 3.12 를 요구한다 (실측 확인).
    $m = [regex]::Match($PyVer, '^(\d+)\.(\d+)')
    if ($m.Success) {
        $major = [int]$m.Groups[1].Value
        $minor = [int]$m.Groups[2].Value
        if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 12)) {
            Write-Warn2 "Python $PyVer 감지 — fileflow-lite 는 3.12 이상이 필요해 설치가 실패합니다. 나머지 프로젝트는 정상 진행됩니다."
        }
    }
} else {
    Write-Warn2 'python 없음 — Python 프로젝트 설치를 건너뜁니다. https://python.org 또는 Microsoft Store 에서 설치 권장.'
}

# ── 클론 / 갱신 ──────────────────────────────────────────────────────────────
$All = @($Repos)
if ($IncludePrivate) { $All += $PrivateRepos }

New-Item -ItemType Directory -Force -Path $Root | Out-Null
Write-Step "저장소를 $Root 아래로 내려받는 중"

$Done = @()
foreach ($p in $All) {
    $dest = Join-Path $Root $p.Dir
    $url  = "https://github.com/$Owner/$($p.Repo).git"

    if (Test-Path (Join-Path $dest '.git')) {
        Write-Host "   ~   $($p.Dir) — 이미 있음, 최신으로 갱신"
        git -C $dest pull --ff-only --quiet 2>$null
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "$($p.Dir) pull 실패 (로컬 변경사항 확인 필요) — 클론은 유지됩니다" }
    } else {
        git clone --quiet -- $url $dest 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn2 "$($p.Dir) 클론 실패 — 비공개 저장소라면 'gh auth login' 또는 Git Credential Manager 로그인이 필요합니다"
            continue
        }
    }
    Write-Ok "$($p.Dir)  ($($p.Title))"
    $Done += $p
}

# ── 프로젝트별 의존성 설치 ───────────────────────────────────────────────────
if (-not $SkipDeps) {
    Write-Step '프로젝트별 의존성 설치'

    foreach ($p in $Done) {
        $dir = Join-Path $Root $p.Dir

        switch ($p.Setup) {
            'npm' {
                if (-not $HasNode) { Write-Warn2 "$($p.Dir) — node 없음, 건너뜀"; break }
                Write-Host "   ... $($p.Dir): npm install"
                Push-Location $dir
                try {
                    npm install --no-fund --no-audit 2>$null | Out-Null
                    if ($LASTEXITCODE -eq 0) { Write-Ok "$($p.Dir) 의존성 설치 완료" }
                    else { Write-Warn2 "$($p.Dir) npm install 실패 (exit $LASTEXITCODE)" }
                }
                catch { Write-Warn2 "$($p.Dir) npm install 실패: $_" }
                finally { Pop-Location }
            }
            'venv' {
                if (-not $PyExe) { Write-Warn2 "$($p.Dir) — python 없음, 건너뜀"; break }
                $venv   = Join-Path $dir '.venv'
                $venvPy = Join-Path $venv 'Scripts\python.exe'
                Write-Host "   ... $($p.Dir): 가상환경 + 패키지"
                try {
                    if (-not (Test-Path $venvPy)) { & $PyExe -m venv $venv }
                    & $venvPy -m pip install --quiet --upgrade pip

                    $req = Join-Path $dir 'requirements.txt'
                    if (Test-Path $req) { & $venvPy -m pip install --quiet -r $req }

                    if (Test-Path (Join-Path $dir 'pyproject.toml')) {
                        Push-Location $dir
                        try { & $venvPy -m pip install --quiet -e . } finally { Pop-Location }
                    }

                    # dgist-lms-autosaver 는 Playwright 브라우저가 따로 필요
                    if ((Test-Path $req) -and (Select-String -Path $req -Pattern '^playwright' -Quiet)) {
                        Write-Host "   ... $($p.Dir): playwright chromium 내려받는 중 (수 분 소요)"
                        & $venvPy -m playwright install chromium
                    }
                    Write-Ok "$($p.Dir) 가상환경 준비 완료 (.venv)"
                } catch { Write-Warn2 "$($p.Dir) 설치 중 오류: $_" }

                # 설정 파일 템플릿 안내 (실제 값은 직접 입력)
                $cfgExample = Join-Path $dir 'config.example.py'
                $cfg        = Join-Path $dir 'config.py'
                if ((Test-Path $cfgExample) -and (-not (Test-Path $cfg))) {
                    Write-Warn2 "$($p.Dir): config.py 가 없습니다. 'python setup.py' 를 실행해 계정·API 키를 입력하세요"
                }
            }
            default { }
        }
    }
}

# ── 정적 앱 실행용 바로가기 (저장소 밖에 생성 — git 상태를 더럽히지 않음) ────
Write-Step '정적 앱 바로가기 생성'
$LaunchDir = Join-Path $Root '_실행'
New-Item -ItemType Directory -Force -Path $LaunchDir | Out-Null

$shell = New-Object -ComObject WScript.Shell
foreach ($p in $Done) {
    if (-not $p.Launch) { continue }
    $target = Join-Path (Join-Path $Root $p.Dir) $p.Launch
    if (-not (Test-Path $target)) { continue }
    $lnk = $shell.CreateShortcut((Join-Path $LaunchDir "$($p.Title).lnk"))
    $lnk.TargetPath = $target
    $lnk.Save()
    Write-Ok "$($p.Title)"
}

# ── 마무리 안내 ──────────────────────────────────────────────────────────────
Write-Host "`n────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host " 완료. 프로젝트 위치: $Root" -ForegroundColor White
Write-Host "────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host @"

 바로 실행 (더블클릭):   $LaunchDir

 개발 서버로 실행:
   철봉 지도       cd "$Root\cheolbong-map"        ; python server.py
   72              cd "$Root\72"                   ; npm run db:local ; npm run dev
   DGIST LMS       cd "$Root\dgist-lms-autosaver"  ; .\.venv\Scripts\pythonw.exe app.py
   FileFlow Lite   cd "$Root\fileflow-lite"        ; .\.venv\Scripts\fileflow-lite.exe

 Claude Code 로 열기:
   cd "$Root\<프로젝트폴더>" ; claude

 남은 수동 작업은 PROJECTS.md 의 "직접 채워야 하는 값"을 확인하세요.

"@ -ForegroundColor Gray
