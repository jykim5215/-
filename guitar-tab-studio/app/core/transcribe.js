/* transcribe.js — 채보 엔진 (온셋 · 템포 · 다중음고 · 노트 트래킹 · 조성 · 코드)
   window.GT.Transcribe
   외부 의존성 없음. 긴 곡에서도 UI가 멈추지 않도록 블록 단위로 비동기 처리. */
(function (GT) {
  'use strict';

  var FRAME = 4096;
  var HOP = 512;
  var MIN_MIDI = 40;   // E2 (6번줄 개방)
  var MAX_MIDI = 88;   // E6
  var NPITCH = MAX_MIDI - MIN_MIDI + 1;
  var HARMONICS = 8;
  var HARM_DECAY = 0.84;

  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function midiToName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  function yieldUI() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  /* ── 스펙트럼 화이트닝: 이동평균 배경을 빼서 피크를 강조 ── */
  function whiten(mag, out, halfWin) {
    var n = mag.length, i, sum = 0, cnt = 0;
    // 누적합으로 O(n)
    var cum = whiten._cum;
    if (!cum || cum.length !== n + 1) cum = whiten._cum = new Float64Array(n + 1);
    cum[0] = 0;
    for (i = 0; i < n; i++) cum[i + 1] = cum[i] + mag[i];
    for (i = 0; i < n; i++) {
      var a = i - halfWin; if (a < 0) a = 0;
      var b = i + halfWin; if (b > n - 1) b = n - 1;
      var bg = (cum[b + 1] - cum[a]) / (b - a + 1);
      var v = mag[i] - bg * 1.0;
      out[i] = v > 0 ? v : 0;
    }
  }

  /* ── 피치별 하모닉 살리언스 ── */
  function buildPitchBins(rate) {
    var bins = [], p, h;
    for (p = 0; p < NPITCH; p++) {
      var f0 = midiToFreq(MIN_MIDI + p);
      var arr = [];
      for (h = 1; h <= HARMONICS; h++) {
        var f = f0 * h;
        if (f > rate / 2 - 50) break;
        var c = f * FRAME / rate;
        var w = Math.max(1, Math.round(c * 0.030));
        arr.push([Math.max(0, Math.round(c - w)), Math.min(FRAME / 2, Math.round(c + w)), Math.pow(HARM_DECAY, h - 1)]);
      }
      bins.push(arr);
    }
    return bins;
  }

  function salienceAll(spec, pitchBins, out) {
    for (var p = 0; p < NPITCH; p++) {
      var hs = pitchBins[p], s = 0;
      for (var h = 0; h < hs.length; h++) {
        var lo = hs[h][0], hi = hs[h][1], m = 0;
        for (var b = lo; b <= hi; b++) if (spec[b] > m) m = spec[b];
        s += m * hs[h][2];
      }
      out[p] = s;
    }
  }

  /* 선택된 피치의 하모닉 성분을 스펙트럼에서 제거(옥타브 유령음 억제) */
  function subtractHarmonics(spec, pitchBins, p) {
    var hs = pitchBins[p];
    for (var h = 0; h < hs.length; h++) {
      var lo = hs[h][0], hi = hs[h][1];
      for (var b = lo; b <= hi; b++) spec[b] *= 0.15;
    }
  }

  /* ── 온셋 엔벨로프에서 템포 추정 ── */
  function estimateTempo(flux, frameRate) {
    var n = flux.length;
    if (n < 20) return { bpm: 100, beats: [] };
    var mean = 0, i;
    for (i = 0; i < n; i++) mean += flux[i];
    mean /= n;
    var x = new Float32Array(n);
    for (i = 0; i < n; i++) x[i] = Math.max(0, flux[i] - mean);

    var minBpm = 45, maxBpm = 210;
    var minLag = Math.max(2, Math.floor(frameRate * 60 / maxBpm));
    var maxLag = Math.min(n - 1, Math.ceil(frameRate * 60 / minBpm));
    var bestLag = minLag, bestVal = -1;
    for (var lag = minLag; lag <= maxLag; lag++) {
      var s = 0;
      for (i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
      s /= (n - lag);
      // 사람이 흔히 느끼는 100~130 BPM 근처에 가벼운 가중치
      var bpm = 60 * frameRate / lag;
      var w = 1 - 0.35 * Math.abs(Math.log(bpm / 115) / Math.log(4));
      s *= Math.max(0.4, w);
      if (s > bestVal) { bestVal = s; bestLag = lag; }
    }
    var bpm = 60 * frameRate / bestLag;
    while (bpm < 60) bpm *= 2;
    while (bpm > 190) bpm /= 2;
    var lag = 60 * frameRate / bpm;

    // 위상(첫 박) 찾기
    var bestPhase = 0, bestScore = -1;
    for (var ph = 0; ph < Math.round(lag); ph++) {
      var sc = 0, c = 0;
      for (var t = ph; t < n; t += lag) { sc += x[Math.round(t)] || 0; c++; }
      if (c) { sc /= c; if (sc > bestScore) { bestScore = sc; bestPhase = ph; } }
    }
    var beats = [];
    for (var t2 = bestPhase; t2 < n; t2 += lag) beats.push(t2 / frameRate);
    return { bpm: Math.round(bpm * 10) / 10, beats: beats, phaseSec: bestPhase / frameRate };
  }

  /* ── 조성 추정 (Krumhansl-Schmuckler) ── */
  var MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function corr(a, b) {
    var n = 12, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return (da && db) ? num / Math.sqrt(da * db) : 0;
  }

  function detectKey(chroma) {
    var best = { score: -2, name: 'C', mode: 'major' };
    for (var r = 0; r < 12; r++) {
      var rot = [];
      for (var i = 0; i < 12; i++) rot[i] = chroma[(i + r) % 12];
      var cm = corr(rot, MAJ), cn = corr(rot, MIN);
      if (cm > best.score) best = { score: cm, name: NAMES[r], mode: 'major' };
      if (cn > best.score) best = { score: cn, name: NAMES[r], mode: 'minor' };
    }
    return best;
  }

  /* ── 코드 템플릿 ── */
  var CHORD_TYPES = [
    ['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]],
    ['m7', [0, 3, 7, 10]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
    ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['5', [0, 7]], ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]]
  ];

  function chordScore(chroma, total, r, t) {
    var iv = CHORD_TYPES[t][1], inSum = 0, i;
    for (i = 0; i < iv.length; i++) inSum += chroma[(r + iv[i]) % 12];
    var outSum = total - inSum;
    return inSum / total - 0.55 * (outSum / total) - 0.02 * iv.length;
  }

  /* 이름 → [root, typeIndex] */
  function parseChord(name) {
    if (!name) return null;
    for (var r = 0; r < 12; r++) {
      for (var t = 0; t < CHORD_TYPES.length; t++) {
        if (NAMES[r] + CHORD_TYPES[t][0] === name) return [r, t];
      }
    }
    return null;
  }

  function detectChordScored(chroma) {
    var best = null, bestScore = 0, total = 0, i;
    for (i = 0; i < 12; i++) total += chroma[i];
    if (total < 1e-6) return { name: null, score: 0 };
    for (var r = 0; r < 12; r++) {
      for (var t = 0; t < CHORD_TYPES.length; t++) {
        var score = chordScore(chroma, total, r, t);
        if (score > bestScore) { bestScore = score; best = NAMES[r] + CHORD_TYPES[t][0]; }
      }
    }
    return { name: bestScore > 0.12 ? best : null, score: bestScore, total: total };
  }

  function detectChord(chroma) { return detectChordScored(chroma).name; }

  /* ── 메인 분석 ───────────────────────────────────────────── */
  function analyze(samples, rate, opts, onProgress) {
    opts = opts || {};
    var polyphony = Math.max(1, Math.min(6, opts.polyphony || 4));
    var sensitivity = opts.sensitivity == null ? 0.5 : opts.sensitivity; // 0..1
    var minMidi = opts.minMidi || MIN_MIDI;
    var maxMidi = opts.maxMidi || MAX_MIDI;

    var nFrames = Math.max(1, Math.floor((samples.length - FRAME) / HOP) + 1);
    var frameRate = rate / HOP;
    var win = GT.FFT.hann(FRAME);
    var re = new Float32Array(FRAME), im = new Float32Array(FRAME);
    var mag = new Float32Array(FRAME / 2 + 1);
    var wsp = new Float32Array(FRAME / 2 + 1);
    var work = new Float32Array(FRAME / 2 + 1);
    var prevMag = new Float32Array(FRAME / 2 + 1);
    var pitchBins = buildPitchBins(rate);

    var sal = new Float32Array(NPITCH);
    var flux = new Float32Array(nFrames);
    var actStrength = new Float32Array(NPITCH * nFrames); // 프레임별 선택된 피치 세기
    var chromaAcc = new Float32Array(12);
    var chromaFrames = new Float32Array(12 * nFrames);

    var fluxLimit = Math.min(mag.length - 1, Math.floor(5000 * FRAME / rate));

    var f = 0;
    var BLOCK = 96;

    function step() {
      var end = Math.min(nFrames, f + BLOCK);
      for (; f < end; f++) {
        GT.FFT.frameMagnitude(samples, f * HOP, FRAME, win, mag, re, im);

        // 온셋 플럭스
        var fl = 0;
        for (var b = 1; b <= fluxLimit; b++) {
          var d = mag[b] - prevMag[b];
          if (d > 0) fl += d;
          prevMag[b] = mag[b];
        }
        flux[f] = fl;

        // 화이트닝 후 다중음고 추출
        whiten(mag, wsp, 24);
        work.set(wsp);
        var base = f * NPITCH;
        var frameTotal = 0;
        for (var k = 0; k < polyphony; k++) {
          salienceAll(work, pitchBins, sal);
          var bi = -1, bv = 0;
          for (var p = 0; p < NPITCH; p++) {
            var m = MIN_MIDI + p;
            if (m < minMidi || m > maxMidi) continue;
            if (sal[p] > bv) { bv = sal[p]; bi = p; }
          }
          if (bi < 0 || bv <= 0) break;
          if (k > 0 && bv < actStrength[base + 0] * 0.08) break;
          actStrength[base + bi] = bv;
          if (k === 0) frameTotal = bv;
          subtractHarmonics(work, pitchBins, bi);
        }
        // 크로마
        var cb = f * 12;
        for (var p2 = 0; p2 < NPITCH; p2++) {
          var v = actStrength[base + p2];
          if (v > 0) {
            var pc = (MIN_MIDI + p2) % 12;
            chromaFrames[cb + pc] += v;
            chromaAcc[pc] += v;
          }
        }
      }
      if (onProgress) onProgress(f / nFrames * 0.82, '오디오 분석 중… ' + Math.round(f / nFrames * 100) + '%');
      if (f < nFrames) return yieldUI().then(step);
      return Promise.resolve();
    }

    return step().then(function () {
      if (onProgress) onProgress(0.86, '박자와 음을 정리하는 중…');
      return yieldUI();
    }).then(function () {
      // 1) 템포 · 비트
      var tempo = estimateTempo(flux, frameRate);

      // 2) 온셋 피크 (노트 분할용)
      var onsets = pickOnsets(flux, frameRate, sensitivity);

      // 3) 활성도 임계값
      var vals = [];
      for (var i = 0; i < actStrength.length; i += 7) if (actStrength[i] > 0) vals.push(actStrength[i]);
      vals.sort(function (a, b) { return a - b; });
      var med = vals.length ? vals[Math.floor(vals.length * 0.55)] : 0;
      var thr = med * (0.55 + (1 - sensitivity) * 1.4);

      // 4) 노트 트래킹
      var notes = trackNotes(actStrength, nFrames, frameRate, thr, onsets);

      // 5) 조성 · 코드
      var key = detectKey(chromaAcc);
      var chords = chordsPerBeat(chromaFrames, nFrames, frameRate, tempo.beats);

      // 6) 신뢰도
      var conf = 0;
      for (var j = 0; j < notes.length; j++) conf += notes[j].conf;
      conf = notes.length ? conf / notes.length : 0;

      if (onProgress) onProgress(1, '분석 완료');
      return {
        notes: notes,
        bpm: tempo.bpm,
        beats: tempo.beats,
        key: key,
        chords: chords,
        confidence: conf,
        duration: samples.length / rate,
        frameRate: frameRate
      };
    });
  }

  function pickOnsets(flux, frameRate, sensitivity) {
    var n = flux.length, i;
    var sm = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      sm[i] = (flux[a] + flux[i] + flux[b]) / 3;
    }
    var W = Math.round(frameRate * 0.35);
    var out = [];
    var minGap = Math.round(frameRate * 0.055);
    var last = -1e9;
    for (i = 1; i < n - 1; i++) {
      var lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W), s = 0, c = 0;
      for (var j = lo; j <= hi; j += 2) { s += sm[j]; c++; }
      var localMean = c ? s / c : 0;
      var delta = localMean * (0.9 + (1 - sensitivity) * 1.6) + 1e-9;
      if (sm[i] > delta && sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1] && (i - last) > minGap) {
        out.push(i); last = i;
      }
    }
    return out;
  }

  function trackNotes(act, nFrames, frameRate, thr, onsets) {
    var onsetSet = {};
    for (var o = 0; o < onsets.length; o++) onsetSet[onsets[o]] = 1;
    var notes = [];
    var minFrames = Math.max(2, Math.round(frameRate * 0.06));
    var gapAllow = Math.max(1, Math.round(frameRate * 0.045));

    for (var p = 0; p < NPITCH; p++) {
      var f = 0;
      while (f < nFrames) {
        if (act[f * NPITCH + p] <= thr) { f++; continue; }
        var start = f, gap = 0, sum = 0, cnt = 0, peak = 0, last = f;
        while (f < nFrames) {
          var v = act[f * NPITCH + p];
          if (v > thr) { gap = 0; last = f; sum += v; cnt++; if (v > peak) peak = v; }
          else { gap++; if (gap > gapAllow) break; }
          // 강한 온셋에서 음이 다시 튀면 분리
          if (f > start + minFrames && onsetSet[f] && v > peak * 0.75 && act[(f - 1) * NPITCH + p] < v * 0.6) break;
          f++;
        }
        var len = last - start + 1;
        if (len >= minFrames && cnt > 0) {
          var mean = sum / cnt;
          notes.push({
            midi: MIN_MIDI + p,
            start: start / frameRate,
            dur: Math.max(0.06, len / frameRate),
            vel: Math.min(1, peak / (thr * 6) ),
            conf: Math.max(0.05, Math.min(1, (mean / (thr * 2.2)) * Math.min(1, len / (frameRate * 0.14))))
          });
        }
        f = Math.max(f, last + 1);
      }
    }
    notes.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });
    return notes;
  }

  /* 코드는 박마다 바뀌지 않는다. 2박 창으로 모으고, 직전 코드가 여전히 그럴듯하면
     유지한다(히스테리시스). 그래야 악보에 코드명이 난삽하게 찍히지 않는다. */
  function chordsPerBeat(chromaFrames, nFrames, frameRate, beats, beatsPerWindow) {
    var out = [];
    if (!beats || beats.length < 2) return out;
    var W = beatsPerWindow || 2;
    var prev = null;
    for (var i = 0; i < beats.length; i += W) {
      var s = Math.round(beats[i] * frameRate);
      var endBeat = (i + W < beats.length) ? beats[i + W] : beats[beats.length - 1] + (beats[1] - beats[0]);
      var e = Math.round(endBeat * frameRate);
      var acc = new Float32Array(12);
      for (var f = s; f < e && f < nFrames; f++)
        for (var c = 0; c < 12; c++) acc[c] += chromaFrames[f * 12 + c];

      var best = detectChordScored(acc);
      var pick = best.name;
      if (prev && best.name && best.name !== prev && best.total > 1e-6) {
        var pc = parseChord(prev);
        if (pc) {
          var prevScore = chordScore(acc, best.total, pc[0], pc[1]);
          // 새 후보가 확실히 낫지 않으면 직전 코드를 유지한다
          if (best.score < prevScore * 1.22) pick = prev;
        }
      }
      if (pick) prev = pick;
      out.push({ time: beats[i], chord: pick });
    }
    return out;
  }

  GT.Transcribe = {
    analyze: analyze,
    midiToName: midiToName,
    midiToFreq: midiToFreq,
    detectChord: detectChord,
    detectChordScored: detectChordScored,
    NAMES: NAMES,
    MIN_MIDI: MIN_MIDI,
    MAX_MIDI: MAX_MIDI
  };
})(window.GT = window.GT || {});
