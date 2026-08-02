// 단계 3 자료 수집: URL 본문·메타데이터 추출 + 파일(docx/pdf/txt) 텍스트 추출
const JSZip = require('jszip');

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
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return (data.text || '').trim();
}

// name+buffer → 텍스트 (렌더러 파일 업로드 IPC용)
async function extractFile(name, buffer) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'docx') return extractDocx(buffer);
  if (ext === 'pdf') return extractPdf(buffer);
  if (['txt', 'md', 'text'].includes(ext)) return buffer.toString('utf8');
  if (ext === 'hwp') {
    throw new Error('hwp는 직접 지원하지 않습니다. 한글에서 docx/txt로 변환 후 업로드하세요.');
  }
  throw new Error(`지원하지 않는 형식: .${ext} (docx/pdf/txt 지원)`);
}

module.exports = { fetchArticle, extractArticleFromHtml, extractFile, extractDocx, stripTags };
