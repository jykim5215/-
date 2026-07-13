// 앱 내 이메일 발송 — SMTP (nodemailer)
//
// DGIST 메일은 기본적으로 mail.dgist.ac.kr:587 STARTTLS로 발송한다.
// SMTP 호스트/포트는 설정으로 바꿀 수 있어 Gmail 등 다른 서버도 대응된다.
//
// 보안: 앱 비밀번호는 safeStorage로 암호화 저장(main에서 처리), 이 모듈은 평문을 받지만
//       메모리에서만 쓰고 저장하지 않는다.
const nodemailer = require('nodemailer');
const path = require('path');

// 프리셋: 알려진 제공자의 SMTP 기본값
const PRESETS = {
  dgist: { host: 'mail.dgist.ac.kr', port: 587, secure: false },
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
};

function buildTransport({ host, port, secure, user, pass }) {
  const h = host || PRESETS.dgist.host;
  const p = port || PRESETS.dgist.port;
  // 465 = 암시적 SSL, 그 외(587/25) = STARTTLS. secure를 명시하면 그대로 따름.
  const isSecure = secure !== undefined ? secure : Number(p) === 465;
  return nodemailer.createTransport({
    host: h,
    port: Number(p),
    secure: isSecure,
    requireTLS: !isSecure, // 587 등에서 STARTTLS 강제 (평문 전송 방지)
    auth: { user, pass },
    tls: { minVersion: 'TLSv1.2', servername: h },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

function isGmailHost(cfg) {
  return !cfg.host || /gmail\.com|googlemail\.com/i.test(cfg.host);
}

function isDgistHost(cfg) {
  return /dgist\.ac\.kr/i.test(cfg.host || PRESETS.dgist.host);
}

// 연결 자체가 안 된 오류(포트 차단·STARTTLS 거부 등) — 다른 포트로 재시도할 가치가 있다.
function isConnectionError(e) {
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|getaddrinfo|ESOCKET|greeting|STARTTLS|wrong version number|EPROTO|certificate|CERT_|self.signed/i
    .test(String(e && e.message || e));
}

function isAuthError(e) {
  return /Invalid login|Username and Password not accepted|BadCredentials|Authentication (failed|unsuccessful)|AUTHENTICATIONFAILED|535/i
    .test(String(e && e.message || e));
}

// 시도할 (포트, 로그인 ID) 조합. 설정된 포트 → 반대 포트(587↔465) 순.
// DGIST 서버는 로그인 ID로 전체 주소 대신 아이디만 요구할 수 있어 인증 실패 시 로컬파트로 재시도한다.
function candidatePlans(cfg) {
  const host = cfg.host || PRESETS.dgist.host;
  const port = Number(cfg.port || PRESETS.dgist.port);
  const ports = [port, port === 465 ? 587 : 465];
  const users = [cfg.user];
  const localPart = String(cfg.user || '').split('@')[0];
  if (isDgistHost(cfg) && localPart && localPart !== cfg.user) users.push(localPart);
  const plans = [];
  for (const p of ports) for (const u of users) plans.push({ ...cfg, host, port: p, secure: undefined, user: u });
  return plans;
}

// 폴백 실행기: 연결 오류면 다음 포트로, 인증 오류면 다음 로그인 ID로 넘어간다.
// fn(transport, plan) 성공 시 { result, plan } 반환.
async function withFallback(cfg, fn) {
  const plans = candidatePlans(cfg);
  const attempts = [];
  let lastError = null;
  let skipPort = null; // 연결이 안 된 포트 — 같은 포트의 다른 로그인 ID도 건너뜀 (타임아웃 중복 방지)
  let lockPort = null; // 인증 오류가 난 포트 = 연결은 되는 포트 — 이 포트에서 로그인 ID만 바꿔 시도
  for (const plan of plans) {
    if (plan.port === skipPort) continue;
    if (lockPort !== null && plan.port !== lockPort) continue;
    try {
      const result = await fn(buildTransport(plan), plan);
      return { result, plan };
    } catch (e) {
      attempts.push({ host: plan.host, port: plan.port, user: plan.user });
      lastError = e;
      if (isAuthError(e)) lockPort = plan.port;
      else if (isConnectionError(e)) skipPort = plan.port;
      else break; // 수신자 거부 등은 재시도 의미 없음
    }
  }
  const tried = attempts.map((a) => `${a.host}:${a.port}(${a.user})`).join(', ');
  const err = new Error(`${smtpError(lastError, cfg)}\n(시도: ${tried})`);
  err.attempts = attempts;
  throw err;
}

// 설정 검증 (발송 전 연결 확인). 반환: {ok, error?, used?}
async function verify(cfg) {
  if (!cfg.user || !cfg.pass) return { ok: false, error: '이메일 주소와 비밀번호를 설정하세요.' };
  try {
    const { plan } = await withFallback(cfg, (t) => t.verify());
    return { ok: true, used: { host: plan.host, port: plan.port, user: plan.user } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 발송. msg: {to, subject, body, cc?, bcc?}. cfg: {user, pass, host, port, secure, fromName}
// 폴백으로 성공하면 used에 실제로 통한 포트·로그인 ID가 담긴다 (호출측에서 설정에 저장).
async function sendMail(msg, cfg) {
  if (!cfg.user || !cfg.pass) throw new Error('이메일 주소와 비밀번호를 설정하세요.');
  validateAddressList(msg.to, '받는 사람', { required: true });
  validateAddressList(msg.cc, '참조');
  validateAddressList(msg.bcc, '숨은참조');
  const { result: info, plan } = await withFallback(cfg, (t) => t.sendMail(buildMailOptions(msg, cfg)));
  return {
    ok: true,
    messageId: info.messageId,
    accepted: info.accepted,
    used: { host: plan.host, port: plan.port, user: plan.user },
  };
}

function buildMailOptions(msg, cfg) {
  const from = cfg.fromName ? `${cfg.fromName} <${cfg.user}>` : cfg.user;
  return {
    from,
    to: msg.to,
    cc: cleanAddressList(msg.cc),
    bcc: cleanAddressList(msg.bcc),
    subject: msg.subject || '(제목 없음)',
    text: msg.body || '',
    attachments: normalizeAttachments(msg.attachments || []),
  };
}

function cleanAddressList(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const items = value.flatMap(splitAddressList).map((v) => String(v).trim()).filter(Boolean);
    return items.length ? items.join(', ') : undefined;
  }
  const items = splitAddressList(value);
  return items.length ? items.join(', ') : undefined;
}

function splitAddressList(value) {
  return String(value || '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function emailFromAddress(value) {
  const text = String(value || '').trim();
  return (text.match(/<([^<>@\s]+@[^<>\s]+)>/)?.[1] || text).trim();
}

function isEmailAddress(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(emailFromAddress(value));
}

function validateAddressList(value, label, { required = false } = {}) {
  const items = Array.isArray(value) ? value.flatMap(splitAddressList) : splitAddressList(value);
  if (required && !items.length) throw new Error(`${label} 이메일 주소를 입력하세요.`);
  const invalid = items.find((item) => !isEmailAddress(item));
  if (invalid) throw new Error(`${label} 이메일 주소가 올바르지 않습니다: ${invalid}`);
}

function normalizeAttachments(items) {
  return items
    .filter((item) => item && item.name && (item.buffer || item.content || item.base64))
    .map((item) => {
      const rawName = path.basename(String(item.name)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      const content = item.base64
        ? Buffer.from(item.base64, 'base64')
        : Buffer.from(item.buffer || item.content);
      return {
        filename: rawName || 'attachment',
        content,
        contentType: item.type || item.contentType || undefined,
      };
    });
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
    return '메일 서버에 연결하지 못했습니다 — SMTP 호스트/포트를 확인하세요. (예: mail.dgist.ac.kr, 포트 465 또는 587. 일부 망은 외부 SMTP를 차단합니다)';
  }
  if (/Application-specific password required/i.test(m)) {
    return 'Gmail 앱 비밀번호가 필요합니다 — 2단계 인증을 켜고 앱 비밀번호를 발급하세요.';
  }
  return '발송 실패: ' + m;
}

module.exports = {
  sendMail,
  verify,
  buildTransport,
  buildMailOptions,
  normalizeAttachments,
  cleanAddressList,
  validateAddressList,
  candidatePlans,
  withFallback,
  isConnectionError,
  isAuthError,
  PRESETS,
};
