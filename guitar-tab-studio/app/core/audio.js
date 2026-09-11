/* audio.js — 오디오 입력(탭 캡처 / 파일) · 디코딩 · 모노 리샘플
   window.GT.Audio */
(function (GT) {
  'use strict';

  var TARGET_RATE = 22050;          // 채보용 목표 샘플레이트
  var MAX_SECONDS = 15 * 60;        // 안전 상한 (메모리 보호)

  function ctx() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) throw new Error('이 브라우저는 Web Audio를 지원하지 않습니다.');
    if (!ctx._c) ctx._c = new C();
    return ctx._c;
  }

  function decodeArrayBuffer(buf) {
    return new Promise(function (resolve, reject) {
      var c = ctx();
      var p = c.decodeAudioData(buf, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('파일을 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }

  /* AudioBuffer → 모노 Float32Array(TARGET_RATE) */
  function toMono(audioBuffer) {
    var srcLen = audioBuffer.length;
    var chans = audioBuffer.numberOfChannels;
    var mono = new Float32Array(srcLen);
    var ch, i;
    for (ch = 0; ch < chans; ch++) {
      var d = audioBuffer.getChannelData(ch);
      for (i = 0; i < srcLen; i++) mono[i] += d[i];
    }
    if (chans > 1) for (i = 0; i < srcLen; i++) mono[i] /= chans;

    var sr = audioBuffer.sampleRate;
    if (Math.abs(sr - TARGET_RATE) < 1) return { samples: mono, rate: sr };

    // 선형보간 리샘플 (다운샘플 전 간단한 박스 저역통과로 에일리어싱 완화)
    var ratio = sr / TARGET_RATE;
    if (ratio > 1) {
      var k = Math.max(1, Math.floor(ratio));
      var sm = new Float32Array(srcLen);
      var acc = 0;
      for (i = 0; i < srcLen; i++) {
        acc += mono[i];
        if (i >= k) acc -= mono[i - k];
        sm[i] = acc / Math.min(i + 1, k);
      }
      mono = sm;
    }
    var outLen = Math.floor(srcLen / ratio);
    var out = new Float32Array(outLen);
    for (i = 0; i < outLen; i++) {
      var pos = i * ratio, i0 = Math.floor(pos), f = pos - i0;
      var a = mono[i0] || 0, b = mono[i0 + 1] || a;
      out[i] = a + (b - a) * f;
    }
    return { samples: out, rate: TARGET_RATE };
  }

  function normalize(samples) {
    var peak = 0, i;
    for (i = 0; i < samples.length; i++) { var v = samples[i] < 0 ? -samples[i] : samples[i]; if (v > peak) peak = v; }
    if (peak > 0.0001 && peak < 0.99) { var g = 0.95 / peak; for (i = 0; i < samples.length; i++) samples[i] *= g; }
    return samples;
  }

  /* 파일(mp3/m4a/wav/ogg/mp4/webm) → {samples, rate, duration} */
  function fromFile(file) {
    return readFile(file).then(decodeArrayBuffer).then(function (ab) {
      if (ab.duration > MAX_SECONDS) throw new Error('오디오가 너무 깁니다(최대 15분). 구간을 잘라서 넣어주세요.');
      var m = toMono(ab);
      normalize(m.samples);
      m.duration = m.samples.length / m.rate;
      return m;
    });
  }

  /* ── 탭 오디오 캡처 ─────────────────────────────────────────
     유튜브가 재생 중인 브라우저 탭을 선택하고 "탭 오디오 공유"를 켜면
     그 소리를 그대로 녹음한다. 서버 없이 브라우저 안에서만 처리된다. */
  function captureSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia &&
              window.MediaRecorder);
  }

  function Recorder() {
    this.stream = null; this.rec = null; this.chunks = [];
    this.onLevel = null; this.onStop = null; this._raf = 0;
  }

  Recorder.prototype.start = function () {
    var self = this;
    if (!captureSupported()) {
      return Promise.reject(new Error(
        '이 환경에서는 탭 오디오 캡처를 쓸 수 없습니다. 오디오 파일을 드래그해서 넣어주세요.'));
    }
    return navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      var tracks = stream.getAudioTracks();
      if (!tracks.length) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        throw new Error('오디오 트랙이 없습니다. 탭을 선택할 때 "탭 오디오도 공유" 를 반드시 체크해주세요.');
      }
      // 영상 트랙은 필요 없으므로 즉시 정지 (자원 절약 · 화면 내용 처리 안 함)
      stream.getVideoTracks().forEach(function (t) { t.stop(); });

      self.stream = stream;
      self.chunks = [];
      var mime = '';
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].some(function (m) {
        if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m)) { mime = m; return true; }
        return false;
      });
      self.rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      self.rec.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
      self.rec.onstop = function () {
        var blob = new Blob(self.chunks, { type: self.chunks.length ? self.chunks[0].type : 'audio/webm' });
        self._teardown();
        if (self.onStop) self.onStop(blob);
      };
      self.rec.start(250);
      self._meter(stream);
      return true;
    });
  };

  Recorder.prototype._meter = function (stream) {
    var self = this;
    try {
      var c = ctx();
      if (c.state === 'suspended') c.resume();
      var src = c.createMediaStreamSource(stream);
      var an = c.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      var buf = new Uint8Array(an.fftSize);
      var tick = function () {
        if (!self.rec || self.rec.state !== 'recording') return;
        an.getByteTimeDomainData(buf);
        var peak = 0;
        for (var i = 0; i < buf.length; i++) { var v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v; }
        if (self.onLevel) self.onLevel(peak);
        self._raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { /* 레벨미터는 부가 기능이므로 실패해도 녹음은 계속 */ }
  };

  Recorder.prototype.stop = function () {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    else this._teardown();
  };

  Recorder.prototype._teardown = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    this.stream = null;
  };

  function fromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('녹음 데이터를 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(blob);
    }).then(decodeArrayBuffer).then(function (ab) {
      var m = toMono(ab);
      normalize(m.samples);
      m.duration = m.samples.length / m.rate;
      return m;
    });
  }

  GT.Audio = {
    TARGET_RATE: TARGET_RATE,
    context: ctx,
    fromFile: fromFile,
    fromBlob: fromBlob,
    captureSupported: captureSupported,
    Recorder: Recorder
  };
})(window.GT = window.GT || {});
