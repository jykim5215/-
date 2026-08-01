// DGIST 메일서버용 경량 IMAP 클라이언트 (수신)
//
// DGIST IMAP 서버는 표준과 조금 다른 응답을 보내서 엄격한 IMAP 라이브러리가
// 중간에 실패한다. 그래서 실제로 필요한 명령만 직접 구현한다.
// (붕어빵 dgist-lms-autosaver의 MiniIMAP을 Node로 이식 + 주입 방어 추가)
//
// 보안: 사용자 입력(계정·비밀번호·폴더명)에 CR/LF가 섞이면 IMAP 명령이 주입될 수
//       있으므로 인용 전에 제어문자를 제거한다. 연결은 항상 TLS.
const tls = require('tls');
const { imapUtf7Decode, decodeMimeWords, parseHeaders, decodeBodySnippet } = require('./mime');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// IMAP 문자열 인용. CR/LF·NUL을 먼저 제거해 명령 주입을 막는다.
function quote(value) {
  const safe = String(value == null ? '' : value).replace(/[\r\n\0]/g, '');
  return '"' + safe.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// 소켓에서 "한 줄" 또는 "정확히 N바이트"를 순서대로 읽어주는 도우미.
class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.error = null;
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this._pump();
    });
    const fail = (e) => {
      this.error = e instanceof Error ? e : new Error('서버 연결이 끊겼습니다.');
      while (this.waiters.length) this.waiters.shift().reject(this.error);
    };
    socket.on('error', fail);
    socket.on('end', () => fail(new Error('서버 연결이 끊겼습니다.')));
    socket.on('close', () => fail(new Error('서버 연결이 끊겼습니다.')));
  }

  _pump() {
    while (this.waiters.length) {
      const w = this.waiters[0];
      if (w.type === 'line') {
        const i = this.buf.indexOf(0x0a);
        if (i === -1) return;
        const line = this.buf.subarray(0, i + 1);
        this.buf = this.buf.subarray(i + 1);
        this.waiters.shift();
        w.resolve(line);
      } else {
        if (this.buf.length < w.n) return;
        const b = this.buf.subarray(0, w.n);
        this.buf = this.buf.subarray(w.n);
        this.waiters.shift();
        w.resolve(b);
      }
    }
  }

  _want(waiter) {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      this.waiters.push({ ...waiter, resolve, reject });
      this._pump();
    });
  }

  readLine() { return this._want({ type: 'line' }); }
  readBytes(n) { return this._want({ type: 'bytes', n }); }
}

class MiniIMAP {
  constructor(socket) {
    this.socket = socket;
    this.reader = new SocketReader(socket);
    this.tagN = 0;
  }

  // TLS로 접속하고 서버 인사말을 소비한다.
  static async connect(host, port = 993, timeout = 20000) {
    const socket = await new Promise((resolve, reject) => {
      const s = tls.connect(
        { host, port: Number(port), servername: host, minVersion: 'TLSv1.2' },
        () => resolve(s)
      );
      s.setTimeout(timeout, () => s.destroy(new Error('메일 서버 응답이 없습니다 (시간 초과).')));
      s.once('error', reject);
    });
    socket.setTimeout(0);
    const client = new MiniIMAP(socket);
    await client.reader.readLine(); // 서버 인사말
    return client;
  }

  // 명령 실행. 반환: { status, lines: [{ line, literal }] }
  async cmd(command) {
    this.tagN += 1;
    const tag = 'A' + String(this.tagN).padStart(3, '0');
    this.socket.write(`${tag} ${command}\r\n`);
    const lines = [];
    for (;;) {
      const line = await this.reader.readLine();
      if (line.subarray(0, tag.length + 1).toString('ascii') === tag + ' ') {
        const status = line.toString('ascii').split(' ')[1] || '';
        return { status, lines };
      }
      let literal = null;
      const m = line.toString('binary').match(/\{(\d+)\}\r?\n$/);
      if (m) literal = await this.reader.readBytes(Number(m[1]));
      lines.push({ line, literal });
    }
  }

