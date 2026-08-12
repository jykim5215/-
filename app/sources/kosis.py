"""KOSIS OpenAPI 클라이언트.

베이스: https://kosis.kr/openapi · 기관 orgId=101(국가데이터처)

스펙 §3이 지목한 실수 지점들을 하나씩 구조로 막았다.

1. startPrdDe/endPrdDe 와 newEstPrdCnt/prdInterval 은 동시에 보내면 오류다.
   두 세트를 각각 PeriodRange / RecentCount dataclass 로 만들고 data()가 그 중
   하나만 받게 해서, 동시에 보내는 코드를 아예 쓸 수 없게 했다.
2. 정상 응답은 JSON 배열, 오류는 객체다. isinstance(resp, list)로 분기한다.
3. err=20 은 objL2 이하가 비어서 나는 오류다. objL2 -> objL3 -> ... 순으로
   "ALL"을 채우며 최대 3회 재시도한다.
4. 인증키가 URL 인코딩된 형태로 발급되면 디코딩해서 보낸다.
5. 다중값 구분자는 공백이다. '+'로 인코딩되면 서버가 공백으로 되돌리는 과정에서
   깨질 수 있으므로 항상 %20으로 인코딩한다.
6. 응답은 KosisRow dataclass 로 정규화한다.
7. 새 통계표는 meta(type="ITM")로 유효 코드를 확인한 뒤에만 data()를 부른다.
   코드를 추측해 하드코딩하지 않는다.
8. SQLite 6시간 TTL 캐시 + 호출 간 0.3초 슬립.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import quote, unquote, urlencode

import httpx

from ..errors import DataUnavailable, KosisApiError
from ..provenance import KST
from .cache import DEFAULT_MIN_INTERVAL, DEFAULT_TTL_SECONDS, RateLimiter, ResponseCache, make_cache_key

KOSIS_BASE = "https://kosis.kr/openapi"

#: 국가데이터처(구 통계청).
ORG_ID_NSO = "101"

#: 소비자물가조사 목록 ID. 이 아래를 런타임 조회해 통계표를 해석한다.
CPI_PARENT_LIST_ID = "P2_6"

#: 통계표 ID는 하드코딩하지 않는다. 목록/검색 조회가 모두 실패했을 때만 쓰는
#: 마지막 폴백 힌트이며, 사용 사실은 provenance note 에 남는다.
FALLBACK_TABLE_HINTS = {
    "품목별 소비자물가지수": "DT_1J22112",
    "소비자물가지수(시도)": "INH_1J22003",
}

_ENDPOINT_LIST = "/statisticsList.do"
_ENDPOINT_SEARCH = "/statisticsSearch.do"
_ENDPOINT_META = "/statisticsData.do"
_ENDPOINT_DATA = "/Param/statisticsParameterData.do"

#: objL2 부터 채워 나갈 분류 레벨 이름(err=20 재시도용).
_OBJ_LEVELS = ("objL2", "objL3", "objL4", "objL5", "objL6", "objL7", "objL8")


# ---------------------------------------------------------------------------
# 기간 지정 — 두 세트를 동시에 보낼 수 없게 만드는 타입
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PeriodRange:
    """시작/종료 시점으로 기간을 지정한다."""

    start_prd_de: str
    end_prd_de: str

    def to_params(self) -> dict[str, str]:
        return {"startPrdDe": self.start_prd_de, "endPrdDe": self.end_prd_de}


@dataclass(frozen=True)
class RecentCount:
    """최근 N개 시점으로 기간을 지정한다."""

    new_est_prd_cnt: int
    prd_interval: int | None = None

    def to_params(self) -> dict[str, str]:
        params = {"newEstPrdCnt": str(self.new_est_prd_cnt)}
        if self.prd_interval is not None:
            params["prdInterval"] = str(self.prd_interval)
        return params


#: data()는 이 둘 중 정확히 하나를 받는다. 두 세트를 함께 넘길 방법이 없다.
PeriodSpec = PeriodRange | RecentCount


# ---------------------------------------------------------------------------
# 응답 정규화
# ---------------------------------------------------------------------------


def _to_float(raw: object) -> float | None:
    """DT 값을 float 로. 결측('-', '', None, 'X')은 0이 아니라 None 이다."""
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "")
    if text in ("", "-", "X", "x", "..", "…"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


@dataclass(frozen=True)
class KosisRow:
    """KOSIS 데이터 한 행.

    DT=값, PRD_DE=시점, C1~C8=분류코드, C1_NM~=분류명, ITM_NM=항목명,
    UNIT_NM=단위.
    """

    dt: float | None
    prd_de: str
    prd_se: str | None = None
    itm_id: str | None = None
    itm_nm: str | None = None
    unit_nm: str | None = None
    tbl_id: str | None = None
    org_id: str | None = None
    classes: Mapping[str, str] = field(default_factory=dict)
    class_names: Mapping[str, str] = field(default_factory=dict)
    raw: Mapping[str, Any] = field(default_factory=dict)

    @property
    def has_value(self) -> bool:
        return self.dt is not None

    @classmethod
    def parse(cls, obj: Mapping[str, Any]) -> "KosisRow":
        classes: dict[str, str] = {}
        class_names: dict[str, str] = {}
        for level in range(1, 9):
            code = obj.get(f"C{level}")
            if code not in (None, ""):
                classes[f"C{level}"] = str(code)
            name = obj.get(f"C{level}_NM")
            if name not in (None, ""):
                class_names[f"C{level}"] = str(name)
        return cls(
            dt=_to_float(obj.get("DT")),
            prd_de=str(obj.get("PRD_DE", "")),
            prd_se=obj.get("PRD_SE"),
            itm_id=obj.get("ITM_ID"),
            itm_nm=obj.get("ITM_NM"),
            unit_nm=obj.get("UNIT_NM"),
            tbl_id=obj.get("TBL_ID"),
            org_id=obj.get("ORG_ID"),
            classes=classes,
            class_names=class_names,
            raw=dict(obj),
        )


@dataclass(frozen=True)
class TableRef:
    """런타임에 해석한 통계표 참조."""

    org_id: str
    tbl_id: str
    tbl_nm: str
    #: 폴백 힌트를 썼다면 그 사실이 여기 남아 화면 출처 표기까지 따라간다.
    note: str | None = None


@dataclass(frozen=True)
class TableCodes:
    """meta 로 확인한 유효 코드 집합."""

    items: Mapping[str, str]  # itmId -> 항목명
    obj_levels: Mapping[str, Mapping[str, str]]  # 'objL1' -> {코드: 분류명}

    def has_item(self, itm_id: str) -> bool:
        return itm_id in self.items

    def has_obj(self, level: str, code: str) -> bool:
        return code in self.obj_levels.get(level, {})


# ---------------------------------------------------------------------------
# 다중값 인코딩
# ---------------------------------------------------------------------------


def normalize_multi(value: str | Sequence[str] | None) -> str | None:
    """itmId/objL 다중값을 공백 구분 문자열로 정규화한다.

    구분자는 공백 또는 '+'인데, '+'를 그대로 URL에 실으면 서버가 공백으로
    해석하는 경로와 %2B로 인코딩되는 경로가 갈려 값이 깨진다. 그래서 입력이
    어느 쪽이든 공백 구분으로 통일하고, 인코딩은 항상 %20으로 한다.
    """
    if value is None:
        return None
    if isinstance(value, str):
        parts = value.replace("+", " ").split()
    else:
        parts = [p for item in value for p in str(item).replace("+", " ").split()]
    if not parts:
        return None
    return " ".join(parts)


def encode_params(params: Mapping[str, Any]) -> str:
    """쿼리 문자열 생성. 공백을 '+'가 아니라 %20으로 인코딩한다."""
    clean = {k: v for k, v in params.items() if v is not None and v != ""}
    return urlencode(clean, quote_via=quote, safe="")


def _mask(url: str) -> str:
    """로그/예외에 인증키가 남지 않도록 가린다."""
    import re

    return re.sub(r"(apiKey=)[^&]*", r"\1***", url)


# ---------------------------------------------------------------------------
# 클라이언트
# ---------------------------------------------------------------------------


class KosisClient:
    """KOSIS OpenAPI 비동기 클라이언트."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = KOSIS_BASE,
        conn: sqlite3.Connection | None = None,
        http_client: httpx.AsyncClient | None = None,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        min_interval: float = DEFAULT_MIN_INTERVAL,
    ) -> None:
        if not api_key:
            raise DataUnavailable("KOSIS 인증키가 없습니다. .env 의 KOSIS_API_KEY 를 설정하세요.")
        # (4) 인증키가 URL 인코딩된 형태로 발급되면 디코딩해서 보낸다.
        self.api_key = unquote(api_key) if "%" in api_key else api_key
        self.base_url = base_url.rstrip("/")
        self._cache = ResponseCache(conn, ttl_seconds) if conn is not None else None
        self._client = http_client
        self._owns_client = http_client is None
        self._limiter = RateLimiter(min_interval)

    async def __aenter__(self) -> "KosisClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
            self._owns_client = True
        return self._client

    # -- 저수준 ------------------------------------------------------------

    async def _get(self, path: str, params: dict[str, Any]) -> Any:
        """요청 -> (캐시) -> JSON 파싱까지. 오류 분기는 호출부에서 한다."""
        full = {**params, "apiKey": self.api_key, "format": "json", "jsonVD": "Y"}
        cache_key = make_cache_key(path, full)
        url = f"{self.base_url}{path}?{encode_params(full)}"

        if self._cache is not None:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return json.loads(cached)

        # (8) 실제 네트워크 호출 사이에만 0.3초를 쉰다.
        await self._limiter.wait()
        response = await self._http().get(url)
        response.raise_for_status()
        body = response.text

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise KosisApiError(
                "parse", f"JSON 이 아닌 응답: {body[:200]}", url=_mask(url)
            ) from exc

        if self._cache is not None and not _is_error_payload(payload):
            self._cache.put(cache_key, _mask(url), body)
        return payload

    async def _get_list(self, path: str, params: dict[str, Any]) -> list[dict]:
        """(2) 정상 응답은 배열, 오류는 객체. isinstance 로 분기한다."""
        url = f"{self.base_url}{path}"
        payload = await self._get(path, params)
        _raise_if_error(payload, url)
        if not isinstance(payload, list):
            raise KosisApiError(
                "shape",
                f"배열 응답을 기대했지만 {type(payload).__name__} 을 받았습니다.",
                url=url,
            )
        return payload

    # -- 공개 메서드 --------------------------------------------------------

    async def list_tree(self, vw_cd: str, parent_list_id: str) -> list[dict]:
        """통계 목록 조회. GET /statisticsList.do?method=getList"""
        return await self._get_list(
            _ENDPOINT_LIST,
            {"method": "getList", "vwCd": vw_cd, "parentListId": parent_list_id},
        )

    async def search(self, keyword: str, *, org_id: str | None = None) -> list[dict]:
        """통계표 검색. GET /statisticsSearch.do?method=getList"""
        params: dict[str, Any] = {"method": "getList", "searchNm": keyword}
        if org_id:
            params["orgId"] = org_id
        return await self._get_list(_ENDPOINT_SEARCH, params)

    async def meta(self, org_id: str, tbl_id: str, type: str) -> Any:
        """메타 조회. GET /statisticsData.do?method=getMeta (+jsonMVD=Y)

        type: 'ITM'(항목) | 'OBJ'(분류) | 'PRD'(수록시점) 등.
        """
        url = f"{self.base_url}{_ENDPOINT_META}"
        payload = await self._get(
            _ENDPOINT_META,
            {
                "method": "getMeta",
                "orgId": org_id,
                "tblId": tbl_id,
                "type": type,
                "jsonMVD": "Y",
            },
        )
        _raise_if_error(payload, url)
        return payload

    async def resolve_codes(self, org_id: str, tbl_id: str) -> TableCodes:
        """(7) data() 를 부르기 전에 유효한 itmId/objL 코드를 확인한다."""
        itm_payload = await self.meta(org_id, tbl_id, type="ITM")
        obj_payload = await self.meta(org_id, tbl_id, type="OBJ")
        return TableCodes(
            items=_parse_item_meta(itm_payload),
            obj_levels=_parse_obj_meta(obj_payload),
        )

    async def data(
        self,
        *,
        org_id: str,
        tbl_id: str,
        period: PeriodSpec,
        itm_id: str | Sequence[str] | None = None,
        obj_l1: str | Sequence[str] | None = None,
        obj_l2: str | Sequence[str] | None = None,
        obj_l3: str | Sequence[str] | None = None,
        obj_l4: str | Sequence[str] | None = None,
        prd_se: str | None = None,
        max_err20_retries: int = 3,
    ) -> list[KosisRow]:
        """통계 자료 조회. GET /Param/statisticsParameterData.do?method=getList

        period 는 PeriodRange 또는 RecentCount 하나만 받는다. 두 기간 파라미터
        세트를 동시에 보낼 방법이 타입 수준에서 없다.
        """
        if not isinstance(period, (PeriodRange, RecentCount)):
            raise TypeError(
                "period 는 PeriodRange 또는 RecentCount 여야 합니다. "
                "startPrdDe/endPrdDe 와 newEstPrdCnt 를 동시에 보낼 수 없습니다."
            )

        obj_values: dict[str, str | None] = {
            "objL1": normalize_multi(obj_l1),
            "objL2": normalize_multi(obj_l2),
            "objL3": normalize_multi(obj_l3),
            "objL4": normalize_multi(obj_l4),
        }
        base_params: dict[str, Any] = {
            "method": "getList",
            "orgId": org_id,
            "tblId": tbl_id,
            "itmId": normalize_multi(itm_id),
            "prdSe": prd_se,
            **period.to_params(),
        }

        attempt = 0
        while True:
            params = {**base_params, **{k: v for k, v in obj_values.items() if v}}
            try:
                rows = await self._get_list(_ENDPOINT_DATA, params)
                return [KosisRow.parse(row) for row in rows]
            except KosisApiError as exc:
                # (3) err=20 은 objL2 이하가 비어서 나는 오류다.
                if exc.err != "20" or attempt >= max_err20_retries:
                    raise
                if not _fill_next_obj_level(obj_values):
                    raise
                attempt += 1

    async def data_validated(
        self,
        *,
        org_id: str,
        tbl_id: str,
        period: PeriodSpec,
        itm_id: str | Sequence[str],
        obj_l1: str | Sequence[str] | None = None,
        **kwargs: Any,
    ) -> tuple[list[KosisRow], TableCodes]:
        """(7) meta 로 코드를 확인한 뒤에만 data() 를 부른다.

        새 통계표를 쓸 때는 이 메서드를 쓴다. itmId/objL 코드를 추측해서
        하드코딩하면 조용히 빈 결과가 돌아오는데, 그걸 데이터 없음으로
        오해하지 않도록 여기서 먼저 막는다.
        """
        codes = await self.resolve_codes(org_id, tbl_id)

        requested_items = (normalize_multi(itm_id) or "").split()
        unknown = [i for i in requested_items if i != "ALL" and not codes.has_item(i)]
        if unknown and codes.items:
            raise DataUnavailable(
                f"통계표 {tbl_id} 에 없는 항목 코드입니다: {', '.join(unknown)}. "
                f"유효 코드: {', '.join(sorted(codes.items)[:10])}"
            )

        requested_objs = (normalize_multi(obj_l1) or "").split()
        unknown_obj = [
            c for c in requested_objs if c != "ALL" and not codes.has_obj("objL1", c)
        ]
        if unknown_obj and codes.obj_levels.get("objL1"):
            raise DataUnavailable(
                f"통계표 {tbl_id} 의 objL1 에 없는 분류 코드입니다: {', '.join(unknown_obj)}"
            )

        rows = await self.data(
            org_id=org_id,
            tbl_id=tbl_id,
            period=period,
            itm_id=itm_id,
            obj_l1=obj_l1,
            **kwargs,
        )
        return rows, codes

    async def find_table(
        self,
        *,
        keyword: str,
        parent_list_id: str = CPI_PARENT_LIST_ID,
        vw_cd: str = "MT_ZTITLE",
        org_id: str = ORG_ID_NSO,
    ) -> TableRef:
        """통계표를 런타임에 해석한다. tblId 를 하드코딩하지 않기 위한 경로.

        목록 조회 -> 실패 시 search() 재탐색 -> 그래도 없으면 폴백 힌트.
        폴백을 쓰면 note 에 남겨 화면 출처 표기까지 그 사실이 전달된다.
        """
        try:
            entries = await self.list_tree(vw_cd, parent_list_id)
            match = _match_table(entries, keyword)
            if match:
                return TableRef(org_id=org_id, tbl_id=match[0], tbl_nm=match[1])
        except (KosisApiError, httpx.HTTPError):
            pass

        try:
            entries = await self.search(keyword, org_id=org_id)
            match = _match_table(entries, keyword)
            if match:
                return TableRef(org_id=org_id, tbl_id=match[0], tbl_nm=match[1])
        except (KosisApiError, httpx.HTTPError):
            pass

        hint = FALLBACK_TABLE_HINTS.get(keyword)
        if hint:
            return TableRef(
                org_id=org_id,
                tbl_id=hint,
                tbl_nm=keyword,
                note="통계표 목록 조회 실패로 폴백 힌트 사용",
            )
        raise DataUnavailable(
            f"통계표를 찾지 못했습니다(키워드: {keyword}). 목록·검색 조회가 모두 실패했습니다."
        )


