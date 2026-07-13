function splitDraft(draft = '') {
  const normalized = String(draft).replace(/\r\n/g, '\n').trim();
  if (!normalized) return { title: '', body: '', todos: [] };

  const lines = normalized.split('\n');
  const title = (lines.shift() || '').trim();
  const rest = lines.join('\n').trim();
  const parts = rest.split(/-{2,}\s*확인 필요\s*-{2,}/i);
  const body = (parts.shift() || '').trim();
  const todos = parts
    .join('\n')
    .split('\n')
    .map((line) => line.replace(/^[-•☐\s]+/, '').trim())
    .filter(Boolean);

  return { title, body, todos };
}

function uniqueSources(materials = []) {
  return new Set(
    materials
      .map((material) => String(material?.source || '').trim().toLowerCase())
      .filter((source) => source && !/출처 보완 필요|출처 미확인/.test(source))
  ).size;
}

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

function buildEditorialReadiness({ draft = '', materials = [], quoteResults = [] } = {}) {
  const parsed = splitDraft(draft);
  const bodyChars = parsed.body.replace(/\s/g, '').length;
  const materialCount = materials.length;
  const sourceCount = uniqueSources(materials);
  const quoteCounts = { exact: 0, fuzzy: 0, missing: 0 };

  for (const item of quoteResults || []) {
    const status = item?.verdict?.status;
    if (status in quoteCounts) quoteCounts[status] += 1;
  }

  const checks = [];
  if (!parsed.body) {
    checks.push(check('body', '기사 본문', 'block', '제목 아래 기사 본문이 없습니다.'));
  } else if (bodyChars < 300) {
    checks.push(check('body', '기사 본문', 'warn', `본문 ${bodyChars.toLocaleString()}자 · 초안 분량을 확인하세요.`));
  } else {
    checks.push(check('body', '기사 본문', 'pass', `본문 ${bodyChars.toLocaleString()}자`));
  }

  if (!parsed.title) {
    checks.push(check('title', '제목', 'block', '첫 줄에 기사 제목을 적으세요.'));
  } else if (parsed.title.length < 6 || parsed.title.length > 80) {
    checks.push(check('title', '제목', 'warn', `${parsed.title.length}자 · 제목 길이를 다시 확인하세요.`));
  } else {
    checks.push(check('title', '제목', 'pass', `${parsed.title.length}자`));
  }

  if (!materialCount) {
    checks.push(check('sources', '취재 근거', 'block', '연결된 취재 자료가 없습니다.'));
  } else if (!sourceCount) {
    checks.push(check('sources', '취재 근거', 'block', `자료 ${materialCount}건의 실제 출처를 보완하세요.`));
  } else if (sourceCount < 2) {
    checks.push(check('sources', '취재 근거', 'warn', `자료 ${materialCount}건 · 서로 다른 출처 ${sourceCount}곳`));
  } else {
    checks.push(check('sources', '취재 근거', 'pass', `자료 ${materialCount}건 · 서로 다른 출처 ${sourceCount}곳`));
  }

  if (quoteCounts.missing) {
    checks.push(check('quotes', '직접인용', 'block', `원문에서 찾지 못한 인용 ${quoteCounts.missing}건`));
  } else if (quoteCounts.fuzzy) {
    checks.push(check('quotes', '직접인용', 'warn', `원문과 다른 인용 ${quoteCounts.fuzzy}건`));
  } else {
    const exact = quoteCounts.exact ? `원문 일치 ${quoteCounts.exact}건` : '직접인용 없음';
    checks.push(check('quotes', '직접인용', 'pass', exact));
  }

  if (parsed.todos.length) {
    checks.push(check('todos', '확인 필요', 'block', `미확인 항목 ${parsed.todos.length}건`));
  } else {
    checks.push(check('todos', '확인 필요', 'pass', '남은 미확인 항목 없음'));
  }

  const weights = { pass: 1, warn: 0.5, block: 0 };
  const score = Math.round(
    checks.reduce((sum, item) => sum + weights[item.status], 0) / checks.length * 100
  );
  const blockers = checks.filter((item) => item.status === 'block');
  const warnings = checks.filter((item) => item.status === 'warn');

  return {
    ready: blockers.length === 0,
    score,
    checks,
    blockers,
    warnings,
    metrics: {
      bodyChars,
      materialCount,
      sourceCount,
      todoCount: parsed.todos.length,
      quoteCounts,
    },
  };
}

module.exports = { splitDraft, buildEditorialReadiness };
