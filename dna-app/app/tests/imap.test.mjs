import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  PRESETS,
  buildClientOptions,
  isReportingMail,
  normalizeSummary,
  listInbox,
  readInboxMessage,
  htmlToText,
  verifyInbox,
  imapError,
} = require('../src/main/imap');

class FakeImapClient {
  constructor(options) {
    this.options = options;
    this.mailbox = { exists: 3 };
    FakeImapClient.last = this;
  }

  async connect() {
    this.connected = true;
  }

  async getMailboxLock(path) {
    this.lockedPath = path;
    return { release: () => { this.released = true; } };
  }

  async fetchAll(range, query) {
    this.range = range;
    this.query = query;
    return [
      {
        uid: 10,
        envelope: {
          subject: '이전 회신',
          from: [{ name: 'A', address: 'a@dgist.ac.kr' }],
          to: [{ address: 'dna@dgist.ac.kr' }],
          date: new Date('2026-07-07T01:00:00Z'),
          messageId: '<a>',
        },
        flags: new Set(['\\Seen']),
        size: 100,
      },
      {
        uid: 12,
        envelope: {
          subject: '식단표 안내',
          from: [{ name: 'Notice', address: 'notice@dgist.ac.kr' }],
          to: [{ address: 'dna@dgist.ac.kr' }],
          date: new Date('2026-07-08T02:00:00Z'),
          messageId: '<c>',
        },
        flags: new Set(),
        size: 50,
      },
      {
        uid: 11,
        envelope: {
          subject: '최신 회신',
          from: [{ name: 'B', address: 'b@dgist.ac.kr' }],
          to: [{ address: 'dna@dgist.ac.kr' }],
          date: new Date('2026-07-08T01:00:00Z'),
          messageId: '<b>',
        },
        flags: new Set(),
        size: 200,
      },
    ];
  }

  async fetchOne(uid, query, options) {
    this.readUid = uid;
    this.readQuery = query;
    this.readOptions = options;
    return {
      uid: Number(uid),
      envelope: {
        subject: '원본 제목',
        from: [{ name: 'B', address: 'b@dgist.ac.kr' }],
        date: new Date('2026-07-08T01:00:00Z'),
      },
      flags: new Set(),
      source: Buffer.from('Subject: 최신 회신\r\n\r\n본문입니다.'),
    };
  }

  async logout() {
    this.loggedOut = true;
  }
}

test('imap — DGIST SSL/TLS 기본 설정', () => {
  assert.equal(PRESETS.dgist.host, 'mail.dgist.ac.kr');
  assert.equal(PRESETS.dgist.port, 993);
  assert.equal(PRESETS.dgist.secure, true);
  const options = buildClientOptions({ user: 'dna@dgist.ac.kr', pass: 'secret' });
  assert.equal(options.host, 'mail.dgist.ac.kr');
  assert.equal(options.port, 993);
  assert.equal(options.secure, true);
  assert.deepEqual(options.auth, { user: 'dna@dgist.ac.kr', pass: 'secret' });
});

test('imap — 최근 받은메일 목록 정렬과 잠금 해제', async () => {
  const res = await listInbox(
    { user: 'dna@dgist.ac.kr', pass: 'secret' },
    { ClientClass: FakeImapClient, limit: 10 }
  );
  assert.equal(res.exists, 3);
  assert.equal(res.messages.length, 2);
  assert.equal(res.messages[0].uid, 11);
  assert.equal(res.messages[0].seen, false);
  assert.equal(res.messages[1].seen, true);
  assert.equal(FakeImapClient.last.lockedPath, 'INBOX');
  assert.equal(FakeImapClient.last.released, true);
  assert.equal(FakeImapClient.last.loggedOut, true);
});

test('imap — 취재 관련 필터와 전체 보기', async () => {
  const reporting = await listInbox(
    { user: 'dna@dgist.ac.kr', pass: 'secret' },
    { ClientClass: FakeImapClient, limit: 10, filter: 'reporting' }
  );
  assert.deepEqual(reporting.messages.map((m) => m.uid), [11, 10]);

  const all = await listInbox(
    { user: 'dna@dgist.ac.kr', pass: 'secret' },
    { ClientClass: FakeImapClient, limit: 10, filter: 'all' }
  );
  assert.deepEqual(all.messages.map((m) => m.uid), [12, 11, 10]);
});

test('imap — 단일 메일 읽기와 본문 파싱', async () => {
  const res = await readInboxMessage(
    { user: 'dna@dgist.ac.kr', pass: 'secret' },
    11,
    {
      ClientClass: FakeImapClient,
      parser: async () => ({
        subject: '파싱된 제목',
        from: { text: 'B <b@dgist.ac.kr>' },
        to: { text: 'DNA <dna@dgist.ac.kr>' },
        date: new Date('2026-07-08T01:00:00Z'),
        text: '본문입니다.',
        attachments: [{ filename: 'file.pdf', contentType: 'application/pdf', size: 12 }],
      }),
    }
  );
  assert.equal(res.uid, 11);
  assert.equal(res.subject, '파싱된 제목');
  assert.equal(res.from, 'B <b@dgist.ac.kr>');
  assert.equal(res.text, '본문입니다.');
  assert.deepEqual(res.attachments, [{ filename: 'file.pdf', contentType: 'application/pdf', size: 12 }]);
  assert.equal(FakeImapClient.last.readOptions.uid, true);
});

test('imap — 설정 누락과 로그인 오류 안내', async () => {
  const missing = await verifyInbox({ user: '', pass: '' }, { ClientClass: FakeImapClient });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /DGIST 이메일 주소와 비밀번호/);

  assert.match(
    imapError(new Error('NO [AUTHENTICATIONFAILED] Authentication failed')),
    /로그인 실패/
  );
  assert.match(
    imapError(new Error('connect ETIMEDOUT')),
    /메일 서버에 연결하지 못했습니다/
  );
});

test('imap — summary 정규화', () => {
  const s = normalizeSummary({
    uid: 3,
    envelope: {
      subject: '',
      from: [{ address: 'x@dgist.ac.kr' }],
      date: new Date('2026-07-08T00:00:00Z'),
    },
    flags: new Set(['\\Flagged']),
  });
  assert.equal(s.subject, '(제목 없음)');
  assert.equal(s.from, 'x@dgist.ac.kr');
  assert.equal(s.flagged, true);
});

test('imap — 취재 요청/회신성 메일 판별', () => {
  assert.equal(isReportingMail({ subject: '[디지스트신문 DNA] 인터뷰 요청', from: '', to: '' }), true);
  assert.equal(isReportingMail({ subject: 'Re: 조정부 취재 건', from: '', to: 'dna@dgist.ac.kr' }, 'dna@dgist.ac.kr'), true);
  assert.equal(isReportingMail({ subject: '식단표 안내', from: 'notice@dgist.ac.kr', to: '' }), false);
});

test('imap — html-only 본문 텍스트 변환', () => {
  assert.equal(
    htmlToText('<p>안녕하세요&nbsp;DNA</p><script>alert(1)</script><p>답변입니다.</p>'),
    '안녕하세요 DNA\n\n답변입니다.'
  );
});
