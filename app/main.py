"""진입점.

    uvicorn app.main:app --reload
    python -m app.main
"""

from __future__ import annotations

from .api import create_app
from .config import load_settings

app = create_app()


def main() -> None:
    import uvicorn

    settings = load_settings()
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
