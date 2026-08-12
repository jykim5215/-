"""화면이 필요로 하는 값을 만들어 주는 서비스 계층.

여기서 나가는 모든 수치에는 출처가 붙는다. 값을 만들 수 없으면 DataUnavailable
을 올리고, API 계층이 그것을 「데이터 없음(사유)」로 바꾼다. 어떤 경로로도
그럴듯한 기본값이 채워지지 않는다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date

from .calc.index import CpiResult, WeightSet, aggregate, compute
from .calc.narrative import build as build_narrative
from .calc.narrative import explain_contribution
from .config import Settings
from .errors import DataUnavailable, KosisApiError
from .provenance import Provenance
from .sources.cpi_index import (
    DivisionSnapshot,
    fetch_division_indices,
    months_before,
    previous_year_period,
)
from .sources.kosis import KosisClient
from .weights.official import DIVISIONS, official_weight_set

#: 궤적 화면이 요구하는 개월 수.
TRAJECTORY_MONTHS = 24


@dataclass(frozen=True)
class ResultBundle:
    """계산 결과 + 출처."""

    result: CpiResult
    provenance: Provenance
    narrative_sentence: str
    driver_code: str | None


class CpiService:
    def __init__(self, settings: Settings, conn: sqlite3.Connection) -> None:
        self.settings = settings
        self.conn = conn
        self._snapshot_cache: dict[str, DivisionSnapshot] = {}

    # -- 지수 확보 ---------------------------------------------------------

    def client(self) -> KosisClient:
        """KOSIS 클라이언트. 인증키가 없으면 사유를 붙여 즉시 실패한다."""
        if not self.settings.has_kosis:
            raise DataUnavailable(
                "KOSIS 인증키가 없습니다. kosis.kr/openapi 에서 발급받아 "
                ".env 의 KOSIS_API_KEY 에 넣으세요."
            )
        return KosisClient(self.settings.kosis_api_key, conn=self.conn)

    async def load_snapshots(self, *, months: int = TRAJECTORY_MONTHS + 13) -> dict[str, DivisionSnapshot]:
        """최근 구간의 12대 분류 지수를 확보한다.

        24개월 궤적과 각 시점의 전년 동월(추가 12개월)이 모두 필요하다.
        """
        if self._snapshot_cache:
            return self._snapshot_cache

        today = date.today()
        end = f"{today.year:04d}{today.month:02d}"
        start = months_before(end, months)

        try:
            async with self.client() as client:
                snapshots = await fetch_division_indices(
                    client, start_period=start, end_period=end
                )
        except KosisApiError as exc:
            raise DataUnavailable(
                f"KOSIS 조회에 실패했습니다 (err={exc.err}: {exc.err_msg})"
            ) from exc
        except OSError as exc:
            raise DataUnavailable(f"KOSIS 에 연결하지 못했습니다: {exc}") from exc

        complete = {p: s for p, s in snapshots.items() if s.is_complete}
        if not complete:
            raise DataUnavailable(
                "12대 분류가 모두 채워진 시점이 없습니다. 응답의 분류명 대응을 확인하세요."
            )
        self._snapshot_cache = complete
        return complete

    async def latest_period(self) -> str:
        snapshots = await self.load_snapshots()
        return max(snapshots)

    # -- 계산 --------------------------------------------------------------

    async def compute_for(
        self, weights: WeightSet, *, period: str | None = None
    ) -> ResultBundle:
        """내 물가와 공식 지수를 계산한다."""
        snapshots = await self.load_snapshots()
        period = period or max(snapshots)

        current = snapshots.get(period)
        if current is None:
            raise DataUnavailable(f"{period} 시점의 지수가 없습니다.")

        previous_period_code = previous_year_period(period)
        previous = snapshots.get(previous_period_code)
        if previous is None:
            raise DataUnavailable(
                f"전년 동월({previous_period_code}) 지수가 없어 상승률을 계산할 수 없습니다."
            )

        official = official_weight_set()
        result = compute(
            current=current.points(),
            previous=previous.points(),
            mine=weights,
            official=official,
        )
        narrative = build_narrative(result)

        return ResultBundle(
            result=result,
            provenance=current.provenance,
            narrative_sentence=narrative.sentence,
            driver_code=narrative.driver_code,
        )

    async def trajectory(
        self, weights: WeightSet, *, months: int = TRAJECTORY_MONTHS
    ) -> list[dict]:
        """공식 CPI vs 내 물가 24개월 궤적."""
        snapshots = await self.load_snapshots()
        official = official_weight_set()
        latest = max(snapshots)

        points: list[dict] = []
        for offset in range(months - 1, -1, -1):
            period = months_before(latest, offset)
            current = snapshots.get(period)
            previous = snapshots.get(previous_year_period(period))
            if current is None or previous is None:
                continue
            try:
                result = compute(
                    current=current.points(),
                    previous=previous.points(),
                    mine=weights,
                    official=official,
                )
            except DataUnavailable:
                continue
            points.append(
                {
                    "period": period,
                    "my_rate": result.my_rate,
                    "official_rate": result.official_rate,
                    "my_index": result.my_index,
                    "official_index": result.official_index,
                    "base_year": result.base_year,
                }
            )

        if not points:
            raise DataUnavailable("궤적을 그릴 시점이 없습니다.")
        return points

    async def basket(self, weights: WeightSet) -> dict:
        """내 가중치 상위 분류의 최근 가격.

        aT KAMIS 는 인증키와 계정 ID 두 개, 오피넷은 별도 키가 필요하다. 키가
        없으면 이 화면만 비활성화되고 나머지 화면은 정상 동작한다.
        """
        top = sorted(weights.weights.items(), key=lambda kv: kv[1], reverse=True)[:5]
        names = {d.code: d.name for d in DIVISIONS}

        return {
            "top_divisions": [
                {"code": code, "name": names.get(code, code), "weight": weight}
                for code, weight in top
            ],
            "kamis": {
                "available": self.settings.has_kamis,
                "reason": None
                if self.settings.has_kamis
                else "aT KAMIS 인증키와 계정 ID가 없습니다(.env: KAMIS_CERT_KEY, KAMIS_CERT_ID).",
            },
            "opinet": {
                "available": self.settings.has_opinet,
                "reason": None
                if self.settings.has_opinet
                else "오피넷 인증키가 없습니다(.env: OPINET_API_KEY). 무료 키는 최근 7일만 제공하므로 시계열은 일별 적재가 필요합니다.",
            },
        }


def serialize_result(bundle: ResultBundle) -> dict:
    """결과를 화면이 쓰는 형태로. 모든 수치에 출처가 함께 나간다."""
    result = bundle.result
    source = bundle.provenance.to_dict()

    return {
        "ok": True,
        "period": result.period,
        "previous_period": result.previous_period,
        "base_year": result.base_year,
        "source": source,
        "my_rate": result.my_rate,
        "official_rate": result.official_rate,
        "my_index": result.my_index,
        "official_index": result.official_index,
        "gap": result.gap,
        "negligible": result.is_negligible,
        "narrative": bundle.narrative_sentence,
        "driver_code": bundle.driver_code,
        "contributions": [
            {
                "code": c.code,
                "name": c.name,
                "my_share": c.my_share,
                "official_share": c.official_share,
                "share_ratio": c.share_ratio,
                "division_rate": c.division_rate,
                "my_contribution": c.my_contribution,
                "official_contribution": c.official_contribution,
                "gap_contribution": c.gap_contribution,
                "explanation": explain_contribution(c),
            }
            for c in sorted(
                result.contributions, key=lambda c: c.gap_contribution, reverse=True
            )
        ],
    }


def unavailable(reason: str) -> dict:
    """「데이터 없음(사유)」. 절대 값으로 채우지 않는다."""
    return {"ok": False, "unavailable": True, "reason": reason}
