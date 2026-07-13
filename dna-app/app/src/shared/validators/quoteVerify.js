// 인용 검증기: 기사 초안의 직접인용(큰따옴표)이 업로드된 녹취/자료에
// 실제 존재하는 문장인지 대조한다. 없는 인용 = 빨간 경고.
//
// 판정 3단계:
//  1) exact  — 정규화 후 부분 문자열 일치
//  2) fuzzy  — 자료 문장과의 유사도 ≥ threshold (조사·어미 미세 수정 허용)
//  3) missing — 근거 없음 → 간접인용 전환 요구
const { editDistance } = require('../editDistance');
const { extractDirectQuotes } = require('./quotes');

// 공백·문장부호·따옴표류 제거 정규화
function normalize(s) {
  return String(s)
    .replace(/[“”"‘’'『』「」\s]/g, '')
    .replace(/[.,·…!?~\-—()[\]{}:;]/g, '');
}

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  const max = Math.max(na.length, nb.length, 1);
  return 1 - editDistance(na, nb) / max;
}

function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?다요죠음임함])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

// quote 하나를 sources(자료 본문 배열)와 대조
function verifyQuote(quote, sources, { fuzzyThreshold = 0.82 } = {}) {
  const nq = normalize(quote);
  if (nq.length === 0) return { status: 'exact', score: 1, sourceIndex: -1 };

  let best = { score: 0, sourceIndex: -1, sentence: '' };
  for (let si = 0; si < sources.length; si++) {
    const body = String(sources[si] || '');
    if (normalize(body).includes(nq)) {
      return { status: 'exact', score: 1, sourceIndex: si };
    }
    // 문장 단위 + 인접 2문장 결합으로 fuzzy 탐색
    const sentences = splitSentences(body);
    for (let i = 0; i < sentences.length; i++) {
      const candidates = [sentences[i]];
      if (i + 1 < sentences.length) candidates.push(sentences[i] + ' ' + sentences[i + 1]);
      for (const cand of candidates) {
        // 길이 차가 3배 이상이면 계산 생략 (성능)
        const ratio = normalize(cand).length / Math.max(nq.length, 1);
        if (ratio > 3 || ratio < 1 / 3) continue;
        const s = similarity(quote, cand);
        if (s > best.score) best = { score: s, sourceIndex: si, sentence: cand };
      }
    }
  }
  if (best.score >= fuzzyThreshold) {
    return { status: 'fuzzy', score: best.score, sourceIndex: best.sourceIndex, matched: best.sentence };
  }
  return { status: 'missing', score: best.score, sourceIndex: -1 };
}

// 초안 전체 검증: 각 직접인용의 판정 목록 반환
function verifyDraftQuotes(draft, sources, opts) {
  const quotes = extractDirectQuotes(draft);
  return quotes.map((q) => ({ ...q, verdict: verifyQuote(q.text, sources, opts) }));
}

module.exports = { normalize, similarity, verifyQuote, verifyDraftQuotes, splitSentences };
