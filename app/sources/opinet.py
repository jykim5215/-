"""오피넷 유가 클라이언트.

★ 무료 인증키는 **최근 7일치만** 제공한다. 그보다 긴 시계열이 필요하면 매일
받아서 쌓아야 한다. 그래서 이 모듈은 조회와 함께 **일별 적재**를 지원하고,
쌓인 범위를 넘어서는 구간을 요청하면 없는 구간을 만들어내지 않고 사유와 함께
가진 범위만 돌려준다.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import httpx

from ..errors import DataUnavailable
from ..provenance import KST, Provenance

OPINET_BASE = "https://www.opinet.co.kr/api/avgAllPrice.do"

ORG = "한국석유공사 오피넷"

#: 무료 키가 제공하는 최대 소급 일수.
FREE_TIER_DAYS = 7

SCHEMA = """
CREATE TABLE IF NOT EXISTS opinet_daily (
    surveyed_on TEXT NOT NULL,
    product     TEXT NOT NULL,
    price       REAL NOT NULL,
    stored_at   TEXT NOT NULL,
    PRIMARY KEY (surveyed_on, product)
);
"""


@dataclass(frozen=True)
class FuelPrice:
    product: str
    price: float
    surveyed_on: str
    provenance: Provenance


class OpinetClient:
    def __init__(self, api_key: str, *, http_client: httpx.AsyncClient | None = None) -> None:
        if not api_key:
            raise DataUnavailable(
                "오피넷 인증키가 없습니다(.env: OPINET_API_KEY). "
                f"무료 키는 최근 {FREE_TIER_DAYS}일만 제공하므로 시계열은 일별 적재가 필요합니다."
            )
        self.api_key = api_key
        self._client = http_client
        self._owns_client = http_client is None

    async def __aenter__(self) -> "OpinetClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=20.0)
            self._owns_client = True
        return self._client

    async def average_prices(self) -> list[FuelPrice]:
        """전국 평균 판매가격(오늘)."""
        params = {"code": self.api_key, "out": "json"}
        try:
            response = await self._http().get(OPINET_BASE, params=params)
            response.raise_for_status()
            payload = json.loads(response.text)
        except (httpx.HTTPError, json.JSONDecodeError, OSError) as exc:
            raise DataUnavailable(f"오피넷 조회에 실패했습니다: {exc}") from exc

        rows = _extract_rows(payload)
        if not rows:
            raise DataUnavailable("오피넷 응답에 가격 행이 없습니다.")

        today = date.today()
        retrieved_at = datetime.now(KST)
        prices: list[FuelPrice] = []
        for row in rows:
            price = _to_float(row.get("PRICE"))
            product = row.get("PRODNM") or row.get("PRODCD")
            if price is None or not product:
                continue
            prices.append(
                FuelPrice(
                    product=str(product),
                    price=price,
                    surveyed_on=today.isoformat(),
                    provenance=Provenance(
                        org=ORG,
                        table_id="avgAllPrice",
                        period=today.strftime("%Y%m%d"),
                        base_year=today.year,
                        retrieved_at=retrieved_at,
                        note="전국 평균 판매가격(원/L)",
                    ),
                )
            )
        return prices


# ---------------------------------------------------------------------------
# 일별 적재 — 무료 키의 7일 제한을 넘기기 위한 유일한 방법
# ---------------------------------------------------------------------------


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def store_daily(conn: sqlite3.Connection, prices: list[FuelPrice]) -> int:
    """오늘 받은 값을 쌓는다. 매일 한 번 돌려야 시계열이 생긴다."""
    ensure_schema(conn)
    now = datetime.now(KST).isoformat()
    conn.executemany(
        "INSERT OR REPLACE INTO opinet_daily (surveyed_on, product, price, stored_at) "
        "VALUES (?, ?, ?, ?)",
        [(p.surveyed_on, p.product, p.price, now) for p in prices],
    )
    conn.commit()
    return len(prices)


def load_range(
    conn: sqlite3.Connection, *, product: str, start: str, end: str
) -> tuple[list[tuple[str, float]], str | None]:
    """쌓인 범위에서 읽는다.

    Returns:
        (행 목록, 경고). 요청 구간이 적재 범위보다 넓으면 없는 구간을 만들어내지
        않고 경고 문구를 함께 돌려준다.
    """
    ensure_schema(conn)
    rows = conn.execute(
        "SELECT surveyed_on, price FROM opinet_daily "
        "WHERE product = ? AND surveyed_on BETWEEN ? AND ? ORDER BY surveyed_on",
        (product, start, end),
    ).fetchall()
    series = [(r["surveyed_on"], r["price"]) for r in rows]

    if not series:
        return [], (
            f"{start}~{end} 구간에 적재된 유가가 없습니다. "
            f"오피넷 무료 키는 최근 {FREE_TIER_DAYS}일만 제공하므로 일별 적재가 필요합니다."
        )

    warning = None
    if series[0][0] > start:
        warning = (
            f"적재는 {series[0][0]} 부터입니다. 그 이전 구간은 값이 없어 비워 둡니다."
        )
    return series, warning


def _extract_rows(payload: Any) -> list[dict]:
    if isinstance(payload, dict):
        result = payload.get("RESULT")
        if isinstance(result, dict):
            oil = result.get("OIL")
            if isinstance(oil, list):
                return [r for r in oil if isinstance(r, dict)]
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    return []


def _to_float(raw: object) -> float | None:
    if raw is None:
        return None
    try:
        return float(str(raw).replace(",", "").strip())
    except ValueError:
        return None
