// 메일함 서비스 — IMAP 수신 + 폴더별 수집 + 읽음/삭제 동작
//
// 취재 이메일 단계에서 취재원의 "답신"을 앱 안에서 바로 받아보고, 그 답장을
// 한 번에 수집 자료로 넘기기 위한 계층이다. 오디오 받아쓰기와 마찬가지로
// 메일 본문도 기기 밖으로 나가지 않는다(분류를 켠 경우 제목·요약만 AI에 전달).
const { MiniIMAP, classifyFolder, folderRaw, parseMessage, buildContacts } = require('./imap');

const DEFAULT_IMAP = { host: 'mail.dgist.ac.kr', port: 993 };

// 관심사 기본값 (붕어빵 앱과 동일)
const DEFAULT_INTERESTS = '전공 탐색, 취업, 음악, 세미나';

function imapConfig(cfg = {}) {
  return {
    host: cfg.imapHost || DEFAULT_IMAP.host,
    port: Number(cfg.imapPort || DEFAULT_IMAP.port),
    user: cfg.user,
    pass: cfg.pass,
  };
}

// deps.createClient는 테스트에서 가짜 서버에 물리기 위한 주입점 (운영은 TLS 고정).
async function connect(cfg, deps = {}) {
  const c = imapConfig(cfg);
  if (!c.user || !c.pass) {
    throw new Error('설정에서 학교 이메일 계정을 먼저 입력해 주세요.');
  }
  const createClient = deps.createClient || MiniIMAP.connect;
  const client = await createClient(c.host, c.port);
  try {
    await client.login(c.user, c.pass);
  } catch (e) {
    // 로그인이 실패해도 소켓은 반드시 닫는다. 안 닫으면 비밀번호를 고쳐 다시
    // 시도할 때마다 연결이 쌓여 서버가 동시 접속 제한으로 거부하게 된다.
    await client.logout();
    throw e;
  }
  return client;
}

// 연결 확인만 (설정 화면의 "받기 테스트")
async function verify(cfg, deps = {}) {
  let client;
  try {
    client = await connect(cfg, deps);
    const folders = await client.listFolders();
    return { ok: true, folders: folders.map((f) => f.name) };
  } catch (e) {
    return { ok: false, error: imapError(e, imapConfig(cfg)) };
  } finally {
    if (client) await client.logout();
  }
}

// 받은/보낸/광고 등 관심 폴더에서 최근 메일 수집.
// onProgress: ({ folder, done, total }) => void
async function fetchRecent(cfg, { days = 21, maxPerFolder = 60, onProgress } = {}, deps = {}) {
  let client;
  try {
    client = await connect(cfg, deps);
    const targets = [];
    const seenKeys = new Set();
    for (const { raw, name } of await client.listFolders()) {
      const key = classifyFolder(name);
      // 붕어빵 앱과 동일하게 분류되는 폴더를 전부 수집한다(스팸·임시·휴지통 포함).
      // 지운 메일은 휴지통 폴더로만 보이므로 받은편지함에 되살아나지 않는다.
      if (key && !seenKeys.has(key)) {
        targets.push({ raw, key });
        seenKeys.add(key);
      }
    }
    if (!seenKeys.has('inbox')) targets.unshift({ raw: 'INBOX', key: 'inbox' });

    const since = new Date(Date.now() - days * 86400000);
    const emails = [];
    const errors = [];
    for (const { raw, key } of targets) {
      if (!(await client.selectFolder(raw))) continue;
      const ids = (await client.searchSince(since)).slice(-maxPerFolder).reverse();
      let done = 0;
      for (const uid of ids) {
        try {
          emails.push(parseMessage(await client.fetchMessage(uid), uid, key));
        } catch (e) {
          errors.push(`${key}:${uid} ${e.message}`);
        }
        done += 1;
        if (onProgress) onProgress({ folder: key, done, total: ids.length });
      }
    }
    return {
      ok: true,
      updatedAt: new Date().toISOString(),
      emails,
      contacts: buildContacts(emails),
      folders: targets.map((t) => t.key),
      errors,
    };
  } catch (e) {
    throw new Error(imapError(e, imapConfig(cfg)));
  } finally {
    if (client) await client.logout();
  }
}

// 메일 하나의 읽음/안읽음 표시
async function markRead(cfg, uid, folder = 'inbox', seen = true, deps = {}) {
  const client = await connect(cfg, deps);
  try {
    const raw = (await folderRaw(client, folder)) || 'INBOX';
    await client.selectFolder(raw);
    const ok = await client.storeFlag(uid, '\\Seen', seen);
    return { ok, uid, seen };
  } finally {
    await client.logout();
  }
}

// 폴더의 안읽은 메일 전부 읽음 처리
async function markAllRead(cfg, folder = 'inbox', deps = {}) {
  const client = await connect(cfg, deps);
  try {
    const raw = (await folderRaw(client, folder)) || 'INBOX';
    await client.selectFolder(raw);
    const uids = await client.searchUnseen();
    for (const uid of uids) await client.storeFlag(uid, '\\Seen', true);
    return { ok: true, count: uids.length };
  } finally {
    await client.logout();
  }
}

