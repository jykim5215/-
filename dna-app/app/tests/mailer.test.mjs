import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  sendMail,
  verify,
  buildTransport,
  buildMailOptions,
  normalizeAttachments,
  cleanAddressList,
  validateAddressList,
  candidatePlans,
  withFallback,
  isConnectionError,
  isAuthError,
  PRESETS,
} = require('../src/main/mailer');

test('mailer — 설정 누락 검증', async () => {
  const r = await verify({ user: '', pass: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /이메일 주소와 비밀번호/);
});

test('mailer — 받는 사람 주소 검증', async () => {
  await assert.rejects(
    sendMail({ to: 'not-an-email', subject: 's', body: 'b' }, { user: 'a@b.com', pass: 'x' }),
    /받는 사람 이메일/
  );
  await assert.rejects(
    sendMail({ to: 'x@y.com', subject: 's', body: 'b' }, { user: '', pass: '' }),
    /이메일 주소와 비밀번호/
  );
});

test('mailer — 참조 주소 목록 정규화와 검증', () => {
  assert.equal(cleanAddressList('a@dgist.ac.kr; DNA <b@dgist.ac.kr>'), 'a@dgist.ac.kr, DNA <b@dgist.ac.kr>');
  assert.doesNotThrow(() => validateAddressList('DNA <b@dgist.ac.kr>', '참조'));
  assert.throws(() => validateAddressList('bad-address', '참조'), /참조 이메일 주소/);
});

test('mailer — DGIST 프리셋 + fromName 조립', () => {
  assert.equal(PRESETS.dgist.host, 'mail.dgist.ac.kr');
  assert.equal(PRESETS.dgist.port, 587);
  assert.equal(PRESETS.gmail.host, 'smtp.gmail.com');
  assert.equal(PRESETS.gmail.port, 465);
  const t = buildTransport({ user: 'hong@dgist.ac.kr', pass: 'x' });
  assert.equal(t.options.host, 'mail.dgist.ac.kr'); // 기본값
  assert.equal(t.options.port, 587);
  assert.equal(t.options.secure, false);
  assert.equal(t.options.requireTLS, true);
  assert.equal(t.options.tls.servername, 'mail.dgist.ac.kr');
});

test('mailer — DGIST 자체 서버 직접 연결 (STARTTLS 587)', () => {
  const t = buildTransport({ host: 'mail.dgist.ac.kr', port: 587, user: 'dgun@dgist.ac.kr', pass: 'x' });
  assert.equal(t.options.host, 'mail.dgist.ac.kr');
  assert.equal(t.options.port, 587);
  assert.equal(t.options.secure, false);      // 587 = STARTTLS
  assert.equal(t.options.requireTLS, true);   // 평문 전송 방지
  // 465는 암시적 SSL
  const t2 = buildTransport({ host: 'mail.dgist.ac.kr', port: 465, user: 'x', pass: 'y' });
  assert.equal(t2.options.secure, true);
});

test('mailer — 오류 안내가 호스트에 따라 구분됨', async () => {
  // DGIST 호스트 연결 실패 → DGIST용 안내 (구글 앱 비밀번호 언급 안 함)
  const r = await verify({ user: 'a@dgist.ac.kr', pass: 'x', host: 'mail.invalid.dgist.example', port: 587 });
  assert.equal(r.ok, false);
  assert.match(r.error, /연결하지 못했|발송 실패|인증서|로그인 실패/);
  assert.ok(!/앱 비밀번호/.test(r.error) || /DGIST/.test(r.error));
});

test('mailer — 참조·숨은참조·첨부 옵션 조립', () => {
  const opts = buildMailOptions({
    to: 'a@dgist.ac.kr',
    cc: 'b@dgist.ac.kr',
    bcc: ['c@dgist.ac.kr'],
    subject: 's',
    body: 'b',
    attachments: [
      { name: '../unsafe:name.txt', type: 'text/plain', buffer: Buffer.from('hello') },
    ],
  }, { user: 'dna@dgist.ac.kr', fromName: 'DNA 기자' });

  assert.equal(opts.from, 'DNA 기자 <dna@dgist.ac.kr>');
  assert.equal(opts.cc, 'b@dgist.ac.kr');
  assert.equal(opts.bcc, 'c@dgist.ac.kr');
  assert.equal(opts.attachments.length, 1);
  assert.equal(opts.attachments[0].filename, 'unsafe_name.txt');
  assert.equal(opts.attachments[0].content.toString(), 'hello');
});

test('mailer — 폴백 후보: DGIST는 포트 587↔465 + 로컬파트 로그인', () => {
  const plans = candidatePlans({ user: 'hong@dgist.ac.kr', pass: 'x', host: 'mail.dgist.ac.kr', port: 587 });
  assert.deepEqual(plans.map((p) => [p.port, p.user]), [
    [587, 'hong@dgist.ac.kr'],
    [587, 'hong'],
    [465, 'hong@dgist.ac.kr'],
    [465, 'hong'],
  ]);
  // Gmail은 로컬파트 재시도 없음
  const gmail = candidatePlans({ user: 'a@gmail.com', pass: 'x', host: 'smtp.gmail.com', port: 465 });
  assert.deepEqual(gmail.map((p) => [p.port, p.user]), [[465, 'a@gmail.com'], [587, 'a@gmail.com']]);
});

test('mailer — 오류 분류', () => {
  assert.ok(isConnectionError(new Error('connect ECONNREFUSED 1.2.3.4:587')));
  assert.ok(isConnectionError(new Error('Greeting never received')));
  assert.ok(isAuthError(new Error('535 5.7.8 Authentication failed')));
  assert.ok(!isAuthError(new Error('connect ETIMEDOUT')));
});

test('mailer — 연결 오류면 같은 포트는 건너뛰고 다음 포트로 폴백', async () => {
  const tried = [];
  const cfg = { user: 'hong@dgist.ac.kr', pass: 'x', host: 'mail.dgist.ac.kr', port: 587 };
  const { plan } = await withFallback(cfg, async (_t, p) => {
    tried.push([p.port, p.user]);
    if (p.port === 587) throw new Error('connect ETIMEDOUT 1.2.3.4:587');
    return 'ok';
  });
  // 587 전체주소에서 연결 실패 → 587 로컬파트는 건너뛰고 바로 465
  assert.deepEqual(tried, [[587, 'hong@dgist.ac.kr'], [465, 'hong@dgist.ac.kr']]);
  assert.equal(plan.port, 465);
});

test('mailer — 인증 오류면 같은 포트에서 로컬파트로 재시도', async () => {
  const tried = [];
  const cfg = { user: 'hong@dgist.ac.kr', pass: 'x', host: 'mail.dgist.ac.kr', port: 587 };
  const { plan } = await withFallback(cfg, async (_t, p) => {
    tried.push([p.port, p.user]);
    if (p.user.includes('@')) throw new Error('535 Authentication failed');
    return 'ok';
  });
  assert.deepEqual(tried, [[587, 'hong@dgist.ac.kr'], [587, 'hong']]);
  assert.equal(plan.user, 'hong');
});

test('mailer — 전부 실패하면 시도 내역이 오류에 담김', async () => {
  const cfg = { user: 'hong@dgist.ac.kr', pass: 'x', host: 'mail.dgist.ac.kr', port: 587 };
  await assert.rejects(
    withFallback(cfg, async () => { throw new Error('connect ETIMEDOUT'); }),
    (e) => /시도:/.test(e.message) && /587/.test(e.message) && /465/.test(e.message)
  );
});

test('mailer — base64 첨부 정규화', () => {
  const a = normalizeAttachments([{ name: 'x.pdf', base64: Buffer.from('pdf').toString('base64') }]);
  assert.equal(a.length, 1);
  assert.equal(a[0].filename, 'x.pdf');
  assert.equal(a[0].content.toString(), 'pdf');
});
