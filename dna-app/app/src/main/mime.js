// 메일 MIME 디코딩 유틸 — 헤더/본문을 읽을 수 있는 한글 텍스트로 되돌린다.
//
// DGIST 메일서버는 한글 메일을 euc-kr/cp949로 보내는 경우가 많고, 본문 조각만
// 잘라 받으면 전송 인코딩(base64/quoted-printable) 표시가 헤더에 남아 있지 않을
// 수 있다. 그래서 인코딩을 추정해서라도 최대한 읽히게 만든다.
// (붕어빵 dgist-lms-autosaver의 email_reader.py 검증된 로직을 Node로 이식)

// Node/Electron TextDecoder 라벨로 정규화. cp949·ks_c_5601은 euc-kr로 처리.
function normalizeCharset(cs) {
  const c = String(cs || '').toLowerCase().trim().replace(/^["']|["']$/g, '');
  if (!c) return null;
  if (/^(cp949|ms949|ks_c_5601[\w-]*|euckr|euc[-_]kr|korean)$/.test(c)) return 'euc-kr';
  if (/^(utf-?8|unicode-1-1-utf-8)$/.test(c)) return 'utf-8';
  return c;
}

// 여러 문자셋을 차례로 시도해 디코드. 마지막엔 utf-8 대체문자로라도 반환.
function decodeBuf(buf, charsets = []) {
  const tried = new Set();
  for (const raw of [...charsets, 'utf-8', 'euc-kr']) {
    const cs = normalizeCharset(raw);
    if (!cs || tried.has(cs)) continue;
    tried.add(cs);
    try {
      // fatal:true → 깨지면 다음 문자셋으로 넘어감
      return new TextDecoder(cs, { fatal: true }).decode(buf);
    } catch {
      continue;
    }
  }
  return buf.toString('utf8');
}

// RFC 2047 인코딩 헤더(=?utf-8?B?...?=) 디코드. 제목·발신자 이름에 쓰인다.
function decodeMimeWords(value) {
  const text = String(value || '');
  if (!text.includes('=?')) return text.trim();
  // 인접한 인코딩 워드 사이의 공백은 규격상 제거 대상
  const out = text.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s*)(?==\?)|=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (m, cs1, enc1, txt1, _sp, cs2, enc2, txt2) => {
      const cs = cs1 || cs2;
      const enc = (enc1 || enc2).toUpperCase();
      const txt = txt1 !== undefined ? txt1 : txt2;
      try {
        let buf;
        if (enc === 'B') {
          buf = Buffer.from(txt, 'base64');
        } else {
          // Q 인코딩: '_'는 공백, =XX는 16진
          const q = txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
            String.fromCharCode(parseInt(h, 16))
          );
          buf = Buffer.from(q, 'binary');
        }
        return decodeBuf(buf, [cs]);
      } catch {
        return m;
      }
    }
  );
  return out.trim();
}

// 메일 헤더 블록 파싱 (접힌 줄 펼치기 포함). 키는 소문자.
function parseHeaders(raw) {
  const headers = {};
  let current = null;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += ' ' + line.trim();
    } else {
      const i = line.indexOf(':');
      if (i > 0) {
        current = line.slice(0, i).trim().toLowerCase();
        headers[current] = line.slice(i + 1).trim();
      }
    }
  }
  return headers;
}

// IMAP modified UTF-7 폴더명 → 유니코드 ("&vPSwuTDW-" → 한글 폴더명)
function imapUtf7Decode(s) {
  const str = String(s || '');
  let res = '';
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (c === '&') {
      const j = str.indexOf('-', i);
      if (j === i + 1) { res += '&'; i = j + 1; continue; }
      if (j === -1) { res += str.slice(i); break; }
      const chunk = str.slice(i + 1, j).replace(/,/g, '/');
      try {
        const buf = Buffer.from(chunk + '='.repeat((4 - (chunk.length % 4)) % 4), 'base64');
        res += buf.swap16().toString('utf16le'); // base64 안은 UTF-16BE
      } catch {
        res += str.slice(i, j + 1);
      }
      i = j + 1;
    } else {
      res += c;
      i += 1;
    }
  }
  return res;
}

// 본문 조각 앞에 멀티파트 경계/파트 헤더가 붙어 있으면 떼어낸다.
// 반환: { body, encoding, charset }
function stripMimePartHeaders(raw) {
  let buf = raw;
  let encoding = '';
  let charset = '';
  const head = buf.toString('binary');
  const m = head.match(
    /^\s*(?:--[^\r\n]*\r?\n)*((?:[A-Za-z][A-Za-z0-9-]*:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*\r?\n)+)\r?\n/
  );
  if (m && /content-/i.test(m[1])) {
    const hdrs = m[1].toLowerCase();
    const encM = hdrs.match(/content-transfer-encoding:\s*([a-z0-9-]+)/);
    if (encM) encoding = encM[1];
    const csM = hdrs.match(/charset="?([a-z0-9_-]+)"?/);
    if (csM) charset = csM[1];
    buf = Buffer.from(head.slice(m[0].length), 'binary');
  }
  // 남아 있는 경계 줄 제거
  const cleaned = buf.toString('binary').replace(/--+=?_?[A-Za-z0-9_.=+-]*--?\s*/g, ' ');
  return { body: Buffer.from(cleaned, 'binary'), encoding, charset };
}

