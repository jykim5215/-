"""KOSIS 클라이언트 테스트.

스펙 §3이 지목한 8개 실수 지점을 각각 테스트로 덮는다. 저장된 응답
픽스처(합성, 형태만)로 테스트하며 네트워크를 타지 않는다.
"""

from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.errors import DataUnavailable, KosisApiError
from app.sources.kosis import (
    KosisClient,
    KosisRow,
    PeriodRange,
    RecentCount,
    encode_params,
    normalize_multi,
)

from .conftest import load_protocol


def make_client(handler, **kwargs) -> KosisClient:
    transport = httpx.MockTransport(handler)
    return KosisClient(
        "TESTKEY",
        http_client=httpx.AsyncClient(transport=transport),
        min_interval=0.0,
        **kwargs,
    )


def json_response(payload) -> httpx.Response:
    return httpx.Response(
        200, text=json.dumps(payload, ensure_ascii=False), headers={"content-type": "application/json"}
    )


# --- (1) 기간 파라미터 상호배타 ------------------------------------------------


def test_period_specs_produce_disjoint_parameter_sets():
    """두 기간 파라미터 세트가 절대 함께 나가지 않는다."""
    range_params = PeriodRange("202501", "202607").to_params()
    recent_params = RecentCount(24, prd_interval=1).to_params()

    assert set(range_params) == {"startPrdDe", "endPrdDe"}
    assert set(recent_params) == {"newEstPrdCnt", "prdInterval"}
    assert not set(range_params) & set(recent_params)


async def test_data_rejects_non_period_spec():
    """dict 로 기간을 넘기면 (두 세트를 섞을 유일한 경로) 즉시 막는다."""
    client = make_client(lambda request: json_response([]))
    with pytest.raises(TypeError, match="동시에 보낼 수 없습니다"):
        await client.data(
            org_id="101",
            tbl_id="TEST_TBL_A",
            period={"startPrdDe": "202601", "newEstPrdCnt": 3},  # type: ignore[arg-type]
        )
    await client.aclose()


# --- (2) 배열/오류객체 분기 ----------------------------------------------------


async def test_error_object_raises_kosis_api_error():
    errors = load_protocol("errors.json")
    client = make_client(lambda request: json_response(errors["err30"]))

    with pytest.raises(KosisApiError) as excinfo:
        await client.data(
            org_id="101", tbl_id="TEST_TBL_A", period=RecentCount(1)
        )
    assert excinfo.value.err == "30"
    assert "인증키" in excinfo.value.err_msg
    await client.aclose()


async def test_list_response_is_parsed():
    rows_payload = load_protocol("data_ok.json")
    client = make_client(lambda request: json_response(rows_payload))

    rows = await client.data(org_id="101", tbl_id="TEST_TBL_A", period=RecentCount(1))
    assert len(rows) == 3
    assert rows[0].dt == 100.00
    await client.aclose()


async def test_numeric_err_field_is_still_detected():
    """err 가 숫자 20 으로 와도 문자열 '20' 과 같게 다뤄야 재시도가 작동한다."""
    errors = load_protocol("errors.json")
    client = make_client(lambda request: json_response(errors["err_numeric"]))

    with pytest.raises(KosisApiError) as excinfo:
        await client.data(org_id="101", tbl_id="T", period=RecentCount(1), max_err20_retries=0)
    assert excinfo.value.err == "20"
    await client.aclose()


# --- (3) err=20 재시도 ---------------------------------------------------------


async def test_err20_fills_obj_levels_in_order():
    """objL2 -> objL3 순으로 ALL 을 채워가며 재시도한다."""
    errors = load_protocol("errors.json")
    rows_payload = load_protocol("data_ok.json")
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = parse_qs(urlparse(str(request.url)).query)
        seen.append(params)
        if "objL3" in params:
            return json_response(rows_payload)
        return json_response(errors["err20"])

    client = make_client(handler)
    rows = await client.data(
        org_id="101", tbl_id="TEST_TBL_A", period=RecentCount(1), obj_l1="D01"
    )

    assert len(rows) == 3
    assert len(seen) == 3
    assert "objL2" not in seen[0]
    assert seen[1]["objL2"] == ["ALL"] and "objL3" not in seen[1]
    assert seen[2]["objL2"] == ["ALL"] and seen[2]["objL3"] == ["ALL"]
    await client.aclose()


async def test_err20_gives_up_after_max_retries():
    errors = load_protocol("errors.json")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return json_response(errors["err20"])

    client = make_client(handler)
    with pytest.raises(KosisApiError):
        await client.data(org_id="101", tbl_id="T", period=RecentCount(1))
    # 최초 1회 + 재시도 3회
    assert calls["n"] == 4
    await client.aclose()


# --- (4) 인증키 디코딩 ---------------------------------------------------------