# ---------------------------------------------------------------------------
# 파싱 보조
# ---------------------------------------------------------------------------


def _is_error_payload(payload: Any) -> bool:
    return isinstance(payload, Mapping) and ("err" in payload or "errMsg" in payload)


def _raise_if_error(payload: Any, url: str) -> None:
    if _is_error_payload(payload):
        raise KosisApiError(
            payload.get("err", "unknown"), str(payload.get("errMsg", "")), url=url
        )


def _fill_next_obj_level(obj_values: dict[str, str | None]) -> bool:
    """objL2 -> objL3 -> ... 순으로 아직 비어 있는 첫 레벨을 'ALL' 로 채운다."""
    for level in _OBJ_LEVELS:
        if not obj_values.get(level):
            obj_values[level] = "ALL"
            return True
    return False


def _match_table(entries: Iterable[Mapping[str, Any]], keyword: str) -> tuple[str, str] | None:
    """목록/검색 응답에서 키워드에 맞는 통계표를 고른다.

    정확 일치를 우선하고, 없으면 부분 일치 중 이름이 가장 짧은 것을 쓴다
    (상위 표가 대개 이름이 짧다).
    """
    candidates: list[tuple[str, str]] = []
    for entry in entries:
        tbl_id = entry.get("TBL_ID")
        tbl_nm = entry.get("TBL_NM") or entry.get("LIST_NM") or ""
        if not tbl_id:
            continue
        if tbl_nm == keyword:
            return str(tbl_id), str(tbl_nm)
        if keyword in str(tbl_nm):
            candidates.append((str(tbl_id), str(tbl_nm)))
    if candidates:
        return min(candidates, key=lambda pair: len(pair[1]))
    return None


