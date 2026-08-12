"""가중치 적재와 기준개편 대응 테스트."""

from __future__ import annotations

import pytest

from app.errors import DataUnavailable
from app.weights.loader import (
    ItemWeight,
    close_validity,
    division_totals,
    load_from_db,
    persist,
    seed_divisions,
)
from app.weights.official import OFFICIAL_WEIGHTS_2022, WEIGHT_TOTAL


def test_seed_creates_twelve_divisions_summing_to_1000(memory_db):
    count = seed_divisions(memory_db, base_year=2020)
    assert count == 12

    items = load_from_db(memory_db, base_year=2020)
    assert len(items) == 12
    assert sum(i.weight for i in items) == pytest.approx(WEIGHT_TOTAL)
    assert division_totals(items) == pytest.approx(dict(OFFICIAL_WEIGHTS_2022))


def test_loading_is_scoped_to_base_year(memory_db):
    """기준연도가 다른 가중치는 섞여 나오지 않는다."""
    seed_divisions(memory_db, base_year=2020)
    persist(
        memory_db,
        [ItemWeight("D01", "식료품 및 비주류음료", 150.0, "D01", 2025)],
        source="2025년 기준 개편분",
        valid_from="202501",
    )

    assert len(load_from_db(memory_db, base_year=2020)) == 12
    assert len(load_from_db(memory_db, base_year=2025)) == 1
    assert load_from_db(memory_db, base_year=2025)[0].weight == 150.0


def test_mapping_carries_validity_period(memory_db):
    """품목 코드 변경에 대비해 매핑에 유효기간이 있어야 한다."""
    seed_divisions(memory_db, base_year=2020)
    row = memory_db.execute(
        "SELECT valid_from, valid_to FROM item_mapping WHERE item_code = 'D01'"
    ).fetchone()
    assert row["valid_from"] == "202001"
    assert row["valid_to"] is None, "현재 유효한 매핑은 valid_to 가 비어 있다"


def test_base_year_reform_closes_old_mapping(memory_db):
    """2026-12 개편 시 이전 매핑을 닫고 새 매핑을 연다."""
    seed_divisions(memory_db, base_year=2020)
    closed = close_validity(memory_db, base_year=2020, valid_to="202611")
    assert closed == 12

    persist(
        memory_db,
        [ItemWeight("N01", "신규 품목", 5.0, "D01", 2025)],
        source="2025년 기준",
        valid_from="202512",
    )

    old = memory_db.execute(
        "SELECT valid_to FROM item_mapping WHERE base_year = 2020"
    ).fetchall()
    assert all(r["valid_to"] == "202611" for r in old)

    new = memory_db.execute(
        "SELECT valid_from, valid_to FROM item_mapping WHERE base_year = 2025"
    ).fetchone()
    assert new["valid_from"] == "202512" and new["valid_to"] is None


def test_missing_xlsx_reports_where_to_get_it(tmp_path):
    from app.weights.loader import load_from_xlsx

    with pytest.raises(DataUnavailable, match="통계설명자료"):
        load_from_xlsx(tmp_path / "없는파일.xlsx", base_year=2020)


def test_xlsx_parses_division_headed_layout(tmp_path):
    """분류 머리 행 아래에 품목이 오는 배치를 읽는다."""
    openpyxl = pytest.importorskip("openpyxl")
    path = tmp_path / "weights.xlsx"

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["지출목적별 품목 및 가중치"])
    sheet.append(["품목", "가중치"])
    sheet.append(["식료품 및 비주류음료", 142.0])
    sheet.append(["쌀", 4.5])
    sheet.append(["빵", 3.2])
    sheet.append(["교통", 110.6])
    sheet.append(["휘발유", 20.1])
    workbook.save(path)

    from app.weights.loader import load_from_xlsx

    items = load_from_xlsx(path, base_year=2020)
    assert [i.item_name for i in items] == ["쌀", "빵", "휘발유"]
    assert [i.division_code for i in items] == ["D01", "D01", "D07"]
    assert division_totals(items) == pytest.approx({"D01": 7.7, "D07": 20.1})
