// 앱 내 받은메일 확인 — IMAP (ImapFlow)
//
// DGIST 기본값: mail.dgist.ac.kr:993 SSL/TLS.
// 비밀번호는 main 프로세스에서 safeStorage로 복호화된 뒤 이 모듈에 전달되며,
// 이 모듈은 메모리에서만 사용하고 저장하지 않는다.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const PRESETS = {
  dgist: { host: 'mail.dgist.ac.kr', port: 993, secure: true },
};

function buildClientOptions({ host, port, secure, user, pass }) {
  const p = Number(port || PRESETS.dgist.port);
  return {
    host: host || PRESETS.dgist.host,
    port: p,
    secure: secure !== undefined ? Boolean(secure) : p === 993,
    auth: { user, pass },
    logger: false,
  };
}

function makeClient(cfg, ClientClass = ImapFlow) {
  return new ClientClass(buildClientOptions(cfg));
}

function requireCredentials(cfg) {
  if (!cfg.user || !cfg.pass) throw new Error('DGIST 이메일 주소와 비밀번호를 설정하세요.');
}

async function withInbox(cfg, fn, ClientClass) {
  requireCredentials(cfg);
  const client = makeClient(cfg, ClientClass);
  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    return await fn(client);
  } finally {
    if (lock) lock.release();
    if (typeof client.logout === 'function') {
      await client.logout().catch(() => {});
    } else if (typeof client.close === 'function') {
      client.close();
    }
  }
}

function addressText(addresses) {
  if (!Array.isArray(addresses) || !addresses.length) return '';
  return addresses
    .map((a) => {
      if (!a) return '';
      const name = a.name ? String(a.name).trim() : '';
      const address = a.address ? String(a.address).trim() : '';
      if (name && address) return `${name} <${address}>`;
      return name || address;
    })
    .filter(Boolean)
    .join(', ');
}

function normalizeSummary(msg) {
  const envelope = msg.envelope || {};
  const flags = msg.flags ? Array.from(msg.flags) : [];
  const date = envelope.date || msg.internalDate || null;
  return {
    uid: msg.uid,
    subject: envelope.subject || '(제목 없음)',
    from: addressText(envelope.from),
    to: addressText(envelope.to),
    date: date ? new Date(date).toISOString() : null,
    seen: flags.includes('\\Seen'),
    flagged: flags.includes('\\Flagged'),
    size: msg.size || null,
    messageId: envelope.messageId || '',
    inReplyTo: envelope.inReplyTo || '',
  };
}

function isReportingMail(summary, ownAddress = '') {
  const hay = [
    summary.subject,
    summary.from,
    summary.to,
    summary.messageId,
    summary.inReplyTo,
  ].join(' ').toLowerCase();
  const own = String(ownAddress || '').toLowerCase();
  const isReplyToMe = own && hay.includes(own) && /\b(re|fw|fwd):|답변|회신|reply|returned|undeliver/i.test(hay);
  return isReplyToMe || [
    '취재',
    '인터뷰',
    '서면',
    '질문',
    '답변',
    '회신',
    '요청',
    '디지스트신문',
    '[디지스트신문 dna]',
  ].some((kw) => hay.includes(kw));
}

function sortRecentFirst(items) {
  return [...items].sort((a, b) => {
    const bd = b.date ? Date.parse(b.date) : 0;
    const ad = a.date ? Date.parse(a.date) : 0;
    if (bd !== ad) return bd - ad;
    return Number(b.uid || 0) - Number(a.uid || 0);
  });
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function streamToBuffer(source) {
  if (!source) return Buffer.alloc(0);
  if (Buffer.isBuffer(source)) return source;
  if (typeof source === 'string') return Buffer.from(source);
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function verifyInbox(cfg, { ClientClass } = {}) {
  try {
    await withInbox(cfg, async (client) => ({
      ok: true,
      exists: client.mailbox?.exists || 0,
    }), ClientClass);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: imapError(e) };
  }
}

async function listInbox(cfg, { limit = 10, filter = 'reporting', ClientClass } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
  return withInbox(cfg, async (client) => {
    const exists = client.mailbox?.exists || 0;
    if (!exists) return { messages: [], exists };

    const scanLimit = filter && filter !== 'all' ? Math.min(Math.max(safeLimit * 5, 30), 120) : safeLimit;
    const range = exists <= scanLimit ? '1:*' : `*:-${scanLimit}`;
    const messages = await client.fetchAll(range, {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
    });
    let summaries = sortRecentFirst(messages.map(normalizeSummary));
    if (filter === 'reporting') summaries = summaries.filter((m) => isReportingMail(m, cfg.user));
    if (filter === 'unread') summaries = summaries.filter((m) => !m.seen);
    return {
      exists,
      messages: summaries.slice(0, safeLimit),
    };
  }, ClientClass);
}

async function readInboxMessage(cfg, uid, { ClientClass, parser = simpleParser } = {}) {
  if (!uid) throw new Error('읽을 메일 UID가 없습니다.');
  return withInbox(cfg, async (client) => {
    const msg = await client.fetchOne(String(uid), {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      source: true,
    }, { uid: true });
    if (!msg) throw new Error('해당 메일을 찾지 못했습니다.');

    const parsed = await parser(await streamToBuffer(msg.source));
    const summary = normalizeSummary(msg);
    return {
      ...summary,
      subject: parsed.subject || summary.subject,
      from: parsed.from?.text || summary.from,
      to: parsed.to?.text || summary.to,
      date: parsed.date ? parsed.date.toISOString() : summary.date,
      text: String(parsed.text || htmlToText(parsed.html) || '').trim(),
      html: parsed.html ? String(parsed.html) : '',
      attachments: (parsed.attachments || []).map((a) => ({
        filename: a.filename || '(이름 없음)',
        contentType: a.contentType || '',
        size: a.size || 0,
      })),
    };
  }, ClientClass);
}

function imapError(e) {
  const m = String(e && e.message || e);
  if (/Invalid login|Authentication|AUTHENTICATIONFAILED|LOGIN failed|535|NO \[AUTHENTICATIONFAILED\]/i.test(m)) {
    return '로그인 실패 — DGIST 이메일 주소 전체와 메일 비밀번호가 맞는지 확인하세요.';
  }
  if (/self.signed|certificate|CERT_/i.test(m)) {
    return '서버 인증서 오류 — IMAP 호스트/포트가 맞는지 확인하세요. (DGIST 기본값: mail.dgist.ac.kr, 993 SSL/TLS)';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|ESOCKET|connection/i.test(m)) {
    return '메일 서버에 연결하지 못했습니다 — IMAP 호스트/포트를 확인하세요. (DGIST 기본값: mail.dgist.ac.kr, 993 SSL/TLS)';
  }
  return '받은메일 확인 실패: ' + m;
}

module.exports = {
  PRESETS,
  buildClientOptions,
  makeClient,
  normalizeSummary,
  isReportingMail,
  verifyInbox,
  listInbox,
  readInboxMessage,
  htmlToText,
  imapError,
};
