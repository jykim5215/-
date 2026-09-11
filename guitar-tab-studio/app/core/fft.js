/* fft.js — 의존성 없는 radix-2 FFT / STFT
   window.GT.FFT 로 노출. file:// 에서 동작하도록 클래식 스크립트. */
(function (GT) {
  'use strict';

  var cosTable = {}, sinTable = {}, revTable = {};

  function tables(n) {
    if (cosTable[n]) return;
    var c = new Float32Array(n / 2), s = new Float32Array(n / 2), i;
    for (i = 0; i < n / 2; i++) {
      c[i] = Math.cos(-2 * Math.PI * i / n);
      s[i] = Math.sin(-2 * Math.PI * i / n);
    }
    var bits = Math.round(Math.log(n) / Math.LN2);
    var rev = new Uint32Array(n);
    for (i = 0; i < n; i++) {
      var x = i, r = 0;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    cosTable[n] = c; sinTable[n] = s; revTable[n] = rev;
  }

  /* in-place complex FFT (re, im 길이는 2의 거듭제곱) */
  function fft(re, im) {
    var n = re.length;
    if (n <= 1) return;
    tables(n);
    var rev = revTable[n], c = cosTable[n], s = sinTable[n], i, j, t;
    for (i = 0; i < n; i++) {
      j = rev[i];
      if (j > i) {
        t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (i = 0; i < n; i += size) {
        var k = 0;
        for (j = i; j < i + half; j++, k += step) {
          var l = j + half;
          var tre = re[l] * c[k] - im[l] * s[k];
          var tim = re[l] * s[k] + im[l] * c[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  }

  function hann(n) {
    var w = new Float32Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return w;
  }

  /* 한 프레임의 진폭 스펙트럼(0..n/2) 계산 */
  function frameMagnitude(samples, offset, size, win, outMag, re, im) {
    var i, n = samples.length;
    for (i = 0; i < size; i++) {
      var idx = offset + i;
      re[i] = idx < n ? samples[idx] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    var half = size >> 1;
    for (i = 0; i <= half; i++) outMag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }

  GT.FFT = { fft: fft, hann: hann, frameMagnitude: frameMagnitude };
})(window.GT = window.GT || {});
