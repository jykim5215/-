// 수신 파이프라인 통합 테스트 — 가짜 IMAP 서버에 실제 소켓으로 붙어
// fetchRecent / markRead / markAllRead / deleteMessage 전 경로를 그대로 태운다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { createFakeImapServer, utf7Encode } from './helpers/fake-imap-server.mjs';
const require = createRequire(import.meta.url);

const mailbox = require('../src/main/mailbox');
const { MiniIMAP } = require('../src/main/imap');

// 평문 소켓으로 MiniIMAP을 만든다 (운영 경로는 TLS 고정, 여기서만 주입)
function plainClientFactory(port) {
  return async () => {
    const socket = await new Promise((res, rej) => {
      const s = net.connect({ host: '127.0.0.1', port }, () => res(s));
      s.once('error', rej);
    });
    const client = new MiniIMAP(socket);
    await client.reader.readLine(); // 서버 인사말
    return client;
  };
}

async function withServer(fn, opts) {
  const fake = createFakeImapServer(opts);
  const port = await fake.listen();
  try {
    return await fn({ deps: { createClient: plainClientFactory(port) }, fake });
  } finally {
    await fake.close();
  }
}

const CFG = { user: 'dgun_189@dgist.ac.kr', pass: 'secret' };

test('통합 — 받기 테스트가 한글 폴더명을 그대로 읽어온다', async () => {
  await withServer(async ({ deps }) => {
    const r = await mailbox.verify(CFG, deps);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.folders, ['INBOX', '보낸 편지함', '광고 편지함', '지운 편지함', '스팸 편지함']);
  });
});

test('통합 — 비밀번호가 틀리면 사용자 언어 오류', async () => {
  await withServer(async ({ deps }) => {
    const r = await mailbox.verify({ ...CFG, pass: 'wrong' }, deps);
    assert.equal(r.ok, false);
    assert.match(r.error, /로그인 실패/);
    assert.match(r.error, /IMAP 사용이 켜져/); // 웹메일 설정 안내 포함
  });
});

test('통합 — 메일 수집: euc-kr·quoted-printable·HTML 본문이 모두 한글로 복원', async () => {
  await withServer(async ({ deps }) => {
    const res = await mailbox.fetchRecent(CFG, { days: 3650 }, deps);
    assert.equal(res.ok, true);
    assert.deepEqual(res.errors, [], '메일 파싱 오류가 없어야 한다');

    // 붕어빵 앱과 동일하게 분류되는 폴더를 전부 수집 (휴지통·스팸 포함)
    assert.deepEqual(res.folders.sort(), ['inbox', 'promo', 'sent', 'spam', 'trash']);
    // 휴지통 메일은 trash 폴더로만 들어가고 받은편지함을 오염시키지 않는다
    const trash = res.emails.filter((m) => m.folder === 'trash');
    assert.equal(trash.length, 1);
    assert.equal(trash[0].uid, 301);

    const inbox = res.emails.filter((m) => m.folder === 'inbox');
    assert.equal(inbox.length, 3);

    // 1) utf-8 제목 + quoted-printable 본문
    const a = inbox.find((m) => m.uid === 101);
    assert.equal(a.subject, '수강신청 안내');
    assert.equal(a.fromName, '학생팀');
    assert.equal(a.fromEmail, 'team@dgist.ac.kr');
    assert.match(a.body, /수강신청 일정을 안내합니다/);
    assert.equal(a.unread, true);

    // 2) euc-kr 제목·발신자 + base64 euc-kr 본문 + 답신 판정
    const b = inbox.find((m) => m.uid === 102);
    assert.equal(b.fromName, '박성현');
    assert.match(b.subject, /^Re:/);
    assert.match(b.body, /인터뷰 가능합니다/);
    assert.equal(b.isReply, true, 'In-Reply-To가 있으면 답신');

    // 3) HTML 본문 → CSS 없이 평문, &nbsp;는 일반 공백
    const c = inbox.find((m) => m.uid === 103);
    assert.ok(!c.body.includes('color'), c.body);
    assert.equal(c.body, '보도자료 입니다');
    assert.equal(c.unread, false); // \Seen

    // 보낸 편지함도 수집
    const sent = res.emails.filter((m) => m.folder === 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].toEmail, 'park@dgist.ac.kr');

    // 연락처: 보낸 편지함의 받는 사람까지 포함, @dgist 우선
    const emails = res.contacts.map((c2) => c2.email);
    assert.ok(emails.includes('park@dgist.ac.kr'));
    assert.ok(emails.includes('team@dgist.ac.kr'));
    assert.ok(res.contacts.every((c2) => c2.email.endsWith('dgist.ac.kr')));
  });
});