// HTML/CSS가 섞인 본문을 평문으로. <style>이 안 닫혀도 CSS가 새지 않게 정리한다.
function cleanHtmlToText(input, limit = 4000) {
  let text = String(input || '');
  // 1) style/script/head 블록 제거 (닫는 태그 없으면 끝까지)
  text = text.replace(/<style\b[\s\S]*?(?:<\/style>|$)/gi, ' ');
  text = text.replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, ' ');
  text = text.replace(/<head\b[\s\S]*?(?:<\/head>|$)/gi, ' ');
  text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, ' '); // 조건부 주석 포함
  // 2) 줄바꿈이 될 만한 태그는 개행으로
  text = text.replace(/<\s*br\s*\/?>/gi, '\n');
  text = text.replace(/<\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n');
  // 3) 나머지 태그 제거
  text = text.replace(/<[^>]+>/g, ' ');
  // 4) 태그가 사라지며 드러난 CSS 잔재 정리
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  text = text.replace(/@(?:import|media|font-face|charset)[^;{]*[;{]/gi, ' ');
  text = text.replace(/[#.]?[A-Za-z][\w-]*(?:\s*[,>+~\s]\s*[#.]?[\w-]+)*\s*\{[^{}]*\}/g, ' ');
  text = text.replace(/\{[^{}]*\}/g, ' ');
  text = text.replace(/[a-zA-Z-]+\s*:\s*[^;{}\n]+;/g, ' ');
  text = text.replace(/#[A-Za-z][\w-]*/g, ' ');
  // 5) HTML 엔티티 복원
  text = unescapeHtml(text);
  // 6) 눈에 안 보이는 공백 정규화.
  //    &nbsp;(U+00A0)나 zero-width 문자가 남으면 나중에 인용문을 원문과 대조할 때
  //    똑같아 보이는데도 불일치로 판정되므로 여기서 일반 공백으로 바꾼다.
  text = text.replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ');
  text = text.replace(/[\u200b-\u200d\ufeff]/g, '');
  // 7) 공백 정리 (문단 개행은 유지)
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*/g, '\n\n');
  text = text.replace(/[ \t]*\n[ \t]*/g, '\n');
  return text.trim().slice(0, limit);
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  middot: '·', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘',
  rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', trade: '™',
  copy: '©', reg: '®', deg: '°', times: '×', euro: '€', pound: '£', yen: '¥',
};
function unescapeHtml(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X'
        ? parseInt(ref.slice(2), 16)
        : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    const v = ENTITIES[ref.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

// 인코딩 정보가 불완전한 본문 조각을 최대한 읽을 수 있게 디코드.
function decodeBodySnippet(raw, limit = 4000) {
  if (!raw || !raw.length) return '';
  const { body, encoding, charset } = stripMimePartHeaders(raw);

  const charsets = charset ? [charset, 'utf-8', 'euc-kr'] : ['utf-8', 'euc-kr'];
  let text = '';

  if (encoding === 'base64') {
    text = decodeBuf(Buffer.from(body.toString('binary').replace(/\s+/g, ''), 'base64'), charsets);
  } else if (encoding === 'quoted-printable') {
    text = decodeBuf(decodeQuotedPrintable(body), charsets);
  }

  const stripped = body.toString('binary').replace(/\s+/g, '');
  // 인코딩 표시가 없어도 base64로 보이면 디코드 시도 (조각만 받을 때 흔함)
  if (!text && stripped && /^[A-Za-z0-9+/=]+$/.test(stripped) && stripped.length > 16) {
    text = decodeBuf(Buffer.from(stripped, 'base64'), charsets);
  }
  if (!text) {
    let candidate = body;
    if (/=3D|=[0-9A-F]{2}/.test(body.toString('binary'))) {
      candidate = decodeQuotedPrintable(body);
    }
    text = decodeBuf(candidate, charsets);
  }
  return cleanHtmlToText(text, limit);
}

function decodeQuotedPrintable(buf) {
  const s = buf.toString('binary')
    .replace(/=\r?\n/g, '')                       // soft line break
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(s, 'binary');
}

module.exports = {
  decodeMimeWords,
  parseHeaders,
  imapUtf7Decode,
  stripMimePartHeaders,
  decodeBodySnippet,
  decodeQuotedPrintable,
  cleanHtmlToText,
  decodeBuf,
  normalizeCharset,
};
