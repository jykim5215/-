// 레퍼런스 일괄 분석 — 기사(docx)+카드뉴스(pptx) 쌍을 폴더째 스캔해
// reference_pairs/review/<배치>/<슬러그>/ 에 구조화 데이터와 감사 보고서를 쌓고,
// 말뭉치 전체의 통계(장수 분포·비율·폰트·카테고리·본문 분량)를 집계한다.
//
// 사용: node scripts/analyze-reference-batch.mjs --src <자료폴더> [--out reference_pairs/review/batch-YYYY-MM] [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  analyzeDocx,
  analyzePptx,
  auditReferencePair,
  maskContactDetails,
  sha256,
} = require('../src/main/referenceAudit');

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const srcDir = path.resolve(option('src') || (() => { throw new Error('--src 자료 폴더가 필요합니다.'); })());
const outRoot = path.resolve(APP, option('out') || path.join('reference_pairs', 'review', `batch-${new Date().toISOString().slice(0, 7)}`));
const limit = Number(option('limit') || 0);

// OOXML 잔해·시스템 폴더는 건너뜀
const SKIP_DIRS = new Set(['word', 'ppt', 'media', 'docprops', 'customxml', '_rels', '[trash]', 'node_modules']);
const CATEGORY_BY_PREFIX = { F: '기획', I: '인터뷰', O: '오피니언', P: '포토', S: '스트레이트' };

function* walkUnits(dir, rel = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const hasDocx = files.some((f) => /\.docx$/i.test(f) && !f.startsWith('~$'));
  if (hasDocx && rel) yield { dir, rel, files };
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
    yield* walkUnits(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
  }
}

function pickArticle(files) {
  const candidates = files.filter((f) =>
    /\.docx$/i.test(f) && !f.startsWith('~$') && !/질문지/.test(f));
  if (!candidates.length) return null;
  // 카테고리 접두(F_/I_/O_/P_/S_) 있는 파일 우선, 요약본(SUMMER 등) 제외 우선
  const ranked = [...candidates].sort((a, b) => {
    const score = (f) => (/^[FIOPS]_/.test(f) ? 2 : 0) + (/SUMMER|요약/i.test(f) ? -1 : 0);
    return score(b) - score(a);
  });
  return ranked[0];
}

function pickCardnews(files) {
  const candidates = files.filter((f) => /\.pptx$/i.test(f) && !f.startsWith('~$') && !/figure/i.test(f));
  if (!candidates.length) return null;
  const ranked = [...candidates].sort((a, b) => {
    const score = (f) => (/카드뉴스|카뉴/.test(f) ? 2 : 0) + (/^인스타그램_카드뉴스_2025개편/.test(f) ? -1 : 0);
    return score(b) - score(a);
  });
  return ranked[0];
}