async def test_url_encoded_api_key_is_decoded():
    captured: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(parse_qs(urlparse(str(request.url)).query)["apiKey"][0])
        return json_response([])

    transport = httpx.MockTransport(handler)
    client = KosisClient(
        "abc%2Bdef%3D%3D",
        http_client=httpx.AsyncClient(transport=transport),
        min_interval=0.0,
    )
    assert client.api_key == "abc+def=="
    await client.data(org_id="101", tbl_id="T", period=RecentCount(1))
    assert captured == ["abc+def=="]
    await client.aclose()


def test_plain_api_key_is_left_alone():
    client = KosisClient("ZmFrZWtleTEyMw", min_interval=0.0)
    assert client.api_key == "ZmFrZWtleTEyMw"


# --- (5) 다중값 구분자와 '+' 문제 ---------------------------------------------


def test_normalize_multi_accepts_both_separators():
    assert normalize_multi("T10 T20") == "T10 T20"
    assert normalize_multi("T10+T20") == "T10 T20"
    assert normalize_multi(["T10", "T20"]) == "T10 T20"
    assert normalize_multi(None) is None
    assert normalize_multi("") is None


def test_multi_value_encodes_space_as_percent20_not_plus():
    """'+' 로 인코딩되면 서버가 공백으로 되돌리는 경로에서 값이 깨진다.

    항상 %20 으로 인코딩하고, 디코딩하면 원래 공백 구분으로 돌아와야 한다.
    """
    query = encode_params({"itmId": normalize_multi(["T10", "T20"])})
    assert query == "itmId=T10%20T20"
    assert "+" not in query
    assert parse_qs(query)["itmId"] == ["T10 T20"]


def test_literal_plus_survives_round_trip():
    """인증키처럼 '+' 자체가 값인 경우는 %2B 로 보존돼야 한다."""
    query = encode_params({"apiKey": "abc+def"})
    assert query == "apiKey=abc%2Bdef"
    assert parse_qs(query)["apiKey"] == ["abc+def"]


