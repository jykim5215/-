"""외부 API 응답의 SQLite 캐시와 호출 간격 제어.

KOSIS는 호출량 제한이 있으므로 6시간 TTL 캐시를 두고, 실제 네트워크 호출
사이에는 0.3초를 쉰다(스펙 §3-8). 캐시 히트는 네트워크를 쓰지 않으므로
슬립 대상이 아니다.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import time
from typing import Any

#: 기본 캐시 수명(초). 소비자물가지수는 월 1회 공표라 6시간이면 충분히 짧다.
DEFAULT_TTL_SECONDS = 6 * 60 * 60

#: 연속 호출 사이 최소 간격(초).
DEFAULT_MIN_INTERVAL = 0.3


def make_cache_key(path: str, params: dict[str, Any]) -> str:
    """캐시 키. 인증키는 제외해 키를 바꿔도 캐시가 살아남게 한다."""
    scrubbed = {k: v for k, v in sorted(params.items()) if k != "apiKey"}
    payload = json.dumps([path, scrubbed], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class ResponseCache:
    """응답 원문(str)을 담는 TTL 캐시."""

    def __init__(self, conn: sqlite3.Connection, ttl_seconds: int = DEFAULT_TTL_SECONDS):
        self._conn = conn
        self.ttl = ttl_seconds

    def get(self, cache_key: str) -> str | None:
        row = self._conn.execute(
            "SELECT body, fetched_at FROM http_cache WHERE cache_key = ?", (cache_key,)
        ).fetchone()
        if row is None:
            return None
        if time.time() - row["fetched_at"] > self.ttl:
            self._conn.execute("DELETE FROM http_cache WHERE cache_key = ?", (cache_key,))
            self._conn.commit()
            return None
        return row["body"]

    def put(self, cache_key: str, url: str, body: str) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO http_cache (cache_key, url, body, fetched_at) "
            "VALUES (?, ?, ?, ?)",
            (cache_key, url, body, time.time()),
        )
        self._conn.commit()


class RateLimiter:
    """마지막 실제 호출로부터 min_interval 이 지나도록 대기시킨다."""

    def __init__(self, min_interval: float = DEFAULT_MIN_INTERVAL):
        self.min_interval = min_interval
        self._last: float | None = None
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            if self._last is not None:
                remaining = self.min_interval - (now - self._last)
                if remaining > 0:
                    await asyncio.sleep(remaining)
            self._last = time.monotonic()
