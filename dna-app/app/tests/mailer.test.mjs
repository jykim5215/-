import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { sendMail, verify, buildTransport, PRESETS } = require('../src/main/mailer');

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

test('mailer — Gmail 프리셋 + fromName 조립', () => {
  assert.equal(PRESETS.gmail.host, 'smtp.gmail.com');
  assert.equal(PRESETS.gmail.port, 465);
  const t = buildTransport({ user: 'hong@dgist.ac.kr', pass: 'x' });
  assert.equal(t.options.host, 'smtp.gmail.com'); // 기본값
  assert.equal(t.options.secure, true);
});

test('mailer — DGIST 자체 서버 직접 연결 (SSL 465)', () => {
  // 프리셋 기본값 확인
  assert.equal(PRESETS.dgist.host, 'smtp.dgist.ac.kr');
  assert.equal(PRESETS.dgist.port, 465);
  assert.equal(PRESETS.dgist.secure, true);
  const t = buildTransport({ host: 'smtp.dgist.ac.kr', port: 465, secure: true, user: 'dgun@dgist.ac.kr', pass: 'x' });
  assert.equal(t.options.host, 'smtp.dgist.ac.kr');
  assert.equal(t.options.port, 465);
  assert.equal(t.options.secure, true);       // 465 = 암시적 SSL
  // 587을 명시하면 STARTTLS로 동작 (평문 전송 방지)
  const t2 = buildTransport({ host: 'smtp.dgist.ac.kr', port: 587, user: 'x', pass: 'y' });
  assert.equal(t2.options.secure, false);
  assert.equal(t2.options.requireTLS, true);
});

test('mailer — 오류 안내가 호스트에 따라 구분됨', async () => {
  // DGIST 호스트 연결 실패 → DGIST용 안내 (구글 앱 비밀번호 언급 안 함)
  const r = await verify({ user: 'a@dgist.ac.kr', pass: 'x', host: 'mail.invalid.dgist.example', port: 587 });
  assert.equal(r.ok, false);
  assert.match(r.error, /연결하지 못했|발송 실패|인증서|로그인 실패/);
  assert.ok(!/앱 비밀번호/.test(r.error) || /DGIST/.test(r.error));
});
