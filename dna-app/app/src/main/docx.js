// 기사 초안 → docx 생성기 (의존성: JSZip만 사용, OOXML 직접 작성)
// 초안 텍스트 규약: 첫 줄 = 제목, 이후 빈 줄로 구분된 문단들.
const JSZip = require('jszip');
const { escapeXmlText } = require('../pptx/escape');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// 기본 스타일: 제목(맑은 고딕 계열 20pt Bold), 부제(10pt 회색), 본문(11pt, 줄간격 1.5)
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Malgun Gothic" w:eastAsia="Malgun Gothic" w:hAnsi="Malgun Gothic"/>
<w:sz w:val="22"/><w:szCs w:val="22"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto" w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>
<w:pPr><w:spacing w:after="240"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Byline"><w:name w:val="Byline"/>
<w:pPr><w:spacing w:after="360"/></w:pPr>
<w:rPr><w:color w:val="6B7385"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Todo"><w:name w:val="Todo"/>
<w:rPr><w:color w:val="B3261E"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
</w:styles>`;

function para(text, styleId = null) {
  const style = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : '';
  const lines = String(text).split('\n');
  const runs = lines
    .map((l, i) => `${i > 0 ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${escapeXmlText(l)}</w:t></w:r>`)
    .join('');
  return `<w:p>${style}${runs}</w:p>`;
}

// 초안 텍스트 파싱: 제목 / 본문 문단들 / ---확인 필요--- 섹션
function parseDraft(text) {
  const lines = String(text).replace(/\r\n/g, '\n').trim().split('\n');
  const title = (lines.shift() || '').trim();
  const rest = lines.join('\n').trim();
  const [bodyPart, todoPart] = rest.split(/-{2,}\s*확인 필요\s*-{2,}/);
  const paragraphs = (bodyPart || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const todos = (todoPart || '').split('\n').map((t) => t.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
  return { title, paragraphs, todos };
}

// draftText + 메타 → docx Buffer
async function buildDraftDocx(draftText, { byline = '' } = {}) {
  const { title, paragraphs, todos } = parseDraft(draftText);
  const body = [
    para(title || '(제목 없음)', 'Title'),
    byline ? para(byline, 'Byline') : '',
    ...paragraphs.map((p) => para(p)),
    ...(todos.length
      ? [para('※ 확인 필요', 'Todo'), ...todos.map((t) => para('· ' + t, 'Todo'))]
      : []),
  ].join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/document.xml', document);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildDraftDocx, parseDraft };
