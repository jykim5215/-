// 메일함 서비스 — IMAP 수신 + 폴더별 수집 + 읽음/삭제 동작
//
// 취재 이메일 단계에서 취재원의 "답신"을 앱 안에서 바로 받아보고, 그 답장을
// 한 번에 수집 자료로 넘기기 위한 계층이다. 오디오 받아쓰기와 마찬가지로
// 메일 본문도 기기 밖으로 나가지 않는다(분류를 켠 경우 제목·요약만 AI에 전달).
const { MiniIMAP, classifyFolder, folderRaw, parseMessage, buildContacts } = require('./imap');

const DEFAULT_IMAP = { host: 'mail.dgist.ac.kr', port: 993 };

function imapConfig(cfg = {}) {
  return {
    host: cfg.imapHost || DEFAULT_IMAP.host,
    port: Number(cfg.imapPort || DEFAULT_IMAP.port),
    user: cfg.user,
    pass: cfg.pass,
  };
}

async function connect(cfg) {
  const c = imapConfig(cfg);
  if (!c.user || !c.pass) {
    throw new Error('설정에서 학교 이메일 계정을 먼저 입력해 주세요.');
  }
  const client = await MiniIMAP.connect(c.host, c.port);
  await client.login(c.user, c.pass);
  return client;
}

// 연결 확인만 (설정 화면의 "받기 테스트")
async function verify(cfg) {
  let client;
  try {
    client = await connect(cfg);
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
async function fetchRecent(cfg, { days = 21, maxPerFolder = 60, onProgress } = {}) {
  let client;
  try {
    client = await connect(cfg);
    const targets = [];
    const seenKeys = new Set();
    for (const { raw, name } of await client.listFolders()) {
      const key = classifyFolder(name);
      // 스팸·임시보관함은 기본 수집 대상에서 제외 (노이즈)
      if (key && key !== 'spam' && key !== 'draft' && !seenKeys.has(key)) {
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
async function markRead(cfg, uid, folder = 'inbox', seen = true) {
  const client = await connect(cfg);
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
async function markAllRead(cfg, folder = 'inbox') {
  const client = await connect(cfg);
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
async function deleteMessage(cfg, uid, folder = 'inbox') {
  const client = await connect(cfg);
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
  imapError,
  DEFAULT_IMAP,
};
