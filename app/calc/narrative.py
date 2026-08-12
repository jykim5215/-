"""결과 문장 생성.

결과는 숫자가 아니라 문장이어야 한다. 템플릿으로 고정한다.

⚠️ 이 모듈이 막으려는 오류: **기여도가 음수라고 해서 그 분류의 가격이 내렸다는
뜻이 아니다.** 가격은 올랐지만 내 비중이 평균보다 낮아 덜 맞았을 뿐인 경우가
대부분이다. "물가를 끌어내린 게 교통"처럼 쓰면 사실과 반대가 된다.

그래서 세 부호를 각각 따로 판정한다.

    1) 격차의 부호        -> 내 물가가 공식보다 높은가 낮은가
    2) 격차기여의 부호    -> 그 분류가 내 몫을 더했는가 뺐는가
    3) 분류상승률의 부호  -> 그 분류의 가격이 올랐는가 내렸는가

3번을 1·2번으로 추론하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..weights.official import DIVISION_BY_CODE
from .index import NEGLIGIBLE_GAP, CpiResult, DivisionContribution


@dataclass(frozen=True)
class Narrative:
    """화면 ①에 그대로 실리는 문장."""

    #: 한 문장 요약.
    sentence: str
    #: 문장을 만든 근거(디버깅·검증용).
    driver_code: str | None
    driver_name: str | None
    gap: float
    #: 격차가 무시할 수준이라 분해 설명을 붙이지 않은 경우.
    negligible: bool


def pick_driver(result: CpiResult) -> DivisionContribution | None:
    """격차를 가장 크게 만든 분류. 부호와 무관하게 절댓값 기준이다."""
    if not result.contributions:
        return None
    return max(result.contributions, key=lambda c: abs(c.gap_contribution))


def build(result: CpiResult) -> Narrative:
    """결과를 한 문장으로."""
    if result.is_negligible:
        return Narrative(
            sentence=(
                f"당신의 물가는 공식 물가와 사실상 같습니다"
                f"(차이 {abs(result.gap):.2f}%p, {NEGLIGIBLE_GAP}%p 미만)."
            ),
            driver_code=None,
            driver_name=None,
            gap=result.gap,
            negligible=True,
        )

    driver = pick_driver(result)
    if driver is None:
        return Narrative(
            sentence=(
                f"당신의 물가는 공식보다 {abs(result.gap):.2f}%p "
                f"{_higher_lower(result.gap)}습니다."
            ),
            driver_code=None,
            driver_name=None,
            gap=result.gap,
            negligible=False,
        )

    lead = (
        f"당신의 물가는 공식보다 {abs(result.gap):.2f}%p "
        f"{_higher_lower(result.gap)}습니다."
    )
    ratio = f"{driver.name} 비중이 평균의 {driver.share_ratio:.1f}배입니다."
    examples = _examples(driver.code)

    # (3) 분류의 가격이 실제로 올랐는지 내렸는지 — 오직 division_rate 로만 판정.
    moved = "올랐" if driver.division_rate >= 0 else "내렸"
    rate_text = f"이번 달 {josa(driver.name, '은/는')} {abs(driver.division_rate):.1f}% {moved}"

    if driver.share_ratio >= 1.0:
        # 비중이 평균보다 높다 -> 그 움직임이 그대로 내 몫에 반영된다.
        # (2) 격차기여의 부호로 더해졌는지 빠졌는지 판정.
        applied = "더해졌" if driver.gap_contribution >= 0 else "빠졌"
        tail = f"고{examples}, 그 움직임이 그대로 당신 몫으로 {applied}습니다."
    else:
        # 비중이 평균보다 낮다 -> 그 움직임을 덜 받는다.
        tail = f"는데{examples}, 당신은 그 영향을 그만큼 덜 받았습니다."

    return Narrative(
        sentence=f"{lead} {ratio} {rate_text}{tail}",
        driver_code=driver.code,
        driver_name=driver.name,
        gap=result.gap,
        negligible=False,
    )


def explain_contribution(contribution: DivisionContribution) -> str:
    """막대 하나에 붙는 설명. 화면 ②의 툴팁으로 쓴다.

    부호가 헷갈리는 조합(가격은 올랐는데 기여는 음수)에서 오해가 없게 쓴다.
    """
    rose = contribution.division_rate >= 0
    pushed_up = contribution.gap_contribution >= 0
    moved = "올랐" if rose else "내렸"
    direction = "높였" if pushed_up else "낮췄"

    base = (
        f"{contribution.name} 가격은 {abs(contribution.division_rate):.1f}% {moved}습니다. "
        f"내 비중은 평균의 {contribution.share_ratio:.1f}배이고, "
        f"이 분류는 내 물가를 공식보다 {abs(contribution.gap_contribution):.2f}%p {direction}습니다."
    )

    if rose and not pushed_up:
        base += " 가격이 내려서가 아니라, 비중이 평균보다 낮아 덜 반영된 것입니다."
    elif not rose and pushed_up:
        base += " 가격은 내렸지만 비중이 평균보다 낮아 그 하락을 덜 누린 것입니다."
    return base


def has_batchim(word: str) -> bool:
    """마지막 글자에 받침이 있는지. 조사 선택에 쓴다."""
    if not word:
        return False
    code = ord(word[-1]) - 0xAC00
    if 0 <= code < 11172:  # 한글 음절 영역
        return code % 28 != 0
    # 한글이 아니면(코드 등) 받침 없는 것으로 본다.
    return False


def josa(word: str, pair: str) -> str:
    """받침에 맞는 조사를 붙인다. josa('교통', '은/는') -> '교통은'."""
    with_batchim, without_batchim = pair.split("/")
    return word + (with_batchim if has_batchim(word) else without_batchim)


def _higher_lower(gap: float) -> str:
    return "높" if gap >= 0 else "낮"


def _examples(code: str) -> str:
    division = DIVISION_BY_CODE.get(code)
    if not division or not division.examples:
        return ""
    return "(" + ", ".join(division.examples) + ")"
