"""KOSIS에서 지출목적별 12대 분류 지수를 가져온다.

★ 기준연도는 상수로 가정하지 않고 **응답에서 읽는다.** KOSIS는 단위명에
'2020=100' 형태로 기준연도를 실어 보낸다. 2026-12 개편으로 2025=100 이 되면
코드를 고치지 않아도 그대로 따라가고, 서로 다른 기준연도가 섞이면 계산
단계에서 예외로 걸린다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Mapping, Sequence

from ..calc.index import IndexPoint
from ..errors import DataUnavailable
from ..provenance import KST, Provenance
from ..weights.official import DIVISIONS, resolve_division
from .kosis import KosisClient, KosisRow, PeriodRange, TableRef

CPI_TABLE_KEYWORD = "품목별 소비자물가지수"

_BASE_YEAR_PATTERN = re.compile(r"(\d{4})\s*=\s*100")

#: 단위명에서 기준연도를 읽지 못했을 때 쓰는 값. 이 경우 note 에 남긴다.
FALLBACK_BASE_YEAR = 2020


@dataclass(frozen=True)
class DivisionSnapshot:
    """한 시점의 12대 분류 지수."""

    period: str
    base_year: int
    values: Mapping[str, float]
    provenance: Provenance

    def points(self) -> list[IndexPoint]:
        return [
            IndexPoint(code=code, period=self.period, value=value, base_year=self.base_year)
            for code, value in self.values.items()
        ]

    @property
    def is_complete(self) -> bool:
        return set(self.values) >= {d.code for d in DIVISIONS}


def parse_base_year(unit_nm: str | None) -> int | None:
    """'2020=100' 에서 기준연도를 읽는다."""
    if not unit_nm:
        return None
    match = _BASE_YEAR_PATTERN.search(unit_nm)
    return int(match.group(1)) if match else None


def pick_index_item(items: Mapping[str, str]) -> str:
    """항목 중 '지수'를 고른다. 상승률·기여도 항목과 구분한다."""
    for code, name in items.items():
        if "지수" in name and not any(k in name for k in ("비", "율", "기여", "증감")):
            return code
    raise DataUnavailable(
        f"통계표에서 '지수' 항목을 찾지 못했습니다. 확인된 항목: {dict(list(items.items())[:10])}"
    )


def snapshots_from_rows(
    rows: Sequence[KosisRow], table: TableRef, *, retrieved_at: datetime | None = None
) -> dict[str, DivisionSnapshot]:
    """응답 행들을 시점별 12대 분류 스냅샷으로 정리한다."""
    retrieved_at = retrieved_at or datetime.now(KST)

    grouped: dict[str, dict[str, float]] = {}
    base_years: dict[str, set[int]] = {}
    unit_missing = False

    for row in rows:
        if not row.has_value or not row.prd_de:
            continue
        division = None
        for name in list(row.class_names.values()):
            division = resolve_division(name)
            if division is not None:
                break
        if division is None:
            continue

        base_year = parse_base_year(row.unit_nm)
        if base_year is None:
            unit_missing = True
            base_year = FALLBACK_BASE_YEAR

        grouped.setdefault(row.prd_de, {})[division.code] = row.dt
        base_years.setdefault(row.prd_de, set()).add(base_year)

    note_parts = [part for part in (table.note,) if part]
    if unit_missing:
        note_parts.append(f"단위명에 기준연도가 없어 {FALLBACK_BASE_YEAR}년 기준으로 가정")
    note = "; ".join(note_parts) or None

    snapshots: dict[str, DivisionSnapshot] = {}
    for period, values in grouped.items():
        years = base_years[period]
        if len(years) > 1:
            raise DataUnavailable(
                f"{period} 응답에 기준연도가 섞여 있습니다: {sorted(years)}"
            )
        base_year = years.pop()
        snapshots[period] = DivisionSnapshot(
            period=period,
            base_year=base_year,
            values=values,
            provenance=Provenance(
                org="국가데이터처",
                table_id=table.tbl_id,
                period=period,
                base_year=base_year,
                retrieved_at=retrieved_at,
                note=note,
            ),
        )
    return snapshots


async def fetch_division_indices(
    client: KosisClient, *, start_period: str, end_period: str
) -> dict[str, DivisionSnapshot]:
    """기간 안의 모든 월에 대해 12대 분류 지수를 가져온다.

    통계표 ID는 하드코딩하지 않고 런타임에 해석하며, 항목 코드는 meta 로
    확인한 뒤에만 쓴다.
    """
    table = await client.find_table(keyword=CPI_TABLE_KEYWORD)
    codes = await client.resolve_codes(table.org_id, table.tbl_id)
    if not codes.items:
        raise DataUnavailable(
            f"통계표 {table.tbl_id} 의 항목 코드를 확인하지 못했습니다."
        )

    rows = await client.data(
        org_id=table.org_id,
        tbl_id=table.tbl_id,
        itm_id=pick_index_item(codes.items),
        obj_l1="ALL",
        period=PeriodRange(start_period, end_period),
        prd_se="M",
    )
    snapshots = snapshots_from_rows(rows, table)
    if not snapshots:
        raise DataUnavailable(
            f"{start_period}~{end_period} 구간에서 12대 분류 지수를 얻지 못했습니다."
        )
    return snapshots


# ---------------------------------------------------------------------------
# 체감 품목 — 퍼센트를 손에 잡히는 단위로 바꾸기 위한 개별 품목 지수
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FeltItemSpec:
    """체감 환산에 쓸 품목.

    keyword 는 KOSIS 품목명을 찾기 위한 검색어일 뿐이다. 화면에는 실제로 찾아낸
    품목명을 그대로 쓴다. 품목 코드를 추측해 하드코딩하지 않는다.
    """

    keyword: str
    unit: str


#: 값이 오르면 바로 체감되는 것들. 실제 존재 여부는 런타임에 확인한다.
FELT_ITEM_SPECS: tuple[FeltItemSpec, ...] = (
    FeltItemSpec("커피", "잔"),
    FeltItemSpec("영화관람료", "편"),
    FeltItemSpec("과자", "봉지"),
    FeltItemSpec("탄산음료", "캔"),
    FeltItemSpec("라면", "개"),
    FeltItemSpec("빵", "개"),
    FeltItemSpec("아이스크림", "개"),
    FeltItemSpec("치킨", "마리"),
    FeltItemSpec("햄버거", "개"),
    FeltItemSpec("김밥", "줄"),
    FeltItemSpec("생수", "병"),
    FeltItemSpec("시내버스료", "번"),
)


def _match_item_name(names: Iterable[str], keyword: str) -> str | None:
    """분류명 중 키워드에 맞는 품목명을 고른다.

    정확히 같은 것을 우선하고, 없으면 키워드를 포함하는 것 중 가장 짧은 이름을
    고른다(예: '커피' vs '커피(외식)' 이면 '커피').
    """
    candidates = [n for n in names if keyword in n]
    if not candidates:
        return None
    exact = [n for n in candidates if n == keyword]
    return exact[0] if exact else min(candidates, key=len)


async def fetch_felt_items(
    client: KosisClient, *, period: str, previous_period: str
) -> tuple[list[dict], Provenance, list[str]]:
    """체감 품목의 전년동월비를 가져온다.

    Returns:
        (품목 결과, 출처, 찾지 못한 검색어 목록).
        찾지 못한 품목은 만들어내지 않고 그대로 보고한다.
    """
    table = await client.find_table(keyword=CPI_TABLE_KEYWORD)
    codes = await client.resolve_codes(table.org_id, table.tbl_id)
    if not codes.items:
        raise DataUnavailable(f"통계표 {table.tbl_id} 의 항목 코드를 확인하지 못했습니다.")

    rows = await client.data(
        org_id=table.org_id,
        tbl_id=table.tbl_id,
        itm_id=pick_index_item(codes.items),
        obj_l1="ALL",
        obj_l2="ALL",
        period=PeriodRange(previous_period, period),
        prd_se="M",
    )

    # 품목명 -> {시점: (값, 기준연도)}
    by_name: dict[str, dict[str, tuple[float, int]]] = {}
    for row in rows:
        if not row.has_value or row.prd_de not in (period, previous_period):
            continue
        base_year = parse_base_year(row.unit_nm) or FALLBACK_BASE_YEAR
        for name in row.class_names.values():
            by_name.setdefault(name, {})[row.prd_de] = (row.dt, base_year)

    retrieved_at = datetime.now(KST)
    results: list[dict] = []
    missing: list[str] = []

    for spec in FELT_ITEM_SPECS:
        name = _match_item_name(by_name, spec.keyword)
        if name is None:
            missing.append(spec.keyword)
            continue
        points = by_name[name]
        if period not in points or previous_period not in points:
            missing.append(spec.keyword)
            continue

        now_value, now_base = points[period]
        before_value, before_base = points[previous_period]
        if now_base != before_base:
            raise DataUnavailable(
                f"{name}: 두 시점의 기준연도가 다릅니다({before_base} vs {now_base}). "
                "기준개편 전후 지수를 섞어 계산할 수 없습니다."
            )
        if before_value == 0:
            missing.append(spec.keyword)
            continue

        results.append(
            {
                "item_name": name,
                "unit": spec.unit,
                "rate": (now_value / before_value - 1.0) * 100.0,
                "base_year": now_base,
                "period": period,
            }
        )

    if not results:
        raise DataUnavailable(
            "체감 품목 지수를 하나도 찾지 못했습니다. "
            f"찾으려던 품목: {', '.join(s.keyword for s in FELT_ITEM_SPECS)}"
        )

    provenance = Provenance(
        org="국가데이터처",
        table_id=table.tbl_id,
        period=period,
        base_year=results[0]["base_year"],
        retrieved_at=retrieved_at,
        note=table.note,
    )
    return results, provenance, missing


def previous_year_period(period: str) -> str:
    """전년 동월. '202607' -> '202507'."""
    return f"{int(period[:4]) - 1}{period[4:]}"


def months_before(period: str, months: int) -> str:
    """N개월 전 시점 코드."""
    year, month = int(period[:4]), int(period[4:])
    total = year * 12 + (month - 1) - months
    return f"{total // 12:04d}{total % 12 + 1:02d}"
