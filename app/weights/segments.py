"""L0 세그먼트 기본 가중치.

가구원 수 / 소득분위 / 주거형태 / 자차 유무 4개만 묻고, 가계동향조사의
소득분위별·가구원수별 지출 구성비를 기본 가중치로 채운다. 업로드 없이도
결과가 나오는 기본 경로다.

★ 구성비는 **런타임에 KOSIS에서 받아온다.** 여기에 숫자를 하드코딩하지 않는다.
조회에 실패하면 그럴듯한 값으로 채우는 대신 사유를 붙여 실패시키고, 호출부가
공식 평균 가중치로 내려가되 "개인화되지 않았다"는 사실을 화면에 남긴다.

★ 주거형태·자차 유무는 12대 분류 구성비만으로는 반영할 수 없다. 자가주거비는
헤드라인 CPI에서 제외돼 있고, 자차 유무는 교통 안에서 운영비 품목이 갈리는
문제라 품목(458개) 단위 가중치가 있어야 한다. 그래서 지금은 **조정 계수를
지어내지 않고** 해당 분류에 확인 힌트를 붙여 L1 슬라이더로 유도한다.
품목 가중치 엑셀이 적재되면 이 자리에서 재배분할 수 있다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..calc.index import WeightSet
from ..errors import DataUnavailable
from ..provenance import Provenance
from ..sources.kosis import KosisClient, PeriodRange, RecentCount
from .official import DIVISIONS, resolve_division

HousingType = Literal["own", "jeonse", "monthly"]

HOUSING_LABELS: dict[str, str] = {
    "own": "자가",
    "jeonse": "전세",
    "monthly": "월세",
}


@dataclass(frozen=True)
class Segment:
    """L0에서 묻는 네 가지."""

    household_size: int
    income_decile: int
    housing_type: HousingType
    has_car: bool

    def __post_init__(self) -> None:
        if not 1 <= self.household_size <= 10:
            raise DataUnavailable("가구원 수는 1~10 사이여야 합니다.")
        if not 1 <= self.income_decile <= 10:
            raise DataUnavailable("소득분위는 1~10 사이여야 합니다.")
        if self.housing_type not in HOUSING_LABELS:
            raise DataUnavailable(f"주거형태가 올바르지 않습니다: {self.housing_type}")

    @property
    def label(self) -> str:
        car = "자차 있음" if self.has_car else "자차 없음"
        return (
            f"{self.household_size}인 가구 · 소득 {self.income_decile}분위 · "
            f"{HOUSING_LABELS[self.housing_type]} · {car}"
        )


@dataclass(frozen=True)
class SegmentWeights:
    """세그먼트로 만든 가중치와 그 한계."""

    weights: WeightSet
    provenance: Provenance
    #: 구성비로 반영하지 못해 사용자 확인이 필요한 분류.
    review_hints: tuple[tuple[str, str], ...] = ()
    #: 개인화가 실제로 일어났는지. False면 공식 평균 가중치를 쓴 것이다.
    personalized: bool = True


#: 가계동향조사 통계표는 tblId 를 하드코딩하지 않고 search() 로 찾는다.
HOUSEHOLD_SURVEY_KEYWORD = "가구원수별 가구당 월평균 가계수지"
HOUSEHOLD_SURVEY_KEYWORD_ALT = "소득 5분위별 가구당 월평균 가계수지"


async def fetch_segment_weights(
    client: KosisClient, segment: Segment, *, base_year: int = 2020
) -> SegmentWeights:
    """가계동향조사 지출 구성비로 세그먼트 기본 가중치를 만든다.

    Raises:
        DataUnavailable: 통계표나 구성비를 확보하지 못한 경우. 이때 숫자를
            지어내지 않는다. 호출부가 공식 평균 가중치로 내려가고 그 사실을
            화면에 표시한다.
    """
    table = None
    for keyword in (HOUSEHOLD_SURVEY_KEYWORD, HOUSEHOLD_SURVEY_KEYWORD_ALT):
        try:
            table = await client.find_table(keyword=keyword)
            break
        except DataUnavailable:
            continue
    if table is None:
        raise DataUnavailable(
            "가계동향조사 지출 구성비 통계표를 찾지 못했습니다(목록·검색 조회 실패)."
        )

    codes = await client.resolve_codes(table.org_id, table.tbl_id)
    if not codes.items:
        raise DataUnavailable(f"가계동향조사 통계표 {table.tbl_id} 의 항목 코드를 확인하지 못했습니다.")

    rows = await client.data(
        org_id=table.org_id,
        tbl_id=table.tbl_id,
        itm_id=list(codes.items),
        obj_l1="ALL",
        period=RecentCount(1),
    )

    shares = _extract_division_shares(rows)
    missing = {d.code for d in DIVISIONS} - set(shares)
    if missing:
        raise DataUnavailable(
            "가계동향조사에서 12대 분류 구성비를 모두 얻지 못했습니다: "
            + ", ".join(sorted(missing))
        )

    period = rows[0].prd_de if rows else ""
    provenance = Provenance(
        org="국가데이터처",
        table_id=table.tbl_id,
        period=period,
        base_year=base_year,
        retrieved_at=_now(),
        note=(table.note or None),
    )
    return SegmentWeights(
        weights=WeightSet(
            weights=shares,
            label=f"{segment.label} 기본 가중치",
            source=f"가계동향조사 지출 구성비 ({table.tbl_id})",
            base_year=base_year,
        ),
        provenance=provenance,
        review_hints=review_hints(segment),
    )


def review_hints(segment: Segment) -> tuple[tuple[str, str], ...]:
    """구성비로는 반영되지 않아 사용자가 직접 확인해야 하는 분류.

    조정 계수를 지어내는 대신, 왜 어긋날 수 있는지를 알려 L1 슬라이더로
    보정하게 한다.
    """
    hints: list[tuple[str, str]] = []

    if segment.housing_type == "own":
        hints.append(
            (
                "D04",
                "자가 보유자입니다. 헤드라인 소비자물가지수에는 자가주거비가 "
                "빠져 있어(주거 가중치 약 9.8%) 체감과 가장 크게 어긋나는 "
                "항목입니다. 주택·수도·전기·연료 비중을 직접 확인해 보세요.",
            )
        )
    elif segment.housing_type == "monthly":
        hints.append(
            (
                "D04",
                "월세 거주자입니다. 실제 월세 지출 비중이 평균과 다를 수 있으니 "
                "주택·수도·전기·연료 비중을 확인해 보세요.",
            )
        )

    if not segment.has_car:
        hints.append(
            (
                "D07",
                "자차가 없습니다. 교통 분류에는 휘발유·경유·자동차 구입비가 "
                "함께 들어 있어, 자차가 없으면 실제 비중이 평균보다 낮습니다. "
                "교통 비중을 직접 낮춰 보세요.",
            )
        )
    else:
        hints.append(
            (
                "D07",
                "자차가 있습니다. 유가 변동이 평균보다 크게 반영될 수 있으니 "
                "교통 비중을 확인해 보세요.",
            )
        )

    return tuple(hints)


def _extract_division_shares(rows) -> dict[str, float]:
    """응답 행에서 12대 분류 구성비를 뽑는다.

    가계동향조사의 소비지출 12개 비목은 소비자물가지수의 지출목적별 12대
    분류와 같은 체계라 이름으로 대응된다.
    """
    shares: dict[str, float] = {}
    for row in rows:
        if not row.has_value:
            continue
        for name in list(row.class_names.values()) + [row.itm_nm or ""]:
            division = resolve_division(name)
            if division is not None:
                shares[division.code] = row.dt
                break
    return shares


def _now():
    from datetime import datetime

    from ..provenance import KST

    return datetime.now(KST)
