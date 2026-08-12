"""라스파이레스 지수 계산과 기여도 분해.

소비자물가지수는 기준시점 고정 가중산술평균(라스파이레스)이다.

    공식지수  I_t = Σ(w_i × I_i,t) / Σw_i      (Σw_i = 1,000)
    내 물가   P_t = Σ(v_i × I_i,t) / Σv_i      (v_i = 사용자 가중치)
    전년동월비 rate = (P_t / P_{t-12} - 1) × 100

I_i,t 는 KOSIS가 이미 계산해 둔 품목별 지수를 그대로 쓴다. 원가격을 다시 구하지
않으며, 바뀌는 것은 가중치뿐이다.

★ 기준연도 안전장치: 서로 다른 기준연도(2020=100 / 2025=100)의 지수가 한
계산에 섞이면 숫자는 나오지만 의미가 없다. 조용히 계산되지 않도록
BaseYearMismatchError 를 던져 즉시 실패시킨다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

from ..errors import BaseYearMismatchError, DataUnavailable

#: 격차가 이보다 작으면 "공식 물가와 사실상 같다"로 본다(%p).
NEGLIGIBLE_GAP = 0.05


@dataclass(frozen=True)
class IndexPoint:
    """지수 한 점. base_year 없이는 만들 수 없다."""

    code: str
    period: str
    value: float
    base_year: int


@dataclass(frozen=True)
class WeightSet:
    """가중치 집합.

    가중치의 절대 크기는 결과에 영향을 주지 않는다(비율만 쓴다). 합계가
    1,000이든 100이든 같은 지수가 나온다.
    """

    weights: Mapping[str, float]
    label: str
    source: str
    #: 이 가중치가 만들어진 지수 기준연도.
    base_year: int

    def __post_init__(self) -> None:
        if not self.weights:
            raise DataUnavailable("가중치가 비어 있습니다.")
        if any(w < 0 for w in self.weights.values()):
            raise DataUnavailable("가중치에 음수가 있습니다.")
        if self.total <= 0:
            raise DataUnavailable("가중치 합계가 0입니다.")

    @property
    def total(self) -> float:
        return sum(self.weights.values())

    @property
    def codes(self) -> frozenset[str]:
        return frozenset(self.weights)

    def share(self, code: str) -> float:
        """정규화된 비중(0~1)."""
        return self.weights.get(code, 0.0) / self.total

    def normalized(self, total: float = 1000.0) -> dict[str, float]:
        """합계를 total 로 맞춘 가중치. L1 슬라이더 저장에 쓴다."""
        factor = total / self.total
        return {code: weight * factor for code, weight in self.weights.items()}


@dataclass(frozen=True)
class DivisionContribution:
    """한 분류가 내 물가와 격차에 기여한 몫."""

    code: str
    name: str
    my_share: float
    official_share: float
    #: 내 비중 ÷ 평균 비중. 문장의 "평균의 N배".
    share_ratio: float
    #: 이 분류 자체의 전년동월비 상승률(%). 부호 판정은 이것으로 한다.
    division_rate: float
    #: 내 물가 상승률에 대한 기여(%p).
    my_contribution: float
    #: 공식 상승률에 대한 기여(%p).
    official_contribution: float
    #: 격차(내 물가 - 공식)에 대한 기여(%p). 부호 판정은 이것으로 따로 한다.
    gap_contribution: float


@dataclass(frozen=True)
class CpiResult:
    """한 시점의 계산 결과 전체."""

    period: str
    previous_period: str
    base_year: int
    my_index: float
    my_rate: float
    official_index: float
    official_rate: float
    contributions: tuple[DivisionContribution, ...]

    @property
    def gap(self) -> float:
        """내 물가 - 공식 (%p)."""
        return self.my_rate - self.official_rate

    @property
    def is_negligible(self) -> bool:
        return abs(self.gap) < NEGLIGIBLE_GAP


# ---------------------------------------------------------------------------
# 기준연도 안전장치
# ---------------------------------------------------------------------------


def require_single_base_year(points: Sequence[IndexPoint], *, context: str = "") -> int:
    """지수들이 모두 같은 기준연도인지 확인하고 그 기준연도를 돌려준다."""
    if not points:
        raise DataUnavailable(f"지수가 비어 있습니다{(' — ' + context) if context else ''}.")
    base_years = {p.base_year for p in points}
    if len(base_years) > 1:
        raise BaseYearMismatchError(
            f"기준연도가 다른 지수를 한 계산에 섞을 수 없습니다: "
            f"{sorted(base_years)}{(' — ' + context) if context else ''}. "
            "2026-12 기준개편(2020=100 -> 2025=100) 전후 지수를 함께 쓰지 않았는지 확인하세요."
        )
    return base_years.pop()


def _as_map(points: Sequence[IndexPoint]) -> dict[str, IndexPoint]:
    return {p.code: p for p in points}


def _require_coverage(points: Mapping[str, IndexPoint], weights: WeightSet, period: str) -> None:
    """가중치가 있는 분류의 지수가 하나라도 없으면 계산하지 않는다.

    빠진 분류를 조용히 빼고 계산하면 분모가 달라져 결과가 왜곡된다.
    """
    missing = sorted(weights.codes - set(points))
    if missing:
        raise DataUnavailable(
            f"{period} 시점의 지수가 없는 분류가 있습니다: {', '.join(missing)}"
        )


# ---------------------------------------------------------------------------
# 계산
# ---------------------------------------------------------------------------


def aggregate(points: Sequence[IndexPoint], weights: WeightSet) -> float:
    """라스파이레스 가중산술평균. Σ(v_i × I_i) / Σv_i"""
    period = points[0].period if points else "?"
    require_single_base_year(points, context=f"{period} 집계")
    by_code = _as_map(points)
    _require_coverage(by_code, weights, period)

    numerator = sum(weight * by_code[code].value for code, weight in weights.weights.items())
    return numerator / weights.total


def yoy_rate(current: float, previous: float) -> float:
    """전년동월비 상승률(%). (P_t / P_{t-12} - 1) × 100"""
    if previous == 0:
        raise DataUnavailable("전년 동월 지수가 0이라 상승률을 계산할 수 없습니다.")
    return (current / previous - 1.0) * 100.0


def compute(
    *,
    current: Sequence[IndexPoint],
    previous: Sequence[IndexPoint],
    mine: WeightSet,
    official: WeightSet,
) -> CpiResult:
    """내 물가와 공식 지수를 함께 계산하고 격차를 분류별로 분해한다.

    기여도 분해는 합이 정확히 맞는 형태를 쓴다.

        기여도_i   = 비중_i × (I_i,t − I_i,t-12) / P_{t-12} × 100
        Σ기여도_i  ≡ 내 물가 상승률

        격차기여_i = 내비중_i × ΔI_i / P_{t-12} × 100
                   − 평균비중_i × ΔI_i / O_{t-12} × 100
        Σ격차기여_i ≡ 내 물가 상승률 − 공식 상승률

    스펙의 직관식 (내비중 − 평균비중) × 분류상승률 은 두 분모(P_{t-12}, O_{t-12})가
    같다고 본 근사다. "격차를 품목별로 분해한다"가 참이려면 합이 정확히 맞아야
    하므로 여기서는 분모를 살린 정확식을 쓴다. 분모가 같으면 직관식으로 환원된다.
    """
    base_year = require_single_base_year(list(current) + list(previous), context="내 물가 계산")

    current_map = _as_map(current)
    previous_map = _as_map(previous)

    my_now = aggregate(current, mine)
    my_before = aggregate(previous, mine)
    official_now = aggregate(current, official)
    official_before = aggregate(previous, official)

    my_rate = yoy_rate(my_now, my_before)
    official_rate = yoy_rate(official_now, official_before)

    contributions: list[DivisionContribution] = []
    for code in sorted(mine.codes | official.codes):
        now_point = current_map.get(code)
        before_point = previous_map.get(code)
        if now_point is None or before_point is None:
            continue

        delta = now_point.value - before_point.value
        my_share = mine.share(code)
        official_share = official.share(code)

        my_contribution = my_share * delta / my_before * 100.0
        official_contribution = official_share * delta / official_before * 100.0

        contributions.append(
            DivisionContribution(
                code=code,
                name=_division_name(code),
                my_share=my_share,
                official_share=official_share,
                share_ratio=(my_share / official_share) if official_share else float("inf"),
                division_rate=yoy_rate(now_point.value, before_point.value),
                my_contribution=my_contribution,
                official_contribution=official_contribution,
                gap_contribution=my_contribution - official_contribution,
            )
        )

    return CpiResult(
        period=current[0].period,
        previous_period=previous[0].period,
        base_year=base_year,
        my_index=my_now,
        my_rate=my_rate,
        official_index=official_now,
        official_rate=official_rate,
        contributions=tuple(contributions),
    )


def _division_name(code: str) -> str:
    from ..weights.official import division_name

    return division_name(code)


def points_from_mapping(
    values: Mapping[str, float], *, period: str, base_year: int
) -> list[IndexPoint]:
    """{분류코드: 지수} 를 IndexPoint 목록으로."""
    return [
        IndexPoint(code=code, period=period, value=float(value), base_year=base_year)
        for code, value in values.items()
    ]
