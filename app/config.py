"""환경설정.

인증키는 .env 로만 관리한다. 코드에 하드코딩하지 않으며, .env 는 .gitignore 에
있어 커밋되지 않는다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover
        return
    load_dotenv(ROOT / ".env")


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    kosis_api_key: str
    kamis_cert_key: str
    kamis_cert_id: str
    opinet_api_key: str
    db_path: str
    host: str
    port: int

    @property
    def has_kosis(self) -> bool:
        return bool(self.kosis_api_key)

    @property
    def has_kamis(self) -> bool:
        """KAMIS 는 인증키와 계정 ID 두 개가 모두 있어야 한다."""
        return bool(self.kamis_cert_key and self.kamis_cert_id)

    @property
    def has_opinet(self) -> bool:
        return bool(self.opinet_api_key)


def load_settings() -> Settings:
    return Settings(
        kosis_api_key=os.getenv("KOSIS_API_KEY", "").strip(),
        kamis_cert_key=os.getenv("KAMIS_CERT_KEY", "").strip(),
        kamis_cert_id=os.getenv("KAMIS_CERT_ID", "").strip(),
        opinet_api_key=os.getenv("OPINET_API_KEY", "").strip(),
        db_path=os.getenv("MYCPI_DB_PATH", str(ROOT / "data" / "mycpi.sqlite3")),
        host=os.getenv("MYCPI_HOST", "127.0.0.1"),
        port=int(os.getenv("MYCPI_PORT", "8000")),
    )


#: 이 서비스가 공식 물가가 아님을 알리는 상시 노출 문구.
DISCLAIMER = (
    "이 서비스는 국가데이터처가 공표한 공식 지수를 사용자 가중치로 재가중한 "
    "참고값입니다. 공식 물가가 아닙니다."
)
