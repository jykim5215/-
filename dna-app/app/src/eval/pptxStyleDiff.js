// 카드뉴스 XML 검증기: 생성된 pptx의 폰트·색상 값이 템플릿 원본과 일치하는지 diff.
// 생성물에는 템플릿에 없던 폰트/색이 나타나면 안 된다 (텍스트만 교체했다는 증거).
const eng = require('../pptx/engine');

async function collectStyleTokens(zipOrBuffer) {
  const zip = Buffer.isBuffer(zipOrBuffer) ? await eng.loadPptx(zipOrBuffer) : zipOrBuffer;
  const fonts = new Set();
  const colors = new Set();
  const sizes = new Set();
  for (const n of eng.listSlideNumbers(zip)) {
    const xml = await eng.getSlideXml(zip, n);
    for (const m of xml.matchAll(/typeface="([^"]+)"/g)) fonts.add(m[1]);
    for (const m of xml.matchAll(/srgbClr val="([0-9A-Fa-f]{6})"/g)) colors.add(m[1].toUpperCase());
    for (const m of xml.matchAll(/<a:rPr[^>]*\bsz="(\d+)"/g)) sizes.add(m[1]);
  }
  return { fonts, colors, sizes };
}

// output이 template의 부분집합인지 검사. 위반 항목 목록 반환 (빈 배열 = 통과).
async function diffStyles(templateBuffer, outputBuffer) {
  const t = await collectStyleTokens(templateBuffer);
  const o = await collectStyleTokens(outputBuffer);
  const violations = [];
  for (const f of o.fonts) if (!t.fonts.has(f)) violations.push(`템플릿에 없는 폰트: ${f}`);
  for (const c of o.colors) if (!t.colors.has(c)) violations.push(`템플릿에 없는 색상: #${c}`);
  for (const s of o.sizes) if (!t.sizes.has(s)) violations.push(`템플릿에 없는 글자 크기: ${Number(s) / 100}pt`);
  return { ok: violations.length === 0, violations };
}

module.exports = { collectStyleTokens, diffStyles };
