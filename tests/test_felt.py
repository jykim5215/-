"""체감 환산 테스트.

이 모듈의 핵심 주장은 "가격을 만들어내지 않는다"이다. 개수 환산은 등락률만으로
계산되고, 원화 금액은 사용자가 넣은 값에서만 나온다.
"""

from __future__ import annotations

import pytest

from app.calc.felt import (
    DEFAULT_UNITS,
    FeltItem,
    basket_sentence,
    item_sentence,
    price_after,
    same_basket_cost,
    units_for_same_money,
)
from app.errors import DataUnavailable


def item(rate: float, name: str = "커피", unit: str = "잔") -> FeltItem:
    return FeltItem(item_name=name, unit=unit, rate=rate, base_year=2020, period="202607")


# --- 개수 환산: 가격 없이 성립한다 ---------------------------------------------


def test_price_rise_means_fewer_units():
    """값이 오르면 같은 돈으로 덜 산다."""
    assert units_for_same_money(2.7) == pytest.approx(100 / 1.027)
    assert units_for_same_money(2.7) < 100


def test_price_fall_means_more_units():
    assert units_for_same_money(-5.0) == pytest.approx(100 / 0.95)
    assert units_for_same_money(-5.0) > 100


def test_no_change_means_same_units():
    assert units_for_same_money(0.0) == pytest.approx(100.0)


def test_units_conversion_needs_no_price_at_all():
    """같은 등락률이면 커피든 영화든 같은 개수가 나온다 — 가격과 무관하다."""
    assert units_for_same_money(3.0) == units_for_same_money(3.0)


def test_impossible_rate_is_refused():
    with pytest.raises(DataUnavailable):
        units_for_same_money(-100.0)


# --- 기준가 환산: 사용자가 넣은 값에서만 나온다 ---------------------------------


def test_price_after_applies_real_rate_to_user_input():
    assert price_after(4500, 2.7) == pytest.approx(4621.5)


def test_price_after_has_no_default_price():
    """기본 가격을 갖지 않는다. 반드시 사용자가 넣어야 한다."""
    with pytest.raises(TypeError):
        price_after()  # type: ignore[call-arg]


@pytest.mark.parametrize("bad", [0, -100])
def test_non_positive_base_price_is_refused(bad):
    with pytest.raises(DataUnavailable):
        price_after(bad, 2.7)


# --- 장바구니 환산: 지수의 정의를 그대로 옮긴 것 --------------------------------


def test_same_basket_cost():
    assert same_basket_cost(100_000, 2.8) == pytest.approx(102_800)


def test_basket_sentence_says_how_much_more():
    text = basket_sentence(100_000, 2.8)
    assert "100,000원어치" in text
    assert "102,800원" in text
    assert "2,800원 더" in text


def test_basket_sentence_for_a_fall():
    text = basket_sentence(100_000, -1.5)
    assert "98,500원" in text
    assert "덜 냅니다" in text


def test_basket_sentence_when_flat():
    assert "거의 같습니다" in basket_sentence(100_000, 0.0)


# --- 문장: 부호를 따로 판정한다 --------------------------------------------------


def test_sentence_for_a_rise_says_fewer():
    text = item_sentence(item(10.0))
    assert "커피" in text
    assert "100잔 사던 돈으로" in text
    assert "91잔" in text
    assert "줄었습니다" in text
    assert "늘었습니다" not in text


def test_sentence_for_a_fall_says_more():
    text = item_sentence(item(-10.0))
    assert "111잔" in text
    assert "늘었습니다" in text
    assert "줄었습니다" not in text


def test_sentence_for_no_change():
    assert "거의 그대로입니다" in item_sentence(item(0.1))


def test_sentence_uses_the_real_kosis_item_name():
    """우리가 붙인 별명이 아니라 KOSIS 품목명을 그대로 쓴다."""
    text = item_sentence(item(5.0, name="커피(외식)"))
    assert "커피(외식)" in text


def test_sentence_uses_the_items_own_rate_not_the_headline():
    """품목 문장은 그 품목의 등락률만 쓴다. 전체 상승률을 갖다 붙이지 않는다."""
    coffee = item(12.0, name="커피")
    movie = item(1.0, name="영화관람료", unit="편")

    assert "89잔" in item_sentence(coffee)   # 100 / 1.12
    assert "99편" in item_sentence(movie)    # 100 / 1.01


def test_default_units_is_a_round_hundred():
    assert DEFAULT_UNITS == 100
    assert f"{DEFAULT_UNITS:,.0f}잔" == "100잔"


# --- 품목명 매칭 -----------------------------------------------------------------


def test_exact_item_name_wins_over_longer_match():
    from app.sources.cpi_index import _match_item_name

    names = ["커피(외식)", "커피", "커피크림"]
    assert _match_item_name(names, "커피") == "커피"


def test_shortest_match_when_no_exact_name():
    from app.sources.cpi_index import _match_item_name

    assert _match_item_name(["커피(외식)", "커피크림"], "커피") == "커피크림"


def test_missing_item_returns_none_rather_than_guessing():
    from app.sources.cpi_index import _match_item_name

    assert _match_item_name(["쌀", "빵"], "커피") is None
