"""FastAPI 라우트.

수치를 만들 수 없는 경우 500으로 죽지 않고 {ok:false, reason} 을 돌려준다.
화면은 그 사유를 그대로 「데이터 없음(사유)」로 표시한다.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Body, FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .calc.index import WeightSet
from .config import DISCLAIMER, ROOT, Settings, load_settings
from .db import connect
from .errors import DataUnavailable, MyCpiError
from .provenance import KST
from .service import CpiService, serialize_result, unavailable
from .weights.loader import seed_divisions
from .weights.official import (
    DIVISIONS,
    OFFICIAL_WEIGHTS_2022,
    OFFICIAL_WEIGHT_SOURCE,
    WEIGHT_TOTAL,
)
from .weights.segments import Segment, fetch_segment_weights, review_hints

WEB_DIR = ROOT / "web"
VERSION_FILE = ROOT / "version.json"

router = APIRouter(prefix="/api")


def get_settings() -> Settings:
    return load_settings()


def _service() -> CpiService:
    settings = load_settings()
    conn = connect(settings.db_path)
    seed_divisions(conn)
    return CpiService(settings, conn)


def _weight_set(weights: dict[str, float], label: str, source: str, base_year: int) -> WeightSet:
    known = {d.code for d in DIVISIONS}
    unknown = sorted(set(weights) - known)
    if unknown:
        raise DataUnavailable(f"알 수 없는 분류 코드입니다: {', '.join(unknown)}")
    missing = sorted(known - set(weights))
    if missing:
        raise DataUnavailable(f"가중치가 빠진 분류가 있습니다: {', '.join(missing)}")
    return WeightSet(
        weights={k: float(v) for k, v in weights.items()},
        label=label,
        source=source,
        base_year=base_year,
    )


@router.get("/status")
async def status() -> dict:
    """어떤 데이터를 쓸 수 있는지. 화면이 뭘 비활성화할지 여기서 정한다."""
    settings = load_settings()
    return {
        "disclaimer": DISCLAIMER,
        "kosis": {
            "available": settings.has_kosis,
            "reason": None
            if settings.has_kosis
            else "KOSIS 인증키가 없습니다. kosis.kr/openapi 에서 발급받아 .env 의 KOSIS_API_KEY 에 넣으세요.",
        },
        "kamis": {"available": settings.has_kamis},
        "opinet": {"available": settings.has_opinet},
        "version": _version_info(),
    }


@router.get("/divisions")
async def divisions() -> dict:
    """12대 분류와 공식 가중치. L1 슬라이더의 기준선이다."""
    return {
        "total": WEIGHT_TOTAL,
        "source": OFFICIAL_WEIGHT_SOURCE,
        "base_year": 2020,
        "divisions": [
            {
                "code": d.code,
                "name": d.name,
                "item_count": d.item_count,
                "examples": list(d.examples),
                "official_weight": OFFICIAL_WEIGHTS_2022[d.code],
            }
            for d in DIVISIONS
        ],
    }


@router.post("/segment")
async def segment(payload: dict = Body(...)) -> dict:
    """[L0] 4개 문항으로 기본 가중치를 만든다.

    가계동향조사 구성비 조회에 실패하면 숫자를 지어내지 않고 공식 평균
    가중치로 내려가되, 개인화되지 않았다는 사실을 그대로 알린다.
    """
    try:
        seg = Segment(
            household_size=int(payload.get("household_size", 1)),
            income_decile=int(payload.get("income_decile", 5)),
            housing_type=payload.get("housing_type", "monthly"),
            has_car=bool(payload.get("has_car", False)),
        )
    except (DataUnavailable, ValueError, TypeError) as exc:
        return JSONResponse(status_code=400, content=unavailable(str(exc)))

    service = _service()
    hints = [{"code": code, "message": message} for code, message in review_hints(seg)]

    try:
        async with service.client() as client:
            segment_weights = await fetch_segment_weights(client, seg)
    except (DataUnavailable, MyCpiError, OSError) as exc:
        return {
            "ok": True,
            "personalized": False,
            "label": seg.label,
            "weights": dict(OFFICIAL_WEIGHTS_2022),
            "source": OFFICIAL_WEIGHT_SOURCE,
            "base_year": 2020,
            "review_hints": hints,
            "notice": (
                f"가계동향조사 지출 구성비를 가져오지 못해 전체 평균 가중치를 "
                f"그대로 쓰고 있습니다(사유: {exc}). 아직 개인화되지 않은 상태이니 "
                f"아래 슬라이더로 직접 조정하세요."
            ),
        }

    return {
        "ok": True,
        "personalized": True,
        "label": seg.label,
        "weights": dict(segment_weights.weights.weights),
        "source": segment_weights.weights.source,
        "base_year": segment_weights.weights.base_year,
        "review_hints": hints,
        "notice": None,
    }


@router.post("/compute")
async def compute_endpoint(payload: dict = Body(default={})) -> dict:
    """내 물가를 계산한다. 화면 ①②의 데이터원."""
    service = _service()
    raw = payload.get("weights") or dict(OFFICIAL_WEIGHTS_2022)
    label = payload.get("label") or "내 가중치"

    try:
        weights = _weight_set(raw, label, payload.get("source", "사용자 입력"), 2020)
        bundle = await service.compute_for(weights, period=payload.get("period"))
    except DataUnavailable as exc:
        return unavailable(str(exc))
    except MyCpiError as exc:
        return unavailable(f"계산에 실패했습니다: {exc}")

    body = serialize_result(bundle)
    body["disclaimer"] = DISCLAIMER
    body["weights"] = dict(weights.weights)
    return body


@router.post("/trajectory")
async def trajectory_endpoint(payload: dict = Body(default={})) -> dict:
    """화면 ③ 궤적. 공식 CPI vs 내 물가 24개월."""
    service = _service()
    raw = payload.get("weights") or dict(OFFICIAL_WEIGHTS_2022)
    try:
        weights = _weight_set(raw, "내 가중치", "사용자 입력", 2020)
        points = await service.trajectory(weights)
    except DataUnavailable as exc:
        return unavailable(str(exc))

    return {"ok": True, "points": points, "disclaimer": DISCLAIMER}


@router.post("/felt")
async def felt_endpoint(payload: dict = Body(default={})) -> dict:
    """체감 환산. 퍼센트를 '작년에 100잔 사던 돈으로 올해 몇 잔'으로 바꾼다."""
    from .calc.felt import (
        DEFAULT_UNITS,
        FeltItem,
        basket_sentence,
        item_sentence,
        units_for_same_money,
    )

    service = _service()
    raw = payload.get("weights") or dict(OFFICIAL_WEIGHTS_2022)

    try:
        weights = _weight_set(raw, "내 가중치", "사용자 입력", 2020)
        bundle = await service.compute_for(weights, period=payload.get("period"))
        felt = await service.felt(period=bundle.result.period)
    except DataUnavailable as exc:
        return unavailable(str(exc))

    items = []
    for row in felt["items"]:
        item = FeltItem(
            item_name=row["item_name"],
            unit=row["unit"],
            rate=row["rate"],
            base_year=row["base_year"],
            period=row["period"],
        )
        items.append(
            {
                **row,
                "units_for_same_money": item.units_for_same_money,
                "base_units": DEFAULT_UNITS,
                "sentence": item_sentence(item),
            }
        )
    items.sort(key=lambda i: i["rate"], reverse=True)

    # 장바구니 환산은 지수의 정의를 그대로 옮긴 것이라 가격 데이터가 필요 없다.
    basket_amount = float(payload.get("basket_amount") or 100_000)

    return {
        "ok": True,
        "period": felt["period"],
        "source": felt["source"],
        "items": items,
        "missing": felt["missing"],
        "my_rate": bundle.result.my_rate,
        "official_rate": bundle.result.official_rate,
        "basket": {
            "amount": basket_amount,
            "mine": basket_sentence(basket_amount, bundle.result.my_rate),
            "official": basket_sentence(basket_amount, bundle.result.official_rate),
            "units_mine": units_for_same_money(bundle.result.my_rate),
        },
        "disclaimer": DISCLAIMER,
    }


@router.post("/basket")
async def basket_endpoint(payload: dict = Body(default={})) -> dict:
    """화면 ④ 장바구니. 키가 없으면 이 화면만 비활성화된다."""
    service = _service()
    raw = payload.get("weights") or dict(OFFICIAL_WEIGHTS_2022)
    try:
        weights = _weight_set(raw, "내 가중치", "사용자 입력", 2020)
        return {"ok": True, **await service.basket(weights)}
    except DataUnavailable as exc:
        return unavailable(str(exc))


@router.post("/weights")
async def save_weights(payload: dict = Body(...)) -> dict:
    """사용자 가중치(입력)를 저장한다. 계산 결과는 저장하지 않는다."""
    raw = payload.get("weights") or {}
    level = payload.get("level", "L1")
    profile_id = payload.get("profile_id") or uuid.uuid4().hex

    try:
        weights = _weight_set(raw, "내 가중치", "사용자 입력", 2020)
    except DataUnavailable as exc:
        return JSONResponse(status_code=400, content=unavailable(str(exc)))

    normalized = weights.normalized(WEIGHT_TOTAL)
    now = datetime.now(KST).isoformat()
    settings = load_settings()
    conn = connect(settings.db_path)
    conn.executemany(
        "INSERT OR REPLACE INTO user_weights "
        "(profile_id, division_code, weight, level, updated_at) VALUES (?, ?, ?, ?, ?)",
        [(profile_id, code, weight, level, now) for code, weight in normalized.items()],
    )
    conn.commit()
    conn.close()

    return {"ok": True, "profile_id": profile_id, "weights": normalized, "total": WEIGHT_TOTAL}


@router.get("/mapping/rules")
async def mapping_rules() -> dict:
    """업종 매핑 규칙. 브라우저가 같은 표로 분류해 결과가 어긋나지 않게 한다."""
    from .mapping.mcc import REVIEW_THRESHOLD, rules_as_json

    return {
        "review_threshold": REVIEW_THRESHOLD,
        "rules": rules_as_json(),
        "notice": (
            "카드 업종과 소비자물가지수 분류의 대응 관계는 공표된 표준이 없습니다. "
            "이 매핑은 추정이며, 신뢰도가 낮은 항목은 직접 확인해 주세요."
        ),
    }


@router.post("/mapping/correct")
async def correct_mapping(payload: dict = Body(...)) -> dict:
    """[L2] 업종 매핑 수정 이력을 저장해 매핑을 개선한다."""
    required = ("merchant", "corrected_division")
    if any(not payload.get(field) for field in required):
        return JSONResponse(
            status_code=400,
            content=unavailable("merchant 와 corrected_division 이 필요합니다."),
        )

    settings = load_settings()
    conn = connect(settings.db_path)
    conn.execute(
        "INSERT INTO mcc_correction "
        "(profile_id, merchant, raw_category, suggested_division, corrected_division, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            payload.get("profile_id"),
            payload["merchant"],
            payload.get("raw_category"),
            payload.get("suggested_division"),
            payload["corrected_division"],
            datetime.now(KST).isoformat(),
        ),
    )
    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS n FROM mcc_correction").fetchone()["n"]
    conn.close()
    return {"ok": True, "total_corrections": count}


@router.get("/version")
async def version() -> dict:
    return _version_info()


def _version_info() -> dict:
    if VERSION_FILE.exists():
        return json.loads(VERSION_FILE.read_text(encoding="utf-8"))
    return {"version": "0.0.0", "changelog": "version.json 이 없습니다."}


def create_app() -> FastAPI:
    app = FastAPI(title="내 물가 (My CPI)", version=_version_info().get("version", "0.0.0"))
    app.include_router(router)

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    if WEB_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")

    return app
