/* ai.js — (선택) Claude API 보정 레이어
   window.GT.AI

   설계 원칙
   · 선택 기능이다. 키가 없으면 이 기능만 꺼지고 나머지 앱은 그대로 동작한다.
   · API 키는 코드에 하드코딩하지 않는다. 사용자가 직접 입력한 키를 이 기기의
     localStorage 에만 저장하고, api.anthropic.com 외 어디로도 보내지 않는다.
   · 오디오는 전송하지 않는다. 사용자가 직접 채보한 결과에서 뽑은 음악적 요약
     (코드 진행 · 마디 수 · 음 분포 · BPM · 조성)만 보낸다.
   · 기존 곡의 악보를 받아오는 용도가 아니다. 넘긴 데이터의 정리/라벨링만 요청한다.
   · 브라우저 확장 프로그램 없이 앱에서 직접 부르므로 raw fetch 를 쓴다
     (빌드 스텝이 없는 file:// 앱이라 공식 SDK 를 번들할 수 없다). */
(function (GT) {
  'use strict';

  var ENDPOINT = 'https://api.anthropic.com/v1/messages';
  var API_VERSION = '2023-06-01';
  var MODEL = 'claude-opus-5';
  var KEY_STORE = 'gts_anthropic_key';
  var MODEL_STORE = 'gts_anthropic_model';

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }
  function setKey(k) {
    try {
      if (k) localStorage.setItem(KEY_STORE, k);
      else localStorage.removeItem(KEY_STORE);
    } catch (e) { /* 저장 불가 환경 */ }
  }
  function getModel() {
    try { return localStorage.getItem(MODEL_STORE) || MODEL; } catch (e) { return MODEL; }
  }
  function setModel(m) {
    try { localStorage.setItem(MODEL_STORE, m || MODEL); } catch (e) { /* noop */ }
  }
  function enabled() { return !!getKey(); }

  /* 악보에서 보낼 요약을 만든다 (원본 오디오 · 개인정보는 포함하지 않는다) */
  function summarize(score) {
    var chords = [], counts = {}, notes = 0, i, m, s, st;
    for (m = 0; m < score.measures.length; m++) {
      var mm = score.measures[m];
      for (i = 0; i < mm.chords.length; i++) chords.push({ m: m + 1, beat: (mm.chords[i].slot / score.subdiv) + 1, name: mm.chords[i].name });
      for (s = 0; s < mm.slots.length; s++)
        for (st = 0; st < 6; st++) {
          var c = mm.slots[s][st];
          if (!c) continue;
          notes++;
          var pc = GT.TabModel.cellToMidi(score, st, c.fret) % 12;
          counts[pc] = (counts[pc] || 0) + 1;
        }
    }
    var density = [];
    for (m = 0; m < score.measures.length; m++) {
      var n = 0, mm2 = score.measures[m];
      for (s = 0; s < mm2.slots.length; s++)
        for (st = 0; st < 6; st++) if (mm2.slots[s][st]) n++;
      density.push(n);
    }
    return {
      title: score.meta.title,
      tuning: score.meta.tuning,
      capo: score.meta.capo,
      bpm: score.meta.bpm,
      timeSig: score.meta.timeSig.join('/'),
      key: score.meta.key,
      measureCount: score.measures.length,
      noteCount: notes,
      notesPerMeasure: density,
      pitchClassHistogram: counts,
      chordTimeline: chords.slice(0, 220)
    };
  }

  var SYSTEM =
    '당신은 기타 채보를 정리해주는 조수입니다. 사용자가 자기 오디오를 직접 분석해 만든 ' +
    '채보 요약 데이터만 받습니다. 알려진 기존 곡의 악보나 가사를 기억에서 불러와 채우지 마세요. ' +
    '오직 주어진 데이터에서 읽어낼 수 있는 구조만 정리합니다. ' +
    '출력은 반드시 JSON 객체 하나만, 다른 말이나 코드펜스 없이 내보내세요.';

  function buildPrompt(sum) {
    return [
      '아래는 한 기타 연주 오디오를 자동 채보한 결과의 요약입니다.',
      '이 데이터만 근거로 다음을 정리해 주세요.',
      '',
      '1) sections: 음표 밀도(notesPerMeasure)와 코드 진행(chordTimeline)의 반복 구조를 보고',
      '   구간을 나눈다. 각 항목은 {"measure": 시작마디(1부터), "label": "Intro"|"Verse"|"Chorus"|"Bridge"|"Outro"|"Interlude"} 형태.',
      '   확실하지 않으면 적게 나눈다. 최대 12개.',
      '2) chordFixes: chordTimeline 안에서 진행상 명백히 어색해 보이는 코드만 고친다.',
      '   각 항목은 {"measure": n, "beat": b, "from": "원래", "to": "고친것", "why": "한 줄 이유"}. 없으면 빈 배열.',
      '3) key: 조성 추정 (예: "G major"). 확실하지 않으면 빈 문자열.',
      '4) practiceNotes: 이 곡을 연습할 때의 조언 2~4개 (한국어, 각 한 문장).',
      '5) suggestedTitle: 제목이 비어 있거나 "제목 없는 채보"라면 곡 분위기에 맞는 제목 후보 하나. 아니면 빈 문자열.',
      '',
      'JSON 스키마: {"sections":[],"chordFixes":[],"key":"","practiceNotes":[],"suggestedTitle":""}',
      '',
      '데이터:',
      JSON.stringify(sum)
    ].join('\n');
  }

  function extractJson(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
    return JSON.parse(t.slice(a, b + 1));
  }

  function refine(score) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('설정에서 Anthropic API 키를 먼저 넣어주세요.'));
    var sum = summarize(score);

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        // 브라우저에서 직접 호출할 때 필요한 헤더
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(sum) }]
      })
    }).then(function (r) {
      return r.text().then(function (body) {
        if (!r.ok) {
          var msg = '요청 실패 (' + r.status + ')';
          try { var j = JSON.parse(body); if (j.error && j.error.message) msg += ' — ' + j.error.message; } catch (e) { /* 원문 무시 */ }
          if (r.status === 401) msg = 'API 키가 올바르지 않습니다.';
          if (r.status === 429) msg = '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
          throw new Error(msg);
        }
        return JSON.parse(body);
      });
    }).then(function (res) {
      if (res.stop_reason === 'refusal') throw new Error('AI가 이 요청에 응답하지 않았습니다.');
      var text = '';
      var blocks = res.content || [];
      for (var i = 0; i < blocks.length; i++) if (blocks[i].type === 'text') text += blocks[i].text;
      return extractJson(text);
    });
  }

  /* 결과를 악보에 반영 */
  function apply(score, result) {
    var changed = { sections: 0, chords: 0, key: false, title: false };
    if (result.sections && result.sections.length) {
      for (var m = 0; m < score.measures.length; m++) score.measures[m].section = null;
      for (var i = 0; i < result.sections.length; i++) {
        var s = result.sections[i];
        var idx = (parseInt(s.measure, 10) || 1) - 1;
        if (idx >= 0 && idx < score.measures.length && s.label) {
          score.measures[idx].section = String(s.label).slice(0, 24);
          changed.sections++;
        }
      }
    }
    if (result.chordFixes && result.chordFixes.length) {
      for (var k = 0; k < result.chordFixes.length; k++) {
        var f = result.chordFixes[k];
        var mi = (parseInt(f.measure, 10) || 1) - 1;
        var mm = score.measures[mi];
        if (!mm || !f.to) continue;
        var slot = Math.round(((parseFloat(f.beat) || 1) - 1) * score.subdiv);
        for (var c = 0; c < mm.chords.length; c++) {
          if (Math.abs(mm.chords[c].slot - slot) <= 1) { mm.chords[c].name = String(f.to).slice(0, 10); changed.chords++; break; }
        }
      }
    }
    if (result.key && !score.meta.key) { score.meta.key = String(result.key).slice(0, 16); changed.key = true; }
    if (result.suggestedTitle && (!score.meta.title || score.meta.title === '제목 없는 채보')) {
      score.meta.title = String(result.suggestedTitle).slice(0, 80);
      changed.title = true;
    }
    if (result.practiceNotes && result.practiceNotes.length) {
      score.meta.note = result.practiceNotes.slice(0, 4).map(function (x) { return '· ' + x; }).join('\n');
    }
    return changed;
  }

  GT.AI = {
    enabled: enabled, getKey: getKey, setKey: setKey,
    getModel: getModel, setModel: setModel, DEFAULT_MODEL: MODEL,
    summarize: summarize, refine: refine, apply: apply
  };
})(window.GT = window.GT || {});