  async login(user, password) {
    const { status } = await this.cmd(`LOGIN ${quote(user)} ${quote(password)}`);
    if (status !== 'OK') {
      throw new Error('학교 이메일 로그인에 실패했습니다 — 아이디·비밀번호를 확인하세요.');
    }
  }

  // [{ raw, name }] 폴더 목록
  async listFolders() {
    const { status, lines } = await this.cmd('LIST "" "*"');
    if (status !== 'OK') return [{ raw: 'INBOX', name: '받은 편지함' }];
    const folders = [];
    for (const { line } of lines) {
      const text = line.toString('utf8');
      const m = text.match(/"([^"]*)"\s*$/);
      const raw = m ? m[1] : (text.trim().split(/\s+/).pop() || '');
      if (raw) folders.push({ raw, name: imapUtf7Decode(raw) });
    }
    return folders;
  }

  async selectFolder(raw) {
    const { status } = await this.cmd(`SELECT ${quote(raw)}`);
    return status === 'OK';
  }

  // 디코드된 폴더명에 keyword가 들어간 첫 폴더의 raw 이름
  async findFolder(keyword) {
    const folders = this._folders || (this._folders = await this.listFolders());
    const hit = folders.find((f) => f.name.includes(keyword));
    return hit ? hit.raw : null;
  }

  _collectIds(lines) {
    const ids = [];
    for (const { line } of lines) {
      const text = line.toString('ascii');
      if (/^\*\s+SEARCH/i.test(text)) {
        for (const tok of text.trim().split(/\s+/).slice(2)) {
          if (/^\d+$/.test(tok)) ids.push(Number(tok));
        }
      }
    }
    return ids;
  }

  // since 이후 메일의 UID 목록 (UID는 재색인돼도 안 바뀌는 안정적 식별자)
  async searchSince(since) {
    const d = String(since.getDate()).padStart(2, '0');
    const dateStr = `${d}-${MONTHS[since.getMonth()]}-${since.getFullYear()}`;
    const { status, lines } = await this.cmd(`UID SEARCH SINCE ${dateStr}`);
    if (status !== 'OK') return [];
    return this._collectIds(lines).sort((a, b) => a - b);
  }

  async searchUnseen() {
    const { status, lines } = await this.cmd('UID SEARCH UNSEEN');
    if (status !== 'OK') return [];
    return this._collectIds(lines);
  }

  async storeFlag(uid, flag, add = true) {
    const op = add ? '+FLAGS' : '-FLAGS';
    const { status } = await this.cmd(`UID STORE ${Number(uid)} ${op} (${flag})`);
    return status === 'OK';
  }

  async copyTo(uid, rawFolder) {
    const { status } = await this.cmd(`UID COPY ${Number(uid)} ${quote(rawFolder)}`);
    return status === 'OK';
  }

  async expunge() {
    await this.cmd('EXPUNGE');
  }

  // BODY.PEEK을 써서 열람만으로 읽음 표시가 바뀌지 않게 한다.
  async fetchMessage(uid, bodyBytes = 20000) {
    const { lines } = await this.cmd(
      `UID FETCH ${Number(uid)} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)] BODY.PEEK[1]<0.${bodyBytes}>)`
    );
    let headers = Buffer.alloc(0);
    let body = Buffer.alloc(0);
    let seen = false;
    for (const { line, literal } of lines) {
      const text = line.toString('binary');
      const fm = text.match(/FLAGS \(([^)]*)\)/i);
      if (fm && /\\SEEN/i.test(fm[1])) seen = true;
      if (literal === null || literal === undefined) continue;
      if (/HEADER\.FIELDS/i.test(text)) headers = literal;
      else body = literal;
    }
    return { headers, body, seen };
  }

  async logout() {
    try { await this.cmd('LOGOUT'); } catch { /* 이미 끊겼으면 무시 */ }
    try { this.socket.destroy(); } catch { /* noop */ }
  }
}

