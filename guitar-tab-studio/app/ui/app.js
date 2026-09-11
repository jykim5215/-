/* app.js — 화면 조립 · 상태 · 이벤트 배선
   window.GT 의 코어 모듈들을 묶어 실제 앱으로 만든다. */
(function (GT) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var S = {
    step: 1,
    audio: null,          // {samples, rate, duration, label}
    analysis: null,       // 채보 엔진 결과 (재배치·재양자화에 재사용)
    score: null,
    sel: null,            // {m,s,str}
    library: [],
    checked: {},          // 악보집에 넣을 곡 id
    recorder: null,
    recStart: 0,
    recTimer: 0,
    loop: false,
    speed: 1,
    metro: false,
    dirtyTimer: 0
  };

  var renderer, player;

  /* ───────── 토스트 ───────── */
  function toast(msg, kind, ms) {
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, ms || 3200);
  }

  /* ───────── 모달 ───────── */
  function openModal(id) { $(id).classList.add('show'); }
  function closeModal(id) { $(id).classList.remove('show'); }
  function wireModals() {
    var masks = document.querySelectorAll('.mask');
    Array.prototype.forEach.call(masks, function (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m || e.target.hasAttribute('data-close')) m.classList.remove('show');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        Array.prototype.forEach.call(document.querySelectorAll('.mask.show'), function (m) {
          m.classList.remove('show');
        });
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () {
        var parent = t.parentNode;
        Array.prototype.forEach.call(parent.querySelectorAll('.tab'), function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        var modal = t.closest('.modal');
        Array.prototype.forEach.call(modal.querySelectorAll('.pane'), function (p) { p.classList.remove('on'); });
        $(t.getAttribute('data-pane')).classList.add('on');
      });
    });
  }

  /* ───────── 셀렉트 채우기 ───────── */
  function fillSelects() {
    var tunings = GT.Fretboard.TUNINGS;
    ['mTuning', 'aTuning', 'sTuning'].forEach(function (id) {
      var el = $(id); el.innerHTML = '';
      for (var k in tunings) if (tunings.hasOwnProperty(k)) {
        var o = document.createElement('option');
        o.value = k; o.textContent = tunings[k].label;
        el.appendChild(o);
      }
    });
    ['mCapo', 'aCapo'].forEach(function (id) {
      var el = $(id); el.innerHTML = '';
      for (var i = 0; i <= 12; i++) {
        var o = document.createElement('option');
        o.value = String(i); o.textContent = i === 0 ? '없음' : i + '프렛';
        el.appendChild(o);
      }
    });
    var ns = $('nString'); ns.innerHTML = '';
    for (var j = 0; j < 6; j++) {
      var o2 = document.createElement('option');
      o2.value = String(j); o2.textContent = (j + 1) + '번 줄';
      ns.appendChild(o2);
    }
  }

  /* ───────── 단계 ───────── */
  function setStep(n) {
    S.step = n;
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (b) {
      var v = +b.getAttribute('data-step');
      b.classList.toggle('on', v === n);
      b.classList.toggle('done', v < n);
      b.disabled = (v === 2 && !S.audio) || ((v === 3 || v === 4) && !S.score);
    });
    $('welcome').hidden = !(n === 1 && !S.score);
    $('progress').hidden = true;
    $('scoreView').hidden = !S.score || n === 1 && !S.score;
    if (S.score) { $('welcome').hidden = true; $('scoreView').hidden = false; }
  }

  /* ───────── 가져오기 ───────── */
  function openImport() {
    $('capUnsupported').hidden = GT.Audio.captureSupported();
    $('btnCapture').disabled = !GT.Audio.captureSupported();
    openModal('mImport');
  }

  function startCapture() {
    if (S.recorder) return stopCapture();
    var rec = new GT.Audio.Recorder();
    rec.onLevel = function (v) { $('recLevel').style.width = Math.min(100, v * 160) + '%'; };
    rec.onStop = function (blob) {
      S.recorder = null;
      clearInterval(S.recTimer);
      $('btnCapture').textContent = '캡처 시작';
      $('recTime').hidden = $('recLevelWrap').hidden = $('recNote').hidden = true;
      closeModal('mImport');
      toast('녹음을 읽는 중…');
      GT.Audio.fromBlob(blob).then(function (a) {
        a.label = '탭 오디오 캡처';
        onAudioReady(a);
      }).catch(function (e) { toast(e.message || '녹음을 처리하지 못했습니다.', 'err', 5000); });
    };
    rec.start().then(function () {
      S.recorder = rec;
      S.recStart = Date.now();
      $('btnCapture').textContent = '■ 정지하고 분석';
      $('recTime').hidden = $('recLevelWrap').hidden = $('recNote').hidden = false;
      S.recTimer = setInterval(function () {
        var t = Math.floor((Date.now() - S.recStart) / 1000);
        $('recTime').textContent = pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
        if (t > 15 * 60) stopCapture();
      }, 250);
      toast('녹음 중입니다. 영상을 처음부터 재생하세요.', 'ok', 4200);
    }).catch(function (e) {
      toast(e.message || '캡처를 시작하지 못했습니다.', 'err', 5200);
    });
  }
  function stopCapture() { if (S.recorder) S.recorder.stop(); }

  function handleFile(file) {
    if (!file) return;
    closeModal('mImport');
    toast('파일을 읽는 중…');
    GT.Audio.fromFile(file).then(function (a) {
      a.label = file.name;
      onAudioReady(a);
    }).catch(function (e) {
      toast(e.message || '이 파일은 열지 못했습니다.', 'err', 5000);
    });
  }

  function onAudioReady(a) {
    S.audio = a;
    S.analysis = null;
    toast('오디오 준비 완료 · ' + fmtTime(a.duration), 'ok');
    setStep(2);
    $('aTuning').value = getPref('tuning', 'standard');
    openModal('mAnalyze');
  }

  /* ───────── 분석 ───────── */
  function runAnalyze() {
    if (!S.audio) { toast('먼저 소리를 가져와주세요.', 'err'); return; }
    closeModal('mAnalyze');
    setStep(2);
    $('welcome').hidden = true;
    $('scoreView').hidden = true;
    $('progress').hidden = false;
    $('progTitle').textContent = '분석 중…';
    $('progBar').style.width = '0%';

    var tuning = $('aTuning').value;
    var capo = +$('aCapo').value;
    var poly = +$('aPoly').value;
    var sens = +$('aSens').value;
    var ts = $('aTime').value.split('/').map(Number);

    var opts = { polyphony: poly, sensitivity: sens };
    // 튜닝·카포에 맞춰 탐색할 음역을 좁힌다
    var tun = (GT.Fretboard.TUNINGS[tuning] || GT.Fretboard.TUNINGS.standard).notes;
    opts.minMidi = Math.min.apply(null, tun) + capo;
    opts.maxMidi = Math.max.apply(null, tun) + capo + 19;

    setTimeout(function () {
      GT.Transcribe.analyze(S.audio.samples, S.audio.rate, opts, function (p, msg) {
        $('progBar').style.width = Math.round(p * 100) + '%';
        if (msg) $('progMsg').textContent = msg;
      }).then(function (res) {
        S.analysis = res;
        if (!res.notes.length) {
          $('progress').hidden = true;
          setStep(2);
          toast('음을 찾지 못했습니다. 감도를 높이거나 기타 소리가 뚜렷한 구간으로 다시 시도해보세요.', 'err', 6000);
          return;
        }
        buildScoreFromAnalysis({ tuning: tuning, capo: capo, timeSig: ts, title: guessTitle() });
        $('progress').hidden = true;
        setStep(3);
        toast(GT.TabModel.countNotes(S.score) + '개의 음을 찾았습니다.', 'ok');
        saveCurrent();
      }).catch(function (e) {
        $('progress').hidden = true;
        setStep(2);
        toast('분석 중 문제가 생겼습니다: ' + (e.message || e), 'err', 6000);
      });
    }, 60);
  }

  function guessTitle() {
    if (!S.audio || !S.audio.label) return '제목 없는 채보';
    if (S.audio.label === '탭 오디오 캡처') return '제목 없는 채보';
    return S.audio.label.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 70);
  }

  function buildScoreFromAnalysis(meta) {
    var res = S.analysis;
    var placed = GT.Fretboard.place(res.notes, { tuning: meta.tuning, capo: meta.capo });
    GT.Fretboard.markTechniques(placed.notes);
    var keep = S.score ? S.score.meta : null;
    S.score = GT.TabModel.build(placed.notes, {
      title: meta.title || (keep ? keep.title : '제목 없는 채보'),
      artist: keep ? keep.artist : '',
      sourceUrl: keep ? keep.sourceUrl : '',
      tuning: meta.tuning, capo: meta.capo,
      bpm: meta.bpm || res.bpm,
      timeSig: meta.timeSig
    }, res);
    if (keep && keep.note) S.score.meta.note = keep.note;
    if (keep && keep.id) S.score.id = keep.id;
    S.sel = null;
    refreshAll();
  }

  /* ───────── 화면 갱신 ───────── */
  function refreshAll() {
    var sc = S.score;
    if (!sc) { $('btnExport').disabled = true; $('btnPlay').disabled = true; return; }
    $('btnExport').disabled = false;
    $('btnPlay').disabled = false;

    $('shTitle').textContent = sc.meta.title || '제목 없는 채보';
    $('shArtist').textContent = sc.meta.artist || '';
    var tun = GT.Fretboard.TUNINGS[sc.meta.tuning];
    var meta = [];
    meta.push(tun ? tun.label : sc.meta.tuning);
    meta.push(sc.meta.capo ? 'CAPO ' + sc.meta.capo : 'CAPO 없음');
    meta.push('♩= ' + sc.meta.bpm);
    meta.push(sc.meta.timeSig.join('/'));
    if (sc.meta.key) meta.push('KEY ' + sc.meta.key.toUpperCase());
    $('shMeta').textContent = meta.join(' · ');
    $('shCount').textContent = sc.measures.length + '마디 · ' + GT.TabModel.countNotes(sc) + '음';

    $('mTitle').value = sc.meta.title || '';
    $('mArtist').value = sc.meta.artist || '';
    $('mSource').value = sc.meta.sourceUrl || '';
    $('mTuning').value = sc.meta.tuning;
    $('mCapo').value = String(sc.meta.capo);
    $('mBpm').value = sc.meta.bpm;
    $('mTime').value = sc.meta.timeSig.join('/');
    $('mNote').value = sc.meta.note || '';

    var conf = GT.TabModel.meanConfidence(sc);
    $('confBar').style.width = Math.round(conf * 100) + '%';
    $('confVal').textContent = Math.round(conf * 100) + '%';
    $('confVal').style.color = conf > 0.6 ? 'var(--ok)' : (conf > 0.35 ? 'var(--accent)' : 'var(--warn)');

    renderer.setScore(sc);
    renderer.draw({ sel: S.sel });
    updateSelUI();
    updateTime(0);
  }

  function updateSelUI() {
    var c = S.sel ? GT.TabModel.getCell(S.score, S.sel.m, S.sel.s, S.sel.str) : null;
    $('nString').value = S.sel ? String(S.sel.str) : '0';
    $('nFret').value = c ? c.fret : '';
    $('nTech').value = c ? (c.tech || '') : '';
  }

  /* ───────── 악보집(라이브러리) ───────── */
  function loadLibrary() {
    return GT.Library.all().then(function (arr) {
      S.library = arr;
      renderLibrary();
      return arr;
    });
  }

  function renderLibrary() {
    var box = $('songs');
    box.innerHTML = '';
    $('libTitle').textContent = '악보집 목차 · ' + S.library.length + '곡';
    if (!S.library.length) {
      var d = document.createElement('div');
      d.className = 'empty-rail';
      d.textContent = '아직 채보한 곡이 없습니다. 소리를 가져오면 여기에 쌓입니다.';
      box.appendChild(d);
      $('btnBook').disabled = true;
      return;
    }
    S.library.forEach(function (sc, i) {
      var row = document.createElement('div');
      row.className = 'song' + (S.score && S.score.id === sc.id ? ' on' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!S.checked[sc.id];
      cb.addEventListener('click', function (e) {
        e.stopPropagation();
        S.checked[sc.id] = cb.checked;
        updateBookBtn();
      });
      var num = document.createElement('span'); num.className = 'num'; num.textContent = (i + 1);
      var t = document.createElement('span'); t.className = 't'; t.textContent = sc.meta.title || '제목 없음';
      var x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = '삭제';
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('“' + (sc.meta.title || '제목 없음') + '”을(를) 목록에서 지울까요?')) return;
        GT.Library.remove(sc.id).then(function () {
          delete S.checked[sc.id];
          if (S.score && S.score.id === sc.id) { S.score = null; S.sel = null; setStep(1); refreshAll(); }
          loadLibrary();
          toast('삭제했습니다.');
        });
      });
      var sub = document.createElement('div'); sub.className = 's';
      var tun = GT.Fretboard.TUNINGS[sc.meta.tuning];
      sub.textContent = (tun ? tun.label.replace(/\s*\(.*\)/, '') : sc.meta.tuning) +
        (sc.meta.capo ? ' · Capo ' + sc.meta.capo : '') + ' · ' + sc.meta.bpm + ' BPM · ' +
        sc.measures.length + '마디';
      row.appendChild(cb); row.appendChild(num); row.appendChild(t); row.appendChild(x); row.appendChild(sub);
      row.addEventListener('click', function () { openScore(sc); });
      box.appendChild(row);
    });
    updateBookBtn();
  }

  function updateBookBtn() {
    var n = 0;
    for (var k in S.checked) if (S.checked[k]) n++;
    $('btnBook').disabled = n === 0;
    $('btnBook').textContent = n ? ('선택 ' + n + '곡 → 악보집 PDF 엮기') : '선택한 곡 → 악보집 PDF 엮기';
  }

  function openScore(sc) {
    player.stop();
    S.score = sc;
    S.analysis = null;   // 저장된 악보는 원본 오디오 없이 편집만 가능
    S.sel = null;
    setStep(3);
    refreshAll();
    renderLibrary();
  }

  function saveCurrent() {
    if (!S.score) return Promise.resolve();
    return GT.Library.put(S.score).then(loadLibrary);
  }
  function saveSoon() {
    clearTimeout(S.dirtyTimer);
    S.dirtyTimer = setTimeout(saveCurrent, 700);
  }

  /* ───────── 편집 ───────── */
  function wireCanvas() {
    var cv = $('tabCanvas');
    cv.addEventListener('click', function (e) {
      if (!S.score) return;
      var r = cv.getBoundingClientRect();
      var hit = renderer.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (!hit) return;
      S.sel = hit;
      renderer.draw({ sel: S.sel });
      updateSelUI();
      var c = GT.TabModel.getCell(S.score, hit.m, hit.s, hit.str);
      if (c) player.preview(GT.TabModel.cellToMidi(S.score, hit.str, c.fret));
    });
  }

  function editFret(delta, absolute) {
    if (!S.score || !S.sel) return;
    var c = GT.TabModel.getCell(S.score, S.sel.m, S.sel.s, S.sel.str);
    var nf;
    if (absolute != null) nf = absolute;
    else if (!c) return;
    else nf = c.fret + delta;
    if (nf < 0) nf = 0; if (nf > 24) nf = 24;
    if (c) c.fret = nf; else GT.TabModel.setCell(S.score, S.sel.m, S.sel.s, S.sel.str,
      GT.TabModel.mkCell({ fret: nf, conf: 1, vel: 0.8 }));
    var cell = GT.TabModel.getCell(S.score, S.sel.m, S.sel.s, S.sel.str);
    cell.conf = 1;
    renderer.draw({ sel: S.sel });
    updateSelUI();
    player.preview(GT.TabModel.cellToMidi(S.score, S.sel.str, nf));
    saveSoon();
  }

  function moveString(d) {
    if (!S.score || !S.sel) return;
    var to = S.sel.str + d;
    if (to < 0 || to > 5) return;
    var c = GT.TabModel.getCell(S.score, S.sel.m, S.sel.s, S.sel.str);
    if (c) {
      // 같은 음 높이를 유지하면서 줄만 옮긴다
      var midi = GT.TabModel.cellToMidi(S.score, S.sel.str, c.fret);
      var t = GT.Fretboard.TUNINGS[S.score.meta.tuning].notes;
      var nf = midi - t[to] - S.score.meta.capo;
      if (nf >= 0 && nf <= 24 && !GT.TabModel.getCell(S.score, S.sel.m, S.sel.s, to)) {
        c.fret = nf;
        GT.TabModel.moveCell(S.score, { m: S.sel.m, s: S.sel.s, str: S.sel.str }, { m: S.sel.m, s: S.sel.s, str: to });
      }
    }
    S.sel.str = to;
    renderer.draw({ sel: S.sel });
    updateSelUI();
    saveSoon();
  }

  function moveSlot(d) {
    if (!S.score || !S.sel) return;
    var spm = S.score.slotsPerMeasure;
    var idx = S.sel.m * spm + S.sel.s + d;
    if (idx < 0 || idx >= GT.TabModel.totalSlots(S.score)) return;
    S.sel = { m: Math.floor(idx / spm), s: idx % spm, str: S.sel.str };
    renderer.draw({ sel: S.sel });
    updateSelUI();
  }

  function deleteSel() {
    if (!S.score || !S.sel) return;
    GT.TabModel.setCell(S.score, S.sel.m, S.sel.s, S.sel.str, null);
    renderer.draw({ sel: S.sel });
    updateSelUI();
    saveSoon();
  }

  function wireKeys() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (document.querySelector('.mask.show')) return;
      if (!S.score) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
      if (!S.sel) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); moveString(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveString(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? moveSlot(-1) : editFret(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? moveSlot(1) : editFret(1); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
      else if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        var now = Date.now();
        if (S._numAt && now - S._numAt < 700 && S._numBuf.length === 1) {
          var two = parseInt(S._numBuf + e.key, 10);
          if (two <= 24) { editFret(0, two); S._numBuf = ''; S._numAt = 0; return; }
        }
        S._numBuf = e.key; S._numAt = now;
        editFret(0, parseInt(e.key, 10));
      }
    });
  }

  /* ───────── 재생 ───────── */
  function togglePlay() {
    if (!S.score) return;
    if (player.playing) { player.stop(); $('btnPlay').textContent = '▶'; return; }
    var from = S.sel ? (S.sel.m * S.score.slotsPerMeasure + S.sel.s) : 0;
    player.speed = S.speed;
    player.metronome = S.metro;
    player.loop = null;
    if (S.loop && S.sel) {
      var spm = S.score.slotsPerMeasure;
      player.loop = { from: S.sel.m * spm, to: Math.min(GT.TabModel.totalSlots(S.score), (S.sel.m + 2) * spm) };
      from = player.loop.from;
    }
    player.onSlot = function (p) {
      renderer.draw({ sel: S.sel, playSlot: p });
      updateTime(p.index);
    };
    player.onEnd = function () { $('btnPlay').textContent = '▶'; renderer.draw({ sel: S.sel }); };
    player.play(S.score, from);
    $('btnPlay').textContent = '■';
  }

  function updateTime(slotIndex) {
    if (!S.score) return;
    var sd = GT.TabModel.slotDuration(S.score) / S.speed;
    var total = GT.TabModel.totalSlots(S.score) * sd;
    var cur = (slotIndex || 0) * sd;
    $('tTime').textContent = fmtTime(cur) + ' / ' + fmtTime(total);
    $('seekFill').style.width = total ? Math.min(100, cur / total * 100) + '%' : '0%';
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ───────── 내보내기 ───────── */
  function pdfOpts() {
    return {
      pageSize: $('pPage').value,
      measuresPerSystem: +$('pPer').value,
      showChords: $('pChords').checked,
      showTechniques: $('pTech').checked,
      cream: $('pCream').checked
    };
  }

  function doExportPdf() {
    if (!S.score) return;
    try {
      GT.Export.exportPdf(S.score, pdfOpts());
      toast('PDF를 만들었습니다.', 'ok');
      setStep(4);
    } catch (e) { toast('PDF 생성 실패: ' + (e.message || e), 'err', 6000); }
  }

  function checkedScores() {
    var out = [];
    for (var i = 0; i < S.library.length; i++) if (S.checked[S.library[i].id]) out.push(S.library[i]);
    return out;
  }

  function doExportBook() {
    var list = checkedScores();
    if (!list.length) {
      toast('왼쪽 목록에서 악보집에 넣을 곡을 체크해주세요.', 'err', 4500);
      return;
    }
    toast(list.length + '곡을 엮는 중…');
    setTimeout(function () {
      try {
        GT.Export.exportBookPdf(list, { title: $('pBookTitle').value || '기타 타브 악보집' }, pdfOpts());
        toast('악보집 PDF를 만들었습니다.', 'ok');
        setStep(4);
      } catch (e) { toast('악보집 생성 실패: ' + (e.message || e), 'err', 6000); }
    }, 40);
  }

  function doPrint() {
    if (!S.score) return;
    try {
      var blob = GT.PDF.exportScore(S.score, pdfOpts());
      var url = URL.createObjectURL(blob);
      var w = window.open(url, '_blank');
      if (!w) { toast('팝업이 막혔습니다. PDF로 저장한 뒤 인쇄해주세요.', 'err', 5000); return; }
      setTimeout(function () { try { w.print(); } catch (e) { /* 브라우저가 막는 경우 */ } }, 900);
    } catch (e) { toast('인쇄 준비 실패: ' + (e.message || e), 'err'); }
  }

  /* ───────── 설정 ───────── */
  function getPref(k, d) {
    try { var v = localStorage.getItem('gts_' + k); return v == null ? d : v; } catch (e) { return d; }
  }
  function setPref(k, v) {
    try { localStorage.setItem('gts_' + k, v); } catch (e) { /* noop */ }
  }

  function openSettings() {
    $('sTuning').value = getPref('tuning', 'standard');
    $('sKey').value = GT.AI.getKey() ? '••••••••••••••••' : '';
    $('sModel').value = GT.AI.getModel();
    $('sAutoUpdate').checked = getPref('autoUpdate', '1') === '1';
    openModal('mSettings');
  }

  function saveSettings() {
    setPref('tuning', $('sTuning').value);
    setPref('autoUpdate', $('sAutoUpdate').checked ? '1' : '0');
    var k = $('sKey').value.trim();
    if (k !== '••••••••••••••••') GT.AI.setKey(k);
    GT.AI.setModel($('sModel').value.trim() || GT.AI.DEFAULT_MODEL);
    closeModal('mSettings');
    toast('설정을 저장했습니다.', 'ok');
  }

  /* ───────── AI ───────── */
  function runAI() {
    if (!S.score) return;
    if (!GT.AI.enabled()) { toast('설정에서 Anthropic API 키를 먼저 넣어주세요.', 'err', 4500); openSettings(); return; }
    $('btnAI').disabled = true;
    $('btnAI').textContent = 'AI가 보는 중…';
    GT.AI.refine(S.score).then(function (res) {
      var ch = GT.AI.apply(S.score, res);
      refreshAll();
      saveCurrent();
      var msg = [];
      if (ch.sections) msg.push('구간 ' + ch.sections + '개');
      if (ch.chords) msg.push('코드 ' + ch.chords + '개');
      if (ch.title) msg.push('제목');
      toast(msg.length ? (msg.join(' · ') + ' 정리 완료') : 'AI가 고칠 곳을 찾지 못했습니다.', 'ok', 4200);
    }).catch(function (e) {
      toast('AI 다듬기 실패: ' + (e.message || e), 'err', 6000);
    }).then(function () {
      $('btnAI').disabled = false;
      $('btnAI').textContent = 'AI로 다듬기';
    });
  }

  /* ───────── 업데이트 ───────── */
  function checkUpdate(silent) {
    if (!silent) {
      $('updBody').innerHTML = '<p style="margin:0;color:var(--ink2);font-size:12.5px">GitHub에서 확인 중…</p>';
      $('updLink').hidden = true;
      $('updReload').hidden = true;
      openModal('mUpdate');
    }
    GT.Update.check().then(function (r) {
      if (r.hasUpdate) {
        $('verBtn').classList.add('has-update');
        $('verBtn').textContent = 'v' + r.current + ' → v' + r.latest;
      }
      if (silent && !r.hasUpdate) return;
      var html = '';
      html += '<p style="margin:0 0 12px;font-size:12.8px;color:var(--ink2)">' +
        '현재 버전 <b>v' + esc(r.current) + '</b>' +
        (r.latest ? ' · 최신 버전 <b>v' + esc(r.latest) + '</b>' : '') + '</p>';
      if (r.hasUpdate) {
        html += '<div class="changelog">' + esc(r.changelog || '변경 내역이 없습니다.') + '</div>';
        if (r.runtime === 'web') {
          html += '<div class="callout">이 앱은 웹에 올라가 있어서 <b>새로고침만 하면</b> 최신 버전이 적용됩니다. ' +
            '저장된 악보는 브라우저 안에 있으므로 그대로 남아 있습니다.</div>';
          $('updLink').hidden = true;
          $('updReload').hidden = false;
        } else {
          html += '<div class="callout">새 버전 zip을 받아 압축을 풀고, 지금 쓰는 폴더의 파일을 덮어쓰면 됩니다. ' +
            '저장된 악보는 브라우저 안에 있으므로 파일을 바꿔도 남아 있습니다.</div>';
          var link = r.assets.length ? r.assets[0].url : r.htmlUrl;
          $('updLink').href = link;
          $('updLink').hidden = false;
          $('updReload').hidden = true;
        }
      } else {
        html += '<div class="callout">' + esc(r.message || '최신 버전을 쓰고 있습니다.') + '</div>';
      }
      $('updBody').innerHTML = html;
      if (silent) openModal('mUpdate');
    }).catch(function (e) {
      if (silent) return;   // 조용한 확인은 실패해도 방해하지 않는다
      $('updBody').innerHTML =
        '<div class="callout warn">업데이트를 확인하지 못했습니다.<br>' + esc(e.message || '') +
        '<br><br>인터넷 없이도 앱은 그대로 쓸 수 있습니다.</div>' +
        '<p style="font-size:12px;color:var(--ink2)">저장소: <a href="' + GT.Update.repoUrl +
        '" target="_blank" rel="noopener">' + GT.Update.repoUrl + '</a></p>';
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ───────── 메타 편집 ───────── */
  function wireMeta() {
    $('mTitle').addEventListener('input', function () {
      S.score.meta.title = this.value; $('shTitle').textContent = this.value || '제목 없는 채보'; saveSoon(); renderLibrarySoon();
    });
    $('mArtist').addEventListener('input', function () {
      S.score.meta.artist = this.value; $('shArtist').textContent = this.value; saveSoon();
    });
    $('mSource').addEventListener('input', function () { S.score.meta.sourceUrl = this.value; saveSoon(); });
    $('mNote').addEventListener('input', function () { S.score.meta.note = this.value; saveSoon(); });

    $('mTuning').addEventListener('change', function () { retune(this.value, S.score.meta.capo); });
    $('mCapo').addEventListener('change', function () { retune(S.score.meta.tuning, +this.value); });

    $('mBpm').addEventListener('change', function () {
      var v = Math.max(30, Math.min(260, +this.value || 100));
      this.value = v;
      if (S.analysis) { rebuild({ bpm: v }); }
      else { S.score.meta.bpm = v; refreshAll(); saveSoon(); }
    });
    $('mTime').addEventListener('change', function () {
      var ts = this.value.split('/').map(Number);
      if (S.analysis) rebuild({ timeSig: ts });
      else toast('박자를 바꾸려면 원본 오디오가 필요합니다. 다시 분석해주세요.', 'err', 4500);
    });

    $('nFret').addEventListener('change', function () { editFret(0, Math.max(0, Math.min(24, +this.value || 0))); });
    $('nTech').addEventListener('change', function () {
      if (!S.sel) return;
      var c = GT.TabModel.getCell(S.score, S.sel.m, S.sel.s, S.sel.str);
      if (c) { c.tech = this.value; renderer.draw({ sel: S.sel }); saveSoon(); }
    });
    $('nString').addEventListener('change', function () {
      if (!S.sel) return;
      var to = +this.value;
      moveString(to - S.sel.str);
    });
    $('nPreview').addEventListener('click', function () {
      if (!S.sel) return;
      var c = GT.TabModel.getCell(S.score, S.sel.m, S.sel.s, S.sel.str);
      if (c) player.preview(GT.TabModel.cellToMidi(S.score, S.sel.str, c.fret));
    });
    $('nDelete').addEventListener('click', deleteSel);
    $('nClear').addEventListener('click', function () { S.sel = null; renderer.draw({}); updateSelUI(); });
  }

  var libTimer = 0;
  function renderLibrarySoon() {
    clearTimeout(libTimer);
    libTimer = setTimeout(function () {
      for (var i = 0; i < S.library.length; i++)
        if (S.library[i].id === S.score.id) S.library[i] = S.score;
      renderLibrary();
    }, 500);
  }

  function retune(tuning, capo) {
    if (!S.score) return;
    if (S.analysis) {
      rebuild({ tuning: tuning, capo: capo });
      toast('새 튜닝에 맞게 운지를 다시 배정했습니다.', 'ok');
    } else {
      // 원본 오디오가 없으면 음 높이를 유지하도록 프렛을 옮겨준다
      var old = GT.Fretboard.TUNINGS[S.score.meta.tuning].notes, oldCapo = S.score.meta.capo;
      var nw = GT.Fretboard.TUNINGS[tuning].notes;
      var lost = 0;
      for (var m = 0; m < S.score.measures.length; m++)
        for (var s = 0; s < S.score.measures[m].slots.length; s++)
          for (var st = 0; st < 6; st++) {
            var c = S.score.measures[m].slots[s][st];
            if (!c) continue;
            var midi = old[st] + oldCapo + c.fret;
            var nf = midi - nw[st] - capo;
            if (nf < 0 || nf > 24) { lost++; nf = Math.max(0, Math.min(24, nf)); }
            c.fret = nf;
          }
      S.score.meta.tuning = tuning; S.score.meta.capo = capo;
      refreshAll(); saveSoon();
      if (lost) toast(lost + '개 음이 지판 밖이라 가장자리로 옮겼습니다.', 'err', 4500);
    }
  }

  function rebuild(over) {
    var m = S.score.meta;
    buildScoreFromAnalysis({
      tuning: over.tuning || m.tuning,
      capo: over.capo == null ? m.capo : over.capo,
      bpm: over.bpm || m.bpm,
      timeSig: over.timeSig || m.timeSig,
      title: m.title
    });
    saveSoon();
  }

  /* ───────── 초기화 ───────── */
  function init() {
    renderer = new GT.Render.Renderer($('tabCanvas'));
    player = new GT.Synth.Player();

    fillSelects();
    wireModals();
    wireCanvas();
    wireKeys();
    wireMeta();

    $('verBtn').textContent = 'v' + GT.VERSION;

    $('btnImport').addEventListener('click', openImport);
    $('btnStart').addEventListener('click', openImport);
    $('btnCapture').addEventListener('click', startCapture);
    $('btnRunAnalyze').addEventListener('click', runAnalyze);
    $('btnExport').addEventListener('click', function () {
      $('pBookTitle').value = $('pBookTitle').value || '기타 타브 악보집';
      openModal('mExport');
    });
    $('btnSettings').addEventListener('click', openSettings);
    $('btnSaveSettings').addEventListener('click', saveSettings);
    $('verBtn').addEventListener('click', function () { checkUpdate(false); });
    $('updReload').addEventListener('click', function () { window.location.reload(true); });
    $('btnAI').addEventListener('click', runAI);
    $('btnBook').addEventListener('click', function () { openModal('mExport'); setTimeout(doExportBook, 120); });
    $('btnSelectAll').addEventListener('click', function () {
      var allOn = S.library.length && S.library.every(function (s) { return S.checked[s.id]; });
      S.library.forEach(function (s) { S.checked[s.id] = !allOn; });
      renderLibrary();
    });

    $('expPdf').addEventListener('click', doExportPdf);
    $('expBook').addEventListener('click', doExportBook);
    $('expTxt').addEventListener('click', function () { if (S.score) { GT.Export.exportAscii(S.score); toast('텍스트 타브를 저장했습니다.', 'ok'); } });
    $('expMid').addEventListener('click', function () { if (S.score) { GT.Export.exportMidi(S.score); toast('MIDI를 저장했습니다.', 'ok'); } });
    $('expJson').addEventListener('click', function () { if (S.score) { GT.Export.exportJson(S.score); toast('프로젝트를 저장했습니다.', 'ok'); } });
    $('expPrint').addEventListener('click', doPrint);

    // 파일 입력 / 드래그앤드롭
    var drop = $('drop');
    drop.addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function () { handleFile(this.files[0]); this.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    // 창 전체 드롭도 허용 (실사용에서 모달을 안 열고 던지는 경우가 많다)
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        var f = e.dataTransfer.files[0];
        if (/\.json$/i.test(f.name)) loadProjectFile(f); else handleFile(f);
      }
    });

    $('btnLoadProject').addEventListener('click', function () { $('projInput').click(); });
    $('projInput').addEventListener('change', function () { loadProjectFile(this.files[0]); this.value = ''; });

    $('btnCopyCli').addEventListener('click', function () {
      var t = $('cliCmd').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('복사했습니다.', 'ok'); },
        function () { toast('복사하지 못했습니다. 직접 선택해 복사해주세요.', 'err'); });
      else toast('이 브라우저에서는 자동 복사가 안 됩니다.', 'err');
    });

    $('btnWipe').addEventListener('click', function () {
      if (!confirm('저장된 악보를 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
      GT.Library.clearAll().then(function () {
        S.checked = {}; S.score = null; S.sel = null;
        setStep(1); refreshAll(); loadLibrary();
        closeModal('mSettings');
        toast('모두 지웠습니다.');
      });
    });

    // 트랜스포트
    $('btnPlay').addEventListener('click', togglePlay);
    $('chipLoop').addEventListener('click', function () {
      S.loop = !S.loop; this.classList.toggle('on', S.loop);
      toast(S.loop ? '선택한 마디부터 2마디를 반복합니다.' : '루프를 껐습니다.');
    });
    var speeds = [1, 0.75, 0.5, 0.35, 1.25];
    var si = 0;
    $('chipSpeed').addEventListener('click', function () {
      si = (si + 1) % speeds.length;
      S.speed = speeds[si];
      this.textContent = S.speed.toFixed(2).replace(/0$/, '') + '×';
      this.classList.toggle('on', S.speed !== 1);
      if (player.playing) { player.stop(); $('btnPlay').textContent = '▶'; }
      updateTime(0);
    });
    $('chipMetro').addEventListener('click', function () {
      S.metro = !S.metro; this.classList.toggle('on', S.metro);
      player.metronome = S.metro;
    });
    $('seek').addEventListener('click', function (e) {
      if (!S.score) return;
      var r = this.getBoundingClientRect();
      var p = (e.clientX - r.left) / r.width;
      var idx = Math.floor(p * GT.TabModel.totalSlots(S.score));
      var spm = S.score.slotsPerMeasure;
      S.sel = { m: Math.floor(idx / spm), s: idx % spm, str: S.sel ? S.sel.str : 0 };
      renderer.draw({ sel: S.sel });
      updateTime(idx);
    });

    // 스텝 탭
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (b) {
      b.addEventListener('click', function () {
        var v = +b.getAttribute('data-step');
        if (b.disabled) return;
        if (v === 1) openImport();
        else if (v === 2) { if (S.audio) openModal('mAnalyze'); }
        else if (v === 4) openModal('mExport');
        setStep(v);
      });
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (S.score) renderer.draw({ sel: S.sel }); }, 140);
    });

    loadLibrary().then(function (arr) {
      if (arr.length) { openScore(arr[0]); }
      else setStep(1);
    });

    if (getPref('autoUpdate', '1') === '1') setTimeout(function () { checkUpdate(true); }, 1800);
  }

  function loadProjectFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var sc = GT.Export.importJson(fr.result);
        closeModal('mImport');
        GT.Library.put(sc).then(function () { return loadLibrary(); }).then(function () {
          openScore(sc);
          toast('프로젝트를 불러왔습니다.', 'ok');
        });
      } catch (e) { toast('프로젝트를 읽지 못했습니다: ' + (e.message || e), 'err', 5000); }
    };
    fr.readAsText(file);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window.GT = window.GT || {});