async def test_multi_itm_reaches_server_as_space_separated():
    captured: list[list[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(parse_qs(urlparse(str(request.url)).query)["itmId"])
        return json_response([])

    client = make_client(handler)
    await client.data(
        org_id="101", tbl_id="T", period=RecentCount(1), itm_id=["T10", "T20"]
    )
    assert captured == [["T10 T20"]]
    await client.aclose()


# --- (6) 응답 정규화 -----------------------------------------------------------


def test_row_normalization():
    rows = [KosisRow.parse(r) for r in load_protocol("data_ok.json")]

    first = rows[0]
    assert first.dt == 100.00
    assert first.prd_de == "202607"
    assert first.itm_nm == "지수"
    assert first.unit_nm == "2020=100"
    assert first.classes["C1"] == "D01"
    assert first.class_names["C1"] == "식료품 및 비주류음료"
    assert first.classes["C2"] == "TOTAL"
    assert first.has_value


def test_missing_value_is_none_not_zero():
    """결측을 0으로 바꾸면 지수가 조용히 왜곡된다. None 이어야 한다."""
    rows = [KosisRow.parse(r) for r in load_protocol("data_ok.json")]
    assert rows[2].dt is None
    assert not rows[2].has_value


@pytest.mark.parametrize("raw", ["-", "", "X", None, "..", "abc"])
def test_non_numeric_dt_is_none(raw):
    assert KosisRow.parse({"DT": raw, "PRD_DE": "202607"}).dt is None


def test_thousands_separator_is_parsed():
    assert KosisRow.parse({"DT": "1,234.5", "PRD_DE": "202607"}).dt == 1234.5


# --- (7) meta 먼저, 그다음 data ------------------------------------------------


async def test_resolve_codes_reads_meta():
    meta = load_protocol("meta.json")

    def handler(request: httpx.Request) -> httpx.Response:
        params = parse_qs(urlparse(str(request.url)).query)
        return json_response(meta["itm"] if params["type"][0] == "ITM" else meta["obj"])

    client = make_client(handler)
    codes = await client.resolve_codes("101", "TEST_TBL_A")

    assert codes.items == {"T10": "지수", "T20": "전년동월비"}
    assert codes.has_item("T10")
    assert not codes.has_item("T99")
    assert codes.has_obj("objL1", "D01")
    assert codes.has_obj("objL2", "S001")
    await client.aclose()


async def test_data_validated_rejects_guessed_item_code():
    """추측한 코드로 data() 를 부르면 빈 결과가 아니라 명확한 실패를 준다."""
    meta = load_protocol("meta.json")
    data_calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        params = parse_qs(urlparse(url).query)
        if "getMeta" in url:
            return json_response(meta["itm"] if params["type"][0] == "ITM" else meta["obj"])
        data_calls["n"] += 1
        return json_response(load_protocol("data_ok.json"))

    client = make_client(handler)
    with pytest.raises(DataUnavailable, match="없는 항목 코드"):
        await client.data_validated(
            org_id="101", tbl_id="TEST_TBL_A", period=RecentCount(1), itm_id="T99"
        )
    assert data_calls["n"] == 0, "코드 검증 전에 data() 를 부르면 안 된다"
    await client.aclose()


async def test_data_validated_passes_valid_code():
    meta = load_protocol("meta.json")

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        params = parse_qs(urlparse(url).query)
        if "getMeta" in url:
            return json_response(meta["itm"] if params["type"][0] == "ITM" else meta["obj"])
        return json_response(load_protocol("data_ok.json"))

    client = make_client(handler)
    rows, codes = await client.data_validated(
        org_id="101", tbl_id="TEST_TBL_A", period=RecentCount(1), itm_id="T10", obj_l1="D01"
    )
    assert len(rows) == 3
    assert codes.has_item("T10")
    await client.aclose()


# --- (8) 캐시와 호출 간격 ------------------------------------------------------


async def test_second_call_is_served_from_cache(memory_db):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return json_response(load_protocol("data_ok.json"))

    client = make_client(handler, conn=memory_db)
    await client.data(org_id="101", tbl_id="T", period=RecentCount(1))
    await client.data(org_id="101", tbl_id="T", period=RecentCount(1))

    assert calls["n"] == 1, "두 번째 호출은 캐시에서 나와야 한다"
    await client.aclose()


async def test_error_responses_are_not_cached(memory_db):
    errors = load_protocol("errors.json")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return json_response(errors["err30"])

    client = make_client(handler, conn=memory_db)
    for _ in range(2):
        with pytest.raises(KosisApiError):
            await client.data(org_id="101", tbl_id="T", period=RecentCount(1))

    assert calls["n"] == 2, "오류 응답을 캐시하면 6시간 동안 복구가 막힌다"
    await client.aclose()


async def test_expired_cache_refetches(memory_db):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return json_response(load_protocol("data_ok.json"))

    client = make_client(handler, conn=memory_db, ttl_seconds=0)
    await client.data(org_id="101", tbl_id="T", period=RecentCount(1))
    await client.data(org_id="101", tbl_id="T", period=RecentCount(1))
    assert calls["n"] == 2
    await client.aclose()


def test_cache_key_ignores_api_key():
    """인증키를 바꿔도 캐시가 살아 있어야 한다."""
    from app.sources.cache import make_cache_key

    a = make_cache_key("/p", {"tblId": "T", "apiKey": "key-a"})
    b = make_cache_key("/p", {"tblId": "T", "apiKey": "key-b"})
    assert a == b


async def test_api_key_is_masked_in_errors():
    """예외 메시지에 인증키가 새어 나가면 안 된다."""
    client = make_client(lambda request: httpx.Response(200, text="<html>not json</html>"))
    with pytest.raises(KosisApiError) as excinfo:
        await client.data(org_id="101", tbl_id="T", period=RecentCount(1))
    assert "TESTKEY" not in str(excinfo.value.url or "")
    await client.aclose()


# --- 통계표 런타임 해석 --------------------------------------------------------


async def test_find_table_prefers_exact_name_from_list():
    meta = load_protocol("meta.json")
    client = make_client(lambda request: json_response(meta["list_tree"]))

    ref = await client.find_table(keyword="품목별 소비자물가지수")
    assert ref.tbl_id == "TEST_TBL_A"
    assert ref.note is None, "정상 조회에는 폴백 표시가 붙지 않는다"
    await client.aclose()


async def test_find_table_falls_back_to_search():
    meta = load_protocol("meta.json")

    def handler(request: httpx.Request) -> httpx.Response:
        if "statisticsList" in str(request.url):
            return json_response({"err": "99", "errMsg": "목록 조회 실패"})
        return json_response(meta["search"])

    client = make_client(handler)
    ref = await client.find_table(keyword="품목별 소비자물가지수")
    assert ref.tbl_id == "TEST_TBL_S"
    await client.aclose()


async def test_find_table_hint_is_flagged_in_provenance_note():
    """폴백 힌트를 썼다는 사실이 출처 표기까지 전달돼야 한다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return json_response({"err": "99", "errMsg": "조회 실패"})

    client = make_client(handler)
    ref = await client.find_table(keyword="품목별 소비자물가지수")
    assert ref.tbl_id == "DT_1J22112"
    assert ref.note and "폴백" in ref.note
    await client.aclose()


async def test_find_table_raises_when_nothing_matches():
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response([])

    client = make_client(handler)
    with pytest.raises(DataUnavailable, match="통계표를 찾지 못했습니다"):
        await client.find_table(keyword="존재하지 않는 통계표")
    await client.aclose()


def test_missing_api_key_fails_with_readable_reason():
    with pytest.raises(DataUnavailable, match="KOSIS 인증키가 없습니다"):
        KosisClient("")
