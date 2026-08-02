// 과거 DNA 기사 아카이브 — 임포트 + 중복 검사 검색
const crypto = require('crypto');

function upsertArticle(store, { title, url = '', publishedAt = '', body = '', source = 'dgistdna.com' }) {
  const existing = url ? store.get('SELECT id FROM archive WHERE url = ?', [url]) : null;
  if (existing) {
    store.run('UPDATE archive SET title=?, published_at=?, body=?, source=? WHERE id=?', [
      title, publishedAt, body, source, existing.id,
    ]);
    return existing.id;
  }
  const id = crypto.randomUUID();
  store.run(
    'INSERT INTO archive (id, title, url, published_at, body, source, imported_at) VALUES (?,?,?,?,?,?,?)',
    [id, title, url, publishedAt, body, source, new Date().toISOString()]
  );
  return id;
}

// 키워드별 LIKE 검색 → 중복 가능성이 있는 과거 기사 목록
function searchArchive(store, keywords, limit = 8) {
  const hits = new Map();
  for (const kw of keywords.filter((k) => k && k.trim())) {
    const like = `%${kw.trim()}%`;
    const rows = store.all(
      `SELECT id, title, url, published_at,
              (CASE WHEN title LIKE ? THEN 2 ELSE 1 END) AS score
       FROM archive WHERE title LIKE ? OR body LIKE ? LIMIT 50`,
      [like, like, like]
    );
    for (const r of rows) {
      const prev = hits.get(r.id);
      if (prev) prev.score += r.score;
      else hits.set(r.id, { ...r, matched: [kw] });
      if (prev && !prev.matched.includes(kw)) prev.matched.push(kw);
    }
  }
  return [...hits.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function archiveCount(store) {
  return store.get('SELECT COUNT(*) AS n FROM archive').n;
}

module.exports = { upsertArticle, searchArchive, archiveCount };
