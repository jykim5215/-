const crypto = require('crypto');
const JSZip = require('jszip');
const pdfParse = require('pdf-parse');
const pptxEngine = require('../pptx/engine');
const { validateCardPlan } = require('../pptx/cardnewsRules');

function decodeXml(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function maskContactDetails(text) {
  return String(text || '')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .replace(/\b0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}\b/g, '[PHONE]');
}

function xmlText(block, namespace = 'w') {
  const tag = namespace === 'a' ? 'a:t' : 'w:t';
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out = [];
  let match;
  while ((match = re.exec(block)) !== null) out.push(decodeXml(match[1]));
  return out.join('');
}

async function analyzeDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('유효한 DOCX가 아닙니다: word/document.xml 없음');

  const rawXml = await documentFile.async('string');
  const visibleXml = rawXml
    // 문단/런 속성 안의 <w:del .../> 표식은 범위 시작이 아니다.
    .replace(/<w:del\b[^>]*\/>/g, '')
    .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '')
    .replace(/<w:commentRangeStart\b[^>]*\/>/g, '')
    .replace(/<w:commentRangeEnd\b[^>]*\/>/g, '')
    .replace(/<w:commentReference\b[^>]*\/>/g, '');

  const paragraphs = [];
  const paragraphRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  let paragraph;
  while ((paragraph = paragraphRe.exec(visibleXml)) !== null) {
    const text = xmlText(
      paragraph[0]
        .replace(/<w:tab\b[^>]*\/>/g, '\t')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
    ).replace(/\u00a0/g, ' ').trim();
    if (text) paragraphs.push(text);
  }

  const commentsFile = zip.file('word/comments.xml');
  const commentsXml = commentsFile ? await commentsFile.async('string') : '';
  const comments = (commentsXml.match(/<w:comment\b/g) || []).length;
  const commentsExtendedFile = zip.file('word/commentsExtended.xml');
  const commentsExtendedXml = commentsExtendedFile
    ? await commentsExtendedFile.async('string')
    : '';
  const resolvedComments = (commentsExtendedXml.match(/\bw15:done="1"/g) || []).length;

  const media = Object.keys(zip.files).filter(
    (name) => name.startsWith('word/media/') && !name.endsWith('/')
  );

  return {
    text: paragraphs.join('\n\n'),
    paragraphs,
    metrics: {
      paragraphs: paragraphs.length,
      tables: (rawXml.match(/<w:tbl\b/g) || []).length,
      mediaFiles: media.length,
      comments,
      unresolvedComments: Math.max(0, comments - resolvedComments),
      trackedInsertions: (rawXml.match(/<w:ins\b/g) || []).length,
      trackedDeletions: (rawXml.match(/<w:del\b/g) || []).length,
      nonBreakingSpaces: (rawXml.match(/\u00a0/g) || []).length,
    },
  };
}

function attr(tag, name) {
  return tag?.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '';
}

function parseShape(block, slideWidth, slideHeight) {
  const props = block.match(/<p:cNvPr\b[^>]*>/)?.[0] || '';
  const off = block.match(/<a:off\b[^>]*>/)?.[0] || '';
  const ext = block.match(/<a:ext\b[^>]*>/)?.[0] || '';
  const x = Number(attr(off, 'x') || 0);
  const y = Number(attr(off, 'y') || 0);
  const width = Number(attr(ext, 'cx') || 0);
  const height = Number(attr(ext, 'cy') || 0);
  const hasGeometry = Boolean(off && ext);
  const visible = !hasGeometry ||
    (x < slideWidth && y < slideHeight && x + width > 0 && y + height > 0);
  const paragraphs = pptxEngine.extractParagraphTexts(block)
    .map((text) => text.replace(/\u000b/g, '\n').trim())
    .filter(Boolean);
  const fonts = [...block.matchAll(/\btypeface="([^"]+)"/g)].map((m) => decodeXml(m[1]));
  const sizes = [...block.matchAll(/\bsz="(\d+)"/g)].map((m) => Number(m[1]) / 100);
  const fills = [...block.matchAll(/<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/g)]
    .map((m) => m[1].toUpperCase());

  return {
    id: Number(attr(props, 'id') || 0),
    name: decodeXml(attr(props, 'name')),
    kind: block.startsWith('<p:pic') ? 'picture' : block.startsWith('<p:graphicFrame') ? 'graphic' : 'shape',
    x,
    y,
    width,
    height,
    visible,
    text: paragraphs.join('\n'),
    paragraphs,
    fonts: [...new Set(fonts)],
    sizes: [...new Set(sizes)],
    fills: [...new Set(fills)],
  };
}

