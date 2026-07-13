const path = require('path');
const { extractDocx } = require('./extract');
const pptx = require('../pptx/engine');

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function previewDocx(name, buffer) {
  const text = await extractDocx(buffer);
  return {
    kind: 'docx',
    title: path.basename(String(name || '문서.docx')),
    paragraphs: splitParagraphs(text),
  };
}

async function previewPptx(name, buffer) {
  const zip = await pptx.loadPptx(buffer);
  const order = await pptx.slideOrder(zip);
  const slides = [];
  for (let i = 0; i < order.length; i++) {
    const xml = await pptx.getSlideXml(zip, order[i]);
    const texts = pptx.extractParagraphTexts(xml)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    slides.push({
      index: i + 1,
      fileNumber: order[i],
      texts,
    });
  }
  return {
    kind: 'pptx',
    title: path.basename(String(name || '프레젠테이션.pptx')),
    slideCount: slides.length,
    slides,
  };
}

async function previewFile(name, buffer) {
  const ext = path.extname(String(name || '')).toLowerCase();
  const content = Buffer.from(buffer || []);
  if (!content.length) throw new Error('미리볼 파일이 비어 있습니다.');
  if (ext === '.docx') return previewDocx(name, content);
  if (ext === '.pptx') return previewPptx(name, content);
  throw new Error('미리보기는 docx와 pptx 파일을 지원합니다.');
}

module.exports = {
  previewFile,
  previewDocx,
  previewPptx,
};
