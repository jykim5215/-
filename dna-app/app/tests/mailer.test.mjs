import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { sendMail, verify, buildTransport, PRESETS } = require('../src/main/mailer');

test('mailer — 설정 누락 검증', async () => {
  const r = await verify({ user: '', pass: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /이메일 주소와 앱 비밀번호/);
});

test('mailer — 받는 사람 주소 검증', async () => {
  await assert.rejects(
    sendMail({ to: 'not-an-email', subject: 's', body: 'b' }, { user: 'a@b.com', pass: 'x' }),
    /받는 사람 이메일/
  );
  await assert.rejects(
    sendMail({ to: 'x@y.com', subject: 's', body: 'b' }, { user: '', pass: '' }),
    /이메일 주소와 앱 비밀번호/
  );
});

test('mailer — Gmail 프리셋 + fromName 조립', () => {
  assert.equal(PRESETS.gmail.host, 'smtp.gmail.com');
  assert.equal(PRESETS.gmail.port, 465);
  const t = buildTransport({ user: 'hong@dgist.ac.kr', pass: 'x' });
  assert.equal(t.options.host, 'smtp.gmail.com'); // 기본값
  assert.equal(t.options.secure, true);
});

test('mailer — 잘못된 자격증명은 사용자 언어 오류로', async () => {
  // 존재하지 않는 SMTP 호스트 → 연결 오류 메시지 매핑
  const r = await verify({ user: 'a@b.com', pass: 'x', host: 'smtp.invalid.nonexistent.example', port: 465 });
  assert.equal(r.ok, false);
  assert.match(r.error, /연결하지 못했|발송 실패|인증서/);
});