function shapeBlocks(slideXml) {
  return slideXml.match(
    /<p:sp\b[\s\S]*?<\/p:sp>|<p:pic\b[\s\S]*?<\/p:pic>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g
  ) || [];
}

async function analyzePptx(buffer) {
  const zip = await pptxEngine.loadPptx(buffer);
  const presentation = await zip.file('ppt/presentation.xml').async('string');
  const sizeTag = presentation.match(/<p:sldSz\b[^>]*>/)?.[0] || '';
  const width = Number(attr(sizeTag, 'cx') || 0);
  const height = Number(attr(sizeTag, 'cy') || 0);
  const order = await pptxEngine.slideOrder(zip);
  const slides = [];
  const fontSet = new Set();

  for (let index = 0; index < order.length; index++) {
    const fileNumber = order[index];
    const xml = await pptxEngine.getSlideXml(zip, fileNumber);
    const shapes = shapeBlocks(xml).map((block) => parseShape(block, width, height));
    shapes.flatMap((shape) => shape.fonts).forEach((font) => fontSet.add(font));
    slides.push({
      index: index + 1,
      fileNumber,
      shapes,
      visibleText: shapes.filter((shape) => shape.visible && shape.text).map((shape) => shape.text),
      offCanvasText: shapes.filter((shape) => !shape.visible && shape.text).map((shape) => shape.text),
    });
  }

  const mediaFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith('ppt/media/') && !name.endsWith('/')
  ).length;

  return {
    width,
    height,
    aspectRatio: height ? width / height : 0,
    slideCount: slides.length,
    fonts: [...fontSet].sort(),
    mediaFiles,
    slides,
  };
}

function firstShape(slide, predicate) {
  return slide.shapes.find((shape) => shape.visible && shape.text && predicate(shape));
}

function deriveCardPlan(deck) {
  if (!deck.slides.length) {
    return { coverTitle: '', category: '', cards: [] };
  }
  const cover = deck.slides[0];
  const title = firstShape(cover, (shape) =>
    shape.name === '제목' || shape.fonts.some((font) => /나눔스퀘어.*ExtraBold/i.test(font))
  );
  const category = firstShape(cover, (shape) =>
    shape.fills.includes('15B1FF') && shape.text !== title?.text
  );

  const cards = [];
  for (const slide of deck.slides.slice(1)) {
    if (slide.visibleText.some((text) => /이 기사가 궁금하다면/.test(text))) break;
    const cardTitle = firstShape(slide, (shape) =>
      shape.name === 'TextBox 4' || shape.sizes.includes(40)
    );
    const body = firstShape(slide, (shape) =>
      shape.name === 'TextBox 6' || shape.sizes.includes(32)
    );
    if (!cardTitle || !body) continue;
    const credit = firstShape(slide, (shape) =>
      shape !== cardTitle &&
      shape !== body &&
      (/사진\s*=/.test(shape.text) || /제공\s*$/.test(shape.text))
    );
    cards.push({
      title: cardTitle.text.replace(/\n+/g, ' ').trim(),
      body: body.paragraphs.join('\n\n'),
      ...(credit ? {
        photoCredit: credit.text
          .replace(/^사진\s*=\s*/, '')
          .replace(/\s*제공\s*$/, '')
          .trim(),
      } : {}),
    });
  }

  return {
    coverTitle: title?.text || '',
    category: category?.text || '',
    cards,
  };
}

