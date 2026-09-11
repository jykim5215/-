/* tabmodel.js — 악보 데이터 모델(마디 · 슬롯 · 편집 연산) + ASCII 타브
   window.GT.TabModel
   슬롯 기반 모델: 한 마디 = slotsPerMeasure개의 시간 칸, 각 칸은 6줄 배열.
   이 구조 하나로 화면 렌더 · 편집 · PDF · ASCII · MIDI 를 모두 처리한다. */
(function (GT) {
  'use strict';

  var SUBDIV = 4; // 한 박당 칸 수 (16분음표)

  function slotsPerMeasure(timeSig) {
    var beats = timeSig[0];
    if (timeSig[1] === 8 && beats % 3 === 0) return beats * 2; // 6/8, 9/8 → 8분음표 칸
    return beats * SUBDIV;
  }

  function emptySlot() { return [null, null, null, null, null, null]; }

  function newMeasure(spm) {
    var slots = [], i;
    for (i = 0; i < spm; i++) slots.push(emptySlot());
    return { slots: slots, chords: [], section: null };
  }

  function uid() {
    return 'gts_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /* 채보 결과 → Score */
  function build(placed, meta, analysis) {
    meta = meta || {};
    var timeSig = meta.timeSig || [4, 4];
    var bpm = meta.bpm || (analysis && analysis.bpm) || 100;
    var spm = slotsPerMeasure(timeSig);
    var beatDur = 60 / bpm;
    var slotDur = (timeSig[1] === 8 && timeSig[0] % 3 === 0) ? beatDur / 2 : beatDur / SUBDIV;

    var beats = (analysis && analysis.beats) || [];
    var t0 = beats.length ? beats[0] : 0;
    // 첫 음이 첫 박보다 앞서면 기준을 당긴다
    if (placed.length && placed[0].start < t0) t0 = Math.max(0, placed[0].start - slotDur * 0.5);

    var maxIdx = 0, i;
    for (i = 0; i < placed.length; i++) {
      var idx = Math.round((placed[i].start - t0) / slotDur);
      if (idx > maxIdx) maxIdx = idx;
    }
    var nMeasures = Math.max(1, Math.ceil((maxIdx + 1) / spm));
    if (nMeasures > 400) nMeasures = 400;

    var measures = [];
    for (i = 0; i < nMeasures; i++) measures.push(newMeasure(spm));

    for (i = 0; i < placed.length; i++) {
      var n = placed[i];
      var gi = Math.round((n.start - t0) / slotDur);
      if (gi < 0) gi = 0;
      var m = Math.floor(gi / spm), s = gi % spm;
      if (m >= measures.length) continue;
      var slot = measures[m].slots[s];
      if (slot[n.string]) {
        // 같은 줄이 이미 차 있으면 다음 칸으로 밀거나, 신뢰도가 높으면 교체
        var moved = false;
        for (var d = 1; d <= 2; d++) {
          var gi2 = gi + d, m2 = Math.floor(gi2 / spm), s2 = gi2 % spm;
          if (m2 < measures.length && !measures[m2].slots[s2][n.string]) {
            measures[m2].slots[s2][n.string] = mkCell(n); moved = true; break;
          }
        }
        if (!moved && n.conf > slot[n.string].conf) slot[n.string] = mkCell(n);
      } else {
        slot[n.string] = mkCell(n);
      }
    }

    // 코드 이름 배치 (박 위치에만, 연속 중복 제거)
    var chordList = (analysis && analysis.chords) || [];
    var lastChord = null;
    for (i = 0; i < chordList.length; i++) {
      var c = chordList[i];
      if (!c.chord || c.chord === lastChord) { if (c.chord) lastChord = c.chord; continue; }
      lastChord = c.chord;
      var ci = Math.round((c.time - t0) / slotDur);
      var cm = Math.floor(ci / spm), cs = ci % spm;
      if (cm >= 0 && cm < measures.length) measures[cm].chords.push({ slot: cs, name: c.chord });
    }

    var score = {
      id: uid(),
      meta: {
        title: meta.title || '제목 없는 채보',
        artist: meta.artist || '',
        sourceUrl: meta.sourceUrl || '',
        tuning: meta.tuning || 'standard',
        capo: meta.capo || 0,
        bpm: Math.round(bpm),
        timeSig: timeSig,
        key: (analysis && analysis.key) ? (analysis.key.name + (analysis.key.mode === 'minor' ? 'm' : '')) : '',
        confidence: (analysis && analysis.confidence) || 0,
        duration: (analysis && analysis.duration) || 0,
        createdAt: Date.now(),
        note: ''
      },
      subdiv: SUBDIV,
      slotsPerMeasure: spm,
      measures: measures
    };
    trimEmpty(score);
    return score;
  }

  function mkCell(n) {
    return { fret: n.fret, conf: n.conf == null ? 1 : n.conf, tech: n.tech || '', vel: n.vel == null ? 0.8 : n.vel };
  }

  function measureIsEmpty(m) {
    for (var s = 0; s < m.slots.length; s++)
      for (var st = 0; st < 6; st++) if (m.slots[s][st]) return false;
    return true;
  }

  function trimEmpty(score) {
    while (score.measures.length > 1 && measureIsEmpty(score.measures[score.measures.length - 1]))
      score.measures.pop();
    while (score.measures.length > 1 && measureIsEmpty(score.measures[0]) && !score.measures[0].chords.length)
      score.measures.shift();
    return score;
  }

  function countNotes(score) {
    var n = 0;
    for (var m = 0; m < score.measures.length; m++)
      for (var s = 0; s < score.measures[m].slots.length; s++)
        for (var st = 0; st < 6; st++) if (score.measures[m].slots[s][st]) n++;
    return n;
  }

  function meanConfidence(score) {
    var n = 0, sum = 0;
    for (var m = 0; m < score.measures.length; m++)
      for (var s = 0; s < score.measures[m].slots.length; s++)
        for (var st = 0; st < 6; st++) {
          var c = score.measures[m].slots[s][st];
          if (c) { sum += c.conf; n++; }
        }
    return n ? sum / n : 0;
  }

  /* ── 편집 연산 ── */
  function getCell(score, m, s, str) {
    var mm = score.measures[m]; if (!mm) return null;
    var ss = mm.slots[s]; if (!ss) return null;
    return ss[str] || null;
  }
  function setCell(score, m, s, str, cell) {
    var mm = score.measures[m]; if (!mm) return;
    if (!mm.slots[s]) return;
    mm.slots[s][str] = cell;
  }
  function moveCell(score, from, to) {
    var c = getCell(score, from.m, from.s, from.str);
    if (!c) return false;
    setCell(score, from.m, from.s, from.str, null);
    setCell(score, to.m, to.s, to.str, c);
    return true;
  }
  function insertMeasure(score, at) {
    score.measures.splice(at, 0, newMeasure(score.slotsPerMeasure));
  }
  function deleteMeasure(score, at) {
    if (score.measures.length <= 1) return;
    score.measures.splice(at, 1);
  }

  /* 줄/프렛 → 실제 음(MIDI). 카포 포함. */
  function cellToMidi(score, str, fret) {
    var t = GT.Fretboard.TUNINGS[score.meta.tuning] || GT.Fretboard.TUNINGS.standard;
    return t.notes[str] + (score.meta.capo || 0) + fret;
  }

  /* 슬롯 단위 시간(초) */
  function slotDuration(score) {
    var ts = score.meta.timeSig;
    var beatDur = 60 / score.meta.bpm;
    return (ts[1] === 8 && ts[0] % 3 === 0) ? beatDur / 2 : beatDur / SUBDIV;
  }

  function totalSlots(score) { return score.measures.length * score.slotsPerMeasure; }

  /* ── ASCII 타브 ── */
  function toAscii(score, opts) {
    opts = opts || {};
    var perLine = opts.measuresPerLine || 4;
    var labels = GT.Fretboard.labelsFor(score.meta.tuning);
    var spm = score.slotsPerMeasure;
    var out = [];
    var m = score.meta;
    out.push(m.title + (m.artist ? ' — ' + m.artist : ''));
    out.push('튜닝: ' + (GT.Fretboard.TUNINGS[m.tuning] || {}).label + '  |  카포: ' + m.capo +
             '  |  ' + m.bpm + ' BPM  |  ' + m.timeSig[0] + '/' + m.timeSig[1] + (m.key ? '  |  Key ' + m.key : ''));
    if (m.sourceUrl) out.push('출처: ' + m.sourceUrl);
    out.push('');

    for (var start = 0; start < score.measures.length; start += perLine) {
      var end = Math.min(score.measures.length, start + perLine);
      var lines = ['', '', '', '', '', ''];
      var chordLine = '';
      for (var st = 0; st < 6; st++) lines[st] = pad(labels[st], 2) + '|';
      chordLine = '   ';
      for (var mi = start; mi < end; mi++) {
        var mm = score.measures[mi];
        var chordAt = {};
        for (var ci = 0; ci < mm.chords.length; ci++) chordAt[mm.chords[ci].slot] = mm.chords[ci].name;
        for (var s = 0; s < spm; s++) {
          var cells = mm.slots[s];
          var w = 1;
          for (var q = 0; q < 6; q++) if (cells[q]) {
            var txt = String(cells[q].fret) + (cells[q].tech || '');
            if (txt.length > w) w = txt.length;
          }
          for (var st2 = 0; st2 < 6; st2++) {
            var c = cells[st2];
            var t = c ? (String(c.fret) + (c.tech || '')) : '';
            lines[st2] += t ? padRight(t, w, '-') : rep('-', w);
            lines[st2] += '-';
          }
          var cname = chordAt[s] || '';
          chordLine = padRight(chordLine, chordLine.length, ' ');
          var target = 3 + lineWidthUpTo(score, start, mi, s, spm);
          while (chordLine.length < target) chordLine += ' ';
          if (cname) chordLine += cname;
        }
        for (var st3 = 0; st3 < 6; st3++) lines[st3] += '|';
      }
      out.push('마디 ' + (start + 1) + '–' + end);
      if (chordLine.trim()) out.push(chordLine);
      for (var k = 0; k < 6; k++) out.push(lines[k]);
      out.push('');
    }
    out.push('— 기타 탭 스튜디오로 채보. 개인 연습·학습용입니다. —');
    return out.join('\n');
  }

  function lineWidthUpTo(score, startM, mi, s, spm) {
    var w = 0;
    for (var m = startM; m <= mi; m++) {
      var lim = (m === mi) ? s : spm;
      for (var i = 0; i < lim; i++) {
        var cells = score.measures[m].slots[i], cw = 1;
        for (var q = 0; q < 6; q++) if (cells[q]) {
          var t = String(cells[q].fret) + (cells[q].tech || '');
          if (t.length > cw) cw = t.length;
        }
        w += cw + 1;
      }
      if (m < mi) w += 1;
    }
    return w;
  }

  function rep(ch, n) { var s = ''; for (var i = 0; i < n; i++) s += ch; return s; }
  function pad(s, n) { while (s.length < n) s = ' ' + s; return s; }
  function padRight(s, n, ch) { while (s.length < n) s += (ch || ' '); return s; }

  GT.TabModel = {
    SUBDIV: SUBDIV,
    build: build,
    newMeasure: newMeasure,
    slotsPerMeasure: slotsPerMeasure,
    emptySlot: emptySlot,
    mkCell: mkCell,
    getCell: getCell, setCell: setCell, moveCell: moveCell,
    insertMeasure: insertMeasure, deleteMeasure: deleteMeasure,
    measureIsEmpty: measureIsEmpty, trimEmpty: trimEmpty,
    countNotes: countNotes, meanConfidence: meanConfidence,
    cellToMidi: cellToMidi, slotDuration: slotDuration, totalSlots: totalSlots,
    toAscii: toAscii, uid: uid
  };
})(window.GT = window.GT || {});
