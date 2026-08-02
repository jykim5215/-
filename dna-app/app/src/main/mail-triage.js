// 메일 분류 — 규칙 기반이 기본, Claude가 있으면 취재 관점 분류·브리핑을 덧입힌다.
//
// 프라이버시: AI에 넘기는 것은 제목·발신자·짧은 발췌(400자)뿐이고 본문 전체는
// 기기에 남는다. API 키가 없거나 호출이 실패해도 규칙 기반 분류로 항상 동작한다.

const CATEGORIES = [
  '취재 답신', '취재원', '제보', '학생회', '행정·학생팀', '세미나·행사', '보도자료', '기타',
];

// 자동발송·시스템 메일 (기사거리 아님)
const SYSTEM_RE = /no-?reply|noreply|do-?not-?reply|mailer-daemon|lms|blackboard|자동\s*발송|발신전용/i;

// 규칙 기반 분류 — AI 없이도 메일함이 정리되게 하는 안전망
function ruleCategory(mail) {
  const subject = mail.subject || '';
  const sender = `${mail.fromName || ''} ${mail.fromEmail || ''}`;
  const text = `${subject} ${sender}`;
  if (mail.isReply || /^\s*(re|답장|회신)\s*:/i.test(subject)) return '취재 답신';
  if (/제보|알려드립니다|기사.*요청|취재.*요청해/.test(text)) return '제보';
  if (/학생회|총학/.test(text)) return '학생회';
  if (/보도자료|press\s*release|홍보실/i.test(text)) return '보도자료';
  if (/교수|professor/i.test(sender)) return '취재원';
  if (/학생팀|학사|행정|지원팀|총무|등록|장학/.test(text)) return '행정·학생팀';
  if (/세미나|특강|콜로퀴움|워크숍|설명회|강연/.test(text)) return '세미나·행사';
  if (/채용|인턴|취업|진로|커리어|모집공고/.test(text)) return '기타';
  if (/동아리|공연|음악|밴드|오케스트라|축제/.test(text)) return '기타';
  return '기타';
}

// 규칙 기반 점수: 답신·제보는 기자에게 최우선, 자동발송은 바닥
function ruleScore(mail, category) {
  if (SYSTEM_RE.test(`${mail.fromEmail || ''} ${mail.fromName || ''} ${mail.subject || ''}`)) return 1;
  if (category === '취재 답신') return 9;
  if (category === '제보') return 8;
  if (category === '취재원') return 6;
  if (category === '보도자료') return 4;
  return 3;
}

// 취재원 발언·1차 자료로 쓸 만한 메일인지 (자료 편입 추천 기준)
function ruleSourceWorthy(mail, category) {
  if (SYSTEM_RE.test(`${mail.fromEmail || ''} ${mail.subject || ''}`)) return false;
  return category === '취재 답신' || category === '취재원' || category === '제보';
}

// AI 없이 즉시 적용되는 기본 분류
function applyRules(emails) {
  for (const mail of emails) {
    const category = ruleCategory(mail);
    mail.category = category;
    mail.score = ruleScore(mail, category);
    mail.sourceWorthy = ruleSourceWorthy(mail, category);
    mail.summary = '';
    mail.info = {};
  }
  return emails;
}

// Claude로 취재 관점 재분류 + 브리핑. 실패하면 규칙 기반 결과를 그대로 쓴다.
// deps.runJson은 테스트에서 주입 (운영에서는 claude.js).
async function triage({ apiKey, emails, interests = '' }, deps = {}) {
  applyRules(emails);
  const briefing = { intro: '', todo: [] };
  if (!apiKey || !emails.length) return { emails, briefing, ai: false };

  const runJson = deps.runJson || require('./claude').runJson;
  const compact = emails.map((m) => ({
    id: m.id,
    from: `${m.fromName} <${m.fromEmail}>`,
    subject: m.subject,
    snippet: (m.snippet || '').slice(0, 400),
  }));
  const user = [
    `오늘 날짜: ${new Date().toISOString().slice(0, 10)}`,
    interests ? `기자의 관심 분야: ${interests}` : '',
    '아래 메일을 분류하라.',
    JSON.stringify(compact, null, 0),
  ].filter(Boolean).join('\n\n');

  try {
    const { data } = await runJson({ apiKey, promptName: 'mail_triage', user, maxTokens: 8000 });
    const byId = new Map((data.emails || []).map((e) => [e.id, e]));
    for (const mail of emails) {
      const item = byId.get(mail.id);
      if (!item) continue;
      if (CATEGORIES.includes(item.category)) mail.category = item.category;
      const n = Number(item.score);
      if (Number.isFinite(n)) mail.score = Math.max(0, Math.min(10, Math.round(n)));
      mail.summary = String(item.summary || '').slice(0, 60);
      if (typeof item.sourceWorthy === 'boolean') mail.sourceWorthy = item.sourceWorthy;
      if (item.info && typeof item.info === 'object') {
        mail.info = Object.fromEntries(
          Object.entries(item.info)
            .filter(([, v]) => String(v || '').trim() && !/^(null|none|-)$/i.test(String(v).trim()))
            .map(([k, v]) => [String(k).slice(0, 10), String(v).slice(0, 40)])
            .slice(0, 4)
        );
      }
      const ev = String(item.eventDate || '').trim();
      if (ev && !/^(null|none)$/i.test(ev)) mail.eventDate = ev.slice(0, 25);
    }
    const b = data.briefing;
    if (b && typeof b === 'object') {
      briefing.intro = String(b.intro || '').slice(0, 120);
      briefing.todo = (Array.isArray(b.todo) ? b.todo : [])
        .map((t) => String(t).slice(0, 60))
        .filter(Boolean)
        .slice(0, 3);
    }
    return { emails, briefing, ai: true };
  } catch (e) {
    // AI 실패는 치명적이지 않다 — 규칙 기반 분류로 계속 쓴다
    return { emails, briefing, ai: false, error: String(e.message || e) };
  }
}

module.exports = {
  CATEGORIES, triage, applyRules, ruleCategory, ruleScore, ruleSourceWorthy,
};
