"""카드 업종/가맹점명 -> 12대 분류 매핑.

★ 공개 표준이 없다. 카드사 업종 코드는 회사마다 다르고 소비자물가지수의
지출목적별 분류와 대응 관계가 공표된 적이 없다. 그래서 이 표는 **추정**이며,
항목마다 신뢰도를 함께 내보내 사용자가 고칠 수 있게 한다.

★ 458개 품목 단위 자동 분류는 시도하지 않는다. 카드 승인 내역은 가맹점 단위이지
상품 단위가 아니다. 이마트 결제 8만 7천 원이 쌀인지 세제인지 카드 데이터로는
알 수 없다. 12대 분류까지만 자동으로 하고, 그 아래는 사용자 입력이다.

규칙은 순수 데이터다. 브라우저(web/app.js)가 같은 표를 /api/mapping/rules 로
받아 같은 방식으로 적용하므로 서버와 클라이언트의 분류 결과가 어긋나지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from ..weights.official import DIVISION_BY_CODE

#: 이 값 미만이면 사용자 확인을 받는다.
REVIEW_THRESHOLD = 0.8


@dataclass(frozen=True)
class MappingRule:
    """가맹점명·업종명에 나타나는 키워드로 분류를 추정한다."""

    keywords: tuple[str, ...]
    division_code: str
    confidence: float
    note: str = ""


#: 위에서부터 먼저 맞는 규칙을 쓴다. 구체적인 것을 앞에 둔다.
RULES: tuple[MappingRule, ...] = (
    # --- 교통: 주유는 명확하다 ---
    MappingRule(("주유", "주유소", "가스충전", "충전소", "에너지", "오일뱅크"), "D07", 0.95,
                "주유·충전은 교통(운송기구 연료비)으로 본다."),
    MappingRule(("철도", "코레일", "고속버스", "시외버스", "지하철", "교통카드", "택시",
                 "항공", "에어", "렌터카", "주차"), "D07", 0.9),
    MappingRule(("자동차정비", "카센터", "타이어", "car center"), "D07", 0.85),

    # --- 식료품: 마트는 비식품이 섞여 확인이 필요하다 ---
    MappingRule(("농협하나로", "하나로마트", "청과", "정육", "수산", "축산", "반찬"), "D01", 0.9),
    MappingRule(("이마트", "홈플러스", "롯데마트", "코스트코", "트레이더스", "마트", "슈퍼",
                 "食品", "식품"), "D01", 0.65,
                "대형마트는 생활용품·의류도 함께 팔아 식료품이 아닐 수 있다."),
    MappingRule(("편의점", "GS25", "CU ", "세븐일레븐", "이마트24"), "D01", 0.6,
                "편의점은 식품과 잡화가 섞인다."),

    # --- 음식 및 숙박 ---
    MappingRule(("스타벅스", "커피", "카페", "베이커리", "제과"), "D11", 0.85),
    MappingRule(("식당", "음식", "restaurant", "치킨", "피자", "버거", "분식", "한식",
                 "중식", "일식", "양식", "주점", "호프", "배달", "배민", "요기요"), "D11", 0.85),
    MappingRule(("호텔", "모텔", "숙박", "펜션", "리조트", "게스트하우스"), "D11", 0.9),

    # --- 보건 ---
    MappingRule(("약국", "병원", "의원", "치과", "한의원", "clinic", "메디컬", "건강검진"),
                "D06", 0.9),

    # --- 통신 ---
    MappingRule(("SKT", "KT ", "LGU", "유플러스", "통신", "телеком", "휴대폰", "알뜰폰"),
                "D08", 0.9),

    # --- 교육 ---
    MappingRule(("학원", "교습", "대학교", "학교", "등록금", "교육", "과외", "학습지"),
                "D10", 0.9),

    # --- 오락 및 문화 ---
    MappingRule(("영화", "CGV", "메가박스", "롯데시네마", "공연", "예매", "서점", "도서",
                 "여행사", "관광", "스포츠", "헬스", "체육", "PC방", "노래"), "D09", 0.85),
    MappingRule(("넷플릭스", "netflix", "왓챠", "스포티파이", "유튜브프리미엄", "구독"),
                "D09", 0.7, "구독 서비스는 오락·문화와 통신 중 어디로 볼지 갈린다."),

    # --- 의류 및 신발 ---
    MappingRule(("의류", "패션", "아울렛", "스포츠의류", "신발", "슈즈", "브랜드", "유니클로",
                 "자라", "무신사"), "D03", 0.85),
    MappingRule(("세탁", "수선"), "D03", 0.7),

    # --- 주택·수도·전기·연료 ---
    MappingRule(("한국전력", "전기요금", "도시가스", "수도요금", "관리비", "임대료", "월세"),
                "D04", 0.9),

    # --- 가정용품 및 가사서비스 ---
    MappingRule(("가구", "이케아", "다이소", "생활용품", "가전", "하이마트", "청소", "세제"),
                "D05", 0.7),

    # --- 주류 및 담배 ---
    MappingRule(("주류", "와인", "위스키", "담배", "전자담배"), "D02", 0.85),

    # --- 기타 상품 및 서비스 ---
    MappingRule(("미용", "헤어", "네일", "이발", "화장품", "올리브영", "보험", "은행수수료"),
                "D12", 0.8),

    # --- 온라인 종합몰: 무엇을 샀는지 알 수 없다 ---
    MappingRule(("쿠팡", "11번가", "G마켓", "옥션", "네이버페이", "카카오페이", "티몬",
                 "위메프", "SSG", "amazon"), "D05", 0.35,
                "종합몰은 품목을 알 수 없다. 무엇을 샀는지 직접 골라야 한다."),
)


@dataclass(frozen=True)
class Classification:
    """한 건의 분류 결과."""

    merchant: str
    amount: float
    division_code: str | None
    division_name: str | None
    confidence: float
    reason: str

    @property
    def needs_review(self) -> bool:
        return self.division_code is None or self.confidence < REVIEW_THRESHOLD

    @property
    def question(self) -> str:
        """사용자에게 보여줄 확인 문장."""
        if self.division_code is None:
            return f"{self.merchant} {self.amount:,.0f}원 — 어떤 분류인지 고르세요."
        return (
            f"{self.merchant} {self.amount:,.0f}원 → "
            f"{self.division_name}(으)로 분류했습니다. 맞나요?"
        )


def classify(merchant: str, amount: float, category: str = "") -> Classification:
    """가맹점명과 업종명으로 12대 분류를 추정한다.

    맞는 규칙이 없으면 추측하지 않고 division_code=None 을 돌려준다.
    """
    haystack = f"{merchant} {category}".lower()

    for rule in RULES:
        for keyword in rule.keywords:
            if keyword.lower().strip() and keyword.lower().strip() in haystack:
                division = DIVISION_BY_CODE[rule.division_code]
                return Classification(
                    merchant=merchant,
                    amount=amount,
                    division_code=rule.division_code,
                    division_name=division.name,
                    confidence=rule.confidence,
                    reason=rule.note or f"'{keyword}' 로 판단했습니다.",
                )

    return Classification(
        merchant=merchant,
        amount=amount,
        division_code=None,
        division_name=None,
        confidence=0.0,
        reason="맞는 규칙이 없습니다. 추측하지 않고 사용자에게 묻습니다.",
    )


def aggregate_to_weights(classifications: Sequence[Classification]) -> dict[str, float]:
    """분류 결과를 12대 분류 지출 합계로 모은다.

    분류하지 못한 건은 제외한다. 임의로 어딘가에 넣으면 가중치가 왜곡된다.
    """
    totals: dict[str, float] = {}
    for item in classifications:
        if item.division_code is None:
            continue
        totals[item.division_code] = totals.get(item.division_code, 0.0) + item.amount
    return totals


def to_weight_scale(totals: dict[str, float], scale: float = 1000.0) -> dict[str, float]:
    """지출 합계를 합계 1,000의 가중치로 환산한다."""
    grand_total = sum(totals.values())
    if grand_total <= 0:
        return {}
    return {code: amount / grand_total * scale for code, amount in totals.items()}


def rules_as_json() -> list[dict]:
    """브라우저가 같은 규칙을 쓰도록 내보낸다."""
    return [
        {
            "keywords": list(rule.keywords),
            "division_code": rule.division_code,
            "division_name": DIVISION_BY_CODE[rule.division_code].name,
            "confidence": rule.confidence,
            "note": rule.note,
        }
        for rule in RULES
    ]