test('통합 — 열람해도 서버 읽음 상태가 바뀌지 않는다 (BODY.PEEK)', async () => {
  await withServer(async ({ deps, fake }) => {
    await mailbox.fetchRecent(CFG, { days: 3650 }, deps);
    // 수집만으로는 STORE(\Seen)가 한 번도 나가면 안 된다
    assert.deepEqual(fake.state.stores, []);
  });
});

test('통합 — 읽음 표시 / 전체 읽음', async () => {
  await withServer(async ({ deps, fake }) => {
    const r = await mailbox.markRead(CFG, 101, 'inbox', true, deps);
    assert.equal(r.ok, true);
    assert.deepEqual(fake.state.stores.at(-1), { uid: 101, op: '+FLAGS', flags: '(\\Seen)', folder: 'INBOX' });

    // 안읽은 메일만 골라 읽음 처리 (101은 위에서 이미 읽음 → 102만 남음)
    const all = await mailbox.markAllRead(CFG, 'inbox', deps);
    assert.equal(all.ok, true);
    assert.equal(all.count, 1);
  });
});

test('통합 — 삭제는 휴지통 복사 후 EXPUNGE (한글 휴지통 폴더 인식)', async () => {
  await withServer(async ({ deps, fake }) => {
    const r = await mailbox.deleteMessage(CFG, 102, 'inbox', deps);
    assert.equal(r.ok, true);
    // 휴지통 폴더를 UTF-7 raw 이름으로 찾아 복사했는지
    assert.equal(fake.state.copies.length, 1);
    assert.equal(fake.state.copies[0].uid, 102);
    assert.equal(fake.state.copies[0].dest, utf7Encode('지운 편지함'));
    // 원본에 \Deleted + EXPUNGE
    assert.match(fake.state.stores.at(-1).flags, /\\Deleted/);
    assert.equal(fake.state.expunged, 1);
  });
});

test('통합 — 보낸 편지함으로 폴더를 지정하면 그 폴더에서 동작', async () => {
  await withServer(async ({ deps, fake }) => {
    await mailbox.markRead(CFG, 201, 'sent', true, deps);
    assert.equal(fake.state.selected, utf7Encode('보낸 편지함'));
  });
});

test('통합 — 계정 미입력은 즉시 안내', async () => {
  await assert.rejects(
    mailbox.fetchRecent({ user: '', pass: '' }, {}, {}),
    /학교 이메일 계정을 먼저 입력/
  );
});


test('통합 — 붕어빵 앱과 서버 설정이 동일', async () => {
  const { DEFAULT_IMAP, DEFAULT_INTERESTS } = mailbox;
  const { PRESETS } = require('../src/main/mailer');
  // 받기 (IMAP)
  assert.equal(DEFAULT_IMAP.host, 'mail.dgist.ac.kr');
  assert.equal(DEFAULT_IMAP.port, 993);
  // 보내기 (SMTP) — 설정을 비워도 이 값이 쓰인다
  assert.equal(PRESETS.dgist.host, 'smtp.dgist.ac.kr');
  assert.equal(PRESETS.dgist.port, 465);
  assert.equal(PRESETS.dgist.secure, true);
  // 관심사 기본값
  assert.equal(DEFAULT_INTERESTS, '전공 탐색, 취업, 음악, 세미나');
});
