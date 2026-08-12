"""공식 가중치 시드 (2022년 기준, 총합 1,000).

출처: 국가데이터처 소비자물가조사(승인번호 101007), 2020=100 지수의 지출목적별
12대 분류 가중치. 품목 단위(458개) 가중치는 KOSIS API로 제공되지 않으므로
`loader.py` 가 통계설명자료 첨부 엑셀을 적재한다.

★ 2026-12-31 공표분부터 2025=100 으로 개편되며 가중치가 전면 교체된다. 그래서
가중치 집합에는 반드시 base_year 와 유효기간이 붙는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class Division:
    """지출목적별 12대 분류."""

    code: str
    name: str
    #: 이 분류에 속한 품목 수(2020=100 기준, 총 458개).
    item_count: int
    #: 문장 생성에 쓰는 대표 세부품목 예시.
    examples: tuple[str, ...] = ()


DIVISIONS: tuple[Division, ...] = (
    Division("D01", "식료품 및 비주류음료", 140, ("농축수산물", "가공식품")),
    Division("D02", "주류 및 담배", 7, ("소주", "담배")),
    Division("D03", "의류 및 신발", 25, ("의류", "신발")),
    Division("D04", "주택, 수도, 전기 및 연료", 15, ("전세", "월세", "전기료", "도시가스")),
    Division("D05", "가정용품 및 가사서비스", 50, ("가구", "가사도우미료")),
    Division("D06", "보건", 34, ("외래진료비", "의약품")),
    Division("D07", "교통", 33, ("휘발유", "경유", "자동차", "대중교통료")),
    Division("D08", "통신", 6, ("휴대전화료", "통신장비")),
    Division("D09", "오락 및 문화", 47, ("단체여행비", "운동경기관람료")),
    Division("D10", "교육", 20, ("학원비", "대학납입금")),
    Division("D11", "음식 및 숙박", 44, ("외식", "호텔숙박료")),
    Division("D12", "기타 상품 및 서비스", 37, ("보험료", "미용료")),
)

DIVISION_BY_CODE: Mapping[str, Division] = {d.code: d for d in DIVISIONS}
DIVISION_BY_NAME: Mapping[str, Division] = {d.name: d for d in DIVISIONS}

#: 2022년 기준 공식 가중치. 총합 1,000.
OFFICIAL_WEIGHTS_2022: Mapping[str, float] = {
    "D01": 142.0,
    "D02": 15.8,
    "D03": 49.6,
    "D04": 171.6,
    "D05": 45.6,
    "D06": 84.0,
    "D07": 110.6,
    "D08": 46.6,
    "D09": 62.9,
    "D10": 73.9,
    "D11": 144.7,
    "D12": 52.7,
}

#: 가중치 총합. 소비자물가지수 가중치는 1,000 으로 표현한다.
WEIGHT_TOTAL = 1000.0

OFFICIAL_WEIGHT_SOURCE = "국가데이터처 소비자물가조사(승인번호 101007) 2022년 기준 가중치"


def official_weight_set():
    """공식 가중치를 WeightSet 으로. M0 인수 테스트의 입력이다."""
    from ..calc.index import WeightSet

    return WeightSet(
        weights=dict(OFFICIAL_WEIGHTS_2022),
        label="공식 가중치(2022년 기준)",
        source=OFFICIAL_WEIGHT_SOURCE,
        base_year=2020,
    )


def division_name(code: str) -> str:
    division = DIVISION_BY_CODE.get(code)
    return division.name if division else code


def resolve_division(name_or_code: str) -> Division | None:
    """분류명 또는 코드로 Division 을 찾는다.

    KOSIS 응답의 분류명은 표기가 조금씩 달라질 수 있어(쉼표/가운뎃점, 공백)
    정규화 후 비교한다.
    """
    if name_or_code in DIVISION_BY_CODE:
        return DIVISION_BY_CODE[name_or_code]
    if name_or_code in DIVISION_BY_NAME:
        return DIVISION_BY_NAME[name_or_code]

    normalized = _normalize(name_or_code)
    for division in DIVISIONS:
        if _normalize(division.name) == normalized:
            return division
    return None


def _normalize(text: str) -> str:
    for ch in " ,·․‧・":
        text = text.replace(ch, "")
    return text
