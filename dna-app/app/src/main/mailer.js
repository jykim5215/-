// 앱 내 이메일 발송 — SMTP (nodemailer)
//
// DGIST 메일은 구글 워크스페이스 기반이라 smtp.gmail.com + 앱 비밀번호로 발송한다.
// (구글 계정 2단계 인증 → 앱 비밀번호 발급 → 설정에 저장). SMTP 호스트/포트는
// 설정으로 바꿀 수 있어 DGIST가 자체 메일 서버를 쓰는 경우에도 대응된다.
//
// 보안: 앱 비밀번호는 safeStorage로 암호화 저장(main에서 처리), 이 모듈은 평문을 받지만
//       메모리에서만 쓰고 저장하지 않는다.
const nodemailer = require('nodemailer');

// 프리셋: 알려진 제공자의 SMTP 기본값
const PRESETS = {
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

// 발송. msg: {to, subject, body, cc?, bcc?}. cfg: {user, pass, host, port, secure, fromName}
async function sendMail(msg, cfg) {
  if (!cfg.user || !cfg.pass) throw new Error('이메일 주소와 비밀번호를 설정하세요.');
  if (!msg.to || !/.+@.+\..+/.test(msg.to)) throw new Error('받는 사람 이메일 주소가 올바르지 않습니다.');
  const from = cfg.fromName ? `${cfg.fromName} <${cfg.user}>` : cfg.user;
  try {
    const info = await buildTransport(cfg).sendMail({
      from,
      to: msg.to,
      cc: msg.cc || undefined,
      bcc: msg.bcc || undefined,
      subject: msg.subject || '(제목 없음)',
      text: msg.body || '',
    });
    return { ok: true, messageId: info.messageId, accepted: info.accepted };
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
    return '메일 서버에 연결하지 못했습니다 — SMTP 호스트/포트를 확인하세요. (예: mail.dgist.ac.kr, 포트 465 또는 587. 일부 망은 외부 SMTP를 차단합니다)';
  }
  if (/Application-specific password required/i.test(m)) {
    return 'Gmail 앱 비밀번호가 필요합니다 — 2단계 인증을 켜고 앱 비밀번호를 발급하세요.';
  }
  return '발송 실패: ' + m;
}

module.exports = { sendMail, verify, buildTransport, PRESETS };
