import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { editDistance, editRatio } = require('../src/shared/editDistance');
const quotes = require('../src/shared/validators/quotes');
const qv = require('../src/shared/validators/quoteVerify');
const { textWeight, headerBarWidthEmu } = require('../src/shared/textWeight');
const { validateCardPlan } = require('../src/pptx/cardnewsRules');

test('editDistance 기본', () => {
  assert.equal(editDistance('', ''), 0);
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('조정부', '조정부'), 0);
  assert.equal(editDistance('조정부 승격', '조정부 승격!'), 1);
  assert.ok(editRatio('abc', 'abc') === 0);
});

test('직접인용 추출 — 곡선/직선 구분', () => {
  const t = '그는 “정말 좋다”고 했고, "이건 직선"이라 했다.';
  const qs = quotes.extractDirectQuotes(t);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].text, '정말 좋다');
  assert.equal(qs[0].curly, true);
  assert.equal(qs[1].curly, false);
});

test('따옴표 방향/혼용 검사', () => {
  const r = quotes.checkQuoteStyle('그는 “좋다”며 "나쁘다"고 했다.');
  const types = r.issues.map((i) => i.type);
  assert.ok(types.includes('straight-double'));
  assert.ok(types.includes('mixed'));
  assert.equal(quotes.checkQuoteStyle('그는 “좋다”고 했다.').issues.length, 0);
});

test('직선→곡선 자동 변환', () => {
  assert.equal(quotes.toCurlyQuotes('"안녕" 그리고 "잘 가"'), '“안녕” 그리고 “잘 가”');
});

test('인용 검증 — exact/fuzzy/missing', () => {
  const source = '박성현 부장은 이렇게 말했다. 지난 2년간 정기 훈련과 대외 대회 출전 실적을 꾸준히 쌓아 왔다. 앞으로도 노력하겠다.';
  const exact = qv.verifyQuote('지난 2년간 정기 훈련과 대외 대회 출전 실적을 꾸준히 쌓아 왔다', [source]);
  assert.equal(exact.status, 'exact');
  const fuzzy = qv.verifyQuote('지난 2년 동안 정기 훈련과 대외 대회 출전 실적을 꾸준히 쌓아왔다', [source]);
  assert.ok(fuzzy.status === 'fuzzy' || fuzzy.status === 'exact');
  const missing = qv.verifyQuote('운영 실적이 부족하고 회칙상 근거도 불분명하다', [source]);
  assert.equal(missing.status, 'missing');
});

test('초안 전체 인용 검증', () => {
  const src = '우리는 승격 요건을 충족했다고 생각한다.';
  const draft = '부장은 “우리는 승격 요건을 충족했다고 생각한다”고 말했다. 반면 “근거가 없다”는 반박도 있다.';
  const res = qv.verifyDraftQuotes(draft, [src]);
  assert.equal(res.length, 2);
  assert.equal(res[0].verdict.status, 'exact');
  assert.equal(res[1].verdict.status, 'missing');
});

test('헤더 바 폭 — 글자 가중치 (한글 1.0, 라틴·숫자 0.55, 공백 0.4)', () => {
  assert.equal(textWeight('한글'), 2.0);
  assert.equal(textWeight('AB1'), 0.55 * 3);
  assert.equal(textWeight('한 글'), 2.4);
  const w = headerBarWidthEmu('사회', { perCharEmu: 100000, paddingEmu: 50000 });
  assert.equal(w, 250000);
  const clamped = headerBarWidthEmu('아주아주아주아주 긴 카테고리', { perCharEmu: 100000, maxEmu: 300000 });
  assert.equal(clamped, 300000);
});

test('카드뉴스 하드 룰 검증', () => {
  const ok = validateCardPlan({ coverTitle: '침체기 딛고\n다시 노를 젓다', category: '사회', cards: [{ title: 'a', body: 'b' }] });
  assert.equal(ok.ok, true);

  const tooMany = validateCardPlan({ coverTitle: 't', category: '사회', cards: Array(11).fill({ title: 'a', body: 'b' }) });
  assert.equal(tooMany.ok, false); // 13장 > 12장

  const threeLines = validateCardPlan({ coverTitle: '가\n나\n다', category: '사회', cards: [{ title: 'a', body: 'b' }] });
  assert.equal(threeLines.ok, false);

  const bracket = validateCardPlan({ coverTitle: 't', category: '[사회]', cards: [{ title: 'a', body: 'b' }] });
  assert.equal(bracket.ok, false);

  const punct = validateCardPlan({ coverTitle: '이게 맞나?', category: '사회', cards: [{ title: 'a', body: 'b' }] });
  assert.equal(punct.ok, true); // 문장부호는 경고
  assert.ok(punct.warnings.length >= 1);

  const longBody = validateCardPlan({ coverTitle: 't', category: '사회', cards: [{ title: 'a', body: '가'.repeat(400) }] });
  assert.ok(longBody.warnings.some((w) => w.includes('로고')));
});
