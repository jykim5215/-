/* fretboard.js — 음(MIDI) → 기타 지판(줄, 프렛) 배정
   window.GT.Fretboard
   설계: 그리디가 아니라 DP(비터비). 손 위치가 지판 끝으로 튀는 것을 막는다.
   줄 인덱스 0 = 1번줄(가장 얇은 e) … 5 = 6번줄(가장 굵은 E). */
(function (GT) {
  'use strict';

  var TUNINGS = {
    'standard':   { label: 'Standard (EADGBe)', notes: [64, 59, 55, 50, 45, 40] },
    'dropd':      { label: 'Drop D (DADGBe)',   notes: [64, 59, 55, 50, 45, 38] },
    'halfstep':   { label: '반음 내림 (Eb)',     notes: [63, 58, 54, 49, 44, 39] },
    'fullstep':   { label: '한음 내림 (D)',      notes: [62, 57, 53, 48, 43, 38] },
    'dadgad':     { label: 'DADGAD',            notes: [62, 57, 55, 50, 45, 38] },
    'openg':      { label: 'Open G (DGDGBD)',   notes: [62, 59, 55, 50, 43, 38] },
    'opend':      { label: 'Open D (DADF#AD)',  notes: [62, 57, 54, 50, 45, 38] },
    'opene':      { label: 'Open E (EBEG#BE)',  notes: [64, 59, 56, 52, 47, 40] },
    'openc':      { label: 'Open C (CGCGCE)',   notes: [64, 60, 55, 48, 43, 36] }
  };

  var STRING_LABELS = {
    'standard': ['e', 'B', 'G', 'D', 'A', 'E'],
    'dropd':    ['e', 'B', 'G', 'D', 'A', 'D'],
    'halfstep': ['eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb'],
    'fullstep': ['d', 'A', 'F', 'C', 'G', 'D'],
    'dadgad':   ['d', 'A', 'G', 'D', 'A', 'D'],
    'openg':    ['d', 'B', 'G', 'D', 'G', 'D'],
    'opend':    ['d', 'A', 'F#', 'D', 'A', 'D'],
    'opene':    ['e', 'B', 'G#', 'E', 'B', 'E'],
    'openc':    ['e', 'C', 'G', 'C', 'G', 'C']
  };

  function labelsFor(tuningKey) {
    return STRING_LABELS[tuningKey] || STRING_LABELS.standard;
  }

  /* 동시에 울리는 음끼리 묶기 */
  function groupNotes(notes, tolSec) {
    var groups = [], cur = null;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (cur && (n.start - cur.time) <= tolSec) cur.notes.push(n);
      else { cur = { time: n.start, notes: [n] }; groups.push(cur); }
    }
    return groups;
  }

  /* 한 그룹에 대한 가능한 (줄,프렛) 배정 후보들 */
  function groupCandidates(group, tuning, capo, maxFret, limit) {
    var notes = group.notes.slice(0, 6);
    var perNote = [];
    for (var i = 0; i < notes.length; i++) {
      var opts = [];
      for (var s = 0; s < 6; s++) {
        var fret = notes[i].midi - tuning[s] - capo;
        if (fret >= 0 && fret <= maxFret) opts.push({ string: s, fret: fret });
      }
      if (!opts.length) return [];             // 이 튜닝/카포로 낼 수 없는 음
      perNote.push(opts);
    }

    var results = [];
    var used = {};
    var pick = new Array(notes.length);

    function fretsOf(k) {
      var fs = [];
      for (var j = 0; j < k; j++) if (pick[j].fret > 0) fs.push(pick[j].fret);
      return fs;
    }

    function dfs(i) {
      if (results.length >= limit * 6) return;
      if (i === notes.length) {
        var fs = fretsOf(notes.length);
        var lo = Infinity, hi = -Infinity, sum = 0;
        for (var j = 0; j < fs.length; j++) { if (fs[j] < lo) lo = fs[j]; if (fs[j] > hi) hi = fs[j]; sum += fs[j]; }
        var span = fs.length ? hi - lo : 0;
        if (span > 5) return;                         // 손이 닿지 않는 배치 제외
        var center = fs.length ? sum / fs.length : 0;
        var openBonus = 0;
        for (var k2 = 0; k2 < notes.length; k2++) if (pick[k2].fret === 0) openBonus += 0.6;
        var cost = span * 1.2 + center * 0.10 - openBonus;
        results.push({ assign: pick.slice(), center: center, cost: cost, span: span });
        return;
      }
      var opts = perNote[i];
      for (var o = 0; o < opts.length; o++) {
        var c = opts[o];
        if (used[c.string]) continue;
        used[c.string] = 1; pick[i] = c;
        dfs(i + 1);
        used[c.string] = 0;
      }
    }
    dfs(0);
    results.sort(function (a, b) { return a.cost - b.cost; });
    return results.slice(0, limit);
  }

  /* 메인: 노트 배열 → (줄,프렛) 배정 */
  function place(notes, options) {
    options = options || {};
    var tuningKey = options.tuning || 'standard';
    var tuning = (TUNINGS[tuningKey] || TUNINGS.standard).notes;
    var capo = options.capo || 0;
    var maxFret = options.maxFret || 17;
    var preferLow = options.preferLow == null ? 1 : options.preferLow;

    var groups = groupNotes(notes, 0.045);
    var cands = [], unplayable = 0, gi;
    for (gi = 0; gi < groups.length; gi++) {
      var c = groupCandidates(groups[gi], tuning, capo, maxFret, 8);
      if (!c.length) {
        // 음역 밖 → 옥타브 이동으로 구제
        var g = groups[gi];
        for (var n = 0; n < g.notes.length; n++) {
          while (g.notes[n].midi < tuning[5] + capo) { g.notes[n].midi += 12; g.notes[n].octShift = 1; }
          while (g.notes[n].midi > tuning[0] + capo + maxFret) { g.notes[n].midi -= 12; g.notes[n].octShift = -1; }
        }
        c = groupCandidates(g, tuning, capo, maxFret, 8);
        if (!c.length) { unplayable++; c = []; }
      }
      cands.push(c);
    }

    // 비터비
    var prevCosts = null, prevIdx = [], back = [];
    for (gi = 0; gi < cands.length; gi++) {
      var list = cands[gi];
      if (!list.length) { back.push(null); continue; }
      var costs = new Float64Array(list.length);
      var bp = new Int32Array(list.length);
      for (var a = 0; a < list.length; a++) {
        var local = list[a].cost + preferLow * list[a].center * 0.06;
        if (!prevCosts) { costs[a] = local; bp[a] = -1; continue; }
        var best = Infinity, bi = 0;
        for (var b2 = 0; b2 < prevCosts.length; b2++) {
          var move = Math.abs(list[a].center - prevIdx[b2].center);
          var trans = move * 0.55 + (move > 4 ? 1.8 : 0);
          var t = prevCosts[b2] + trans;
          if (t < best) { best = t; bi = b2; }
        }
        costs[a] = local + best; bp[a] = bi;
      }
      back.push({ costs: costs, bp: bp, list: list });
      prevCosts = costs; prevIdx = list;
    }

    // 역추적
    var chosen = new Array(cands.length);
    var lastIdx = -1;
    for (gi = cands.length - 1; gi >= 0; gi--) {
      var node = back[gi];
      if (!node) { chosen[gi] = null; lastIdx = -1; continue; }
      var idx;
      if (lastIdx < 0) {
        idx = 0; var bv = Infinity;
        for (var z = 0; z < node.costs.length; z++) if (node.costs[z] < bv) { bv = node.costs[z]; idx = z; }
      } else idx = lastIdx;
      chosen[gi] = node.list[idx];
      lastIdx = node.bp[idx];
    }

    var placed = [];
    for (gi = 0; gi < groups.length; gi++) {
      var ch = chosen[gi];
      if (!ch) continue;
      var gnotes = groups[gi].notes;
      for (var m = 0; m < ch.assign.length; m++) {
        var src = gnotes[m];
        placed.push({
          midi: src.midi, start: src.start, dur: src.dur, vel: src.vel, conf: src.conf,
          string: ch.assign[m].string, fret: ch.assign[m].fret, tech: ''
        });
      }
    }
    placed.sort(function (x, y) { return x.start - y.start || x.string - y.string; });
    return { notes: placed, unplayableGroups: unplayable };
  }

  /* 이어지는 같은 줄의 음에 해머온/풀오프/슬라이드 표시를 붙인다 */
  function markTechniques(placed) {
    for (var i = 1; i < placed.length; i++) {
      var a = placed[i - 1], b = placed[i];
      if (a.string !== b.string) continue;
      var gap = b.start - (a.start + a.dur);
      if (gap > 0.06 || b.start - a.start > 0.5) continue;
      var d = b.fret - a.fret;
      if (d === 0 || a.fret === 0) continue;
      if (Math.abs(d) <= 2 && b.vel < a.vel * 0.85) b.tech = d > 0 ? 'h' : 'p';
      else if (Math.abs(d) >= 3 && Math.abs(d) <= 7 && b.vel < a.vel * 0.8) b.tech = d > 0 ? '/' : '\\';
    }
    return placed;
  }

  GT.Fretboard = {
    TUNINGS: TUNINGS,
    labelsFor: labelsFor,
    place: place,
    markTechniques: markTechniques
  };
})(window.GT = window.GT || {});
