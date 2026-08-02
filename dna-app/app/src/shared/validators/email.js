// DNA 취재 이메일 형식 검사기 (rules/email_format.md의 하드 룰)
const SUBJECT_PREFIX = '[디지스트신문 DNA]';

function checkEmail({ subject = '', body = '', reporterName = '', reporterTitle = '' }) {
  const issues = [];

  if (!subject.startsWith(SUBJECT_PREFIX)) {
    issues.push({ type: 'subject-prefix', message: `제목이 ${SUBJECT_PREFIX} 로 시작해야 합니다.` });
  }
  if (subject.trim() === SUBJECT_PREFIX) {
    issues.push({ type: 'subject-purpose', message: '제목에 용건이 없습니다 ("~~ 요청", "~~ 관련").' });
  }

  // 자기소개: 직함→이름 순 ("디지스트신문 DNA 기자 ○○○입니다")
  const introRe = /디지스트신문\s*DNA\s*\S+\s+\S+\s*입니다/;
  if (!introRe.test(body)) {
    issues.push({
      type: 'intro',
      message: '자기소개(직함→이름 순, 예: "디지스트신문 DNA 기자 ○○○입니다")가 없습니다.',
    });
  } else if (reporterName && reporterTitle) {
    const wrongOrder = body.includes(`${reporterName} ${reporterTitle}`);
    const rightOrder = body.includes(`${reporterTitle} ${reporterName}`);
    if (wrongOrder && !rightOrder) {
      issues.push({ type: 'intro-order', message: '자기소개는 직함→이름 순입니다 (예: "기자 홍길동").' });
    }
  }

  if (!/드림|올림/.test(body)) {
    issues.push({ type: 'signature', message: '서명(예: "디지스트신문 DNA 기자 ○○○ 드림")이 없습니다.' });
  }
  if (!/dgistdna\.com/.test(body)) {
    issues.push({ type: 'signature-site', message: '서명에 dgistdna.com 표기를 권장합니다.', level: 'warn' });
  }

  return { ok: issues.filter((i) => i.level !== 'warn').length === 0, issues };
}

module.exports = { checkEmail, SUBJECT_PREFIX };
