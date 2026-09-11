/* library.js — 악보집 라이브러리 (IndexedDB, 실패 시 localStorage 폴백)
   window.GT.Library — 모든 데이터는 이 기기 안에만 저장된다. */
(function (GT) {
  'use strict';

  var DB = 'guitar-tab-studio', STORE = 'scores', VER = 1;
  var LS_KEY = 'gts_scores_fallback';
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('no-idb'));
      var req = indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-error')); };
    }).catch(function () { return null; });
    return dbp;
  }

  function lsAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function lsWrite(arr) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (e) { /* 용량 초과 등 */ }
  }

  function put(score) {
    score.meta.updatedAt = Date.now();
    return open().then(function (db) {
      if (!db) {
        var arr = lsAll().filter(function (s) { return s.id !== score.id; });
        arr.push(score); lsWrite(arr); return score;
      }
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(score);
        tx.oncomplete = function () { resolve(score); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function all() {
    return open().then(function (db) {
      if (!db) return lsAll();
      return new Promise(function (resolve) {
        var out = [];
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (c) { out.push(c.value); c.continue(); }
          else resolve(out);
        };
        req.onerror = function () { resolve(out); };
      });
    }).then(function (arr) {
      arr.sort(function (a, b) { return (b.meta.createdAt || 0) - (a.meta.createdAt || 0); });
      return arr;
    });
  }

  function remove(id) {
    return open().then(function (db) {
      if (!db) { lsWrite(lsAll().filter(function (s) { return s.id !== id; })); return; }
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve; tx.onerror = resolve;
      });
    });
  }

  function clearAll() {
    return open().then(function (db) {
      if (!db) { lsWrite([]); return; }
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = resolve; tx.onerror = resolve;
      });
    });
  }

  GT.Library = { put: put, all: all, remove: remove, clearAll: clearAll };
})(window.GT = window.GT || {});
