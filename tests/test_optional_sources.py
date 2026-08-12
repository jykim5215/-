"""KAMIS·오피넷 선택 소스 테스트.

키가 없으면 ④ 장바구니만 비활성화되고 나머지는 정상 동작해야 한다.
"""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest

from app.errors import DataUnavailable
from app.sources.kamis import KamisClient
from app.sources.opinet import FREE_TIER_DAYS, OpinetClient, load_range, store_daily


def json_response(payload) -> httpx.Response:
    return httpx.Response(200, text=json.dumps(payload, ensure_ascii=False))


# --- KAMIS: 키 두 개가 모두 필요하다 -------------------------------------------


@pytest.mark.parametrize(
    "cert_key,cert_id,missing",
    [
        ("", "id", "KAMIS_CERT_KEY"),
        ("key", "", "KAMIS_CERT_ID"),
        ("", "", "KAMIS_CERT_KEY"),
    ],
)
def test_kamis_requires_both_credentials(cert_key, cert_id, missing):
    with pytest.raises(DataUnavailable, match=missing):
        KamisClient(cert_key, cert_id)


def test_kamis_accepts_both_credentials():
    client = KamisClient("key", "id")
    assert client.cert_key == "key" and client.cert_id == "id"


async def test_kamis_parses_prices():
    payload = {"data": {"item": [
        {"item_name": "쌀", "unit": "20kg", "dpr1": "58,900"},
        {"item_name": "결측", "unit": "kg", "dpr1": "-"},
    ]}}
    transport = httpx.MockTransport(lambda request: json_response(payload))
    async with KamisClient("k", "i", http_client=httpx.AsyncClient(transport=transport)) as client:
        prices = await client.daily_prices(on=date(2026, 8, 11))

    assert len(prices) == 1, "결측 행은 0으로 채우지 않고 제외한다"
    assert prices[0].item_name == "쌀"
    assert prices[0].price == 58900.0
    assert prices[0].provenance.org.startswith("한국농수산식품유통공사")


async def test_kamis_failure_reports_reason_without_inventing_values():
    transport = httpx.MockTransport(lambda request: httpx.Response(500, text="oops"))
    async with KamisClient("k", "i", http_client=httpx.AsyncClient(transport=transport)) as client:
        with pytest.raises(DataUnavailable, match="KAMIS 조회에 실패"):
            await client.daily_prices()


async def test_kamis_empty_response_is_not_silently_zero():
    transport = httpx.MockTransport(lambda request: json_response({"data": {"item": []}}))
    async with KamisClient("k", "i", http_client=httpx.AsyncClient(transport=transport)) as client:
        with pytest.raises(DataUnavailable, match="가격 행이 없습니다"):
            await client.daily_prices()


# --- 오피넷: 무료 키의 7일 제한 -------------------------------------------------


def test_opinet_requires_key_and_explains_the_seven_day_limit():
    with pytest.raises(DataUnavailable) as excinfo:
        OpinetClient("")
    assert "7일" in str(excinfo.value)
    assert FREE_TIER_DAYS == 7


async def test_opinet_parses_average_prices():
    payload = {"RESULT": {"OIL": [
        {"PRODCD": "B027", "PRODNM": "휘발유", "PRICE": "1,712.34"},
        {"PRODCD": "D047", "PRODNM": "경유", "PRICE": "1,588.90"},
    ]}}
    transport = httpx.MockTransport(lambda request: json_response(payload))
    async with OpinetClient("key", http_client=httpx.AsyncClient(transport=transport)) as client:
        prices = await client.average_prices()

    assert [p.product for p in prices] == ["휘발유", "경유"]
    assert prices[0].price == pytest.approx(1712.34)


def test_daily_storage_builds_the_series_the_free_tier_cannot(memory_db):
    """무료 키가 7일만 주므로 시계열은 적재로만 만들 수 있다."""
    from app.sources.opinet import FuelPrice
    from app.provenance import KST, Provenance
    from datetime import datetime

    def price(day: str, value: float) -> FuelPrice:
        return FuelPrice(
            product="휘발유", price=value, surveyed_on=day,
            provenance=Provenance("오피넷", "avgAllPrice", day.replace("-", ""), 2026,
                                  datetime.now(KST)),
        )

    store_daily(memory_db, [price("2026-08-10", 1700.0)])
    store_daily(memory_db, [price("2026-08-11", 1710.0)])

    series, warning = load_range(memory_db, product="휘발유", start="2026-08-10", end="2026-08-11")
    assert series == [("2026-08-10", 1700.0), ("2026-08-11", 1710.0)]
    assert warning is None


def test_range_beyond_storage_warns_instead_of_fabricating(memory_db):
    from app.sources.opinet import FuelPrice
    from app.provenance import KST, Provenance
    from datetime import datetime

    store_daily(memory_db, [FuelPrice(
        product="휘발유", price=1700.0, surveyed_on="2026-08-10",
        provenance=Provenance("오피넷", "avgAllPrice", "20260810", 2026, datetime.now(KST)),
    )])

    series, warning = load_range(memory_db, product="휘발유", start="2026-01-01", end="2026-08-11")
    assert len(series) == 1, "없는 날짜를 만들어내지 않는다"
    assert warning and "2026-08-10 부터" in warning


def test_empty_storage_explains_why(memory_db):
    series, warning = load_range(memory_db, product="휘발유", start="2026-01-01", end="2026-08-11")
    assert series == []
    assert "일별 적재가 필요" in warning


# --- 서비스: 키가 없어도 나머지 화면은 산다 --------------------------------------


async def test_basket_reports_reasons_without_keys(memory_db):
    from app.config import Settings
    from app.service import CpiService
    from app.weights.official import official_weight_set

    settings = Settings("", "", "", "", ":memory:", "127.0.0.1", 8000)
    service = CpiService(settings, memory_db)
    basket = await service.basket(official_weight_set())

    assert basket["kamis"]["available"] is False
    assert "KAMIS_CERT_KEY" in basket["kamis"]["reason"]
    assert basket["opinet"]["available"] is False
    assert "7일" in basket["opinet"]["reason"]
    # 상위 분류는 키 없이도 나온다
    assert basket["top_divisions"][0]["code"] == "D04"
