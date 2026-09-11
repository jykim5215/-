/* synth.js — Karplus-Strong 발현음 + 메트로놈 재생 (오프라인, 사운드폰트 불필요)
   window.GT.Synth */
(function (GT) {
  'use strict';

  var cache = {};

  function pluckBuffer(ctx, freq, seconds, bright) {
    var key = Math.round(freq * 10) + '_' + Math.round(seconds * 10) + '_' + (bright ? 1 : 0);
    if (cache[key]) return cache[key];
    var rate = ctx.sampleRate;
    var n = Math.ceil(rate * seconds);
    var buf = ctx.createBuffer(1, n, rate);
    var out = buf.getChannelData(0);
    var N = Math.max(2, Math.round(rate / freq));
    var noise = new Float32Array(N);
    var i;
    for (i = 0; i < N; i++) noise[i] = Math.random() * 2 - 1;
    // 초기 여기음의 고역을 약간 깎아 기타에 가깝게
    for (i = 1; i < N; i++) noise[i] = noise[i] * 0.6 + noise[i - 1] * 0.4;
    var damp = bright ? 0.502 : 0.497;
    var idx = 0;
    var prev = 0;
    for (i = 0; i < n; i++) {
      var cur = noise[idx];
      var nxt = noise[(idx + 1) % N];
      var v = (cur + nxt) * damp + prev * 0.002;
      prev = v;
      noise[idx] = v * 0.996;
      out[i] = cur;
      idx = (idx + 1) % N;
    }
    // 페이드아웃
    var fade = Math.min(n, Math.round(rate * 0.06));
    for (i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
    cache[key] = buf;
    return buf;
  }

  function Player() {
    this.ctx = null;
    this.playing = false;
    this.startTime = 0;
    this.startSlot = 0;
    this.speed = 1;
    this.loop = null;           // {from, to} 슬롯 인덱스
    this.metronome = false;
    this.onSlot = null;
    this.onEnd = null;
    this._timer = 0;
    this._scheduled = 0;
    this._nodes = [];
  }

  Player.prototype._ensure = function () {
    if (!this.ctx) this.ctx = GT.Audio.context();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  };

  Player.prototype.play = function (score, fromSlot) {
    this.stop();
    var ctx = this._ensure();
    this.score = score;
    this.slotDur = GT.TabModel.slotDuration(score) / this.speed;
    this.total = GT.TabModel.totalSlots(score);
    this.startSlot = fromSlot || 0;
    this.startTime = ctx.currentTime + 0.08;
    this.playing = true;
    this._scheduled = this.startSlot;
    var self = this;
    this._tick();
    this._timer = setInterval(function () { self._tick(); }, 60);
  };

  Player.prototype._tick = function () {
    if (!this.playing) return;
    var ctx = this.ctx;
    var lookahead = 0.35;
    var spm = this.score.slotsPerMeasure;
    var loopFrom = this.loop ? this.loop.from : 0;
    var loopTo = this.loop ? this.loop.to : this.total;

    while (true) {
      var idx = this._scheduled;
      var t = this.startTime + (idx - this.startSlot) * this.slotDur;
      if (t > ctx.currentTime + lookahead) break;
      var rel = idx;
      if (this.loop) {
        var span = loopTo - loopFrom;
        if (span <= 0) break;
        rel = loopFrom + ((idx - loopFrom) % span + span) % span;
      } else if (idx >= this.total) {
        this.playing = false;
        clearInterval(this._timer);
        if (this.onEnd) this.onEnd();
        return;
      }
      this._scheduleSlot(rel, t);
      this._scheduled++;
    }

    // 재생 위치 콜백
    var elapsed = ctx.currentTime - this.startTime;
    var cur = this.startSlot + Math.floor(elapsed / this.slotDur);
    if (this.loop) {
      var sp = loopTo - loopFrom;
      if (sp > 0) cur = loopFrom + ((cur - loopFrom) % sp + sp) % sp;
    }
    if (this.onSlot && cur >= 0) {
      var spm2 = this.score.slotsPerMeasure;
      this.onSlot({ m: Math.floor(cur / spm2), s: cur % spm2, index: cur });
    }
  };

  Player.prototype._scheduleSlot = function (index, when) {
    var score = this.score;
    var spm = score.slotsPerMeasure;
    var m = Math.floor(index / spm), s = index % spm;
    var mm = score.measures[m];
    if (!mm) return;
    var ctx = this.ctx;

    if (this.metronome && s % score.subdiv === 0) {
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.frequency.value = (s === 0) ? 1600 : 1100;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.16, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      osc.connect(g); g.connect(this.master);
      osc.start(when); osc.stop(when + 0.06);
    }

    var cells = mm.slots[s];
    for (var st = 0; st < 6; st++) {
      var cell = cells[st];
      if (!cell) continue;
      var midi = GT.TabModel.cellToMidi(score, st, cell.fret);
      var freq = 440 * Math.pow(2, (midi - 69) / 12);
      var dur = Math.min(2.4, Math.max(0.35, this.slotDur * 6));
      var buf = pluckBuffer(ctx, freq, dur, st <= 2);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g2 = ctx.createGain();
      g2.gain.value = 0.20 + 0.28 * (cell.vel == null ? 0.7 : cell.vel);
      src.connect(g2); g2.connect(this.master);
      src.start(when);
      src.stop(when + dur);
    }
  };

  Player.prototype.stop = function () {
    this.playing = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = 0;
  };

  Player.prototype.setSpeed = function (v) {
    var wasPlaying = this.playing;
    this.speed = v;
    if (wasPlaying) { this.stop(); }
  };

  /* 한 음만 미리듣기 (편집 중 확인용) */
  Player.prototype.preview = function (midi) {
    var ctx = this._ensure();
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var buf = pluckBuffer(ctx, freq, 0.9, true);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain(); g.gain.value = 0.4;
    src.connect(g); g.connect(this.master);
    src.start();
  };

  GT.Synth = { Player: Player };
})(window.GT = window.GT || {});
