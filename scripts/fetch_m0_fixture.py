#!/usr/bin/env python3
"""M0 인수 테스트용 실데이터 픽스처를 KOSIS에서 받아 저장한다.

KOSIS 인증키가 있고 kosis.kr 에 접근할 수 있는 환경에서 한 번만 돌리면 된다.

    export KOSIS_API_KEY=...
    python scripts/fetch_m0_fixture.py --period 202607

받아오는 것은 지출목적별 12대 분류 지수(2020=100)의 해당 월과 전년 동월이다.
값을 만들어내지 않는다. 12개 분류를 모두 채우지 못하면 파일을 쓰지 않고
무엇이 빠졌는지 알려주고 끝낸다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.errors import DataUnavailable, KosisApiError  # noqa: E402
from app.provenance import KST  # noqa: E402
from app.sources.kosis import ORG_ID_NSO, KosisClient, PeriodRange  # noqa: E402
from app.weights.official import OFFICIAL_WEIGHTS_2022, resolve_division  # noqa: E402

FIXTURE = (
    Path(__file__).resolve().parent.parent
    / "tests" / "fixtures" / "official" / "cpi_division_2026_07.json"
)


async def fetch(period: str, *, base_year: int) -> dict:
    api_key = os.getenv("KOSIS_API_KEY", "")
    if not api_key:
        raise SystemExit("KOSIS_API_KEY 가 설정되지 않았습니다. .env 를 확인하세요.")

    previous = f"{int(period[:4]) - 1}{period[4:]}"

    async with KosisClient(api_key) as client:
        table = await client.find_table(keyword="품목별 소비자물가지수")
        print(f"통계표: {table.tbl_id} ({table.tbl_nm})" + (f" [{table.note}]" if table.note else ""))

        codes = await client.resolve_codes(table.org_id, table.tbl_id)
        print(f"항목 코드 {len(codes.items)}개, objL1 분류 {len(codes.obj_levels.get('objL1', {}))}개 확인")

        index_item = _pick_index_item(codes.items)
        print(f"지수 항목: {index_item}")

        rows = await client.data(
            org_id=table.org_id,
            tbl_id=table.tbl_id,
            itm_id=index_item,
            obj_l1="ALL",
            period=PeriodRange(previous, period),
            prd_se="M",
        )

    divisions = {period: {}, previous: {}}
    for row in rows:
        if not row.has_value or row.prd_de not in divisions:
            continue
        name = row.class_names.get("C1", "")
        division = resolve_division(name)
        if division is None:
            continue
        divisions[row.prd_de][division.code] = row.dt

    _verify_complete(divisions)

    return {
        "source": {
            "org": "국가데이터처",
            "table_id": table.tbl_id,
            "base_year": base_year,
            "retrieved_at": datetime.now(KST).isoformat(),
            "retrieved_by": "scripts/fetch_m0_fixture.py",
            "note": (table.note or "") + " 지출목적별 12대 분류 지수",
        },
        "expected": {
            "period": period,
            # 공표치는 사람이 확인해 적는다. 계산 결과를 기댓값으로 쓰면
            # 테스트가 자기 자신을 검증하게 되어 의미가 없어진다.
            "index": None,
            "yoy_rate": None,
        },
        "divisions": divisions,
    }


def _pick_index_item(items: dict[str, str]) -> str:
    """항목 중 '지수'에 해당하는 코드를 고른다. 추측해서 하드코딩하지 않는다."""
    for code, name in items.items():
        if "지수" in name and "비" not in name and "율" not in name:
            return code
    raise DataUnavailable(
        f"'지수' 항목을 찾지 못했습니다. 확인된 항목: {items}"
    )


def _verify_complete(divisions: dict[str, dict[str, float]]) -> None:
    """12개 분류가 두 시점 모두 채워졌는지 확인한다. 비면 파일을 쓰지 않는다."""
    expected = set(OFFICIAL_WEIGHTS_2022)
    for period, values in divisions.items():
        missing = sorted(expected - set(values))
        if missing:
            raise DataUnavailable(
                f"{period} 시점에 빠진 분류가 있어 픽스처를 쓰지 않습니다: {', '.join(missing)}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--period", default="202607", help="대상 시점 (YYYYMM)")
    parser.add_argument("--base-year", type=int, default=2020, help="지수 기준연도")
    parser.add_argument("--out", type=Path, default=FIXTURE)
    args = parser.parse_args()

    try:
        payload = asyncio.run(fetch(args.period, base_year=args.base_year))
    except (DataUnavailable, KosisApiError) as exc:
        print(f"실패: {exc}", file=sys.stderr)
        print("픽스처를 쓰지 않았습니다. 값을 지어내지 않습니다.", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n저장: {args.out}")
    print(
        "\n남은 일: expected.index 와 expected.yoy_rate 에 「소비자물가동향」 공표치를\n"
        "직접 적어 넣으세요(2026년 7월 = 119.77, +2.8%). 계산 결과를 기댓값으로\n"
        "쓰면 테스트가 자기 자신을 검증하게 되어 의미가 없어집니다."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
