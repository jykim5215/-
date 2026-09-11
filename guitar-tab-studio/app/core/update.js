/* update.js — GitHub 릴리즈 기반 자체 업데이트 확인
   window.GT.Update
   · 공개 GitHub API만 사용한다. 토큰/자격증명을 코드에 넣지 않는다.
   · file:// 에서는 상대경로 fetch 가 막히므로, 현재 버전은 코드에 상수로 둔다.
   · 네트워크 실패는 앱 사용을 막지 않는다(경고만 표시). */
(function (GT) {
  'use strict';

  var VERSION = '1.0.0';
  var OWNER = 'jykim5215';
  var REPO = '-';
  var TAG_PREFIX = 'guitar-tab-studio-v';
  var API = 'https://api.github.com/repos/' + OWNER + '/' + encodeURIComponent(REPO) + '/releases';

  function parseVer(v) {
    var m = String(v).replace(/^v/, '').split('.').map(function (x) { return parseInt(x, 10) || 0; });
    return [m[0] || 0, m[1] || 0, m[2] || 0];
  }
  function cmp(a, b) {
    var A = parseVer(a), B = parseVer(b);
    for (var i = 0; i < 3; i++) { if (A[i] > B[i]) return 1; if (A[i] < B[i]) return -1; }
    return 0;
  }

  function check(timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error('시간 초과 — 네트워크를 확인해주세요.')); }
      }, timeoutMs);

      fetch(API + '?per_page=20', { headers: { 'Accept': 'application/vnd.github+json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('GitHub 응답 오류 (' + r.status + ')');
          return r.json();
        })
        .then(function (list) {
          if (done) return;
          done = true; clearTimeout(timer);
          if (!Array.isArray(list)) throw new Error('릴리즈 목록을 읽지 못했습니다.');
          var mine = list.filter(function (r) {
            return r.tag_name && r.tag_name.indexOf(TAG_PREFIX) === 0 && !r.draft;
          });
          if (!mine.length) {
            resolve({ current: VERSION, latest: null, hasUpdate: false, message: '아직 게시된 릴리즈가 없습니다.' });
            return;
          }
          mine.sort(function (a, b) { return cmp(b.tag_name.slice(TAG_PREFIX.length), a.tag_name.slice(TAG_PREFIX.length)); });
          var rel = mine[0];
          var latest = rel.tag_name.slice(TAG_PREFIX.length);
          resolve({
            current: VERSION,
            latest: latest,
            hasUpdate: cmp(latest, VERSION) > 0,
            changelog: rel.body || '',
            publishedAt: rel.published_at,
            htmlUrl: rel.html_url,
            assets: (rel.assets || []).map(function (a) {
              return { name: a.name, url: a.browser_download_url, size: a.size };
            })
          });
        })
        .catch(function (e) {
          if (done) return;
          done = true; clearTimeout(timer);
          reject(e);
        });
    });
  }

  GT.Update = {
    VERSION: VERSION,
    OWNER: OWNER,
    REPO: REPO,
    TAG_PREFIX: TAG_PREFIX,
    repoUrl: 'https://github.com/' + OWNER + '/' + REPO,
    check: check,
    compare: cmp
  };
  GT.VERSION = VERSION;
})(window.GT = window.GT || {});
