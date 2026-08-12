"""업종 -> 12대 분류 매핑 테스트."""

from __future__ import annotations

import pytest

from app.mapping.mcc import (
    REVIEW_THRESHOLD,
    RULES,
    Classification,
    aggregate_to_weights,
    classify,
    rules_as_json,
    to_weight_scale,
)
from app.weights.official import DIVISION_BY_CODE


def test_every_rule_points_at_a_real_division():
    for rule in RULES:
        assert rule.division_code in DIVISION_BY_CODE
        assert 0.0 < rule.confidence <= 1.0


def test_unambiguous_merchant_is_classified_confidently():
    result = classify("SK에너지 강남주유소", 68000)
    assert result.division_code == "D07"
    assert result.confidence >= REVIEW_THRESHOLD
    assert not result.needs_review


def test_supermarket_is_flagged_for_review():
    """이마트는 식품이 아닐 수 있으니 확인을 받는다."""
    result = classify("이마트 성수점", 87000)
    assert result.division_code == "D01"
    assert result.needs_review
    assert "87,000원" in result.question
    assert "맞나요?" in result.question


def test_unknown_merchant_is_not_guessed():
    """맞는 규칙이 없으면 아무 분류에나 넣지 않는다."""
    result = classify("상호를 알 수 없는 가맹점", 12000)
    assert result.division_code is None
    assert result.confidence == 0.0
    assert result.needs_review
    assert "고르세요" in result.question


def test_general_marketplace_has_low_confidence():
    """종합몰은 품목을 알 수 없다."""
    result = classify("쿠팡", 45000)
    assert result.needs_review
    assert result.confidence < 0.5
    assert "품목을 알 수 없다" in result.reason


def test_category_column_is_used_when_merchant_is_opaque():
    """가맹점명이 모호해도 카드사 업종명으로 분류할 수 있다."""
    result = classify("(주)행복", 30000, category="일반음식점")
    assert result.division_code == "D11"


def test_unclassified_amounts_are_excluded_not_dumped_somewhere():
    items = [
        classify("SK에너지", 50000),
        classify("이마트", 100000),
        classify("알 수 없는 곳", 999999),
    ]
    totals = aggregate_to_weights(items)

    assert totals == {"D07": 50000.0, "D01": 100000.0}
    assert 999999 not in totals.values(), "분류 못 한 금액을 임의로 넣으면 안 된다"


def test_weight_scale_sums_to_1000():
    totals = {"D01": 300000.0, "D07": 100000.0, "D11": 100000.0}
    weights = to_weight_scale(totals)
    assert sum(weights.values()) == pytest.approx(1000.0)
    assert weights["D01"] == pytest.approx(600.0)


def test_empty_totals_give_empty_weights():
    assert to_weight_scale({}) == {}
    assert to_weight_scale({"D01": 0.0}) == {}


def test_rules_export_is_serializable_for_the_browser():
    exported = rules_as_json()
    assert len(exported) == len(RULES)
    assert all(set(r) == {"keywords", "division_code", "division_name", "confidence", "note"} for r in exported)


def test_browser_and_server_apply_rules_in_the_same_order():
    """브라우저는 같은 순서로 규칙을 적용해야 결과가 어긋나지 않는다."""
    exported = rules_as_json()
    assert [r["division_code"] for r in exported] == [r.division_code for r in RULES]


def test_review_question_wording_matches_spec_example():
    result = Classification("이마트", 87000, "D01", "식료품 및 비주류음료", 0.65, "")
    assert result.question == "이마트 87,000원 → 식료품 및 비주류음료(으)로 분류했습니다. 맞나요?"
