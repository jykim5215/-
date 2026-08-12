"""출처를 값에서 떼어낼 수 없게 만드는 계층.

화면의 모든 수치에는 출처 기관 + 기준 시점 + 기준연도가 붙어야 한다. 이를
문서화된 약속이 아니라 타입으로 강제한다. 앱 밖으로 나가는 수치는 반드시
Measured(값+출처) 또는 Unavailable(사유) 둘 중 하나이며, 출처 없는 raw float가
프런트로 넘어갈 경로는 없다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9), "KST")

#: 지출목적별 지수를 제공하는 기관. 통계청은 2026년 국가데이터처로 개편되었다.
DEFAULT_ORG = "국가데이터처"


def format_period(period: str) -> str:
    """KOSIS 시점 코드를 사람이 읽는 형태로. '202607' -> '2026년 7월'."""
    if len(period) == 6 and period.isdigit():
        return f"{period[:4]}년 {int(period[4:]):d}월"
    if len(period) == 4 and period.isdigit():
        return f"{period}년"
    return period


@dataclass(frozen=True)
class Provenance:
    """수치 하나의 출처.

    Attributes:
        org: 출처 기관명.
        table_id: KOSIS 통계표 ID. 런타임 조회로 얻은 값이어야 하며, 폴백
            힌트를 썼다면 note에 그 사실을 남긴다.
        period: 기준 시점(KOSIS 시점 코드, 예: '202607').
        base_year: 지수 기준연도. 이 값 없이 지수를 저장하지 않는다.
        retrieved_at: 조회 시각.
        note: 사용자에게 알려야 할 단서(폴백 사용, 캐시 응답 등).
    """

    org: str
    table_id: str
    period: str
    base_year: int
    retrieved_at: datetime
    note: str | None = None

    @property
    def label(self) -> str:
        """화면에 그대로 붙일 수 있는 한 줄 출처 표기."""
        parts = [
            self.org,
            self.table_id,
            format_period(self.period),
            f"{self.base_year}=100",
        ]
        if self.note:
            parts.append(self.note)
        return " · ".join(parts)

    def to_dict(self) -> dict:
        return {
            "org": self.org,
            "table_id": self.table_id,
            "period": self.period,
            "period_label": format_period(self.period),
            "base_year": self.base_year,
            "retrieved_at": self.retrieved_at.isoformat(),
            "note": self.note,
            "label": self.label,
        }


def combine(provenances: list[Provenance], *, period: str | None = None) -> Provenance:
    """여러 출처를 하나로 합친다(집계값의 출처).

    기준연도가 섞여 있으면 합치지 않고 예외를 던진다. 집계 단계에서
    이미 걸러지지만, 출처 표기 단계에서도 한 번 더 막는다.
    """
    from .errors import BaseYearMismatchError

    if not provenances:
        raise ValueError("출처가 없는 값은 만들 수 없습니다.")

    base_years = {p.base_year for p in provenances}
    if len(base_years) > 1:
        raise BaseYearMismatchError(
            f"기준연도가 섞인 출처를 합칠 수 없습니다: {sorted(base_years)}"
        )

    tables = sorted({p.table_id for p in provenances})
    orgs = sorted({p.org for p in provenances})
    notes = sorted({p.note for p in provenances if p.note})
    periods = {p.period for p in provenances}

    return Provenance(
        org=", ".join(orgs),
        table_id=", ".join(tables),
        period=period or (periods.pop() if len(periods) == 1 else "복수 시점"),
        base_year=base_years.pop(),
        retrieved_at=min(p.retrieved_at for p in provenances),
        note="; ".join(notes) if notes else None,
    )


@dataclass(frozen=True)
class Measured:
    """출처가 붙은 수치. 이 서비스가 화면에 내보낼 수 있는 유일한 수치 형태."""

    value: float
    provenance: Provenance
    unit: str | None = None

    def to_dict(self) -> dict:
        return {
            "value": self.value,
            "unit": self.unit,
            "source": self.provenance.to_dict(),
        }


@dataclass(frozen=True)
class Unavailable:
    """수치를 만들 수 없을 때 그 자리에 들어가는 값.

    reason은 화면에 「데이터 없음(사유)」로 그대로 노출된다.
    """

    reason: str

    def to_dict(self) -> dict:
        return {"unavailable": True, "reason": self.reason}


#: 화면으로 나갈 수 있는 수치 타입. 이 둘 말고는 없다.
Value = Measured | Unavailable
