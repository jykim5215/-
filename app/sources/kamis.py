"""aT KAMIS 농산물유통정보 클라이언트.

kamis.or.kr/service/price/xml.do — **인증키와 계정 ID 두 개**가 모두 필요하다.
하나만 있으면 인증이 통과되지 않으므로 시작 시점에 사유를 붙여 실패시킨다.

키가 없으면 ④ 장바구니 화면만 비활성화되고 나머지 화면은 정상 동작한다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import httpx

from ..errors import DataUnavailable
from ..provenance import KST, Provenance

KAMIS_BASE = "https://www.kamis.or.kr/service/price/xml.do"

ORG = "한국농수산식품유통공사(aT) KAMIS"


@dataclass(frozen=True)
class ItemPrice:
    """품목 하나의 최근 가격."""

    item_name: str
    unit: str
    price: float
    surveyed_on: str
    provenance: Provenance


class KamisClient:
    def __init__(
        self,
        cert_key: str,
        cert_id: str,
        *,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        missing = [
            name
            for name, value in (("KAMIS_CERT_KEY", cert_key), ("KAMIS_CERT_ID", cert_id))
            if not value
        ]
        if missing:
            raise DataUnavailable(
                "aT KAMIS 는 인증키와 계정 ID 가 모두 필요합니다. "
                f"없는 값: {', '.join(missing)}"
            )
        self.cert_key = cert_key
        self.cert_id = cert_id
        self._client = http_client
        self._owns_client = http_client is None

    async def __aenter__(self) -> "KamisClient":
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

    async def daily_prices(self, *, on: date | None = None) -> list[ItemPrice]:
        """일별 품목별 도·소매 가격.

        Raises:
            DataUnavailable: 조회에 실패한 경우. 값을 지어내지 않는다.
        """
        on = on or date.today()
        params = {
            "action": "dailySalesList",
            "p_cert_key": self.cert_key,
            "p_cert_id": self.cert_id,
            "p_returntype": "json",
            "p_regday": on.isoformat(),
        }

        try:
            response = await self._http().get(KAMIS_BASE, params=params)
            response.raise_for_status()
            payload = json.loads(response.text)
        except (httpx.HTTPError, json.JSONDecodeError, OSError) as exc:
            raise DataUnavailable(f"KAMIS 조회에 실패했습니다: {exc}") from exc

        rows = _extract_rows(payload)
        if not rows:
            raise DataUnavailable(
                f"{on.isoformat()} KAMIS 응답에 가격 행이 없습니다(휴일이거나 미공표일 수 있습니다)."
            )

        retrieved_at = datetime.now(KST)
        prices: list[ItemPrice] = []
        for row in rows:
            price = _to_float(row.get("dpr1"))
            name = row.get("item_name") or row.get("productName")
            if price is None or not name:
                continue
            prices.append(
                ItemPrice(
                    item_name=str(name),
                    unit=str(row.get("unit", "")),
                    price=price,
                    surveyed_on=on.isoformat(),
                    provenance=Provenance(
                        org=ORG,
                        table_id="dailySalesList",
                        period=on.strftime("%Y%m%d"),
                        # 가격은 지수가 아니라 원화 실측치라 기준연도 개념이 없다.
                        base_year=on.year,
                        retrieved_at=retrieved_at,
                        note="일별 소매가격(원)",
                    ),
                )
            )
        return prices


def _extract_rows(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("data", "price", "item"):
            value = payload.get(key)
            if isinstance(value, list):
                return [r for r in value if isinstance(r, dict)]
            if isinstance(value, dict):
                inner = value.get("item")
                if isinstance(inner, list):
                    return [r for r in inner if isinstance(r, dict)]
    return []


def _to_float(raw: object) -> float | None:
    if raw is None:
        return None
    text = str(raw).replace(",", "").strip()
    if text in ("", "-", "0"):
        return None
    try:
        return float(text)
    except ValueError:
        return None