function slugify(rel) {
  return rel
    .replace(/6\.3/g, '6-3')
    .split('/')
    .map((part) => part.replace(/_[^_]*$/, '')) // 마지막 _작성자들 제거
    .join('__')
    .replace(/[\\/:*?"<>|.,\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'pair';
}

function categoryOf(rel, articleName) {
  const m = (articleName || rel).match(/(?:^|\/)([FIOPS])_/);
  if (m) return CATEGORY_BY_PREFIX[m[1]];
  if (/인터뷰/.test(rel)) return '인터뷰';
  return '';
}

const units = [...walkUnits(srcDir)];
const summary = [];
let done = 0;

for (const unit of units) {
  if (limit && done >= limit) break;
  const articleName = pickArticle(unit.files);
  if (!articleName) continue;
  const cardnewsName = pickCardnews(unit.files);
  const slug = slugify(unit.rel);
  const outDir = path.join(outRoot, slug);
  const row = {
    slug,
    folder: unit.rel,
    category: categoryOf(unit.rel, articleName),
    article: articleName,
    cardnews: cardnewsName || null,
  };

  try {
    const articleBuffer = fs.readFileSync(path.join(unit.dir, articleName));
    const article = await analyzeDocx(articleBuffer);
    fs.mkdirSync(outDir, { recursive: true });
    const safeArticle = maskContactDetails(article.text);
    fs.writeFileSync(path.join(outDir, 'article.txt'), `${safeArticle}\n`);
    row.paragraphs = article.metrics.paragraphs;
    row.articleChars = safeArticle.length;
    row.unresolvedComments = article.metrics.unresolvedComments;
    row.tracked = article.metrics.trackedInsertions + article.metrics.trackedDeletions;

    if (!cardnewsName) {
      row.status = 'article_only';
      fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        status: 'article_only',
        sourceFiles: { article: { name: articleName, sha256: sha256(articleBuffer) } },
        article: { metrics: article.metrics },
      }, null, 2) + '\n');
    } else {
      const cardnewsBuffer = fs.readFileSync(path.join(unit.dir, cardnewsName));
      const cardnews = await analyzePptx(cardnewsBuffer);
      const audit = auditReferencePair(article, cardnews);
      row.status = audit.status;
      row.slides = cardnews.slideCount;
      row.aspectRatio = Number(cardnews.aspectRatio.toFixed(4));
      row.fonts = cardnews.fonts;
      row.coverTitle = audit.plan.coverTitle;
      row.planCategory = audit.plan.category;
      row.cards = audit.plan.cards.length;
      row.bodyLens = audit.plan.cards.map((c) => c.body.replace(/\s+/g, ' ').length);
      row.credits = audit.plan.cards.filter((c) => c.photoCredit).length;
      row.blockers = audit.blockers;
      row.warnings = audit.warnings;

      fs.writeFileSync(path.join(outDir, 'card-plan.json'), JSON.stringify(audit.plan, null, 2) + '\n');
      fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        status: audit.status,
        sourceFiles: {
          article: { name: articleName, sha256: sha256(articleBuffer) },
          cardnews: { name: cardnewsName, sha256: sha256(cardnewsBuffer) },
        },
        article: { metrics: article.metrics },
        cardnews: {
          width: cardnews.width,
          height: cardnews.height,
          aspectRatio: cardnews.aspectRatio,
          slideCount: cardnews.slideCount,
          fonts: cardnews.fonts,
          mediaFiles: cardnews.mediaFiles,
        },
        audit: {
          blockers: audit.blockers,
          warnings: audit.warnings,
          hiddenTemplateText: audit.hiddenTemplateText,
          excerptIssues: audit.excerptIssues,
        },
      }, null, 2) + '\n');
      fs.writeFileSync(path.join(outDir, 'training-pair.json'), JSON.stringify({
        instruction: '완성된 DNA 기사를 2025 공식 4:5 카드뉴스 구성안으로 변환하라.',
        input: safeArticle,
        output: audit.plan,
        meta: {
          status: audit.status,
          category: row.category,
          sourceFolder: unit.rel,
          blockers: audit.blockers,
          doNotTrain: audit.status !== 'ready',
        },
      }, null, 2) + '\n');
    }
  } catch (e) {
    row.status = 'error';
    row.error = String(e.message || e);
  }
  summary.push(row);
  done++;
  console.log(`${String(row.status).padEnd(13)} ${slug}${row.slides ? ` (${row.slides}장)` : ''}${row.error ? ` — ${row.error}` : ''}`);
}

// ---- 말뭉치 집계 ----
const pairs = summary.filter((r) => r.slides);
const dist = (values) => {
  const map = {};
  for (const v of values) map[v] = (map[v] || 0) + 1;
  return map;
};
const allBodyLens = pairs.flatMap((r) => r.bodyLens || []);
const aggregate = {
  createdAt: new Date().toISOString(),
  source: srcDir,
  units: summary.length,
  pairs: pairs.length,
  articleOnly: summary.filter((r) => r.status === 'article_only').length,
  ready: summary.filter((r) => r.status === 'ready').length,
  needsReview: summary.filter((r) => r.status === 'needs_review').length,
  errors: summary.filter((r) => r.status === 'error').length,
  slideCountDist: dist(pairs.map((r) => r.slides)),
  aspectRatios: dist(pairs.map((r) => r.aspectRatio)),
  categories: dist(summary.map((r) => r.category).filter(Boolean)),
  planCategories: dist(pairs.map((r) => r.planCategory).filter(Boolean)),
  fonts: dist(pairs.flatMap((r) => r.fonts || [])),
  cardBodyChars: allBodyLens.length ? {
    min: Math.min(...allBodyLens),
    max: Math.max(...allBodyLens),
    avg: Math.round(allBodyLens.reduce((a, b) => a + b, 0) / allBodyLens.length),
    over380: allBodyLens.filter((n) => n > 380).length,
  } : null,
  creditsUsedPairs: pairs.filter((r) => r.credits > 0).length,
  rows: summary,
};
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(path.join(outRoot, '_summary.json'), JSON.stringify(aggregate, null, 2) + '\n');
console.log('\n집계:', JSON.stringify({
  units: aggregate.units,
  pairs: aggregate.pairs,
  ready: aggregate.ready,
  needsReview: aggregate.needsReview,
  articleOnly: aggregate.articleOnly,
  errors: aggregate.errors,
  slideCountDist: aggregate.slideCountDist,
}, null, 2));
console.log(`요약 저장: ${path.join(outRoot, '_summary.json')}`);
