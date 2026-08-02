import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  triage, applyRules, ruleCategory, ruleScore, ruleSourceWorthy, CATEGORIES,
} = require('../src/main/mail-triage');

const mk = (o) => ({ subject: '', fromName: '', fromEmail: '', snippet: '', isReply: false, ...o });

test('triage — 규칙 분류: 취재 답신이 최우선', () => {
  const reply = mk({ subject: 'Re: 취재 요청드립니다', isReply: true, fromEmail: 'park@dgist.ac.kr' });
  assert.equal(ruleCategory(reply), '취재 답신');
  assert.equal(ruleScore(reply, '취재 답신'), 9);
  assert.equal(ruleSourceWorthy(reply, '취재 답신'), true);
  // In-Reply-To가 없어도 제목의 Re:로 잡는다
  assert.equal(ruleCategory(mk({ subject: '답장: 인터뷰 관련' })), '취재 답신');
});

test('triage — 규칙 분류: 카테고리별', () => {
  assert.equal(ruleCategory(mk({ subject: '총학생회 공지' })), '학생회');
  assert.equal(ruleCategory(mk({ subject: '[보도자료] 연구 성과', fromName: '홍보실' })), '보도자료');
  assert.equal(ruleCategory(mk({ fromName: '김철수 교수', subject: '문의' })), '취재원');
  assert.equal(ruleCategory(mk({ subject: '학사팀 수강신청 안내' })), '행정·학생팀');
  assert.equal(ruleCategory(mk({ subject: '특강 안내' })), '세미나·행사');
  assert.equal(ruleCategory(mk({ subject: '제보합니다' })), '제보');
  // 모든 규칙 결과는 허용된 카테고리 안에 있어야 한다
  for (const s of ['아무거나', '채용 공고', '동아리 공연']) {
    assert.ok(CATEGORIES.includes(ruleCategory(mk({ subject: s }))));
  }
});

test('triage — 자동발송 메일은 점수 바닥, 자료 후보 아님', () => {
  const sys = mk({ subject: 'Re: LMS 알림', fromEmail: 'no-reply@lms.dgist.ac.kr', isReply: true });
  const cat = ruleCategory(sys);
  assert.equal(ruleScore(sys, cat), 1);
  assert.equal(ruleSourceWorthy(sys, cat), false);
});

test('triage — API 키가 없으면 규칙 분류만으로 동작', async () => {
  const emails = [mk({ id: 'inbox:1', subject: 'Re: 취재 요청', isReply: true })];
  const r = await triage({ apiKey: '', emails });
  assert.equal(r.ai, false);
  assert.equal(r.emails[0].category, '취재 답신');
  assert.deepEqual(r.briefing, { intro: '', todo: [] });
});

test('triage — AI 응답을 반영하되 값은 안전 범위로 자른다', async () => {
  const emails = [
    mk({ id: 'inbox:1', subject: '수강신청 안내' }),
    mk({ id: 'inbox:2', subject: '알 수 없는 메일' }),
  ];
  const fakeRunJson = async () => ({
    data: {
      briefing: { intro: '오늘은 조용합니다.', todo: ['~8/5 회신', 'a', 'b', 'c', 'd'] },
      emails: [
        { id: 'inbox:1', category: '행정·학생팀', score: 99, summary: 'x'.repeat(200),
          info: { 일시: '8/12 10:00', 장소: '', 마감: 'null' }, eventDate: '2026-08-12T10:00', sourceWorthy: true },
        { id: 'inbox:2', category: '존재하지않는카테고리', score: 'abc' },
      ],
    },
  });
  const r = await triage({ apiKey: 'k', emails }, { runJson: fakeRunJson });
  assert.equal(r.ai, true);
  const [a, b] = r.emails;
  assert.equal(a.category, '행정·학생팀');
  assert.equal(a.score, 10);                       // 0~10으로 clamp
  assert.equal(a.summary.length, 60);              // 60자로 절단
  assert.deepEqual(Object.keys(a.info), ['일시']); // 빈 값·null은 제거
  assert.equal(a.eventDate, '2026-08-12T10:00');
  assert.equal(a.sourceWorthy, true);
  // 잘못된 카테고리·점수는 무시하고 규칙 결과 유지
  assert.ok(CATEGORIES.includes(b.category));
  assert.ok(Number.isFinite(b.score));
  assert.equal(r.briefing.todo.length, 3);         // 최대 3개
});

test('triage — AI 실패해도 규칙 분류로 계속 동작', async () => {
  const emails = [mk({ id: 'inbox:1', subject: 'Re: 인터뷰', isReply: true })];
  const boom = async () => { throw new Error('네트워크 오류'); };
  const r = await triage({ apiKey: 'k', emails }, { runJson: boom });
  assert.equal(r.ai, false);
  assert.match(r.error, /네트워크 오류/);
  assert.equal(r.emails[0].category, '취재 답신'); // 규칙 결과는 살아 있다
});

test('triage — applyRules는 모든 메일에 필드를 채운다', () => {
  const emails = [mk({ id: '1', subject: 'a' }), mk({ id: '2', subject: 'Re: b', isReply: true })];
  applyRules(emails);
  for (const m of emails) {
    assert.ok(CATEGORIES.includes(m.category));
    assert.equal(typeof m.score, 'number');
    assert.equal(typeof m.sourceWorthy, 'boolean');
    assert.deepEqual(m.info, {});
  }
});
