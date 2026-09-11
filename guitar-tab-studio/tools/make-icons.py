#!/usr/bin/env python3
"""아이콘 생성기 — 파이썬 표준 라이브러리만 사용 (외부 패키지 불필요).
   기타 헤드스톡 + 바디 모티프를 4배 슈퍼샘플링해 PNG/ICO로 굽는다.
   사용:  python3 tools/make-icons.py"""
import math, os, struct, zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
PAPER = (255, 253, 248)
INK   = (29, 26, 20)
BROWN = (138, 90, 43)
EDGE  = (207, 199, 178)

SS = 4  # 슈퍼샘플 배율


class Canvas:
    def __init__(self, n):
        self.n = n
        self.px = [[PAPER[0], PAPER[1], PAPER[2], 0] for _ in range(n * n)]

    def blend(self, x, y, col, a=1.0):
        if x < 0 or y < 0 or x >= self.n or y >= self.n or a <= 0:
            return
        i = y * self.n + x
        p = self.px[i]
        na = a + p[3] / 255.0 * (1 - a)
        for c in range(3):
            p[c] = int(round(col[c] * a + p[c] * (p[3] / 255.0) * (1 - a) / (na if na else 1)))
        p[3] = int(round(min(1.0, na) * 255))

    def rounded_rect(self, x0, y0, x1, y1, r, col):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                dx = max(x0 + r - x, 0, x - (x1 - r - 1))
                dy = max(y0 + r - y, 0, y - (y1 - r - 1))
                if dx * dx + dy * dy <= r * r:
                    self.blend(x, y, col, 1.0)

    def disc(self, cx, cy, r, col):
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.blend(x, y, col, 1.0)

    def ring(self, cx, cy, r, w, col):
        ro, ri = r + w / 2.0, r - w / 2.0
        for y in range(int(cy - ro) - 1, int(cy + ro) + 2):
            for x in range(int(cx - ro) - 1, int(cx + ro) + 2):
                d = math.hypot(x - cx, y - cy)
                if ri <= d <= ro:
                    self.blend(x, y, col, 1.0)

    def line(self, x0, y0, x1, y1, w, col):
        steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 2
        for s in range(steps + 1):
            t = s / steps
            self.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2.0, col)


def draw(n):
    cv = Canvas(n)
    S = n / 256.0
    # 종이 바탕 + 테두리
    cv.rounded_rect(0, 0, n, n, 56 * S, PAPER)
    cv.rounded_rect(0, 0, n, n, 56 * S, PAPER)
    for t in range(int(3 * S) + 1):
        pass
    # 얇은 테두리
    cv.rounded_rect(0, 0, n, n, 56 * S, EDGE)
    cv.rounded_rect(3 * S, 3 * S, n - 3 * S, n - 3 * S, 53 * S, PAPER)

    # 타브 줄 (배경 결)
    for i in range(6):
        y = (96 + i * 13) * S
        cv.line(36 * S, y, 220 * S, y, 2.0 * S, (231, 225, 210))

    # 기타: 바디(울림구멍 포함) + 넥 + 헤드스톡
    cv.disc(88 * S, 176 * S, 46 * S, BROWN)
    cv.disc(88 * S, 176 * S, 17 * S, PAPER)
    cv.line(104 * S, 158 * S, 186 * S, 74 * S, 15 * S, BROWN)
    cv.line(178 * S, 66 * S, 208 * S, 96 * S, 26 * S, INK)
    # 줄감개
    for i in range(3):
        cv.disc((166 + i * 0) * S, 0, 0, BROWN)
    cv.line(40 * S, 44 * S, 64 * S, 44 * S, 6 * S, BROWN)
    cv.line(40 * S, 60 * S, 64 * S, 60 * S, 6 * S, BROWN)
    cv.line(40 * S, 76 * S, 64 * S, 76 * S, 6 * S, BROWN)
    return cv


def render(size):
    big = draw(size * SS)
    n = size
    out = bytearray()
    for y in range(n):
        out.append(0)
        for x in range(n):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    p = big.px[(y * SS + dy) * (n * SS) + (x * SS + dx)]
                    al = p[3] / 255.0
                    r += p[0] * al; g += p[1] * al; b += p[2] * al; a += p[3]
            cnt = SS * SS
            aa = a / cnt
            if aa > 0:
                sc = (a / 255.0) or 1
                out += bytes([int(min(255, r / sc)), int(min(255, g / sc)),
                              int(min(255, b / sc)), int(min(255, aa))])
            else:
                out += bytes([0, 0, 0, 0])
    return bytes(out), n


def png_bytes(raw, n):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main():
    os.makedirs(OUT, exist_ok=True)
    pngs = {}
    for size in (16, 32, 48, 64, 128, 256):
        raw, n = render(size)
        data = png_bytes(raw, n)
        pngs[size] = data
        if size in (32, 128, 256):
            with open(os.path.join(OUT, 'icon-%d.png' % size), 'wb') as f:
                f.write(data)
            print('assets/icon-%d.png' % size, len(data), 'bytes')

    # ICO (PNG 내장 방식)
    sizes = sorted(pngs)
    hdr = struct.pack('<HHH', 0, 1, len(sizes))
    entries, blobs = b'', b''
    offset = 6 + 16 * len(sizes)
    for s in sizes:
        d = pngs[s]
        w = 0 if s >= 256 else s
        entries += struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, len(d), offset)
        offset += len(d)
        blobs += d
    with open(os.path.join(OUT, 'icon.ico'), 'wb') as f:
        f.write(hdr + entries + blobs)
    print('assets/icon.ico', 6 + 16 * len(sizes) + len(blobs), 'bytes')


if __name__ == '__main__':
    main()