// 삭제 = 휴지통으로 복사한 뒤 원본에 \Deleted + EXPUNGE
async function deleteMessage(cfg, uid, folder = 'inbox', deps = {}) {
  const client = await connect(cfg, deps);
  try {
    const raw = (await folderRaw(client, folder)) || 'INBOX';
    await client.selectFolder(raw);
    const trash = (await client.findFolder('지운')) || (await client.findFolder('Trash'));
    if (trash && trash !== raw) await client.copyTo(uid, trash);
    await client.storeFlag(uid, '\\Deleted', true);
    await client.expunge();
    return { ok: true, uid };
  } finally {
    await client.logout();
  }
}

// 어디서 막혔는지 단계별로 짚어주는 진단.
// DNS → TCP → TLS → LOGIN → 폴더 목록 순서로 확인해 처음 실패한 지점을 알려준다.
async function diagnose(cfg) {
  const dns = require('dns').promises;
  const net = require('net');
  const tls = require('tls');
  const c = imapConfig(cfg);
  const steps = [];
  const add = (name, ok, detail) => steps.push({ name, ok, detail });

  if (!c.user || !c.pass) {
    add('계정 설정', false, '설정 → 이메일에서 주소와 비밀번호를 먼저 입력하세요.');
    return { ok: false, host: c.host, port: c.port, steps };
  }
  add('계정 설정', true, c.user);

  // 1) DNS
  let ip;
  try {
    ip = (await dns.lookup(c.host)).address;
    add('DNS 조회', true, `${c.host} → ${ip}`);
  } catch (e) {
    add('DNS 조회', false, `${c.host} 주소를 찾지 못했습니다 (${e.code}). 호스트 이름을 확인하세요.`);
    return { ok: false, host: c.host, port: c.port, steps };
  }

  // 2) TCP 연결
  const tcpOk = await new Promise((res) => {
    const s = net.connect({ host: c.host, port: c.port });
    const t = setTimeout(() => { s.destroy(); res('timeout'); }, 8000);
    s.on('connect', () => { clearTimeout(t); s.destroy(); res(true); });
    s.on('error', (e) => { clearTimeout(t); res(e.code || 'error'); });
  });
  if (tcpOk !== true) {
    add('서버 연결', false,
      tcpOk === 'timeout'
        ? `${c.host}:${c.port} 응답 없음 — 포트가 막혔거나 포트 번호가 다릅니다. (교내망/방화벽/VPN 확인, IMAP은 보통 993)`
        : `${c.host}:${c.port} 연결 거부 (${tcpOk}) — 포트 번호를 확인하세요.`);
    return { ok: false, host: c.host, port: c.port, steps };
  }
  add('서버 연결', true, `${c.host}:${c.port} 열림`);

  // 3) TLS 핸드셰이크
  const tlsOk = await new Promise((res) => {
    const s = tls.connect({ host: c.host, port: c.port, servername: c.host, minVersion: 'TLSv1.2' });
    const t = setTimeout(() => { s.destroy(); res('timeout'); }, 8000);
    s.on('secureConnect', () => { clearTimeout(t); s.destroy(); res(true); });
    s.on('error', (e) => { clearTimeout(t); res(e.message); });
  });
  if (tlsOk !== true) {
    add('보안 연결(TLS)', false,
      `${tlsOk} — 이 포트가 SSL 포트가 아닐 수 있습니다. IMAP SSL은 993입니다. (143은 비암호화라 지원하지 않습니다)`);
    return { ok: false, host: c.host, port: c.port, steps };
  }
  add('보안 연결(TLS)', true, 'TLS 핸드셰이크 성공');

  // 4) 로그인 + 폴더 목록
  const r = await verify(cfg);
  if (!r.ok) {
    add('로그인', false, r.error);
    return { ok: false, host: c.host, port: c.port, steps };
  }
  add('로그인', true, '인증 성공');
  add('폴더 목록', true, r.folders.join(', '));
  return { ok: true, host: c.host, port: c.port, steps };
}

// IMAP 오류를 사용자 언어로
function imapError(e, cfg = {}) {
  const m = String((e && e.message) || e);
  if (/로그인에 실패|AUTHENTICATIONFAILED|LOGIN failed|Invalid credentials/i.test(m)) {
    return '로그인 실패 — DGIST 메일 아이디·비밀번호가 맞는지, 웹메일에서 IMAP 사용이 켜져 있는지 확인하세요.';
  }
  if (/certificate|CERT_|self.signed/i.test(m)) {
    return '서버 인증서 오류 — IMAP 호스트/포트를 확인하세요. (문제가 계속되면 DGIST IT에 문의)';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|시간 초과|연결이 끊겼/i.test(m)) {
    return `메일 서버에 연결하지 못했습니다 — IMAP 호스트/포트를 확인하세요. (기본값: ${cfg.host || DEFAULT_IMAP.host}, 포트 ${cfg.port || DEFAULT_IMAP.port}. 일부 망은 외부 접속을 차단합니다)`;
  }
  return '메일을 가져오지 못했습니다: ' + m;
}

module.exports = {
  connect,
  verify,
  fetchRecent,
  markRead,
  markAllRead,
  deleteMessage,
  diagnose,
  imapError,
  DEFAULT_IMAP,
  DEFAULT_INTERESTS,
};
