"""라스파이레스 계산과 기여도 분해의 항등식 테스트.

여기 있는 테스트는 **실데이터에 의존하지 않는다.** 산식이 대수적으로 옳은지를
검증하므로, 쓰는 숫자는 통계값이 아니라 자명한 합성값이다. 실제 공표치 재현은
test_m0_acceptance.py 가 맡는다.
"""

from __future__ import annotations

import math

import pytest

from app.calc.index import (
    IndexPoint,
    WeightSet,
    aggregate,
    compute,
    points_from_mapping,
    require_single_base_year,
    yoy_rate,
)
from app.errors import BaseYearMismatchError, DataUnavailable
from app.weights.official import (
    DIVISIONS,
    OFFICIAL_WEIGHTS_2022,
    WEIGHT_TOTAL,
    official_weight_set,
    resolve_division,
)

CODES = list(OFFICIAL_WEIGHTS_2022)


def weights(mapping: dict[str, float], *, base_year: int = 2020) -> WeightSet:
    return WeightSet(weights=mapping, label="테스트", source="합성", base_year=base_year)


def flat(value: float, period: str = "202607", base_year: int = 2020):
    return points_from_mapping({c: value for c in CODES}, period=period, base_year=base_year)


# --- 공식 가중치 시드 자체의 무결성 ---------------------------------------------


def test_official_weights_sum_to_1000():
    assert sum(OFFICIAL_WEIGHTS_2022.values()) == pytest.approx(WEIGHT_TOTAL, abs=1e-9)


def test_division_item_counts_sum_to_458():
    assert sum(d.item_count for d in DIVISIONS) == 458


def test_every_division_has_a_weight():
    assert {d.code for d in DIVISIONS} == set(OFFICIAL_WEIGHTS_2022)


def test_division_lookup_tolerates_punctuation_variants():
    """KOSIS 분류명 표기가 조금 달라도 같은 분류로 해석돼야 한다."""
    assert resolve_division("주택, 수도, 전기 및 연료").code == "D04"
    assert resolve_division("주택·수도·전기 및 연료").code == "D04"
    assert resolve_division("주택수도전기및연료").code == "D04"
    assert resolve_division("D04").code == "D04"
    assert resolve_division("없는 분류") is None


# --- 라스파이레스 집계의 기본 성질 ----------------------------------------------


def test_all_equal_indices_aggregate_to_that_value():
    """모든 지수가 X면 가중치가 무엇이든 결과도 X."""
    assert aggregate(flat(107.25), official_weight_set()) == pytest.approx(107.25)
    lopsided = weights({c: (100.0 if c == "D01" else 1.0) for c in CODES})
    assert aggregate(flat(107.25), lopsided) == pytest.approx(107.25)


def test_weight_scale_does_not_change_the_index():
    """가중치의 절대 크기는 결과에 영향을 주지 않는다. 비율만 쓴다."""
    points = points_from_mapping(
        {c: 100.0 + i for i, c in enumerate(CODES)}, period="202607", base_year=2020
    )
    base = {c: OFFICIAL_WEIGHTS_2022[c] for c in CODES}
    scaled = {c: w * 7.3 for c, w in base.items()}

    assert aggregate(points, weights(base)) == pytest.approx(
        aggregate(points, weights(scaled)), abs=1e-12
    )


def test_index_is_monotonic_in_a_component():
    points = {c: 100.0 for c in CODES}
    low = aggregate(points_from_mapping(points, period="202607", base_year=2020), official_weight_set())
    points["D01"] = 110.0
    high = aggregate(points_from_mapping(points, period="202607", base_year=2020), official_weight_set())
    assert high > low


def test_normalized_weights_sum_to_target():
    ws = weights({c: 1.0 for c in CODES})
    normalized = ws.normalized(1000.0)
    assert sum(normalized.values()) == pytest.approx(1000.0)


# --- 기준연도 안전장치 (스펙 §4) ------------------------------------------------


def test_mixing_base_years_raises_immediately():
    """2020=100 과 2025=100 을 섞으면 조용히 계산되면 안 된다."""
    mixed = [
        IndexPoint("D01", "202607", 119.0, base_year=2020),
        IndexPoint("D02", "202607", 101.0, base_year=2025),
    ]
    with pytest.raises(BaseYearMismatchError, match="기준연도"):
        require_single_base_year(mixed)


def test_compute_rejects_base_year_mix_between_periods():
    """t 는 2025=100, t-12 는 2020=100 인 경우 — 개편 직후 가장 하기 쉬운 실수."""
    current = flat(101.0, period="202612", base_year=2025)
    previous = flat(119.0, period="202512", base_year=2020)

    with pytest.raises(BaseYearMismatchError):
        compute(
            current=current,
            previous=previous,
            mine=official_weight_set(),
            official=official_weight_set(),
        )


def test_same_base_year_computes_fine():
    result = compute(
        current=flat(103.0, period="202612", base_year=2025),
        previous=flat(100.0, period="202512", base_year=2025),
        mine=official_weight_set(),
        official=official_weight_set(),
    )
    assert result.base_year == 2025
    assert result.my_rate == pytest.approx(3.0)


def test_index_point_carries_base_year():
    """base_year 없이 지수를 만들 수 없다."""
    with pytest.raises(TypeError):
        IndexPoint("D01", "202607", 119.0)  # type: ignore[call-arg]


# --- 결측 처리 ------------------------------------------------------------------


