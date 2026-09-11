/* pdf.js — 의존성 0개 벡터 PDF 생성기 + 타브 악보/악보집 레이아웃
   window.GT.PDF
   · 표준 14폰트(Helvetica/Courier)는 Latin-1만 되므로, 한글 등 비ASCII 텍스트는
     캔버스로 렌더링해 JPEG XObject 로 삽입한다. 프렛 숫자·코드명은 ASCII라 벡터로 나간다. */
(function (GT) {
  'use strict';

  var HELV = {};
  (function () {
    var w = ('278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 ' +
      '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 ' +
      '667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 ' +
      '278 278 278 469 556 333 ' +
      '556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584').split(' ');
    for (var i = 0; i < w.length; i++) HELV[32 + i] = +w[i];
  })();
  var HELVB = {};
  (function () {
    var w = ('278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 ' +
      '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 ' +
      '722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 ' +
      '333 278 333 584 556 333 ' +
      '556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584').split(' ');
    for (var i = 0; i < w.length; i++) HELVB[32 + i] = +w[i];
  })();

  var FONTS = {
    helv:    { res: 'F1', base: 'Helvetica',          widths: HELV },
    bold:    { res: 'F2', base: 'Helvetica-Bold',     widths: HELVB },
    italic:  { res: 'F3', base: 'Helvetica-Oblique',  widths: HELV },
    courier: { res: 'F4', base: 'Courier',            widths: null }
  };

  var PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

  function isAscii(s) { return /^[\x20-\x7E]*$/.test(s); }

  function esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function strBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ── 문서 ── */
  function Doc(opts) {
    opts = opts || {};
    var size = PAGE_SIZES[opts.pageSize] || PAGE_SIZES.a4;
    this.W = size[0]; this.H = size[1];
    this.margin = opts.margin == null ? 46 : opts.margin;
    this.bg = opts.bg || null;               // [r,g,b] 0..1, null이면 흰 종이
    this.pages = [];
    this.images = [];                        // {bytes,w,h,name}
    this._imgCache = {};
    this.cur = null;
    this.title = opts.title || 'Guitar Tab';
  }

  Doc.prototype.addPage = function () {
    this.cur = { ops: [], imgs: {} };
    this.pages.push(this.cur);
    if (this.bg) this.rect(0, 0, this.W, this.H, this.bg);
    return this.cur;
  };

  Doc.prototype._y = function (y) { return this.H - y; };

  Doc.prototype.line = function (x1, y1, x2, y2, w, col) {
    col = col || [0, 0, 0];
    this.cur.ops.push(
      f(col[0]) + ' ' + f(col[1]) + ' ' + f(col[2]) + ' RG ' + f(w || 0.6) + ' w ' +
      f(x1) + ' ' + f(this._y(y1)) + ' m ' + f(x2) + ' ' + f(this._y(y2)) + ' l S');
  };

  Doc.prototype.rect = function (x, y, w, h, col) {
    col = col || [1, 1, 1];
    this.cur.ops.push(f(col[0]) + ' ' + f(col[1]) + ' ' + f(col[2]) + ' rg ' +
      f(x) + ' ' + f(this._y(y + h)) + ' ' + f(w) + ' ' + f(h) + ' re f');
  };

  Doc.prototype.textWidth = function (s, size, fontKey) {
    var fnt = FONTS[fontKey || 'helv'];
    if (!fnt.widths) return s.length * size * 0.6;   // Courier 고정폭
    var tot = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      tot += (fnt.widths[c] != null ? fnt.widths[c] : 556);
    }
    return tot * size / 1000;
  };

  /* 비ASCII 문자열은 캔버스 → JPEG 이미지로 그린다 */
  Doc.prototype._rasterText = function (s, size, fontKey, col) {
    var key = s + '|' + size + '|' + fontKey + '|' + (col || []).join(',');
    if (this._imgCache[key]) return this._imgCache[key];
    var scale = 4;
    var fam = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';
    var weight = fontKey === 'bold' ? '700 ' : (fontKey === 'italic' ? 'italic 400 ' : '400 ');
    var cv = document.createElement('canvas');
    var cx = cv.getContext('2d');
    cx.font = weight + (size * scale) + 'px ' + fam;
    var w = Math.ceil(cx.measureText(s).width) + 4;
    var h = Math.ceil(size * scale * 1.38);
    cv.width = Math.max(2, w); cv.height = Math.max(2, h);
    cx = cv.getContext('2d');
    var bg = this.bg || [1, 1, 1];
    cx.fillStyle = 'rgb(' + Math.round(bg[0] * 255) + ',' + Math.round(bg[1] * 255) + ',' + Math.round(bg[2] * 255) + ')';
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.font = weight + (size * scale) + 'px ' + fam;
    cx.textBaseline = 'alphabetic';
    col = col || [0, 0, 0];
    cx.fillStyle = 'rgb(' + Math.round(col[0] * 255) + ',' + Math.round(col[1] * 255) + ',' + Math.round(col[2] * 255) + ')';
    cx.fillText(s, 2, size * scale);
    var data = cv.toDataURL('image/jpeg', 0.94).split(',')[1];
    var img = { bytes: b64ToBytes(data), w: cv.width, h: cv.height,
                name: 'Im' + (this.images.length + 1),
                ptW: cv.width / scale, ptH: cv.height / scale, baseline: size };
    this.images.push(img);
    this._imgCache[key] = img;
    return img;
  };

  /* x,y = 베이스라인 기준(왼쪽 위 원점, y는 아래로 증가) */
  Doc.prototype.text = function (s, x, y, o) {
    s = String(s == null ? '' : s);
    if (!s) return 0;
    o = o || {};
    var size = o.size || 10, fontKey = o.font || 'helv', col = o.color || [0, 0, 0];
    var w;
    if (isAscii(s)) {
      w = this.textWidth(s, size, fontKey);
      var tx = x;
      if (o.align === 'center') tx = x - w / 2;
      else if (o.align === 'right') tx = x - w;
      this.cur.ops.push('BT ' + f(col[0]) + ' ' + f(col[1]) + ' ' + f(col[2]) + ' rg /' +
        FONTS[fontKey].res + ' ' + f(size) + ' Tf ' + f(tx) + ' ' + f(this._y(y)) + ' Td (' + esc(s) + ') Tj ET');
      return w;
    }
    var img = this._rasterText(s, size, fontKey, col);
    w = img.ptW;
    var ix = x;
    if (o.align === 'center') ix = x - w / 2;
    else if (o.align === 'right') ix = x - w;
    var iy = y - size;                       // 베이스라인 맞추기
    this.cur.imgs[img.name] = img;
    this.cur.ops.push('q ' + f(img.ptW) + ' 0 0 ' + f(img.ptH) + ' ' + f(ix) + ' ' +
      f(this._y(iy + img.ptH)) + ' cm /' + img.name + ' Do Q');
    return w;
  };

  Doc.prototype.measure = function (s, size, fontKey) {
    if (isAscii(s)) return this.textWidth(s, size, fontKey);
    return this._rasterText(s, size, fontKey, [0, 0, 0]).ptW;
  };

  function f(n) {
    if (!isFinite(n)) n = 0;
    return (Math.round(n * 1000) / 1000).toString();
  }

  /* ── 직렬화 ── */
  Doc.prototype.build = function () {
    var parts = [], offsets = [], objCount = 0, self = this;
    var chunks = [];
    var pos = 0;

    function push(x) {
      var b = (x instanceof Uint8Array) ? x : strBytes(x);
      chunks.push(b); pos += b.length;
    }
    function obj(n, body, streamBytes) {
      offsets[n] = pos;
      push(n + ' 0 obj\n' + body + '\n');
      if (streamBytes) { push('stream\n'); push(streamBytes); push('\nendstream\n'); }
      push('endobj\n');
    }

    var nPages = this.pages.length;
    // 객체 번호 배치: 1 Catalog, 2 Pages, 3..6 Fonts, 7.. Images, then pages & contents
    var fontStart = 3;
    var imgStart = fontStart + 4;
    var pageStart = imgStart + this.images.length;
    var contentStart = pageStart + nPages;
    var totalObjs = contentStart + nPages - 1;

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    var kids = [];
    for (var i = 0; i < nPages; i++) kids.push((pageStart + i) + ' 0 R');

    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Count ' + nPages + ' /Kids [' + kids.join(' ') + '] >>');

    var fk = ['helv', 'bold', 'italic', 'courier'];
    for (i = 0; i < 4; i++) {
      obj(fontStart + i, '<< /Type /Font /Subtype /Type1 /BaseFont /' + FONTS[fk[i]].base +
        ' /Encoding /WinAnsiEncoding >>');
    }

    for (i = 0; i < this.images.length; i++) {
      var im = this.images[i];
      obj(imgStart + i, '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>',
        im.bytes);
    }
    var imgObjOf = {};
    for (i = 0; i < this.images.length; i++) imgObjOf[this.images[i].name] = imgStart + i;

    for (i = 0; i < nPages; i++) {
      var p = this.pages[i];
      var xo = [];
      for (var nm in p.imgs) if (p.imgs.hasOwnProperty(nm)) xo.push('/' + nm + ' ' + imgObjOf[nm] + ' 0 R');
      var res = '<< /Font << /F1 ' + fontStart + ' 0 R /F2 ' + (fontStart + 1) + ' 0 R /F3 ' +
        (fontStart + 2) + ' 0 R /F4 ' + (fontStart + 3) + ' 0 R >>' +
        (xo.length ? ' /XObject << ' + xo.join(' ') + ' >>' : '') + ' >>';
      obj(pageStart + i, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(this.W) + ' ' + f(this.H) +
        '] /Resources ' + res + ' /Contents ' + (contentStart + i) + ' 0 R >>');
    }

    for (i = 0; i < nPages; i++) {
      var content = this.pages[i].ops.join('\n');
      var cb = strBytes(content);
      obj(contentStart + i, '<< /Length ' + cb.length + ' >>', cb);
    }

    var xrefPos = pos;
    var maxObj = totalObjs;
    var xref = 'xref\n0 ' + (maxObj + 1) + '\n0000000000 65535 f \n';
    for (i = 1; i <= maxObj; i++) {
      var off = offsets[i] || 0;
      xref += ('0000000000' + off).slice(-10) + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + (maxObj + 1) + ' /Root 1 0 R /Info << /Title (' +
      esc(isAscii(this.title) ? this.title : 'Guitar Tab Studio') +
      ') /Producer (Guitar Tab Studio) >> >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    var total = 0;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total), off2 = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], off2); off2 += chunks[i].length; }
    return out;
  };

  Doc.prototype.blob = function () {
    return new Blob([this.build()], { type: 'application/pdf' });
  };

  /* ── 타브 악보 레이아웃 ───────────────────────────────── */
  var INK = [0.11, 0.10, 0.08];
  var GRAY = [0.55, 0.53, 0.48];
  var FAINT = [0.72, 0.70, 0.65];
  var ACCENT = [0.54, 0.35, 0.17];

  function layoutOpts(o) {
    o = o || {};
    return {
      measuresPerSystem: o.measuresPerSystem || 4,
      stringGap: o.stringGap || 7.6,
      systemGap: o.systemGap || 34,
      fretSize: o.fretSize || 8.2,
      showChords: o.showChords !== false,
      showMeasureNumbers: o.showMeasureNumbers !== false,
      showTechniques: o.showTechniques !== false,
      footerNote: o.footerNote || '기타 탭 스튜디오로 채보 · 개인 연습/학습용'
    };
  }

  /* 한 곡을 doc 에 그린다. 반환: 사용한 페이지 수 */
  function drawScore(doc, score, opt, pageNumStart, totalPagesHint) {
    opt = layoutOpts(opt);
    var M = doc.margin;
    var W = doc.W, H = doc.H;
    var contentW = W - M * 2;
    var labels = GT.Fretboard.labelsFor(score.meta.tuning);
    var staffH = opt.stringGap * 5;
    var chordH = opt.showChords ? 12 : 0;
    var techH = opt.showTechniques ? 9 : 0;
    var systemH = chordH + staffH + techH + opt.systemGap;
    var footerY = H - M + 14;
    var bottomLimit = H - M - 6;

    var pageIdx = 0;
    var y = 0;

    function newPage(first) {
      doc.addPage(); pageIdx++;
      y = M;
      if (first) y = drawHeader(doc, score, M, y, contentW);
      else y = M + 8;
      return y;
    }

    function footer(pageNo) {
      doc.line(M, footerY - 9, W - M, footerY - 9, 0.4, [0.85, 0.83, 0.78]);
      doc.text(opt.footerNote, M, footerY, { size: 7, font: 'helv', color: GRAY });
      doc.text(String(pageNo), W - M, footerY, { size: 7.5, font: 'helv', color: GRAY, align: 'right' });
    }

    newPage(true);

    var spm = score.slotsPerMeasure;
    var mi = 0;
    var pageFooters = [];
    while (mi < score.measures.length) {
      if (y + systemH > bottomLimit) {
        pageFooters.push(pageIdx);
        footer(pageNumStart + pageIdx - 1);
        newPage(false);
      }
      var count = Math.min(opt.measuresPerSystem, score.measures.length - mi);
      drawSystem(doc, score, mi, count, M, y, contentW, opt, labels, staffH, chordH);
      y += systemH;
      mi += count;
    }
    footer(pageNumStart + pageIdx - 1);
    return pageIdx;
  }

  function drawHeader(doc, score, x, y, w) {
    var m = score.meta;
    var cx = x + w / 2;
    y += 14;
    doc.text(m.title || '제목 없는 채보', cx, y, { size: 17, font: 'bold', color: INK, align: 'center' });
    y += 15;
    if (m.artist) {
      doc.text(m.artist, cx, y, { size: 10.5, font: 'italic', color: [0.35, 0.33, 0.28], align: 'center' });
      y += 13;
    }
    var meta = [];
    var tun = GT.Fretboard.TUNINGS[m.tuning];
    meta.push(tun ? tun.label.replace(/\s*\(.*\)/, '') : m.tuning);
    if (m.capo) meta.push('Capo ' + m.capo);
    meta.push('= ' + m.bpm);
    meta.push(m.timeSig[0] + '/' + m.timeSig[1]);
    if (m.key) meta.push('Key ' + m.key);
    doc.text(meta.join('   ·   '), cx, y + 1, { size: 8.4, font: 'helv', color: [0.42, 0.40, 0.35], align: 'center' });
    y += 9;
    doc.line(x, y, x + w, y, 1.1, INK);
    y += 4;
    if (m.sourceUrl) {
      doc.text('출처: ' + m.sourceUrl, cx, y + 8, { size: 6.8, font: 'helv', color: FAINT, align: 'center' });
      y += 10;
    }
    return y + 16;
  }

  function drawSystem(doc, score, startM, count, x, y, w, opt, labels, staffH, chordH) {
    var top = y + chordH;
    var gap = opt.stringGap;
    var labelW = 15;
    var sx = x + labelW;
    var sw = w - labelW;

    // 줄 이름
    for (var s = 0; s < 6; s++) {
      var ly = top + s * gap;
      doc.text(labels[s], x + labelW - 4, ly + 2.4, { size: 6.6, font: 'helv', color: GRAY, align: 'right' });
      doc.line(sx, ly, sx + sw, ly, 0.45, [0.32, 0.30, 0.26]);
    }

    // 마디 폭 = 마디 안 음표 밀도에 비례 (최소 폭 보장)
    var weights = [], total = 0, i;
    for (i = 0; i < count; i++) {
      var mm = score.measures[startM + i];
      var used = 0;
      for (var q = 0; q < mm.slots.length; q++) {
        for (var st = 0; st < 6; st++) if (mm.slots[q][st]) { used++; break; }
      }
      var wgt = 1 + Math.min(1.1, used / (mm.slots.length * 0.55));
      weights.push(wgt); total += wgt;
    }

    var cursor = sx;
    doc.line(sx, top, sx, top + staffH, 0.9, [0.2, 0.19, 0.16]);
    for (i = 0; i < count; i++) {
      var mw = sw * (weights[i] / total);
      drawMeasure(doc, score, startM + i, cursor, top, mw, gap, opt);
      cursor += mw;
      var lw = (i === count - 1) ? 0.9 : 0.5;
      doc.line(cursor, top, cursor, top + staffH, lw, [0.2, 0.19, 0.16]);
    }

    if (opt.showMeasureNumbers) {
      doc.text(String(startM + 1), sx + 1, top - chordH - 1.5, { size: 6.2, font: 'helv', color: FAINT });
    }
    var sec = score.measures[startM].section;
    if (sec) {
      doc.text(sec, sx + 14, top - chordH - 1.5, { size: 7.4, font: 'italic', color: ACCENT });
    }
  }

  function drawMeasure(doc, score, mIdx, x, top, w, gap, opt) {
    var mm = score.measures[mIdx];
    var spm = mm.slots.length;
    var pad = 5;
    var inner = Math.max(10, w - pad * 2);
    var chordAt = {};
    for (var c = 0; c < mm.chords.length; c++) chordAt[mm.chords[c].slot] = mm.chords[c].name;

    for (var s = 0; s < spm; s++) {
      var cx = x + pad + (spm > 1 ? inner * (s / spm) : 0) + inner / (spm * 2);
      if (opt.showChords && chordAt[s]) {
        doc.text(chordAt[s], cx, top - 4.5, { size: 7.8, font: 'bold', color: ACCENT, align: 'center' });
      }
      var cells = mm.slots[s];
      for (var st = 0; st < 6; st++) {
        var cell = cells[st];
        if (!cell) continue;
        var txt = String(cell.fret);
        var ly = top + st * gap;
        var tw = doc.textWidth(txt, opt.fretSize, 'helv');
        var col = cell.conf < 0.34 ? FAINT : INK;
        // 숫자 뒤 배경을 지워 줄이 겹치지 않게
        doc.rect(cx - tw / 2 - 1.2, ly - opt.fretSize * 0.44, tw + 2.4, opt.fretSize * 0.9,
                 doc.bg || [1, 1, 1]);
        doc.text(txt, cx, ly + opt.fretSize * 0.34, { size: opt.fretSize, font: 'helv', color: col, align: 'center' });
        if (opt.showTechniques && cell.tech) {
          doc.text(cell.tech, cx + tw / 2 + 1.6, ly + opt.fretSize * 0.3,
            { size: opt.fretSize * 0.78, font: 'italic', color: ACCENT });
        }
      }
    }
  }

  /* ── 내보내기 API ── */
  function makeDoc(opts) {
    opts = opts || {};
    var doc = new Doc({
      pageSize: opts.pageSize || 'a4',
      margin: opts.margin || 46,
      bg: opts.cream ? [0.996, 0.99, 0.973] : null,
      title: opts.title || 'Guitar Tab'
    });
    return doc;
  }

  function exportScore(score, opts) {
    opts = opts || {};
    var doc = makeDoc({ pageSize: opts.pageSize, cream: opts.cream, title: score.meta.title });
    drawScore(doc, score, opts, 1);
    return doc.blob();
  }

  /* 악보집: 표지 → 목차 → 각 곡 */
  function exportBook(scores, book, opts) {
    opts = opts || {};
    book = book || {};
    var doc = makeDoc({ pageSize: opts.pageSize, cream: opts.cream, title: book.title || 'Tab Book' });

    // 1) 페이지 수를 먼저 계산하기 위해 임시 문서에 그려본다
    var probe = makeDoc({ pageSize: opts.pageSize, cream: opts.cream });
    var counts = [], i;
    for (i = 0; i < scores.length; i++) counts.push(drawScore(probe, scores[i], opts, 1));

    var tocPages = Math.max(1, Math.ceil(scores.length / 26));
    var frontPages = 1 + tocPages;      // 표지 + 목차
    var startPage = [], acc = frontPages + 1;
    for (i = 0; i < scores.length; i++) { startPage.push(acc); acc += counts[i]; }

    // 2) 표지
    drawCover(doc, book, scores, opts);

    // 3) 목차
    drawToc(doc, book, scores, startPage, tocPages, opts);

    // 4) 각 곡
    for (i = 0; i < scores.length; i++) drawScore(doc, scores[i], opts, startPage[i]);

    return doc.blob();
  }

  function drawCover(doc, book, scores, opts) {
    doc.addPage();
    var W = doc.W, H = doc.H, M = doc.margin;
    var cx = W / 2;
    doc.line(M, M + 40, W - M, M + 40, 1.2, INK);
    doc.line(M, M + 44, W - M, M + 44, 0.5, INK);
    doc.text(book.title || '기타 타브 악보집', cx, H * 0.36, { size: 26, font: 'bold', color: INK, align: 'center' });
    if (book.subtitle) doc.text(book.subtitle, cx, H * 0.36 + 22, { size: 12, font: 'italic', color: [0.4, 0.38, 0.33], align: 'center' });
    doc.text(scores.length + ' songs', cx, H * 0.36 + 46, { size: 10, font: 'helv', color: GRAY, align: 'center' });
    var d = new Date();
    var ds = d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2);
    doc.text(ds, cx, H - M - 34, { size: 9, font: 'helv', color: GRAY, align: 'center' });
    doc.text('Guitar Tab Studio', cx, H - M - 20, { size: 8, font: 'helv', color: FAINT, align: 'center' });
    doc.line(M, H - M - 10, W - M, H - M - 10, 0.5, INK);
    doc.line(M, H - M - 6, W - M, H - M - 6, 1.2, INK);
  }

  function drawToc(doc, book, scores, startPage, tocPages, opts) {
    var perPage = 26, idx = 0;
    for (var p = 0; p < tocPages; p++) {
      doc.addPage();
      var M = doc.margin, W = doc.W;
      var y = M + 20;
      doc.text(p === 0 ? '목차' : '목차 (계속)', M, y, { size: 15, font: 'bold', color: INK });
      y += 6;
      doc.line(M, y, W - M, y, 1, INK);
      y += 20;
      for (var k = 0; k < perPage && idx < scores.length; k++, idx++) {
        var s = scores[idx];
        var num = String(idx + 1) + '.';
        doc.text(num, M, y, { size: 9, font: 'helv', color: GRAY });
        doc.text(s.meta.title, M + 18, y, { size: 10, font: 'helv', color: INK });
        var sub = [];
        var tun = GT.Fretboard.TUNINGS[s.meta.tuning];
        if (tun) sub.push(tun.label.replace(/\s*\(.*\)/, ''));
        if (s.meta.capo) sub.push('Capo ' + s.meta.capo);
        sub.push(s.meta.bpm + ' BPM');
        doc.text(sub.join(' · '), M + 18, y + 9, { size: 6.8, font: 'helv', color: FAINT });
        doc.text(String(startPage[idx]), W - M, y, { size: 9, font: 'helv', color: INK, align: 'right' });
        var dotY = y - 2.6;
        doc.line(M + 18 + doc.measure(s.meta.title, 10, 'helv') + 6, dotY,
                 W - M - 14, dotY, 0.3, [0.8, 0.78, 0.72]);
        y += 22;
      }
      doc.text('Guitar Tab Studio', W / 2, doc.H - M + 14, { size: 7, font: 'helv', color: GRAY, align: 'center' });
    }
  }

  GT.PDF = {
    Doc: Doc,
    exportScore: exportScore,
    exportBook: exportBook,
    drawScore: drawScore
  };
})(window.GT = window.GT || {});
