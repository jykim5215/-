#!/usr/bin/env python3
"""배포용 압축 패키지 생성과 보안 점검.

    python scripts/package_release.py

하는 일:
  1. 개인정보·자격증명이 섞여 나가지 않는지 점검한다(.env, DB, 키 패턴).
  2. 문제가 없으면 dist/mycpi-<version>.zip 을 만든다.
  3. 점검 결과를 사람이 읽을 수 있게 출력한다.

점검에서 하나라도 걸리면 zip 을 만들지 않고 1을 돌려준다. "일단 만들고 나중에
지우는" 경로를 두지 않는다.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

#: 패키지에 절대 들어가면 안 되는 것.
BLOCKED_NAMES = {".env", "mycpi.sqlite3"}
BLOCKED_SUFFIXES = {".sqlite3", ".db", ".pyc", ".log"}
BLOCKED_DIRS = {".git", "__pycache__", ".pytest_cache", "dist", "data", "node_modules", ".venv"}

#: 소스에 하드코딩된 자격증명을 찾는 패턴.
SECRET_PATTERNS = [
    (re.compile(r"KOSIS_API_KEY\s*=\s*['\"][A-Za-z0-9%+/=_-]{8,}"), "KOSIS 인증키 하드코딩"),
    (re.compile(r"KAMIS_CERT_(KEY|ID)\s*=\s*['\"][A-Za-z0-9%+/=_-]{6,}"), "KAMIS 자격증명 하드코딩"),
    (re.compile(r"OPINET_API_KEY\s*=\s*['\"][A-Za-z0-9%+/=_-]{8,}"), "오피넷 인증키 하드코딩"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), "GitHub 토큰"),
    (re.compile(r"(?i)authorization\s*:\s*['\"]?(bearer|token)\s+\S+"), "Authorization 헤더에 토큰"),
    (re.compile(r"(?i)\b(sk|rk)-[A-Za-z0-9]{20,}"), "API 키로 보이는 문자열"),
]

#: 이 파일들은 예시·설명이라 패턴에 걸려도 무시한다.
SECRET_SCAN_SKIP = {"scripts/package_release.py", ".env.example", "README.md"}

TEXT_SUFFIXES = {".py", ".js", ".html", ".css", ".json", ".md", ".txt", ".ini", ".yml", ".yaml"}


def iter_files() -> list[Path]:
    files = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in BLOCKED_DIRS for part in path.relative_to(ROOT).parts):
            continue
        files.append(path)
    return sorted(files)


def check_personal_data(files: list[Path]) -> list[str]:
    """이 기기에서 실험하며 생긴 개인 정보가 섞여 있는지."""
    findings = []
    for path in files:
        relative = path.relative_to(ROOT)
        if path.name in BLOCKED_NAMES:
            findings.append(f"{relative}: 배포에 포함하면 안 되는 파일")
        if path.suffix in BLOCKED_SUFFIXES:
            findings.append(f"{relative}: {path.suffix} 파일은 로컬 산출물")
    return findings


def check_secrets(files: list[Path]) -> list[str]:
    findings = []
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        if relative in SECRET_SCAN_SKIP or path.suffix not in TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for pattern, label in SECRET_PATTERNS:
            if pattern.search(text):
                findings.append(f"{relative}: {label}")
    return findings


def check_gitignore() -> list[str]:
    """.env 가 확실히 무시되는지."""
    gitignore = ROOT / ".gitignore"
    if not gitignore.exists():
        return [".gitignore 가 없습니다. .env 가 커밋될 수 있습니다."]
    text = gitignore.read_text(encoding="utf-8")
    if ".env" not in text:
        return [".gitignore 에 .env 규칙이 없습니다."]
    return []


def check_fixtures() -> list[str]:
    """공식 픽스처 폴더에 출처 없는 숫자가 들어 있지 않은지."""
    findings = []
    official = ROOT / "tests" / "fixtures" / "official"
    for path in official.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            findings.append(f"{path.name}: JSON 파싱 실패")
            continue
        source = payload.get("source") or {}
        missing = [f for f in ("org", "table_id", "base_year", "retrieved_at") if not source.get(f)]
        if missing:
            findings.append(
                f"tests/fixtures/official/{path.name}: 출처 정보 누락 ({', '.join(missing)}). "
                "출처 없는 수치는 저장소에 두지 않습니다."
            )
    return findings


def build_zip(files: list[Path], version: str) -> Path:
    DIST.mkdir(exist_ok=True)
    target = DIST / f"mycpi-{version}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT))
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-only", action="store_true", help="점검만 하고 zip 은 만들지 않는다")
    args = parser.parse_args()

    version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["version"]
    files = iter_files()

    checks = [
        ("개인정보·로컬 산출물", check_personal_data(files)),
        ("하드코딩된 자격증명", check_secrets(files)),
        (".gitignore 보호", check_gitignore()),
        ("픽스처 출처 표기", check_fixtures()),
    ]

    print(f"보안 점검 — {len(files)}개 파일, v{version}\n")
    failed = False
    for label, findings in checks:
        if findings:
            failed = True
            print(f"  [실패] {label}")
            for finding in findings:
                print(f"         - {finding}")
        else:
            print(f"  [통과] {label}")

    if failed:
        print("\n점검에 걸린 항목이 있어 패키지를 만들지 않았습니다.", file=sys.stderr)
        return 1

    if args.check_only:
        print("\n점검만 수행했습니다.")
        return 0

    target = build_zip(files, version)
    size = target.stat().st_size / 1024
    print(f"\n패키지: {target.relative_to(ROOT)} ({size:,.0f} KB, {len(files)}개 파일)")
    print("포함되지 않음: .env, *.sqlite3, __pycache__, .git, data/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
