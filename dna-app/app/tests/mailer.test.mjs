import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  sendMail, verify, buildTransport, PRESETS, splitAddrs, normalizeAttachments,
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

test('mailer — 설정을 비우면 DGIST가 기본값 (Gmail 아님)', () => {
  assert.equal(PRESETS.gmail.host, 'smtp.gmail.com');
  assert.equal(PRESETS.gmail.port, 465);
  // 호스트를 안 넣어도 DGIST로 나가야 한다. 예전엔 Gmail이 기본이라
  // DGIST 계정으로 구글에 로그인 시도해 무조건 실패했다.
  const t = buildTransport({ user: 'hong@dgist.ac.kr', pass: 'x' });
  assert.equal(t.options.host, 'smtp.dgist.ac.kr');
  assert.equal(t.options.port, 465);
  assert.equal(t.options.secure, true);
});

test('mailer — 호스트 미설정 시 Gmail 앱 비밀번호 안내가 나오지 않는다', async () => {
  const r = await verify({ user: 'a@dgist.ac.kr', pass: 'x', host: 'nonexistent.dgist.invalid', port: 465 });
  assert.equal(r.ok, false);
  assert.ok(!/앱 비밀번호/.test(r.error), r.error);
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

test('mailer — 주소 분리 (쉼표·세미콜론·공백)', () => {
  assert.deepEqual(splitAddrs('a@b.com, c@d.com;e@f.com'), ['a@b.com', 'c@d.com', 'e@f.com']);
  assert.deepEqual(splitAddrs(''), []);
  assert.deepEqual(splitAddrs('쓰레기, x@y.com'), ['x@y.com']); // @ 없는 값은 버림
  assert.deepEqual(splitAddrs(['a@b.com', 'c@d.com']), ['a@b.com', 'c@d.com']);
});

test('mailer — 첨부 정규화: 파일명 주입 차단 + 20MB 상한', () => {
  const [att] = normalizeAttachments([
    { filename: '취재\r\n메모: x/../etc.txt', content: Buffer.from('hi').toString('base64') },
  ]);
  assert.ok(!/[\r\n]/.test(att.filename));       // 헤더 주입 방지
  assert.ok(!att.filename.includes('/'));        // 경로 구분자 제거
  assert.equal(att.content.toString(), 'hi');
  // 총 20MB 초과는 거부
  const big = Buffer.alloc(11 * 1024 * 1024).toString('base64');
  assert.throws(
    () => normalizeAttachments([{ filename: 'a', content: big }, { filename: 'b', content: big }]),
    /20MB/
  );
});

test('mailer — 참조·숨은참조·첨부·스레딩이 메시지에 반영', async () => {
  const sent = [];
  // 실제 SMTP 연결 없이 조립된 메시지를 검사 (transport 주입)
  const fakeTransport = { sendMail: async (m) => { sent.push(m); return { messageId: '<x>', accepted: m.to }; } };
  {
    const res = await sendMail({
      to: 'a@dgist.ac.kr, b@dgist.ac.kr',
      cc: 'c@dgist.ac.kr',
      bcc: 'secret@dgist.ac.kr',
      subject: '취재 요청',
      body: '<p>안녕하세요</p>',
      html: true,
      inReplyTo: '<prev@dgist.ac.kr>',
      references: '<older@dgist.ac.kr>',
      attachments: [{ filename: '질문지.txt', content: Buffer.from('Q1').toString('base64') }],
    }, { user: 'me@dgist.ac.kr', pass: 'x', fromName: '디지스트신문 DNA 기자 홍길동' },
       { buildTransport: () => fakeTransport });

    const m = sent[0];
    assert.deepEqual(m.to, ['a@dgist.ac.kr', 'b@dgist.ac.kr']);
    assert.deepEqual(m.cc, ['c@dgist.ac.kr']);
    assert.deepEqual(m.bcc, ['secret@dgist.ac.kr']);
    assert.equal(m.html, '<p>안녕하세요</p>');
    assert.equal(m.text, undefined);              // html이면 text 없음
    assert.equal(m.inReplyTo, '<prev@dgist.ac.kr>');
    assert.equal(m.references, '<older@dgist.ac.kr> <prev@dgist.ac.kr>');
    assert.equal(m.attachments.length, 1);
    assert.equal(m.from, '디지스트신문 DNA 기자 홍길동 <me@dgist.ac.kr>');
    assert.equal(res.count, 4);                   // to2 + cc1 + bcc1
  }
});

test('mailer — EHLO 이름을 ASCII로 고정 (한글 PC 이름 대응)', () => {
  const t = buildTransport({ host: 'smtp.dgist.ac.kr', port: 465, user: 'a', pass: 'b' });
  assert.equal(t.options.name, 'localhost');
});
