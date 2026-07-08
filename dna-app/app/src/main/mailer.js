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
  return nodemailer.createTransport({
    host: host || PRESETS.gmail.host,
    port: port || PRESETS.gmail.port,
    secure: secure !== undefined ? secure : (port ? Number(port) === 465 : true),
    auth: { user, pass },
  });
}

// 설정 검증 (발송 전 연결 확인). 반환: {ok, error?}
async function verify(cfg) {
  if (!cfg.user || !cfg.pass) return { ok: false, error: '이메일 주소와 앱 비밀번호를 설정하세요.' };
  try {
    await buildTransport(cfg).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: smtpError(e) };
  }
}

// 발송. msg: {to, subject, body, cc?, bcc?}. cfg: {user, pass, host, port, secure, fromName}
async function sendMail(msg, cfg) {
  if (!cfg.user || !cfg.pass) throw new Error('이메일 주소와 앱 비밀번호를 설정하세요.');
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
    throw new Error(smtpError(e));
  }
}

// SMTP 오류를 사용자 언어로 (자주 나오는 케이스)
function smtpError(e) {
  const m = String(e && e.message || e);
  if (/Invalid login|Username and Password not accepted|BadCredentials/i.test(m)) {
    return '로그인 실패 — 앱 비밀번호가 맞는지 확인하세요. (일반 비밀번호가 아니라 구글 "앱 비밀번호"여야 합니다)';
  }
  if (/self.signed|certificate/i.test(m)) return '서버 인증서 오류 — SMTP 호스트/포트 설정을 확인하세요.';
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(m)) {
    return '메일 서버에 연결하지 못했습니다 — 네트워크와 SMTP 호스트/포트를 확인하세요. (일부 기관망은 외부 SMTP를 차단합니다)';
  }
  if (/Application-specific password required/i.test(m)) {
    return '앱 비밀번호가 필요합니다 — 구글 계정 2단계 인증을 켜고 앱 비밀번호를 발급하세요.';
  }
  return '발송 실패: ' + m;
}

module.exports = { sendMail, verify, buildTransport, PRESETS };
