// 유니코드 수동 이스케이프 빌더 — pptx XML 텍스트 주입 전용.
// XML 특수문자 + 비ASCII를 숫자 문자 참조(&#xHHHH;)로 변환해
// 인코딩/파서 차이로 인한 깨짐을 원천 차단한다.
function escapeXmlText(str) {
  let out = '';
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&apos;';
    else if (cp === 0x9 || cp === 0xa || cp === 0xd) out += ch;
    else if (cp < 0x20) continue; // XML 1.0에서 불법인 제어문자 제거
    else if (cp > 0x7e) out += '&#x' + cp.toString(16).toUpperCase() + ';';
    else out += ch;
  }
  return out;
}

// 숫자 참조/기본 엔티티 되돌리기 (텍스트 추출용)
function unescapeXmlText(str) {
  return String(str)
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// <a:t> 요소 생성 — xml:space="preserve" 명시 (공백 보존 하드 룰)
function buildTextElement(text) {
  return `<a:t xml:space="preserve">${escapeXmlText(text)}</a:t>`;
}

module.exports = { escapeXmlText, unescapeXmlText, buildTextElement };
