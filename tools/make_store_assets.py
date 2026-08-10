#!/usr/bin/env python3
"""
Google Play 스토어 등록용 그래픽 자산을 만든다.

만드는 것
  - play-assets/icon-512.png          512×512, 알파 없음 (Play 필수 규격)
  - play-assets/feature-graphic.png   1024×500, 알파 없음 (Play 필수 규격)

앱 아이콘(적응형 벡터)과 같은 모티프·같은 팔레트를 코드로 다시 그린다.
벡터를 래스터화하는 대신 직접 그리는 이유는, 512px 에서는 획 두께와 여백을
따로 조정해야 축소판에서도 형태가 살아남기 때문이다.

사용법:  python3 tools/make_store_assets.py [출력폴더]
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ui/theme/Theme.kt 의 Paper 팔레트와 같은 값
BG = (241, 231, 214)          # ic_launcher_background
CARD = (255, 253, 248)        # Paper.Surface
CARD_BACK = (230, 216, 192)
INK = (36, 31, 26)            # Paper.Ink
TERRACOTTA = (194, 96, 60)    # Paper.Terracotta
UMBER = (138, 90, 52)         # Paper.Umber


def _font(size: int) -> ImageFont.FreeTypeFont:
    """세리프를 우선 찾고, 없으면 있는 트루타입 아무거나. 최후에는 기본 비트맵."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _rounded_card(
    draw: ImageDraw.ImageDraw,
    box: tuple[float, float, float, float],
    radius: int,
    fill: tuple[int, int, int],
    outline: tuple[int, int, int] | None = None,
    width: int = 0,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_mark(size: int, scale: float = 1.0) -> Image.Image:
    """카드 두 장 + 세리프 A 로고. 투명 배경의 정사각 이미지를 돌려준다."""
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 앞 카드 기준 치수 (아이콘 캔버스의 62% 폭)
    cw = s * 0.60 * scale
    ch = cw * 1.16
    cx, cy = s / 2, s / 2 + s * 0.012
    radius = int(cw * 0.13)

    # 뒤 카드 — 살짝 기울여 겹친 느낌
    back = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(back)
    _rounded_card(
        bd,
        (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2),
        radius,
        CARD_BACK,
    )
    back = back.rotate(9, resample=Image.BICUBIC, center=(cx, cy))
    img.alpha_composite(back)

    # 앞 카드 그림자
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    _rounded_card(
        sd,
        (cx - cw / 2, cy - ch / 2 + s * 0.018, cx + cw / 2, cy + ch / 2 + s * 0.018),
        radius,
        (90, 70, 45, 70),
    )
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(s * 0.018)))

    # 앞 카드
    _rounded_card(
        d,
        (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2),
        radius,
        CARD,
        outline=TERRACOTTA,
        width=max(2, int(s * 0.016)),
    )

    # 카드 상단 구분선
    line_y = cy - ch / 2 + ch * 0.20
    d.rectangle(
        (cx - cw / 2, line_y, cx + cw / 2, line_y + max(2, s * 0.012)),
        fill=TERRACOTTA,
    )

    # 세리프 A
    font = _font(int(ch * 0.52))
    text = "A"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(
        (cx - tw / 2 - bbox[0], cy + ch * 0.06 - th / 2 - bbox[1]),
        text,
        font=font,
        fill=INK,
    )

    # 밑줄
    ul_y = cy + ch / 2 - ch * 0.13
    d.rectangle(
        (cx - cw * 0.28, ul_y, cx + cw * 0.28, ul_y + max(2, s * 0.010)),
        fill=UMBER,
    )
    return img


def make_icon(path: Path) -> None:
    """512×512 스토어 아이콘. Play 는 알파 채널을 허용하지 않는다."""
    size = 512
    img = Image.new("RGB", (size, size), BG)
    img.paste(draw_mark(size, scale=0.94), (0, 0), draw_mark(size, scale=0.94))
    img.save(path, "PNG")


def make_feature_graphic(path: Path) -> None:
    """1024×500 피처 그래픽. 왼쪽에 마크, 오른쪽에 문구."""
    w, h = 1024, 500
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    # 배경에 옅은 카드 결 — 종이 위에 카드가 흩어진 느낌
    for i, (x, y, cw, rot, alpha) in enumerate(
        [
            (150, 470, 210, -14, 26),
            (430, 486, 240, 8, 20),
            (760, 466, 200, -6, 24),
            (940, 500, 180, 12, 18),
        ]
    ):
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ch = cw * 0.42
        ld.rounded_rectangle(
            (x - cw / 2, y - ch / 2, x + cw / 2, y + ch / 2),
            radius=int(ch * 0.5),
            fill=(*INK, alpha),
        )
        img.paste(
            Image.alpha_composite(img.convert("RGBA"), layer.rotate(rot, center=(x, y))).convert("RGB"),
            (0, 0),
        )

    # 왼쪽 마크
    mark_size = 300
    mark = draw_mark(mark_size, scale=0.98)
    img.paste(mark, (86, (h - mark_size) // 2 - 10), mark)

    # 오른쪽 문구
    title_font = _font(78)
    sub_font = _font(34)
    tx = 430
    d.text((tx, 176), "단어장", font=title_font, fill=INK)
    d.text((tx, 278), "30일 아카이브 · 몰랐던 단어 자동 정리", font=sub_font, fill=UMBER)
    d.text((tx, 324), "뜻·예문 추천 · 발음 · 간격 반복 복습", font=sub_font, fill=UMBER)

    # 포인트 선
    d.rectangle((tx, 150, tx + 96, 158), fill=TERRACOTTA)

    img.save(path, "PNG")


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "play-assets")
    out.mkdir(parents=True, exist_ok=True)
    make_icon(out / "icon-512.png")
    make_feature_graphic(out / "feature-graphic.png")
    for f in sorted(out.glob("*.png")):
        with Image.open(f) as im:
            print(f"{f}  {im.size[0]}×{im.size[1]}  {im.mode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
