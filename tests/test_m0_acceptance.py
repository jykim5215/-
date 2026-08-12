"""M0 인수 테스트 — 공식 가중치를 넣으면 공표치가 재현되어야 한다.

사용자 가중치 자리에 공식 가중치(2022년 기준, 총합 1,000)를 그대로 넣으면
계산 결과가 국가데이터처 공표치와 소수점 첫째 자리까지 일치해야 한다.

    2026년 7월 = 전년비 +2.8%, 지수 119.77 (2020=100)

이 테스트는 **실제 공표치 픽스처를 읽는다.** 픽스처가 없으면 조용히 통과하지
않고 사유를 붙여 SKIP 하며, MYCPI_REQUIRE_M0=1 이면 FAIL 한다. 지어낸 값으로
초록불을 만드는 것은 통계 서비스에서 가장 치명적인 실패다.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.calc.index import aggregate, compute, points_from_mapping, yoy_rate
from app.weights.official import OFFICIAL_WEIGHTS_2022, official_weight_set

FIXTURE = Path(__file__).parent / "fixtures" / "official" / "cpi_division_2026_07.json"

#: 공표 분류지수와 가중치가 이미 반올림된 값이라, 12분류 재집계는 원리상
#: 0.01~0.02 수준의 오차를 남긴다. 스펙이 요구한 "소수점 첫째 자리 일치"와
#: 같은 수준인 ±0.05 로 잡는다. 458품목 가중치를 적재하면 더 좁힐 수 있다.
TOLERANCE = 0.05

_MISSING = f"""
M0 인수 테스트를 실행할 실데이터 픽스처가 없습니다: {FIXTURE.name}

필요한 것: 2026년 7월과 2025년 7월의 지출목적별 12대 분류 지수(2020=100).
채우는 방법은 tests/fixtures/official/README.md 참고.

이 테스트는 실제 공표치로만 통과할 수 있습니다. 값을 지어내서 통과시키면
안 됩니다.
""".strip()


def load_fixture() -> dict:
    if not FIXTURE.exists():
        if os.getenv("MYCPI_REQUIRE_M0") == "1":
            pytest.fail(_MISSING)
        pytest.skip(_MISSING)
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def m0() -> dict:
    return load_fixture()


def _points(fixture: dict, period: str):
    values = fixture["divisions"][period]
    return points_from_mapping(
        values, period=period, base_year=fixture["source"]["base_year"]
    )


def test_fixture_records_its_source(m0):
    """출처 없는 숫자는 이 저장소에 들어올 수 없다."""
    source = m0["source"]
    for field in ("org", "table_id", "base_year", "retrieved_at"):
        assert source.get(field), f"픽스처에 출처 정보 '{field}' 가 없습니다."
    assert isinstance(source["base_year"], int)


def test_fixture_covers_all_twelve_divisions(m0):
    for period, values in m0["divisions"].items():
        assert set(values) == set(OFFICIAL_WEIGHTS_2022), (
            f"{period}: 12대 분류가 모두 있어야 합니다."
        )
        assert all(v > 0 for v in values.values()), f"{period}: 지수는 0보다 커야 합니다."


def test_official_weights_reproduce_published_index(m0):
    """공식 가중치 -> 공표 지수 119.77 재현."""
    expected = m0["expected"]
    current = _points(m0, expected["period"])

    computed = aggregate(current, official_weight_set())

    assert computed == pytest.approx(expected["index"], abs=TOLERANCE), (
        f"공식 가중치로 집계한 지수 {computed:.4f} 가 공표치 "
        f"{expected['index']} 와 {TOLERANCE} 이상 어긋납니다."
    )


def test_official_weights_reproduce_published_rate(m0):
    """공식 가중치 -> 공표 전년동월비 +2.8% 재현."""
    expected = m0["expected"]
    period = expected["period"]
    previous_period = f"{int(period[:4]) - 1}{period[4:]}"

    weights = official_weight_set()
    now = aggregate(_points(m0, period), weights)
    before = aggregate(_points(m0, previous_period), weights)
    rate = yoy_rate(now, before)

    assert rate == pytest.approx(expected["yoy_rate"], abs=TOLERANCE), (
        f"공식 가중치로 계산한 상승률 {rate:.4f}% 가 공표치 "
        f"{expected['yoy_rate']}% 와 {TOLERANCE}%p 이상 어긋납니다."
    )
    assert round(rate, 1) == pytest.approx(expected["yoy_rate"], abs=1e-9), (
        "소수점 첫째 자리까지 일치해야 합니다."
    )


def test_official_weights_as_user_weights_gives_zero_gap(m0):
    """사용자 가중치 = 공식 가중치이면 격차가 정확히 0이어야 한다.

    개인화 경로 전체(compute)가 공식 경로와 같은 산식을 쓰는지 확인한다.
    """
    expected = m0["expected"]
    period = expected["period"]
    previous_period = f"{int(period[:4]) - 1}{period[4:]}"

    result = compute(
        current=_points(m0, period),
        previous=_points(m0, previous_period),
        mine=official_weight_set(),
        official=official_weight_set(),
    )

    assert result.gap == pytest.approx(0.0, abs=1e-12)
    assert result.is_negligible
    assert result.my_rate == pytest.approx(expected["yoy_rate"], abs=TOLERANCE)
    assert result.my_index == pytest.approx(expected["index"], abs=TOLERANCE)
