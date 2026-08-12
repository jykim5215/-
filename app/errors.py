"""내 물가 서비스 공통 예외.

이 서비스의 제1원칙은 "숫자를 지어내지 않는다"이다. 값을 만들 수 없을 때는
그럴듯한 기본값으로 채우는 대신 여기 있는 예외를 던지고, 화면에는
「데이터 없음(사유)」를 표시한다.
"""

from __future__ import annotations


class MyCpiError(Exception):
    """이 서비스가 던지는 모든 예외의 뿌리."""


class KosisApiError(MyCpiError):
    """KOSIS OpenAPI가 오류를 돌려준 경우.

    정상 응답은 JSON 배열이고, 오류는 객체({"err": .., "errMsg": ..})다.
    호출부에서 isinstance(resp, list)로 분기해 이 예외를 올린다.
    """

    def __init__(self, err: object, err_msg: str, *, url: str | None = None) -> None:
        self.err = str(err)
        self.err_msg = err_msg
        # 인증키가 섞여 있을 수 있으므로 URL은 호출부에서 마스킹해 넘긴다.
        self.url = url
        super().__init__(f"KOSIS err={self.err}: {err_msg}")


class BaseYearMismatchError(MyCpiError):
    """기준연도가 다른 지수를 한 계산에 섞으려 한 경우.

    2026-12-31 공표분부터 소비자물가지수는 2025=100으로 개편된다. 2020=100
    지수와 2025=100 지수를 섞으면 숫자는 나오지만 의미가 없으므로, 조용히
    계산되지 않고 즉시 실패해야 한다.
    """


class DataUnavailable(MyCpiError):
    """수치를 만들 수 없는 경우.

    reason은 그대로 화면에 노출되므로 사용자가 읽고 원인을 알 수 있게 쓴다.
    """

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)
