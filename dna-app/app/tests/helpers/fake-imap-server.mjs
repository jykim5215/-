// 실제 메일 서버에 가깝게 동작하는 테스트용 IMAP 서버 (평문 TCP).
//
// DGIST 서버에서 실제로 겪는 특성을 재현한다:
//  - 한글 폴더명을 IMAP modified UTF-7로 반환
//  - 헤더/본문을 리터럴({N})로 내려보냄
//  - 제목이 euc-kr RFC2047로 인코딩된 메일
//  - multipart/alternative 본문 (BODY[1]이 text/plain)
//  - 응답 뒤에 딸려오는 여분의 untagged 줄
import net from 'node:net';

const CRLF = '\r\n';

// "보낸 편지함" 등을 IMAP modified UTF-7로 인코딩
export function utf7Encode(str) {
  let out = '';
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const b = Buffer.from(buf, 'utf16le').swap16().toString('base64').replace(/=+$/, '').replace(/\//g, ',');
    out += '&' + b + '-';
    buf = '';
  };
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c <= 0x7e) {
      flush();
      out += ch === '&' ? '&-' : ch;
    } else buf += ch;
  }
  flush();
  return out;
}

function lit(buf) {
  return `{${buf.length}}${CRLF}`;
}

export function createFakeImapServer(opts = {}) {
  const {
    user = 'dgun_189@dgist.ac.kr',
    pass = 'secret',
    folders = ['INBOX', '보낸 편지함', '광고 편지함', '지운 편지함', '스팸 편지함'],
    messages = defaultMessages(),
  } = opts;

  const state = { stores: [], copies: [], expunged: 0, selected: null, loginAttempts: [] };

  const server = net.createServer((sock) => {
    let selected = 'INBOX';
    sock.write(`* OK [CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN] DGIST Mail ready${CRLF}`);

    let acc = '';
    sock.on('data', (chunk) => {
      acc += chunk.toString('binary');
      let i;
      while ((i = acc.indexOf('\n')) !== -1) {
        const line = acc.slice(0, i).replace(/\r$/, '');
        acc = acc.slice(i + 1);
        handle(line);
      }
    });

    function handle(line) {
      const sp = line.indexOf(' ');
      const tag = line.slice(0, sp);
      const rest = line.slice(sp + 1);
      const cmd = rest.split(' ')[0].toUpperCase();
      const arg = rest.slice(cmd.length + 1);

      if (cmd === 'LOGIN') {
        const m = arg.match(/^"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"$/);
        const u = m ? m[1].replace(/\\(.)/g, '$1') : '';
        const p = m ? m[2].replace(/\\(.)/g, '$1') : '';
        state.loginAttempts.push({ user: u, pass: p });
        return sock.write(
          u === user && p === pass
            ? `${tag} OK LOGIN completed${CRLF}`
            : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials${CRLF}`
        );
      }
      if (cmd === 'LIST') {
        for (const f of folders) {
          const raw = f === 'INBOX' ? 'INBOX' : utf7Encode(f);
          sock.write(`* LIST (\\HasNoChildren) "/" "${raw}"${CRLF}`);
        }
        return sock.write(`${tag} OK LIST completed${CRLF}`);
      }
      if (cmd === 'SELECT') {
        const raw = (arg.match(/^"(.*)"$/) || [, arg])[1];
        selected = raw;
        state.selected = raw;
        const n = msgsIn(raw).length;
        // 실제 서버처럼 여러 untagged 줄을 먼저 보낸다
        sock.write(`* ${n} EXISTS${CRLF}* 0 RECENT${CRLF}* OK [UIDVALIDITY 1] UIDs valid${CRLF}`);
        return sock.write(`${tag} OK [READ-WRITE] SELECT completed${CRLF}`);
      }
      if (cmd === 'UID') {
        const sub = arg.split(' ')[0].toUpperCase();
        const subArg = arg.slice(sub.length + 1);
        if (sub === 'SEARCH') {
          const list = msgsIn(selected);
          const ids = /UNSEEN/i.test(subArg)
            ? list.filter((m) => !m.seen).map((m) => m.uid)
            : list.map((m) => m.uid);
          sock.write(`* SEARCH ${ids.join(' ')}${CRLF}`);
          return sock.write(`${tag} OK SEARCH completed${CRLF}`);
        }
        if (sub === 'FETCH') {
          const uid = Number(subArg.split(' ')[0]);
          const msg = msgsIn(selected).find((m) => m.uid === uid);
          if (!msg) return sock.write(`${tag} OK FETCH completed${CRLF}`);
          const hdr = Buffer.isBuffer(msg.headers) ? msg.headers : Buffer.from(msg.headers, 'utf8');
          const body = Buffer.isBuffer(msg.body) ? msg.body : Buffer.from(msg.body, 'utf8');
          sock.write(
            `* ${uid} FETCH (UID ${uid} FLAGS (${msg.seen ? '\\Seen' : ''}) ` +
            `BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)] ${lit(hdr)}`
          );
          sock.write(hdr);
          sock.write(` BODY[1]<0> ${lit(body)}`);
          sock.write(body);
          sock.write(`)${CRLF}`);
          return sock.write(`${tag} OK FETCH completed${CRLF}`);
        }
        if (sub === 'STORE') {
          const [uidStr, op, ...flagParts] = subArg.split(' ');
          state.stores.push({ uid: Number(uidStr), op, flags: flagParts.join(' '), folder: selected });
          const msg = msgsIn(selected).find((m) => m.uid === Number(uidStr));
          if (msg && /\\Seen/i.test(flagParts.join(' '))) msg.seen = op.startsWith('+');
          return sock.write(`${tag} OK STORE completed${CRLF}`);
        }
        if (sub === 'COPY') {
          const [uidStr, ...destParts] = subArg.split(' ');
          state.copies.push({ uid: Number(uidStr), dest: destParts.join(' ').replace(/^"|"$/g, '') });
          return sock.write(`${tag} OK COPY completed${CRLF}`);
        }
      }
      if (cmd === 'EXPUNGE') {
        state.expunged += 1;
        return sock.write(`* 1 EXPUNGE${CRLF}${tag} OK EXPUNGE completed${CRLF}`);
      }
      if (cmd === 'LOGOUT') {
        sock.write(`* BYE Logging out${CRLF}${tag} OK LOGOUT completed${CRLF}`);
        return sock.end();
      }
      return sock.write(`${tag} BAD Unknown command${CRLF}`);
    }

    function msgsIn(raw) {
      const name = raw === 'INBOX' ? 'INBOX' : decodeName(raw);
      return messages.filter((m) => m.folder === name);
    }
  });

  function decodeName(raw) {
    for (const f of folders) if (utf7Encode(f) === raw || f === raw) return f;
    return raw;
  }

  return {
    server,
    state,
    listen: () => new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port))),
    close: () => new Promise((res) => server.close(res)),
  };
}

// 실제 메일에서 자주 보이는 형태들 (인코딩을 명시적으로 만들어 둔다)
function defaultMessages() {
  const b64 = (str, enc) => Buffer.from(str, enc).toString('base64');
  // euc-kr 바이트는 직접 지정 (Node TextEncoder는 euc-kr 인코딩을 못 한다)
  const eucKrBody = Buffer.from([
    0xc0, 0xce, 0xc5, 0xcd, 0xba, 0xe4, 0x20,
    0xb0, 0xa1, 0xb4, 0xc9, 0xc7, 0xd5, 0xb4, 0xcf, 0xb4, 0xd9, 0x2e,
  ]); // "인터뷰 가능합니다."
  return [
    {
      // utf-8 제목 + quoted-printable 본문
      uid: 101, folder: 'INBOX', seen: false,
      headers: Buffer.from(
        `From: =?utf-8?B?${b64('학생팀', 'utf8')}?= <team@dgist.ac.kr>\r\n` +
        'To: dgun_189@dgist.ac.kr\r\n' +
        `Subject: =?utf-8?B?${b64('수강신청 안내', 'utf8')}?=\r\n` +
        'Date: Fri, 31 Jul 2026 09:00:00 +0900\r\n' +
        'Message-ID: <a1@dgist.ac.kr>\r\n', 'utf8'),
      body: Buffer.from(
        'Content-Type: text/plain; charset=utf-8\r\n' +
        'Content-Transfer-Encoding: quoted-printable\r\n\r\n' +
        '=EC=88=98=EA=B0=95=EC=8B=A0=EC=B2=AD =EC=9D=BC=EC=A0=95=EC=9D=84 ' +
        '=EC=95=88=EB=82=B4=ED=95=A9=EB=8B=88=EB=8B=A4.', 'ascii'),
    },
    {
      // euc-kr 제목·발신자 + base64 euc-kr 본문 + 답신(In-Reply-To)
      uid: 102, folder: 'INBOX', seen: false,
      headers: Buffer.from(
        'From: =?euc-kr?B?udq8usf2?= <park@dgist.ac.kr>\r\n' +   // 박성현
        'To: dgun_189@dgist.ac.kr\r\n' +
        'Subject: =?euc-kr?B?UmU6ILTkuq+15biztM+02Q==?=\r\n' +   // Re: 답변드립니다
        'Date: Fri, 31 Jul 2026 14:30:00 +0900\r\n' +
        'Message-ID: <a2@dgist.ac.kr>\r\n' +
        'In-Reply-To: <mine@dgist.ac.kr>\r\n', 'ascii'),
      body: Buffer.from(
        'Content-Type: text/plain; charset=euc-kr\r\n' +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        eucKrBody.toString('base64'), 'ascii'),
    },
    {
      // HTML 본문 — CSS가 새면 안 되고 &nbsp;는 일반 공백이 돼야 한다
      uid: 103, folder: 'INBOX', seen: true,
      headers: Buffer.from(
        'From: pr@dgist.ac.kr\r\n' +
        'To: dgun_189@dgist.ac.kr\r\n' +
        'Subject: HTML newsletter\r\n' +
        'Date: Thu, 30 Jul 2026 08:00:00 +0900\r\n', 'utf8'),
      body: Buffer.from(
        'Content-Type: text/html; charset=utf-8\r\n\r\n' +
        '<html><head><style>.x{color:red}</style></head>' +
        '<body><p>보도자료&nbsp;입니다</p></body></html>', 'utf8'),
    },
    {
      uid: 201, folder: '보낸 편지함', seen: true,
      headers: Buffer.from(
        'From: dgun_189@dgist.ac.kr\r\n' +
        `To: =?utf-8?B?${b64('박성현', 'utf8')}?= <park@dgist.ac.kr>\r\n` +
        'Subject: interview request\r\n' +
        'Date: Wed, 29 Jul 2026 11:00:00 +0900\r\n', 'utf8'),
      body: Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\nplease reply', 'utf8'),
    },
    {
      // 휴지통 메일 — 수집 대상에서 빠져야 한다
      uid: 301, folder: '지운 편지함', seen: true,
      headers: Buffer.from('From: old@dgist.ac.kr\r\nSubject: deleted mail\r\n', 'utf8'),
      body: Buffer.from('Content-Type: text/plain\r\n\r\ngone', 'utf8'),
    },
  ];
}
