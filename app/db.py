"""SQLite 스키마와 접속 헬퍼.

설계 원칙(스펙 §4): **계산 결과는 저장하지 않는다.** 저장하는 것은 사용자
입력(가중치, 프로필, 매핑 수정 이력)과 외부 응답 캐시뿐이다. 지수는 언제든
다시 당겨 재계산할 수 있어야 하고, 2026-12 기준개편으로 과거 지수가 소급
재계산되면 이 서비스의 결과도 자동으로 따라가야 하기 때문이다.

지수를 담는 컬럼에는 예외 없이 base_year가 함께 붙는다.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
-- 외부 API 응답 캐시(6시간 TTL). 값이 아니라 응답 원문을 그대로 담는다.
CREATE TABLE IF NOT EXISTS http_cache (
    cache_key  TEXT PRIMARY KEY,
    url        TEXT NOT NULL,
    body       TEXT NOT NULL,
    fetched_at REAL NOT NULL
);

-- L0 세그먼트 응답. 사용자가 고른 4개 값만 담는다.
CREATE TABLE IF NOT EXISTS user_profile (
    profile_id     TEXT PRIMARY KEY,
    household_size INTEGER,
    income_decile  INTEGER,
    housing_type   TEXT,
    has_car        INTEGER,
    created_at     TEXT NOT NULL
);

-- 사용자 가중치(입력). 12대 분류 단위. 합계는 저장 시점에 1,000으로 정규화한다.
CREATE TABLE IF NOT EXISTS user_weights (
    profile_id    TEXT NOT NULL,
    division_code TEXT NOT NULL,
    weight        REAL NOT NULL,
    level         TEXT NOT NULL,  -- L0(세그먼트) | L1(슬라이더) | L2(카드내역)
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (profile_id, division_code)
);

-- 품목 코드 매핑. 2026-12 개편(458->455, 신규 10/제외 13)에 대비해 유효기간을 둔다.
CREATE TABLE IF NOT EXISTS item_mapping (
    item_code     TEXT NOT NULL,
    item_name     TEXT NOT NULL,
    division_code TEXT NOT NULL,
    base_year     INTEGER NOT NULL,
    valid_from    TEXT NOT NULL,  -- 'YYYYMM'
    valid_to      TEXT,           -- NULL이면 현재까지 유효
    PRIMARY KEY (item_code, base_year, valid_from)
);

-- 품목 가중치(엑셀 적재분). base_year 없이는 행을 만들 수 없다.
CREATE TABLE IF NOT EXISTS item_weights (
    item_code  TEXT NOT NULL,
    item_name  TEXT NOT NULL,
    weight     REAL NOT NULL,
    base_year  INTEGER NOT NULL,
    source     TEXT NOT NULL,
    PRIMARY KEY (item_code, base_year)
);

-- 업종->12대 분류 매핑을 사용자가 고친 이력. 매핑 개선에 쓴다.
CREATE TABLE IF NOT EXISTS mcc_correction (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id         TEXT,
    merchant           TEXT NOT NULL,
    raw_category       TEXT,
    suggested_division TEXT,
    corrected_division TEXT NOT NULL,
    created_at         TEXT NOT NULL
);
"""


def connect(path: str | Path) -> sqlite3.Connection:
    """DB 연결을 열고 스키마를 보장한다."""
    path = Path(path)
    if path.parent != Path("."):
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


@contextmanager
def session(path: str | Path) -> Iterator[sqlite3.Connection]:
    conn = connect(path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
