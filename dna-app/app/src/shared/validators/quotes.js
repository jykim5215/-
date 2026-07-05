// 따옴표 규칙 검사기 (rule-based, 확정적)
// DNA 절대 규칙:
//  - 직접인용 큰따옴표 " " 는 취재원 발언 그대로일 때만
//  - 작은따옴표 ' ' 는 단어·구절 인용/필수 강조에만 (남용 금지)
//  - 곡선 따옴표 사용, 직선/곡선 혼용 금지

const CURLY_DOUBLE_OPEN = '“'; // "
const CURLY_DOUBLE_CLOSE = '”'; // "
const CURLY_SINGLE_OPEN = '‘'; // '
const CURLY_SINGLE_CLOSE = '’'; // '

// 본문에서 큰따옴표 직접인용 추출 (곡선 + 직선 모두 — 직선은 별도 경고 대상)
function extractDirectQuotes(text) {
  const quotes = [];
  const re = new RegExp(
    `${CURLY_DOUBLE_OPEN}([^${CURLY_DOUBLE_OPEN}${CURLY_DOUBLE_CLOSE}]+)${CURLY_DOUBLE_CLOSE}|"([^"]+)"`,
    'g'
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[1] ?? m[2];
    quotes.push({
      text: body,
      index: m.index,
      length: m[0].length,
      curly: m[1] !== undefined,
    });
  }
  return quotes;
}

function extractSingleQuoted(text) {
  const out = [];
  const re = new RegExp(
    `${CURLY_SINGLE_OPEN}([^${CURLY_SINGLE_OPEN}${CURLY_SINGLE_CLOSE}]+)${CURLY_SINGLE_CLOSE}`,
    'g'
  );
  let m;
  while ((m = re.exec(text)) !== null) out.push({ text: m[1], index: m.index });
  return out;
}

// 직선/곡선 혼용 검사. 결과: { issues: [{type, message, index?}] }
function checkQuoteStyle(text) {
  const issues = [];
  const straightDouble = (text.match(/"/g) || []).length;
  const straightSingle = (text.match(/(?<![a-zA-Z])'|'(?![a-zA-Z])/g) || []).length;
  const curlyDouble =
    (text.match(new RegExp(CURLY_DOUBLE_OPEN, 'g')) || []).length +
    (text.match(new RegExp(CURLY_DOUBLE_CLOSE, 'g')) || []).length;

  if (straightDouble > 0) {
    issues.push({
      type: 'straight-double',
      message: `직선 큰따옴표(") ${straightDouble}개 발견 — 곡선 따옴표(" ")로 바꾸세요.`,
      count: straightDouble,
    });
  }
  if (straightSingle > 0) {
    issues.push({
      type: 'straight-single',
      message: `직선 작은따옴표(') ${straightSingle}개 발견 — 곡선 따옴표(' ')로 바꾸세요.`,
      count: straightSingle,
    });
  }
  if (straightDouble > 0 && curlyDouble > 0) {
    issues.push({
      type: 'mixed',
      message: '직선·곡선 따옴표가 혼용되어 있습니다. 곡선으로 통일하세요.',
    });
  }
  return { issues };
}

// 작은따옴표 남용 검사 — 밀도 기반 휴리스틱
function checkSingleQuoteOveruse(text, { maxPer1000Chars = 4 } = {}) {
  const singles = extractSingleQuoted(text);
  const density = (singles.length / Math.max(text.length, 1)) * 1000;
  const overused = singles.length >= 3 && density > maxPer1000Chars;
  return {
    count: singles.length,
    overused,
    message: overused
      ? `작은따옴표 강조가 ${singles.length}회로 잦습니다. 꼭 필요한 곳만 남기세요.`
      : null,
  };
}

// 직선 → 곡선 자동 변환 (여는/닫는 판정: 앞 문자가 공백/개행/문두/여는괄호면 여는 따옴표)
function toCurlyQuotes(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i === 0 ? '' : text[i - 1];
    const opening = i === 0 || /[\s([{“‘]/.test(prev);
    if (ch === '"') out += opening ? CURLY_DOUBLE_OPEN : CURLY_DOUBLE_CLOSE;
    else if (ch === "'") out += opening ? CURLY_SINGLE_OPEN : CURLY_SINGLE_CLOSE;
    else out += ch;
  }
  return out;
}

module.exports = {
  extractDirectQuotes,
  extractSingleQuoted,
  checkQuoteStyle,
  checkSingleQuoteOveruse,
  toCurlyQuotes,
  CURLY_DOUBLE_OPEN,
  CURLY_DOUBLE_CLOSE,
  CURLY_SINGLE_OPEN,
  CURLY_SINGLE_CLOSE,
};