// 폴더명을 앱 내부 키로. 관심 없는 폴더는 null.
function classifyFolder(name) {
  const n = String(name || '').trim();
  const low = n.toLowerCase();
  if (n.toUpperCase() === 'INBOX') return 'inbox';
  if (n.includes('보낸') || low.includes('sent')) return 'sent';
  if (n.includes('광고')) return 'promo';
  if (n.includes('스팸') || low.includes('spam') || low.includes('junk')) return 'spam';
  if (n.includes('임시') || low.includes('draft')) return 'draft';
  if (n.includes('지운') || n.includes('휴지') || low.includes('trash') || low.includes('deleted')) return 'trash';
  return null;
}

// 앱 폴더키 → 서버 raw 폴더명
const FOLDER_KEYWORDS = { sent: '보낸', promo: '광고', spam: '스팸', draft: '임시', trash: '지운' };
const FOLDER_FALLBACK = { sent: 'Sent', promo: null, spam: 'Spam', draft: 'Drafts', trash: 'Trash' };
async function folderRaw(client, key) {
  if (key === 'inbox' || !key) return 'INBOX';
  const kw = FOLDER_KEYWORDS[key];
  if (!kw) return 'INBOX';
  return (await client.findFolder(kw)) || (await client.findFolder(FOLDER_FALLBACK[key] || ' ')) || null;
}

// 주소 헤더에서 이름/주소 분리 ("홍길동 <a@b.com>" → {name, email})
function parseAddress(value) {
  const text = decodeMimeWords(value || '');
  const m = text.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^["']|["']$/g, '').trim(), email: m[2].trim() };
  const bare = text.trim().replace(/^["']|["']$/g, '');
  return /@/.test(bare) ? { name: '', email: bare } : { name: bare, email: '' };
}

// FETCH 결과 → 앱에서 쓰는 메일 객체
function parseMessage({ headers, body, seen }, uid, folderKey) {
  const h = parseHeaders(headers);
  const from = parseAddress(h.from);
  const to = parseAddress(h.to);
  let date = '';
  if (h.date) {
    const d = new Date(h.date);
    if (!Number.isNaN(d.getTime())) date = d.toISOString();
  }
  const full = decodeBodySnippet(body, 4000);
  const subject = decodeMimeWords(h.subject || '') || '(제목 없음)';
  return {
    id: `${folderKey}:${uid}`,
    uid,
    folder: folderKey,
    messageId: (h['message-id'] || '').trim(),
    references: (h.references || '').trim(),
    subject,
    fromName: from.name || from.email,
    fromEmail: from.email,
    toName: to.name || to.email,
    toEmail: to.email,
    cc: decodeMimeWords(h.cc || ''),
    date,
    isReply: Boolean((h['in-reply-to'] || '').trim()),
    unread: !seen,
    snippet: full.slice(0, 300),
    body: full,
  };
}

// 메일함에서 본 주소로 자동완성용 연락처 생성 (@dgist 우선, 빈도순)
function buildContacts(emails) {
  const counts = new Map();
  for (const mail of emails) {
    const pairs = [[mail.fromName, mail.fromEmail]];
    if (mail.folder === 'sent') pairs.push([mail.toName, mail.toEmail]);
    for (const [name, addrRaw] of pairs) {
      const addr = String(addrRaw || '').trim().toLowerCase();
      if (!addr || !addr.includes('@')) continue;
      const entry = counts.get(addr) || { email: addr, name: name || '', count: 0 };
      entry.count += 1;
      if (name && !entry.name) entry.name = name;
      counts.set(addr, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) =>
      (a.email.endsWith('dgist.ac.kr') ? 0 : 1) - (b.email.endsWith('dgist.ac.kr') ? 0 : 1) ||
      b.count - a.count ||
      a.email.localeCompare(b.email)
    )
    .slice(0, 300);
}

module.exports = {
  MiniIMAP,
  SocketReader,
  quote,
  classifyFolder,
  folderRaw,
  parseAddress,
  parseMessage,
  buildContacts,
  FOLDER_KEYWORDS,
};
