// RAG 스타일 엔진 (Layer 2)
// "규칙은 프롬프트에 하드코딩, 스타일은 RAG로" — 현재 과제와 유사한 과거 우수 사례
// 2~3건을 검색해 few-shot 예시로 시스템 프롬프트에 동적 삽입한다.
//
// v1 검색기는 BM25 (외부 의존성·네트워크 불필요, 오프라인 동작).
// 임베딩 기반으로 업그레이드할 때는 retrieve()의 내부만 교체하면 된다 (인터페이스 고정).
const fs = require('fs');
const path = require('path');

const GOLD_DIR = path.join(__dirname, '..', '..', 'style_corpus', 'gold');
const MIN_RATING = 4; // 평점 4 이상 human_final만 스타일 코퍼스에 편입

// 한글은 문자 bigram, 라틴/숫자는 단어 단위 토큰화
function tokenize(text) {
  const tokens = [];
  const words = String(text).toLowerCase().match(/[a-z0-9]+|[가-힣]+/g) || [];
  for (const w of words) {
    if (/^[가-힣]+$/.test(w)) {
      if (w.length === 1) tokens.push(w);
      for (let i = 0; i < w.length - 1; i++) tokens.push(w.slice(i, i + 2));
    } else {
      tokens.push(w);
    }
  }
  return tokens;
}

// 코퍼스 수집: style_corpus/gold/*.md + 평점 4+ 레코드의 human_final
function collectCorpus(store) {
  const docs = [];
  if (fs.existsSync(GOLD_DIR)) {
    for (const f of fs.readdirSync(GOLD_DIR)) {
      if (!f.endsWith('.md')) continue;
      docs.push({
        id: `gold:${f}`,
        label: `골드 스탠다드 — ${f.replace(/\.md$/, '')}`,
        text: fs.readFileSync(path.join(GOLD_DIR, f), 'utf8'),
      });
    }
  }
  if (store) {
    const rows = store.all(
      `SELECT record_id, stage, human_final FROM records
       WHERE human_final IS NOT NULL
         AND json_extract(feedback, '$.rating') >= ?`,
      [MIN_RATING]
    );
    for (const r of rows) {
      docs.push({ id: `rec:${r.record_id}`, label: `우수 사례 (${r.stage})`, text: r.human_final });
    }
  }
  return docs;
}

// BM25 (Okapi) — 코퍼스가 작으므로 호출 시 인덱스 구축
function bm25Rank(docs, query, { k1 = 1.5, b = 0.75 } = {}) {
  const docTokens = docs.map((d) => tokenize(d.text));
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / Math.max(docs.length, 1);
  const df = new Map();
  const tfs = docTokens.map((tokens) => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  const N = docs.length;
  const qTokens = [...new Set(tokenize(query))];

  return docs
    .map((doc, i) => {
      let score = 0;
      for (const q of qTokens) {
        const f = tfs[i].get(q) || 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - df.get(q) + 0.5) / (df.get(q) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * docTokens[i].length) / avgLen)));
      }
      return { ...doc, score };
    })
    .sort((a, b2) => b2.score - a.score);
}

// 현재 과제와 유사한 우수 사례 k건 → few-shot 예시 문자열 배열
function retrieve(store, query, k = 2, maxCharsPerDoc = 2000) {
  const corpus = collectCorpus(store);
  if (!corpus.length) return [];
  const ranked = bm25Rank(corpus, query).filter((d) => d.score > 0);
  return ranked.slice(0, k).map((d) => `[${d.label}]\n${d.text.slice(0, maxCharsPerDoc)}`);
}

module.exports = { retrieve, tokenize, bm25Rank, collectCorpus, MIN_RATING };
