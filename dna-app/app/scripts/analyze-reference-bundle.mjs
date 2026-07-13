import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  analyzeDocx,
  analyzePptx,
  analyzePdf,
  analyzeSkill,
  auditReferencePair,
  maskContactDetails,
  sha256,
} = require('../src/main/referenceAudit');

function option(name, required = false) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (required && !value) throw new Error(`--${name} 경로가 필요합니다.`);
  return value;
}

function readInput(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
  return fs.readFileSync(filePath);
}

const articlePath = option('article', true);
const cardnewsPath = option('cardnews', true);
const templatePath = option('template');
const pdfPath = option('pdf');
const skillPath = option('skill');
const outDir = path.resolve(option('out', true));

const articleBuffer = readInput(articlePath);
const cardnewsBuffer = readInput(cardnewsPath);
const [article, cardnews] = await Promise.all([
  analyzeDocx(articleBuffer),
  analyzePptx(cardnewsBuffer),
]);
const audit = auditReferencePair(article, cardnews);

const optional = {};
if (templatePath) optional.template = await analyzePptx(readInput(templatePath));
if (pdfPath) optional.squareInstagramPdf = await analyzePdf(readInput(pdfPath));
if (skillPath) optional.codexSkill = await analyzeSkill(readInput(skillPath));

fs.mkdirSync(outDir, { recursive: true });
const safeArticle = maskContactDetails(article.text);
const safePlan = audit.plan;
const sourceFiles = {
  article: { name: path.basename(articlePath), sha256: sha256(articleBuffer) },
  cardnews: { name: path.basename(cardnewsPath), sha256: sha256(cardnewsBuffer) },
};
for (const [key, filePath] of [
  ['template', templatePath],
  ['pdf', pdfPath],
  ['skill', skillPath],
]) {
  if (!filePath) continue;
  const buffer = readInput(filePath);
  sourceFiles[key] = { name: path.basename(filePath), sha256: sha256(buffer) };
}

const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  status: audit.status,
  sourceFiles,
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
  optional: {
    ...(optional.template ? {
      template: {
        width: optional.template.width,
        height: optional.template.height,
        aspectRatio: optional.template.aspectRatio,
        slideCount: optional.template.slideCount,
        fonts: optional.template.fonts,
      },
    } : {}),
    ...(optional.squareInstagramPdf ? { squareInstagramPdf: optional.squareInstagramPdf } : {}),
    ...(optional.codexSkill ? { codexSkill: optional.codexSkill } : {}),
  },
};

const trainingPair = {
  instruction: '완성된 DNA 기사를 2025 공식 4:5 카드뉴스 구성안으로 변환하라.',
  input: safeArticle,
  output: safePlan,
  meta: {
    status: audit.status,
    sourceFiles,
    blockers: audit.blockers,
    doNotTrain: audit.status !== 'ready',
  },
};

fs.writeFileSync(path.join(outDir, 'article.txt'), `${safeArticle}\n`);
fs.writeFileSync(path.join(outDir, 'card-plan.json'), `${JSON.stringify(safePlan, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'training-pair.json'), `${JSON.stringify(trainingPair, null, 2)}\n`);

console.log(JSON.stringify({
  outDir,
  status: audit.status,
  blockers: audit.blockers.length,
  warnings: audit.warnings.length,
  slides: cardnews.slideCount,
  articleParagraphs: article.metrics.paragraphs,
}, null, 2));
