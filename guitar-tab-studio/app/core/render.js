/* render.js — 캔버스 타브 렌더링 + 클릭 히트테스트 (페이퍼 스코어 테마)
   window.GT.Render */
(function (GT) {
  'use strict';

  var C = {
    paper: '#fffdf8', ink: '#1d1a14', ink2: '#6b6454', faint: '#b6ae99',
    line: '#4a4436', accent: '#8a5a2b', sel: '#8a5a2b', selBg: 'rgba(138,90,43,.14)',
    play: '#b4533a', edge: '#e3ddcd', low: '#a9a08a'
  };

  function Renderer(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.layout = null;
    this.opts = { measuresPerSystem: 4, stringGap: 15, systemGap: 62, fretSize: 12.5, pad: 26 };
  }

  Renderer.prototype.setScore = function (score) { this.score = score; };

  Renderer.prototype.measuresPerSystem = function (width) {
    var w = width - this.opts.pad * 2 - 26;
    var per = Math.floor(w / 190);
    return Math.max(1, Math.min(6, per));
  };

  Renderer.prototype.draw = function (state) {
    var score = this.score;
    var cv = this.cv, ctx = this.ctx;
    state = state || {};
    var cssW = cv.clientWidth || 720;
    var dpr = window.devicePixelRatio || 1;
    var o = this.opts;
    var mps = this.measuresPerSystem(cssW);
    var staffH = o.stringGap * 5;
    var chordH = 20, techH = 12;
    var systemH = chordH + staffH + techH + o.systemGap;
    var nSystems = score ? Math.ceil(score.measures.length / mps) : 0;
    var cssH = Math.max(240, o.pad * 2 + nSystems * systemH + 10);

    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, cssW, cssH);
    if (!score) return;

    var labels = GT.Fretboard.labelsFor(score.meta.tuning);
    var layout = { systems: [], mps: mps, staffH: staffH, stringGap: o.stringGap };
    var x = o.pad, w = cssW - o.pad * 2;
    var y = o.pad;

    for (var si = 0; si < nSystems; si++) {
      var startM = si * mps;
      var count = Math.min(mps, score.measures.length - startM);
      var sys = this._drawSystem(ctx, score, startM, count, x, y, w, labels, staffH, chordH, state);
      layout.systems.push(sys);
      y += systemH;
    }
    this.layout = layout;
  };

  Renderer.prototype._drawSystem = function (ctx, score, startM, count, x, y, w, labels, staffH, chordH, state) {
    var o = this.opts;
    var top = y + chordH;
    var labelW = 24;
    var sx = x + labelW, sw = w - labelW;

    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    for (var s = 0; s < 6; s++) {
      var ly = top + s * o.stringGap;
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'right';
      ctx.fillText(labels[s], x + labelW - 6, ly);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(sx, ly + 0.5); ctx.lineTo(sx + sw, ly + 0.5); ctx.stroke();
    }

    var weights = [], total = 0, i;
    for (i = 0; i < count; i++) {
      var mm = score.measures[startM + i], used = 0;
      for (var q = 0; q < mm.slots.length; q++)
        for (var st = 0; st < 6; st++) if (mm.slots[q][st]) { used++; break; }
      var wg = 1 + Math.min(1.1, used / (mm.slots.length * 0.55));
      weights.push(wg); total += wg;
    }

    var measures = [];
    var cursor = sx;
    barline(ctx, cursor, top, staffH, 1.6);
    for (i = 0; i < count; i++) {
      var mw = sw * (weights[i] / total);
      measures.push(this._drawMeasure(ctx, score, startM + i, cursor, top, mw, state));
      cursor += mw;
      barline(ctx, cursor, top, staffH, i === count - 1 ? 1.6 : 1);
    }

    ctx.textAlign = 'left';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = C.faint;
    ctx.fillText(String(startM + 1), sx + 2, top - chordH + 6);
    var sec = score.measures[startM].section;
    if (sec) {
      ctx.font = 'italic 600 11px system-ui, sans-serif';
      ctx.fillStyle = C.accent;
      ctx.fillText(sec, sx + 24, top - chordH + 6);
    }
    return { startM: startM, count: count, top: top, measures: measures };
  };

  Renderer.prototype._drawMeasure = function (ctx, score, mIdx, x, top, w, state) {
    var o = this.opts;
    var mm = score.measures[mIdx];
    var spm = mm.slots.length;
    var pad = 8;
    var inner = Math.max(16, w - pad * 2);
    var chordAt = {};
    for (var c = 0; c < mm.chords.length; c++) chordAt[mm.chords[c].slot] = mm.chords[c].name;

    var slotX = [];
    for (var s = 0; s < spm; s++) {
      var cx = x + pad + inner * (s / spm) + inner / (spm * 2);
      slotX.push(cx);

      if (state.playSlot != null && state.playSlot.m === mIdx && state.playSlot.s === s) {
        ctx.fillStyle = 'rgba(180,83,58,.13)';
        ctx.fillRect(cx - inner / (spm * 2), top - 6, inner / spm, o.stringGap * 5 + 12);
      }

      if (chordAt[s]) {
        ctx.font = '700 11px ui-monospace, monospace';
        ctx.fillStyle = C.accent;
        ctx.textAlign = 'center';
        ctx.fillText(chordAt[s], cx, top - 14);
      }

      var cells = mm.slots[s];
      for (var st = 0; st < 6; st++) {
        var cell = cells[st];
        var ly = top + st * o.stringGap;
        var selected = state.sel && state.sel.m === mIdx && state.sel.s === s && state.sel.str === st;
        if (selected) {
          ctx.fillStyle = C.selBg;
          ctx.fillRect(cx - 9, ly - 8, 18, 16);
          ctx.strokeStyle = C.sel; ctx.lineWidth = 1.2;
          ctx.strokeRect(cx - 9.5, ly - 8.5, 19, 17);
        }
        if (!cell) continue;
        var txt = String(cell.fret);
        ctx.font = '600 ' + o.fretSize + 'px ui-monospace, Menlo, monospace';
        var tw = ctx.measureText(txt).width;
        ctx.fillStyle = C.paper;
        ctx.fillRect(cx - tw / 2 - 2, ly - o.fretSize * 0.55, tw + 4, o.fretSize * 1.1);
        ctx.fillStyle = cell.conf < 0.34 ? C.low : C.ink;
        ctx.textAlign = 'center';
        ctx.fillText(txt, cx, ly + 0.5);
        if (cell.tech) {
          ctx.font = 'italic 9px ui-monospace, monospace';
          ctx.fillStyle = C.accent;
          ctx.textAlign = 'left';
          ctx.fillText(cell.tech, cx + tw / 2 + 2, ly - 3);
        }
      }
    }
    return { mIdx: mIdx, x: x, w: w, slotX: slotX, top: top };
  };

  function barline(ctx, x, top, staffH, lw) {
    ctx.strokeStyle = '#33302a';
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x + 0.5, top); ctx.lineTo(x + 0.5, top + staffH); ctx.stroke();
  }

  /* 캔버스 좌표 → {m, s, str} */
  Renderer.prototype.hitTest = function (px, py) {
    var L = this.layout;
    if (!L) return null;
    var gap = L.stringGap;
    for (var i = 0; i < L.systems.length; i++) {
      var sys = L.systems[i];
      if (py < sys.top - 18 || py > sys.top + L.staffH + 18) continue;
      var str = Math.round((py - sys.top) / gap);
      if (str < 0) str = 0; if (str > 5) str = 5;
      for (var m = 0; m < sys.measures.length; m++) {
        var mea = sys.measures[m];
        if (px < mea.x || px > mea.x + mea.w) continue;
        var best = 0, bd = Infinity;
        for (var s = 0; s < mea.slotX.length; s++) {
          var d = Math.abs(px - mea.slotX[s]);
          if (d < bd) { bd = d; best = s; }
        }
        return { m: mea.mIdx, s: best, str: str };
      }
    }
    return null;
  };

  GT.Render = { Renderer: Renderer, colors: C };
})(window.GT = window.GT || {});
