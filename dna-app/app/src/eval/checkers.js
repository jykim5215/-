// 자동 검사기 (rule-based, 확정적) — 평가 하네스의 결정적 절반.
// 정성 평가는 judge.js (LLM-as-judge)가 담당한다.
const { verifyDraftQuotes } = require('../shared/validators/quoteVerify');
const { checkQuoteStyle, checkSingleQuoteOveruse } = require('../shared/validators/quotes');
const { checkEmail } = require('../shared/validators/email');
const { validateCardPlan, MAX_BODY_CHARS } = require('../pptx/cardnewsRules');
const { generateCardnews } = require('../pptx/cardnews');
const { diffStyles } = require('./pptxStyleDiff');

// case: { type: 'draft', input: { sources: [...] }, output: '기사 텍스트' }
function checkDraft(output, { sources = [] } = {}) {
  const results = [];
  const quotes = verifyDraftQuotes(output, sources);
  const missing = quotes.filter((q) => q.verdict.status === 'missing');
  results.push({
    name: '인용 검증 (없는 인용 0건)',
    pass: missing.length === 0,
    detail: missing.length ? missing.map((q) => q.text).join(' | ') : `직접인용 ${quotes.length}건 모두 근거 있음`,
  });
  const style = checkQuoteStyle(output);
  results.push({
    name: '따옴표 방향·혼용',
    pass: style.issues.length === 0,
    detail: style.issues.map((i) => i.message).join(' | ') || '통과',
  });
  const singles = checkSingleQuoteOveruse(output);
  results.push({
    name: '작은따옴표 남용',
    pass: !singles.overused,
    detail: singles.message || `${singles.count}회 — 정상`,
  });
  return results;
}

// case: { type: 'email', output: { subject, body } }
function checkEmailCase(output) {
  const r = checkEmail(output);
  return [{
    name: 'DNA 이메일 형식',
    pass: r.ok,
    detail: r.issues.map((i) => i.message).join(' | ') || '통과',
  }];
}

// case: { type: 'cardnews', output: plan, templateBuffer 필요 }
async function checkCardnewsCase(plan, templateBuffer) {
  const results = [];
  const v = validateCardPlan(plan);
  results.push({
    name: `카드뉴스 규격 (12장 제한·커버 규칙·카드당 ${MAX_BODY_CHARS}자)`,
    pass: v.ok,
    detail: [...v.errors, ...v.warnings].join(' | ') || '통과',
  });
  // Q&A 1문항 1카드
  const qaViolation = (plan.cards || []).filter(
    (c) => ((c.body || '').match(/(^|\n)\s*Q\d+[.)]/g) || []).length > 1
  );
  results.push({
    name: 'Q&A 1문항 1카드',
    pass: qaViolation.length === 0,
    detail: qaViolation.length ? `${qaViolation.length}개 카드에 복수 질문` : '통과',
  });
  if (v.ok && templateBuffer) {
    const { buffer } = await generateCardnews(templateBuffer, plan);
    const d = await diffStyles(templateBuffer, buffer);
    results.push({
      name: 'pptx 폰트·색 템플릿 일치 (XML diff)',
      pass: d.ok,
      detail: d.violations.join(' | ') || '템플릿과 완전 일치',
    });
  }
  return results;
}

async function runCase(c, { templateBuffer } = {}) {
  if (c.type === 'draft') return checkDraft(c.output, c.input);
  if (c.type === 'email') return checkEmailCase(c.output);
  if (c.type === 'cardnews') return checkCardnewsCase(c.output, templateBuffer);
  throw new Error('알 수 없는 케이스 type: ' + c.type);
}

module.exports = { checkDraft, checkEmailCase, checkCardnewsCase, runCase };
