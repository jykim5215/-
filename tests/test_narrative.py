"""문장 생성 테스트.

핵심은 스펙이 경고한 오류를 막는 것이다: 기여도가 음수라고 해서 그 분류의
가격이 내렸다는 뜻이 아니다. 네 가지 부호 조합을 전부 확인한다.
"""

from __future__ import annotations

import pytest

from app.calc.index import WeightSet, compute, points_from_mapping
from app.calc.narrative import build, explain_contribution, has_batchim, josa, pick_driver
from app.weights.official import OFFICIAL_WEIGHTS_2022, official_weight_set

CODES = list(OFFICIAL_WEIGHTS_2022)


def scenario(*, moved_code: str, moved_to: float, my_multiplier: float):
    """한 분류만 다르게 움직이고, 그 분류의 내 비중만 다른 상황을 만든다."""
    previous = points_from_mapping({c: 100.0 for c in CODES}, period="202507", base_year=2020)
    values = {c: 100.0 for c in CODES}
    values[moved_code] = moved_to
    current = points_from_mapping(values, period="202607", base_year=2020)

    mine = dict(OFFICIAL_WEIGHTS_2022)
    mine[moved_code] = OFFICIAL_WEIGHTS_2022[moved_code] * my_multiplier

    return compute(
        current=current,
        previous=previous,
        mine=WeightSet(weights=mine, label="테스트", source="합성", base_year=2020),
        official=official_weight_set(),
    )


# --- 조사 처리 ------------------------------------------------------------------


@pytest.mark.parametrize(
    "word,expected",
    [
        ("교통", True),
        ("통신", True),
        ("보건", True),
        ("교육", True),
        ("음식 및 숙박", True),
        ("의류 및 신발", True),
        ("오락 및 문화", False),
        ("주류 및 담배", False),
        ("식료품 및 비주류음료", False),
        ("기타 상품 및 서비스", False),
    ],
)
def test_batchim_detection(word, expected):
    assert has_batchim(word) is expected


def test_josa_agrees_with_final_consonant():
    assert josa("교통", "은/는") == "교통은"
    assert josa("오락 및 문화", "은/는") == "오락 및 문화는"


def test_no_ungrammatical_particle_in_any_sentence():
    """'교통는' 같은 문장이 나오면 안 된다."""
    for code in CODES:
        result = scenario(moved_code=code, moved_to=110.0, my_multiplier=3.0)
        sentence = build(result).sentence
        name = next(c.name for c in result.contributions if c.code == code)
        if has_batchim(name):
            assert f"{name}는 " not in sentence
        else:
            assert f"{name}은 " not in sentence


# --- 네 가지 부호 조합 -----------------------------------------------------------


def test_high_weight_and_price_rose_adds_to_my_rate():
    """비중 높음 + 가격 상승 -> 더해졌다."""
    result = scenario(moved_code="D07", moved_to=120.0, my_multiplier=4.0)
    driver = pick_driver(result)

    assert driver.code == "D07"
    assert driver.division_rate > 0
    assert driver.gap_contribution > 0
    assert driver.share_ratio > 1

    sentence = build(result).sentence
    assert "높습니다" in sentence
    assert "올랐" in sentence
    assert "더해졌습니다" in sentence
    assert "빠졌" not in sentence


def test_high_weight_and_price_fell_subtracts_from_my_rate():
    """비중 높음 + 가격 하락 -> 빠졌다."""
    result = scenario(moved_code="D07", moved_to=90.0, my_multiplier=4.0)
    driver = pick_driver(result)

    assert driver.division_rate < 0
    assert driver.gap_contribution < 0
    assert driver.share_ratio > 1

    sentence = build(result).sentence
    assert "낮습니다" in sentence
    assert "내렸" in sentence
    assert "빠졌습니다" in sentence
    assert "올랐" not in sentence


def test_low_weight_and_price_rose_is_not_described_as_a_price_fall():
    """★ 가장 중요한 케이스.

    가격은 올랐는데 비중이 낮아 기여도가 음수다. 이때 "내렸다"고 쓰면
    사실과 반대가 된다.
    """
    result = scenario(moved_code="D07", moved_to=120.0, my_multiplier=0.2)
    driver = pick_driver(result)

    assert driver.division_rate > 0, "교통 가격은 올랐다"
    assert driver.gap_contribution < 0, "그런데 격차기여는 음수다"
    assert driver.share_ratio < 1

    sentence = build(result).sentence
    assert "올랐는데" in sentence, "가격이 올랐다는 사실이 그대로 쓰여야 한다"
    assert "내렸" not in sentence, "기여도가 음수라고 가격이 내렸다고 쓰면 안 된다"
    assert "덜 받았습니다" in sentence
    assert "낮습니다" in sentence


def test_low_weight_and_price_fell():
    """비중 낮음 + 가격 하락 -> 하락을 덜 누렸다."""
    result = scenario(moved_code="D07", moved_to=90.0, my_multiplier=0.2)
    driver = pick_driver(result)

    assert driver.division_rate < 0
    assert driver.gap_contribution > 0
    assert driver.share_ratio < 1

    sentence = build(result).sentence
    assert "내렸는데" in sentence
    assert "올랐" not in sentence
    assert "덜 받았습니다" in sentence
    assert "높습니다" in sentence


# --- 격차가 없을 때 ---------------------------------------------------------------


def test_negligible_gap_uses_its_own_branch():
    result = scenario(moved_code="D07", moved_to=110.0, my_multiplier=1.0)
    narrative = build(result)

    assert narrative.negligible
    assert "사실상 같습니다" in narrative.sentence
    assert narrative.driver_code is None


def test_gap_just_under_threshold_is_negligible():
    """0.05%p 미만이면 분해 설명을 붙이지 않는다."""
    previous = points_from_mapping({c: 100.0 for c in CODES}, period="202507", base_year=2020)
    values = {c: 100.0 for c in CODES}
    values["D08"] = 100.5  # 통신 비중이 작아 격차가 아주 작게 난다
    current = points_from_mapping(values, period="202607", base_year=2020)
    mine = dict(OFFICIAL_WEIGHTS_2022)
    mine["D08"] *= 1.5

    result = compute(
        current=current,
        previous=previous,
        mine=WeightSet(weights=mine, label="t", source="합성", base_year=2020),
        official=official_weight_set(),
    )

    assert abs(result.gap) < 0.05
    assert build(result).negligible


# --- 막대 설명 --------------------------------------------------------------------


def test_bar_explanation_disambiguates_rise_with_negative_contribution():
    result = scenario(moved_code="D07", moved_to=120.0, my_multiplier=0.2)
    transport = next(c for c in result.contributions if c.code == "D07")

    text = explain_contribution(transport)
    assert "올랐습니다" in text
    assert "낮췄습니다" in text
    assert "가격이 내려서가 아니라" in text


def test_bar_explanation_for_fall_with_positive_contribution():
    result = scenario(moved_code="D07", moved_to=90.0, my_multiplier=0.2)
    transport = next(c for c in result.contributions if c.code == "D07")

    text = explain_contribution(transport)
    assert "내렸습니다" in text
    assert "높였습니다" in text
    assert "하락을 덜 누린" in text


def test_driver_is_chosen_by_absolute_gap_contribution():
    """내 물가를 낮춘 항목도 대표 항목이 될 수 있어야 한다."""
    result = scenario(moved_code="D01", moved_to=80.0, my_multiplier=3.0)
    driver = pick_driver(result)
    assert driver.code == "D01"
    assert driver.gap_contribution < 0