def _iter_records(payload: Any) -> Iterable[Mapping[str, Any]]:
    """meta 응답은 배열일 수도, 배열을 담은 객체일 수도 있다."""
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, Mapping):
                yield item
    elif isinstance(payload, Mapping):
        for value in payload.values():
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, Mapping):
                        yield item


def _parse_item_meta(payload: Any) -> dict[str, str]:
    items: dict[str, str] = {}
    for record in _iter_records(payload):
        itm_id = record.get("ITM_ID")
        if itm_id:
            items[str(itm_id)] = str(record.get("ITM_NM", ""))
    return items


def _parse_obj_meta(payload: Any) -> dict[str, dict[str, str]]:
    levels: dict[str, dict[str, str]] = {}
    for record in _iter_records(payload):
        code = record.get("OBJ_ID") or record.get("ITM_ID") or record.get("C1")
        if not code:
            continue
        raw_level = record.get("OBJ_ID_NM") or record.get("UP_OBJ_ID") or ""
        level_no = record.get("OBJ_LVL") or record.get("LVL") or 1
        try:
            level_key = f"objL{int(level_no)}"
        except (TypeError, ValueError):
            level_key = "objL1"
        name = record.get("OBJ_NM") or record.get("C1_NM") or str(raw_level)
        levels.setdefault(level_key, {})[str(code)] = str(name)
    return levels


def utcnow() -> datetime:
    return datetime.now(KST)
