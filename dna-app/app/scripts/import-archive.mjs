// 과거 자산 일괄 수집 (부트스트랩 임포트 도구)
// 1) dgistdna.com 기사 아카이브: WordPress REST → 실패 시 RSS 폴백
// 2) 과거 카드뉴스 pptx: 텍스트 추출 → (기사 ↔ 카드뉴스) 쌍 후보 생성
//
// 사용법:
//   node scripts/import-archive.mjs --db <sqlite경로> [--base https://dgistdna.com] [--limit 200]
//   node scripts/import-archive.mjs --db <sqlite경로> --pptx <카드뉴스.pptx> [--match-title "기사 제목"]
//
// 참고: Electron 앱의 DB 경로는 OS별 userData/dna-data/dna.sqlite (앱의 📊 지표 대화상자 참고).
// 이 스크립트는 네트워크가 되는 로컬 PC에서 실행하는 것을 전제로 한다.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Store } = require(path.join(APP, 'src/main/db.js'));
const archive = require(path.join(APP, 'src/main/archive.js'));
const { stripTags } = require(path.join(APP, 'src/main/extract.js'));
const eng = require(path.join(APP, 'src/pptx/engine.js'));

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const dbPath = arg('db');
if (!dbPath) {
  console.error('사용법: node scripts/import-archive.mjs --db <sqlite경로> [--base URL] [--limit N] [--pptx 파일]');
  process.exit(1);
}
const base = (arg('base', 'https://dgistdna.com')).replace(/\/$/, '');
const limit = parseInt(arg('limit', '200'), 10);
const pptxPath = arg('pptx');

const store = await Store.open(dbPath);

async function importFromWpRest() {
  let page = 1;
  let imported = 0;
  const perPage = 50;
  while (imported < limit) {
    const url = `${base}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&_fields=title,link,date,content`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      if (page === 1) throw new Error(`WP REST 사용 불가 (HTTP ${res.status})`);
      break;
    }
    const posts = await res.json();
    if (!Array.isArray(posts) || !posts.length) break;
    for (const p of posts) {
      archive.upsertArticle(store, {
        title: stripTags(p.title?.rendered || ''),
        url: p.link || '',
        publishedAt: p.date || '',
        body: stripTags(p.content?.rendered || ''),
      });
      imported++;
      if (imported >= limit) break;
    }
    console.log(`  페이지 ${page}: 누적 ${imported}건`);
    page++;
  }
  return imported;
}

async function importFromRss() {
  const res = await fetch(`${base}/feed/`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`RSS 사용 불가 (HTTP ${res.status})`);
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  let imported = 0;
  for (const item of items.slice(0, limit)) {
    const pick = (tag) =>
      (item.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1] || '').trim();
    archive.upsertArticle(store, {
      title: stripTags(pick('title')),
      url: pick('link'),
      publishedAt: pick('pubDate'),
      body: stripTags(pick('content:encoded') || pick('description')),
    });
    imported++;
  }
  return imported;
}

// 카드뉴스 pptx → 텍스트 추출 → (기사 ↔ 카드뉴스 텍스트) 쌍 후보를 records에 저장
async function importPptxPair(file, matchTitle) {
  const zip = await eng.loadPptx(fs.readFileSync(file));
  const order = await eng.slideOrder(zip);
  const cards = [];
  for (const n of order) {
    const paras = eng
      .extractParagraphTexts(await eng.getSlideXml(zip, n))
      .filter((p) => p.trim() && !['여백', 'ㅡ'].includes(p.trim()));
    if (paras.length) cards.push(paras);
  }
  const cardText = cards.map((c, i) => `[카드 ${i + 1}]\n${c.join('\n')}`).join('\n\n');

  let articleBody = '';
  if (matchTitle) {
    const hit = store.get('SELECT body FROM archive WHERE title LIKE ?', [`%${matchTitle}%`]);
    if (hit) articleBody = hit.body;
  }
  const records = require(path.join(APP, 'src/main/records.js'));
  const id = records.createRecord(store, {
    projectId: 'bootstrap-import',
    stage: 'cardnews',
    input: { context: articleBody || `(원문 기사 미연결 — --match-title로 연결 가능) 파일: ${path.basename(file)}` },
    aiOutput: '',
    modelVersion: 'bootstrap',
  });
  records.finalizeRecord(store, id, cardText);
  console.log(`  pptx 쌍 등록: ${path.basename(file)} → record ${id} (카드 ${cards.length}장)`);
}

if (pptxPath) {
  await importPptxPair(pptxPath, arg('match-title'));
} else {
  console.log(`아카이브 임포트 시작: ${base} (최대 ${limit}건)`);
  let n = 0;
  try {
    n = await importFromWpRest();
    console.log(`WP REST로 ${n}건 임포트`);
  } catch (e) {
    console.log(`WP REST 실패(${e.message}) → RSS 폴백`);
    n = await importFromRss();
    console.log(`RSS로 ${n}건 임포트 (RSS는 최근 글 위주 — 전체 아카이브는 WP REST 필요)`);
  }
}
store.persist();
console.log(`완료. 아카이브 총 ${archive.archiveCount(store)}건`);