def test_missing_division_is_refused_not_silently_dropped():
    """빠진 분류를 조용히 빼고 계산하면 분모가 달라져 결과가 왜곡된다."""
    partial = points_from_mapping(
        {c: 110.0 for c in CODES if c != "D07"}, period="202607", base_year=2020
    )
    with pytest.raises(DataUnavailable, match="D07"):
        aggregate(partial, official_weight_set())


def test_empty_weights_are_refused():
    with pytest.raises(DataUnavailable):
        weights({})


def test_negative_weight_is_refused():
    with pytest.raises(DataUnavailable):
        weights({"D01": -1.0, "D02": 2.0})


def test_zero_previous_index_is_refused():
    with pytest.raises(DataUnavailable):
        yoy_rate(110.0, 0.0)


# --- 기여도 분해 항등식 (이 서비스의 핵심 주장) ---------------------------------


def sample_case():
    """합성 케이스: 분류마다 다르게 움직이고, 내 가중치는 공식과 다르다."""
    previous = points_from_mapping(
        {c: 100.0 + i for i, c in enumerate(CODES)}, period="202507", base_year=2020
    )
    current = points_from_mapping(
        {c: (100.0 + i) * (1.0 + (i - 5) / 100.0) for i, c in enumerate(CODES)},
        period="202607",
        base_year=2020,
    )
    mine = weights(
        {c: OFFICIAL_WEIGHTS_2022[c] * (1.0 + (i % 5) / 4.0) for i, c in enumerate(CODES)}
    )
    return current, previous, mine


def test_contributions_sum_exactly_to_my_rate():
    """Σ기여도 ≡ 내 물가 상승률. 분해가 전체를 남김없이 설명해야 한다."""
    current, previous, mine = sample_case()
    result = compute(current=current, previous=previous, mine=mine, official=official_weight_set())

    total = sum(c.my_contribution for c in result.contributions)
    assert total == pytest.approx(result.my_rate, abs=1e-9)


def test_official_contributions_sum_exactly_to_official_rate():
    current, previous, mine = sample_case()
    result = compute(current=current, previous=previous, mine=mine, official=official_weight_set())

    total = sum(c.official_contribution for c in result.contributions)
    assert total == pytest.approx(result.official_rate, abs=1e-9)


def test_gap_contributions_sum_exactly_to_the_gap():
    """Σ격차기여 ≡ 격차. "격차를 품목별로 분해한다"는 주장의 근거."""
    current, previous, mine = sample_case()
    result = compute(current=current, previous=previous, mine=mine, official=official_weight_set())

    total = sum(c.gap_contribution for c in result.contributions)
    assert total == pytest.approx(result.gap, abs=1e-9)


def test_identical_weights_give_zero_gap_and_zero_gap_contributions():
    current, previous, _ = sample_case()
    result = compute(
        current=current,
        previous=previous,
        mine=official_weight_set(),
        official=official_weight_set(),
    )

    assert result.gap == pytest.approx(0.0, abs=1e-12)
    assert all(abs(c.gap_contribution) < 1e-12 for c in result.contributions)
    assert result.is_negligible


def test_share_ratio_reflects_weight_difference():
    current, previous, _ = sample_case()
    doubled_food = dict(OFFICIAL_WEIGHTS_2022)
    doubled_food["D01"] *= 2
    result = compute(
        current=current,
        previous=previous,
        mine=weights(doubled_food),
        official=official_weight_set(),
    )

    food = next(c for c in result.contributions if c.code == "D01")
    # 비중이 2배가 됐지만 합계도 커지므로 비율은 2배보다 조금 작다.
    assert 1.5 < food.share_ratio < 2.0
    assert food.my_share > food.official_share


def test_gap_sign_is_independent_of_division_rate_sign():
    """기여도가 음수여도 그 분류의 가격이 내렸다는 뜻이 아니다.

    이 서비스에서 가장 하기 쉬운 오독을 산식 수준에서 확인한다. 모든 분류가
    올랐는데도, 많이 오른 분류의 비중이 낮으면 격차기여는 음수가 된다.
    """
    previous = points_from_mapping({c: 100.0 for c in CODES}, period="202507", base_year=2020)
    # 모든 분류가 상승. D07(교통)이 가장 크게 올랐다.
    rises = {c: 102.0 for c in CODES}
    rises["D07"] = 120.0
    current = points_from_mapping(rises, period="202607", base_year=2020)

    # 나는 교통 비중이 평균보다 낮다.
    mine_map = dict(OFFICIAL_WEIGHTS_2022)
    mine_map["D07"] = OFFICIAL_WEIGHTS_2022["D07"] / 4

    result = compute(
        current=current, previous=previous, mine=weights(mine_map), official=official_weight_set()
    )
    transport = next(c for c in result.contributions if c.code == "D07")

    assert transport.division_rate > 0, "교통 가격은 올랐다"
    assert transport.gap_contribution < 0, "그런데 격차기여는 음수다"
    assert transport.share_ratio < 1


def test_negligible_gap_threshold():
    previous = points_from_mapping({c: 100.0 for c in CODES}, period="202507", base_year=2020)
    current = points_from_mapping({c: 102.0 for c in CODES}, period="202607", base_year=2020)
    mine_map = dict(OFFICIAL_WEIGHTS_2022)
    mine_map["D01"] *= 1.2

    result = compute(
        current=current, previous=previous, mine=weights(mine_map), official=official_weight_set()
    )
    # 모든 분류가 똑같이 올랐으면 가중치를 바꿔도 격차가 없다.
    assert result.is_negligible
    assert math.isclose(result.gap, 0.0, abs_tol=1e-9)
