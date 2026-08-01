// 앱 내 이메일 발송 — SMTP (nodemailer)
//
// DGIST 메일은 자체 메일 서버(smtp.dgist.ac.kr)를 쓴다. 구글을 거치지 않고
// DGIST SMTP로 직접 보내는 것이 기본 경로다 — DGIST 아이디·비밀번호를 그대로 쓰고,
// 465 포트에서 SSL(암시적 TLS)로 암호화한다. (사용자가 POP를 Gmail에 연동해 둔 것은
// '수신'용일 뿐, 발송과는 별개다.) 호스트를 비우면 Gmail(smtp.gmail.com, 465, 앱
// 비밀번호)로 경유하는 대체 경로도 지원한다.
//
// 보안: 비밀번호는 safeStorage로 암호화 저장(main에서 처리), 이 모듈은 평문을 받지만
//       메모리에서만 쓰고 저장하지 않는다.
const nodemailer = require('nodemailer');

// 프리셋: 알려진 제공자의 SMTP 기본값
const PRESETS = {
  dgist: { host: 'smtp.dgist.ac.kr', port: 465, secure: true }, // 자체 서버, SSL(465)
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
};

function buildTransport({ host, port, secure, user, pass }) {
  const h = host || PRESETS.gmail.host;
  const p = port || PRESETS.gmail.port;
  // 465 = 암시적 SSL, 그 외(587/25) = STARTTLS. secure를 명시하면 그대로 따름.
  const isSecure = secure !== undefined ? secure : Number(p) === 465;
  return nodemailer.createTransport({
    host: h,
    port: Number(p),
    secure: isSecure,
    requireTLS: !isSecure, // 587 등에서 STARTTLS 강제 (평문 전송 방지)
    auth: { user, pass },
    tls: { minVersion: 'TLSv1.2' },
    // EHLO에 쓸 클라이언트 이름을 ASCII로 고정. 윈도우 PC 이름이 한글이면
    // 그대로 EHLO에 실려 인코딩 오류로 발송이 실패한다.
    name: 'localhost',
    connectionTimeout: 15000,
    greetingTimeout: 10000,
  });
}

function isGmailHost(cfg) {
  return !cfg.host || /gmail\.com|googlemail\.com/i.test(cfg.host);
}

// 설정 검증 (발송 전 연결 확인). 반환: {ok, error?}
async function verify(cfg) {
  if (!cfg.user || !cfg.pass) return { ok: false, error: '이메일 주소와 비밀번호를 설정하세요.' };
  try {
    await buildTransport(cfg).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: smtpError(e, cfg) };
  }
}

// 쉼표/세미콜론으로 구분된 주소 문자열 → 정리된 배열
function splitAddrs(value) {
  if (Array.isArray(value)) value = value.join(',');
  if (!value) return [];
  return String(value)
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => s && s.includes('@'));
}

const ATTACH_LIMIT = 20 * 1024 * 1024; // 첨부 총 20MB

// 첨부 정규화. att: {filename, content(base64 또는 Buffer), path?}
function normalizeAttachments(list) {
  const out = [];
  let total = 0;
  for (const att of list || []) {
    if (!att) continue;
    const filename = String(att.filename || att.name || 'attachment')
      .replace(/[\r\n]/g, '')       // 헤더 주입 방지
      .replace(/[/\\]/g, '_');      // 경로 구분자 제거
    let buf;
    if (Buffer.isBuffer(att.content)) buf = att.content;
    else if (att.content instanceof ArrayBuffer) buf = Buffer.from(att.content);
    else if (typeof att.content === 'string') buf = Buffer.from(att.content, 'base64');
    else continue;
    total += buf.length;
    if (total > ATTACH_LIMIT) throw new Error('첨부파일 총 용량은 20MB를 넘을 수 없습니다.');
    out.push({ filename, content: buf });
  }
  return out;
}

// 발송. msg: {to, subject, body, cc?, bcc?, html?, attachments?, inReplyTo?, references?}
// cfg: {user, pass, host, port, secure, fromName}
// deps는 테스트에서 transport를 갈아끼우기 위한 주입점 (운영에서는 기본값 사용).
async function sendMail(msg, cfg, deps = {}) {
  const makeTransport = deps.buildTransport || buildTransport;
  if (!cfg.user || !cfg.pass) throw new Error('이메일 주소와 비밀번호를 설정하세요.');
  const to = splitAddrs(msg.to);
  const cc = splitAddrs(msg.cc);
  const bcc = splitAddrs(msg.bcc);
  if (!to.length || !to.every((a) => /.+@.+\..+/.test(a))) {
    throw new Error('받는 사람 이메일 주소가 올바르지 않습니다.');
  }
  const from = cfg.fromName ? `${cfg.fromName} <${cfg.user}>` : cfg.user;
  const attachments = normalizeAttachments(msg.attachments);

  const mail = {
    from,
    to,
    cc: cc.length ? cc : undefined,
    // bcc는 헤더에 남기지 않고 봉투 수신자로만 — 숨은참조가 새면 취재원이 노출된다
    bcc: bcc.length ? bcc : undefined,
    subject: msg.subject || '(제목 없음)',
    attachments: attachments.length ? attachments : undefined,
  };
  if (msg.html) mail.html = msg.body || '';
  else mail.text = msg.body || '';
  // 답장이면 스레드로 묶이도록 In-Reply-To / References 지정
  if (msg.inReplyTo) {
    mail.inReplyTo = msg.inReplyTo;
    mail.references = [msg.references, msg.inReplyTo].filter(Boolean).join(' ').trim();
  }

  try {
    const info = await makeTransport(cfg).sendMail(mail);
    return {
      ok: true,
      messageId: info.messageId,
      accepted: info.accepted,
      count: to.length + cc.length + bcc.length,
      to: to.join(', '),
      attachments: attachments.length,
    };
  } catch (e) {
    throw new Error(smtpError(e, cfg));
  }
}

// SMTP 오류를 사용자 언어로. 호스트에 따라 Gmail 전용 안내와 일반 서버 안내를 구분.
function smtpError(e, cfg = {}) {
  const m = String(e && e.message || e);
  const gmail = isGmailHost(cfg);
  if (/Invalid login|Username and Password not accepted|BadCredentials|Authentication (failed|unsuccessful)|535/i.test(m)) {
    return gmail
      ? '로그인 실패 — Gmail은 일반 비밀번호가 아니라 "앱 비밀번호"가 필요합니다 (2단계 인증 후 발급).'
      : '로그인 실패 — DGIST 메일 아이디·비밀번호가 맞는지, 그리고 DGIST 웹메일에서 POP/SMTP 사용이 켜져 있는지 확인하세요.';
  }
  if (/self.signed|certificate|CERT_/i.test(m)) {
    return '서버 인증서 오류 — SMTP 호스트/포트가 맞는지 확인하세요. (DGIST 서버 인증서 문제면 IT에 문의)';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|ESOCKET/i.test(m)) {
    return '메일 서버에 연결하지 못했습니다 — SMTP 호스트/포트를 확인하세요. (예: smtp.dgist.ac.kr, 포트 465(SSL). 일부 망은 외부 SMTP를 차단합니다)';
  }
  if (/Application-specific password required/i.test(m)) {
    return 'Gmail 앱 비밀번호가 필요합니다 — 2단계 인증을 켜고 앱 비밀번호를 발급하세요.';
  }
  return '발송 실패: ' + m;
}

module.exports = {
  sendMail, verify, buildTransport, PRESETS,
  splitAddrs, normalizeAttachments, ATTACH_LIMIT,
};