function auditReferencePair(article, deck) {
  const blockers = [];
  const warnings = [];

  if (article.metrics.unresolvedComments > 0) {
    blockers.push(`기사 DOCX에 미해결 댓글 ${article.metrics.unresolvedComments}개가 남아 있습니다.`);
  }
  const tracked = article.metrics.trackedInsertions + article.metrics.trackedDeletions;
  if (tracked > 0) {
    blockers.push(
      `기사 DOCX에 추적 변경 ${tracked}개(삽입 ${article.metrics.trackedInsertions}, 삭제 ${article.metrics.trackedDeletions})가 남아 있습니다.`
    );
  }
  if (deck.slideCount > 12) blockers.push(`카드뉴스가 ${deck.slideCount}장으로 최대 12장을 초과합니다.`);
  if (Math.abs(deck.aspectRatio - 0.8) > 0.001) {
    blockers.push(`카드뉴스 비율이 4:5가 아닙니다(${deck.aspectRatio.toFixed(4)}).`);
  }

  const hiddenTemplateText = deck.slides.flatMap((slide) =>
    slide.offCanvasText
      .filter((text) => text.trim() !== '여백')
      .map((text) => ({ slide: slide.index, text }))
  );
  if (hiddenTemplateText.length) {
    warnings.push(`슬라이드 밖 템플릿 문구 ${hiddenTemplateText.length}개가 남아 있습니다.`);
  }

  // 여러 기사가 섞인 병합 덱 감지 — 커버 전용 서체(나눔스퀘어 ExtraBold)가 2번째 장 이후에도 나오면
  // 다른 기사의 커버가 섞였을 가능성이 높다. (복구·백업 폴더에서 흔한 오염 형태)
  const extraCovers = deck.slides.slice(1).filter((slide) =>
    !slide.visibleText.some((text) => /이 기사가 궁금하다면/.test(text)) &&
    slide.shapes.some((shape) =>
      shape.visible && shape.text && shape.fonts.some((font) => /나눔스퀘어.*ExtraBold/i.test(font))
    )
  );
  if (extraCovers.length) {
    blockers.push(
      `커버형 슬라이드가 ${extraCovers.length}장 더 감지되었습니다(슬라이드 ${extraCovers.map((s) => s.index).join(', ')}) — 여러 기사가 섞인 덱일 수 있어 학습쌍으로 쓸 수 없습니다.`
    );
  }

  const plan = deriveCardPlan(deck);

  // 혼합 덱 감지 2: 정상 덱도 섹션 제목을 "연속" 카드에 반복하므로(1→1→2→2…),
  // 같은 제목이 다른 제목을 사이에 두고 "비연속"으로 재등장하는 경우만 병합 신호로 본다.
  // (복구 폴더의 병합 덱은 기사 A→B→A→B로 카드가 교차되어 있었다)
  const titleRuns = [];
  for (const card of plan.cards) {
    const key = (card.title || '').trim();
    if (!key) continue;
    if (!titleRuns.length || titleRuns[titleRuns.length - 1] !== key) titleRuns.push(key);
  }
  const runCounts = {};
  for (const key of titleRuns) runCounts[key] = (runCounts[key] || 0) + 1;
  const interleaved = Object.keys(runCounts).filter((key) => runCounts[key] >= 2);
  if (interleaved.length >= 2) {
    blockers.push(
      `서로 다른 기사 제목이 카드에 교차 반복됩니다(${interleaved.map((t) => `"${t.slice(0, 20)}"`).join(', ')}) — 여러 기사가 섞인 덱이라 학습쌍으로 쓸 수 없습니다.`
    );
  }

  const validation = validateCardPlan(plan, { sourceText: article.text });
  blockers.push(...validation.errors.filter((error) => error.includes('연속 발췌')));
  warnings.push(...validation.warnings);

  const visibleCredits = plan.cards.filter((card) => card.photoCredit).length;
  if (deck.mediaFiles > 2 && visibleCredits === 0) {
    warnings.push('이미지 미디어가 있으나 보이는 사진 출처가 없습니다. 직접 촬영 여부를 확인하세요.');
  }

  return {
    status: blockers.length ? 'needs_review' : 'ready',
    blockers,
    warnings,
    hiddenTemplateText,
    excerptIssues: validation.excerptIssues,
    plan,
  };
}

async function analyzePdf(buffer) {
  const parsed = await pdfParse(buffer);
  const raw = buffer.toString('latin1');
  const mediaBox = raw.match(
    /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/
  );
  const width = mediaBox ? Number(mediaBox[3]) - Number(mediaBox[1]) : null;
  const height = mediaBox ? Number(mediaBox[4]) - Number(mediaBox[2]) : null;
  return {
    pages: parsed.numpages,
    width,
    height,
    aspectRatio: width && height ? width / height : null,
    firstPageText: String(parsed.text || '').trim().split(/\f|\n(?=DGIST )/)[0].slice(0, 1200),
  };
}

async function analyzeSkill(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const skillPath = files.find((name) => /(^|\/)SKILL\.md$/i.test(name));
  if (!skillPath) throw new Error('유효한 .skill 패키지가 아닙니다: SKILL.md 없음');
  const text = await zip.file(skillPath).async('string');
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || '';
  return {
    files,
    name: frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || '',
    descriptionPresent: /^description:\s*.+/m.test(frontmatter),
    lines: text.split(/\r?\n/).length,
    sections: [...text.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim()),
    automationResources: files.filter((name) => /\/(scripts|references|assets|agents)\//.test(name)),
  };
}

module.exports = {
  analyzeDocx,
  analyzePptx,
  analyzePdf,
  analyzeSkill,
  deriveCardPlan,
  auditReferencePair,
  maskContactDetails,
  sha256,
};
