// 단계 3 자료 수집: URL 본문·메타데이터 추출 + 파일(docx/pdf/txt) 텍스트 추출
const JSZip = require('jszip');
const pptx = require('../pptx/engine');

// ---- HTML → 기사 추출 (의존성 없는 휴리스틱 리더빌리티) ----
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|figcaption)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function metaContent(html, patterns) {
  for (const p of patterns) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`,
      'i'
    );
    const m = html.match(re);
    if (m) return (m[1] || m[2]).trim();
  }
  return '';
}

function extractArticleFromHtml(html, url) {
  const title =
    metaContent(html, ['og:title', 'twitter:title']) ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const author = metaContent(html, ['author', 'article:author', 'og:article:author', 'dable:author']);
  const date = metaContent(html, [
    'article:published_time', 'og:article:published_time', 'date', 'sailthru.date',
  ]);
  const site = metaContent(html, ['og:site_name']) || new URL(url).hostname;

  // 본문: <article> 우선, 없으면 전체에서 텍스트 추출
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const bodyHtml = articleMatch ? articleMatch[0] : html.replace(/<(header|nav|footer|aside)[\s\S]*?<\/\1>/gi, '');
  const text = stripTags(bodyHtml);

  return {
    title: title || '(제목 추출 실패)',
    author,
    date,
    site,
    url,
    text,
  };
}

async function fetchArticle(url) {
  const u = new URL(url); // 형식 검증
  if (!/^https?:$/.test(u.protocol)) throw new Error('http/https URL만 지원합니다.');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (DNA-Desk article importer)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`요청 실패: HTTP ${res.status}`);
  const html = await res.text();
  return extractArticleFromHtml(html, url);
}

// ---- 파일 텍스트 추출 ----
async function extractDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('docx 형식이 아닙니다 (word/document.xml 없음).');
  const xml = await doc.async('string');
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return (data.text || '').trim();
}

async function extractPptx(buffer) {
  const zip = await pptx.loadPptx(buffer);
  const order = await pptx.slideOrder(zip);
  const slides = [];
  for (let i = 0; i < order.length; i++) {
    const xml = await pptx.getSlideXml(zip, order[i]);
    const text = pptx.extractParagraphTexts(xml)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (text) slides.push(`[슬라이드 ${i + 1}]\n${text}`);
  }
  return slides.join('\n\n').trim();
}

// hwpx (OWPML): zip 안 Contents/section*.xml의 <hp:t> 텍스트
async function extractHwpx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sections = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort();
  if (!sections.length) throw new Error('hwpx 형식이 아닙니다 (Contents/section 없음).');
  const parts = [];
  for (const name of sections) {
    const xml = await zip.file(name).async('string');
    const text = xml
      .replace(/<hp:p[ >]/g, '\n<hp:p ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n').trim();
}

// xlsx: 공유 문자열 + 시트 인라인 문자열을 순서대로 덤프
async function extractXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const out = [];
  const shared = zip.file('xl/sharedStrings.xml');
  if (shared) {
    const xml = await shared.async('string');
    const texts = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1].trim()).filter(Boolean);
    if (texts.length) out.push(texts.join('\n'));
  }
  if (!out.length) throw new Error('xlsx에서 텍스트를 찾지 못했습니다.');
  return out.join('\n\n').trim();
}

function extractRtf(buffer) {
  return buffer.toString('utf8')
    .replace(/\\'[0-9a-f]{2}/gi, ' ')
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCodePoint(((Number(n) % 65536) + 65536) % 65536))
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractSubtitles(text) {
  return text
    .replace(/^WEBVTT.*$/m, '')
    .split(/\r?\n/)
    .filter((line) => !/^\d+$/.test(line.trim()) && !/-->/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 대부분 출력 가능한 문자면 텍스트 파일로 간주 (확장자 모를 때)
function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 4096);
  if (!sample.length) return false;
  let bad = 0;
  for (const byte of sample) {
    if (byte === 0) return false; // NUL = 바이너리
    if (byte < 9 || (byte > 13 && byte < 32)) bad++;
  }
  return bad / sample.length < 0.02;
}

const AUDIO_VIDEO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'mp4', 'mov', 'webm', 'mkv', 'avi'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'svg', 'tif', 'tiff'];

// name+buffer → 텍스트 (렌더러 파일 업로드 IPC용)
// 어떤 형식이든 최대한 받아준다. 텍스트를 못 뽑는 형식은 코드가 붙은 오류를 던져
// 렌더러가 라우팅(오디오→받아쓰기, 이미지→사진 자료)하게 한다.
async function extractFile(name, buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const ext = (String(name).split('.').pop() || '').toLowerCase();

  if (AUDIO_VIDEO_EXT.includes(ext)) {
    const err = new Error('오디오/영상 파일입니다 — 받아쓰기(whisper)로 처리하세요.');
    err.code = 'AUDIO_MEDIA';
    throw err;
  }
  if (IMAGE_EXT.includes(ext)) {
    const err = new Error('이미지 파일입니다 — 사진 자료로 기록하거나 카드뉴스 단계에서 사용하세요.');
    err.code = 'IMAGE_MEDIA';
    throw err;
  }

  if (ext === 'docx' || ext === 'dotx') return extractDocx(buf);
  if (ext === 'pptx' || ext === 'potx') return extractPptx(buf);
  if (ext === 'pdf') return extractPdf(buf);
  if (ext === 'hwpx') return extractHwpx(buf);
  if (ext === 'xlsx' || ext === 'xlsm') return extractXlsx(buf);
  if (ext === 'rtf') return extractRtf(buf);
  if (['html', 'htm', 'xhtml'].includes(ext)) return stripTags(buf.toString('utf8'));
  if (['srt', 'vtt'].includes(ext)) return extractSubtitles(buf.toString('utf8'));
  if (['txt', 'md', 'text', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'xml'].includes(ext)) {
    return buf.toString('utf8').trim();
  }
  if (ext === 'hwp') {
    const err = new Error('구형 hwp는 직접 지원하지 않습니다. 한글에서 hwpx/docx/txt로 저장해 다시 올리면 됩니다.');
    err.code = 'BINARY_FILE';
    throw err;
  }

  // 모르는 확장자: zip 계열(OOXML)인지 → 텍스트인지 차례로 시도
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    for (const attempt of [extractDocx, extractPptx, extractHwpx, extractXlsx]) {
      try {
        const text = await attempt(buf);
        if (text) return text;
      } catch { /* 다음 형식 시도 */ }
    }
  }
  if (looksLikeText(buf)) return buf.toString('utf8').trim();

  const err = new Error(`.${ext} 형식에서 본문 텍스트를 추출하지 못했습니다.`);
  err.code = 'BINARY_FILE';
  throw err;
}

module.exports = {
  fetchArticle,
  extractArticleFromHtml,
  extractFile,
  extractDocx,
  extractPptx,
  extractHwpx,
  extractXlsx,
  stripTags,
  AUDIO_VIDEO_EXT,
  IMAGE_EXT,
};
