from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
PROTOCOL = FIXTURES / "protocol"
OFFICIAL = FIXTURES / "official"


def load_protocol(name: str):
    """응답 형태만 담은 합성 픽스처. 통계값이 아니다."""
    return json.loads((PROTOCOL / name).read_text(encoding="utf-8"))


@pytest.fixture
def protocol():
    return load_protocol


@pytest.fixture
def memory_db():
    from app.db import connect

    conn = connect(":memory:")
    yield conn
    conn.close()
