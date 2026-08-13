"""체감 환산 — 퍼센트를 손에 잡히는 단위로 바꾼다.

"+2.7%"는 아무도 실감하지 못한다. 같은 숫자를 이렇게 바꾼다.

    작년에 커피 100잔 사던 돈으로, 올해는 97잔.

★ 이 모듈은 **가격을 만들어내지 않는다.** 두 가지 방식만 쓴다.

  1) 개수 환산 — 가격이 전혀 필요 없다. 등락률만으로 계산된다.
     100 / (1 + r/100). 커피 한 잔이 얼마인지 몰라도 성립한다.
  2) 기준가 환산 — 사용자가 "내 커피는 4,500원"이라고 직접 입력했을 때만
     그 값에 실제 지수 변동을 적용한다. 기본값으로 가격을 채워 넣지 않는다.

즉 화면에 원화 금액이 뜬다면 그건 사용자가 넣은 값이거나, 사용자가 넣은 값에
공표 지수 변동률을 곱한 것뿐이다.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..errors import DataUnavailable

#: 개수 환산의 기준 개수. "작년에 100잔 사던 돈으로".
DEFAULT_UNITS = 100


@dataclass(frozen=True)
class FeltItem:
    """체감 품목 하나의 환산 결과."""

    #: KOSIS가 쓰는 실제 품목명. 우리가 붙인 별명이 아니다.
    item_name: str
    #: 화면에 쓸 단위(잔, 편, 봉지…). 표기용이며 계산에 쓰이지 않는다.
    unit: str
    #: 전년동월비 등락률(%). 공표 지수에서 계산된 값.
    rate: float
    base_year: int
    period: str

    @property
    def units_for_same_money(self) -> float:
        """작년에 DEFAULT_UNITS개 사던 돈으로 올해 살 수 있는 개수."""
        return units_for_same_money(self.rate)

    @property
    def rose(self) -> bool:
        return self.rate >= 0


def units_for_same_money(rate: float, base_units: float = DEFAULT_UNITS) -> float:
    """같은 돈으로 살 수 있는 개수.

    가격이 r% 올랐으면 같은 돈으로 살 수 있는 개수는 base/(1+r/100)이 된다.
    가격 자체는 몰라도 된다.
    """
    factor = 1.0 + rate / 100.0
    if factor <= 0:
        raise DataUnavailable(f"등락률 {rate}% 는 환산할 수 없습니다.")
    return base_units / factor


def price_after(base_price: float, rate: float) -> float:
    """사용자가 입력한 기준가에 실제 등락률을 적용한다.

    base_price 는 반드시 사용자가 직접 넣은 값이어야 한다. 이 함수는 기본값을
    갖지 않는다.
    """
    if base_price <= 0:
        raise DataUnavailable("기준가는 0보다 커야 합니다.")
    return base_price * (1.0 + rate / 100.0)


def same_basket_cost(amount: float, rate: float) -> float:
    """작년에 amount원어치 담던 장바구니의 올해 값.

    지수의 정의를 그대로 옮긴 것이라 별도의 가격 데이터가 필요 없다.
    """
    if amount <= 0:
        raise DataUnavailable("금액은 0보다 커야 합니다.")
    return amount * (1.0 + rate / 100.0)


def basket_sentence(amount: float, rate: float) -> str:
    """장바구니 환산 문장.

    "작년에 10만 원어치 담던 장바구니를 올해 똑같이 담으면 102,700원입니다."
    """
    now = same_basket_cost(amount, rate)
    difference = now - amount
    if abs(difference) < 1:
        return (
            f"작년에 {amount:,.0f}원어치 담던 장바구니를 올해 똑같이 담아도 "
            f"금액이 거의 같습니다."
        )
    direction = "더" if difference > 0 else "덜"
    return (
        f"작년에 {amount:,.0f}원어치 담던 장바구니를 올해 똑같이 담으면 "
        f"{now:,.0f}원입니다. {abs(difference):,.0f}원 {direction} 냅니다."
    )


def item_sentence(item: FeltItem, units: float = DEFAULT_UNITS) -> str:
    """품목 환산 문장.

    부호를 따로 판정한다. 값이 내렸으면 "더 삽니다"가 되어야 한다.
    """
    now = units_for_same_money(item.rate, units)
    difference = now - units

    if abs(difference) < 0.5:
        return (
            f"{item.item_name} 값은 거의 그대로입니다. "
            f"작년에 {units:,.0f}{item.unit} 사던 돈으로 올해도 {units:,.0f}{item.unit} 삽니다."
        )
    if difference < 0:
        return (
            f"작년에 {item.item_name} {units:,.0f}{item.unit} 사던 돈으로 "
            f"올해는 {now:,.0f}{item.unit} 삽니다. "
            f"{abs(difference):,.0f}{item.unit} 줄었습니다."
        )
    return (
        f"작년에 {item.item_name} {units:,.0f}{item.unit} 사던 돈으로 "
        f"올해는 {now:,.0f}{item.unit} 삽니다. "
        f"{abs(difference):,.0f}{item.unit} 늘었습니다."
    )
