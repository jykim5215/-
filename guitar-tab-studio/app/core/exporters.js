/* exporters.js — ASCII 타브 / MIDI / 프로젝트 JSON 내보내기 + 다운로드 헬퍼
   window.GT.Export */
(function (GT) {
  'use strict';

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  function safeName(s) {
    return (s || 'tab').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /* ── MIDI (SMF format 0) ── */
  function vlq(n) {
    var bytes = [n & 0x7F];
    n >>= 7;
    while (n > 0) { bytes.unshift((n & 0x7F) | 0x80); n >>= 7; }
    return bytes;
  }

  function toMidi(score) {
    var TPQ = 480;
    var events = [];   // {tick, type:'on'|'off', midi, vel}
    var spm = score.slotsPerMeasure;
    var ticksPerSlot = Math.round(TPQ / score.subdiv);
    if (score.meta.timeSig[1] === 8 && score.meta.timeSig[0] % 3 === 0) ticksPerSlot = Math.round(TPQ / 2);

    for (var m = 0; m < score.measures.length; m++) {
      var mm = score.measures[m];
      for (var s = 0; s < mm.slots.length; s++) {
        var tick = (m * spm + s) * ticksPerSlot;
        for (var st = 0; st < 6; st++) {
          var cell = mm.slots[s][st];
          if (!cell) continue;
          var midi = GT.TabModel.cellToMidi(score, st, cell.fret);
          var vel = Math.max(24, Math.min(120, Math.round((cell.vel || 0.7) * 110)));
          events.push({ tick: tick, type: 'on', midi: midi, vel: vel });
          events.push({ tick: tick + ticksPerSlot * 3, type: 'off', midi: midi, vel: 0 });
        }
      }
    }
    events.sort(function (a, b) { return a.tick - b.tick || (a.type === 'off' ? -1 : 1); });

    var track = [];
    // 템포
    var usPerQuarter = Math.round(60000000 / score.meta.bpm);
    track = track.concat([0x00, 0xFF, 0x51, 0x03,
      (usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF]);
    // 박자표
    var den = score.meta.timeSig[1], denPow = Math.round(Math.log(den) / Math.LN2);
    track = track.concat([0x00, 0xFF, 0x58, 0x04, score.meta.timeSig[0], denPow, 24, 8]);
    // 음색: Acoustic Guitar (steel) = 25
    track = track.concat([0x00, 0xC0, 25]);

    var last = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var delta = e.tick - last; last = e.tick;
      track = track.concat(vlq(delta));
      track.push(e.type === 'on' ? 0x90 : 0x80, e.midi & 0x7F, e.vel & 0x7F);
    }
    track = track.concat([0x00, 0xFF, 0x2F, 0x00]);

    var header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (TPQ >> 8) & 0xFF, TPQ & 0xFF];
    var len = track.length;
    var trkHdr = [0x4D, 0x54, 0x72, 0x6B, (len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF];
    var all = header.concat(trkHdr, track);
    return new Uint8Array(all);
  }

  function exportAscii(score) {
    var txt = GT.TabModel.toAscii(score);
    download(new Blob([txt], { type: 'text/plain;charset=utf-8' }), safeName(score.meta.title) + '.txt');
  }
  function exportMidi(score) {
    download(new Blob([toMidi(score)], { type: 'audio/midi' }), safeName(score.meta.title) + '.mid');
  }
  function exportJson(score) {
    var data = JSON.stringify({ format: 'guitar-tab-studio', version: 1, score: score }, null, 1);
    download(new Blob([data], { type: 'application/json' }), safeName(score.meta.title) + '.json');
  }
  function exportPdf(score, opts) {
    download(GT.PDF.exportScore(score, opts), safeName(score.meta.title) + '.pdf');
  }
  function exportBookPdf(scores, book, opts) {
    download(GT.PDF.exportBook(scores, book, opts), safeName(book.title || '기타 타브 악보집') + '.pdf');
  }

  function importJson(text) {
    var o = JSON.parse(text);
    var score = o.score || o;
    if (!score.measures || !score.meta) throw new Error('이 앱의 프로젝트 파일이 아닙니다.');
    if (!score.id) score.id = GT.TabModel.uid();
    return score;
  }

  GT.Export = {
    download: download, safeName: safeName, toMidi: toMidi,
    exportAscii: exportAscii, exportMidi: exportMidi, exportJson: exportJson,
    exportPdf: exportPdf, exportBookPdf: exportBookPdf, importJson: importJson
  };
})(window.GT = window.GT || {});
