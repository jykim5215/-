import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  MiniIMAP, quote, classifyFolder, parseAddress, parseMessage, buildContacts,
} = require('../src/main/imap');
const { imapUtf7Decode, decodeMimeWords, decodeBodySnippet, cleanHtmlToText } = require('../src/main/mime');

// 스크립트대로 응답하는 가짜 IMAP 소켓 (DGIST 서버의 리터럴 응답 형태를 흉내)
class FakeSocket extends PassThrough {
  constructor(script) {
    super();
    this.script = script;      // (commandText) => Buffer|string 응답
    this.sent = [];
  }
  write(chunk, enc, cb) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    this.sent.push(text);
    const reply = this.script(text);
    if (reply != null) setImmediate(() => this.push(Buffer.isBuffer(reply) ? reply : Buffer.from(reply, 'binary')));
    if (cb) cb();
    return true;
  }
  destroy() { /* 테스트에서는 no-op */ }
}

function tagOf(cmd) { return cmd.split(' ')[0]; }

test('imap — 인용 시 CR/LF 주입 차단', () => {
  // 비밀번호에 개행이 섞여도 IMAP 명령을 새로 주입할 수 없어야 한다
  assert.equal(quote('pw\r\nA001 DELETE INBOX'), '"pwA001 DELETE INBOX"');
  assert.equal(quote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(quote(null), '""');
});

test('imap — LOGIN 성공/실패 처리', async () => {
  const sock = new FakeSocket((cmd) => `${tagOf(cmd)} OK LOGIN completed\r\n`);
  const c = new MiniIMAP(sock);
  await c.login('a@dgist.ac.kr', 'pw');
  assert.match(sock.sent[0], /^A001 LOGIN "a@dgist\.ac\.kr" "pw"\r\n$/);

  const bad = new FakeSocket((cmd) => `${tagOf(cmd)} NO login failed\r\n`);
  await assert.rejects(new MiniIMAP(bad).login('a', 'b'), /로그인에 실패/);
});

test('imap — 폴더 목록 UTF-7 디코드 + 분류', async () => {
  const sock = new FakeSocket((cmd) => (
    '* LIST (\\HasNoChildren) "/" "INBOX"\r\n' +
    '* LIST (\\HasNoChildren) "/" "&vPSwuA- &07jJwNVo-"\r\n' +   // 보낸 편지함
    '* LIST (\\HasNoChildren) "/" "&ycDGtA- &07jJwNVo-"\r\n' +   // 지운 편지함
    `${tagOf(cmd)} OK LIST completed\r\n`
  ));
  const folders = await new MiniIMAP(sock).listFolders();
  assert.deepEqual(folders.map((f) => f.name), ['INBOX', '보낸 편지함', '지운 편지함']);
  assert.deepEqual(folders.map((f) => classifyFolder(f.name)), ['inbox', 'sent', 'trash']);
});

test('imap — UID SEARCH 결과 파싱', async () => {
  const sock = new FakeSocket((cmd) => `* SEARCH 12 7 33\r\n${tagOf(cmd)} OK SEARCH completed\r\n`);
  const c = new MiniIMAP(sock);
  assert.deepEqual(await c.searchSince(new Date('2026-08-01T00:00:00Z')), [7, 12, 33]); // 정렬됨
  assert.match(c.socket.sent.at(-1), /UID SEARCH SINCE 01-Aug-2026/);
  assert.deepEqual(await c.searchUnseen(), [12, 7, 33]);
});

test('imap — FETCH 리터럴 응답 파싱 (헤더+본문+플래그)', async () => {
  const headers =
    'From: =?utf-8?B?7ZmN6ri464-Z?= <hong@dgist.ac.kr>\r\n' +
    'To: reporter@dgist.ac.kr\r\n' +
    'Subject: =?utf-8?B?7Leo7J6sIOyalOyyrSDtmowg64u1?=\r\n' +
    'Date: Fri, 01 Aug 2026 10:00:00 +0900\r\n' +
    'Message-ID: <abc@dgist.ac.kr>\r\n' +
    'In-Reply-To: <prev@dgist.ac.kr>\r\n';
  const body = Buffer.from('답장 본문입니다. 인터뷰 가능합니다.', 'utf8');
  const sock = new FakeSocket((cmd) => Buffer.concat([
    Buffer.from(`* 1 FETCH (FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM TO SUBJECT)] {${Buffer.byteLength(headers)}}\r\n`, 'binary'),
    Buffer.from(headers, 'binary'),
    Buffer.from(` BODY[1]<0> {${body.length}}\r\n`, 'binary'),
    body,
    Buffer.from(`)\r\n${tagOf(cmd)} OK FETCH completed\r\n`, 'binary'),
  ]));
  const raw = await new MiniIMAP(sock).fetchMessage(42);
  assert.equal(raw.seen, true);

  const mail = parseMessage(raw, 42, 'inbox');
  assert.equal(mail.id, 'inbox:42');
  assert.equal(mail.subject, '취재 요청 회 답');
  assert.equal(mail.fromName, '홍길동');
  assert.equal(mail.fromEmail, 'hong@dgist.ac.kr');
  assert.equal(mail.unread, false);      // \Seen 이므로 읽음
  assert.equal(mail.isReply, true);      // In-Reply-To 존재 → 답신
  assert.match(mail.body, /인터뷰 가능합니다/);
  assert.equal(mail.messageId, '<abc@dgist.ac.kr>');
});

test('imap — BODY.PEEK 사용으로 열람만으로 읽음 처리되지 않음', async () => {
  const sock = new FakeSocket((cmd) => `${tagOf(cmd)} OK FETCH completed\r\n`);
  await new MiniIMAP(sock).fetchMessage(7);
  assert.match(sock.sent[0], /BODY\.PEEK\[HEADER\.FIELDS/);
  assert.match(sock.sent[0], /BODY\.PEEK\[1\]/);
  assert.ok(!/BODY\[1\]/.test(sock.sent[0].replace(/BODY\.PEEK\[1\]/g, '')));
});

test('imap — 플래그 저장 / 복사 / EXPUNGE 명령 형식', async () => {
  const sock = new FakeSocket((cmd) => `${tagOf(cmd)} OK done\r\n`);
  const c = new MiniIMAP(sock);
  assert.equal(await c.storeFlag(5, '\\Seen', true), true);
  assert.match(sock.sent.at(-1), /UID STORE 5 \+FLAGS \(\\Seen\)/);
  await c.storeFlag(5, '\\Seen', false);
  assert.match(sock.sent.at(-1), /UID STORE 5 -FLAGS \(\\Seen\)/);
  await c.copyTo(5, '&ycDGtA- &07jJwNVo-');
  assert.match(sock.sent.at(-1), /UID COPY 5 "&ycDGtA- &07jJwNVo-"/);
  await c.expunge();
  assert.match(sock.sent.at(-1), /EXPUNGE/);
});

test('imap — 주소 파싱', () => {
  assert.deepEqual(parseAddress('=?utf-8?B?7ZmN6ri464-Z?= <hong@dgist.ac.kr>'),
    { name: '홍길동', email: 'hong@dgist.ac.kr' });
  assert.deepEqual(parseAddress('plain@dgist.ac.kr'), { name: '', email: 'plain@dgist.ac.kr' });
  assert.deepEqual(parseAddress('"김 기자" <kim@dgist.ac.kr>'), { name: '김 기자', email: 'kim@dgist.ac.kr' });
});

test('imap — 연락처는 @dgist 우선, 빈도순', () => {
  const contacts = buildContacts([
    { folder: 'inbox', fromName: '외부', fromEmail: 'x@naver.com' },
    { folder: 'inbox', fromName: '외부', fromEmail: 'x@naver.com' },
    { folder: 'inbox', fromName: '홍길동', fromEmail: 'hong@dgist.ac.kr' },
    { folder: 'sent', fromName: '나', fromEmail: 'me@dgist.ac.kr', toName: '학생팀', toEmail: 'team@dgist.ac.kr' },
  ]);
  assert.equal(contacts[0].email.endsWith('dgist.ac.kr'), true);
  const naver = contacts.find((c) => c.email === 'x@naver.com');
  assert.equal(naver.count, 2);
  // 보낸 편지함에서는 받는 사람도 연락처가 됨
  assert.ok(contacts.some((c) => c.email === 'team@dgist.ac.kr'));
});

test('mime — euc-kr 본문과 HTML 잔재 정리', () => {
  // euc-kr 인코딩 헤더
  assert.equal(decodeMimeWords('=?euc-kr?B?urizvSDG7cH2x9Q=?='), '보낸 편지함');
  // 일반적인 HTML 메일: style 블록은 통째로 사라지고 본문만 남아야 한다
  const html = '<head><style>.a{color:red}@import url(x);</style></head>'
    + '<body><p>안녕&nbsp;하세요</p><br>둘째 줄</body>';
  const text = cleanHtmlToText(html);
  assert.ok(!text.includes('color'), text);
  assert.ok(!text.includes('@import'), text);
  assert.match(text, /안녕 하세요/);
  assert.match(text, /둘째 줄/);
  // 닫는 </style>이 잘려나간 메일은 CSS가 본문으로 새면 안 되므로 끝까지 잘라낸다
  assert.ok(!cleanHtmlToText('<style>.a{color:red}').includes('color'));
  // 태그가 제거되며 드러난 CSS 선언 잔재도 정리
  assert.ok(!cleanHtmlToText('<div>font-size: 12px; 실제본문</div>').includes('font-size'));
  // base64 본문 (인코딩 헤더 포함)
  const b64 = 'Content-Transfer-Encoding: base64\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'
    + Buffer.from('취재원 답장입니다', 'utf8').toString('base64');
  assert.equal(decodeBodySnippet(Buffer.from(b64, 'binary')), '취재원 답장입니다');
  assert.equal(imapUtf7Decode('&wqTTOLpUx3zVaA-'), '스팸메일함');
});
