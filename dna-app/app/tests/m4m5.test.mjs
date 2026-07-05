import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { checkEmail } = require('../src/shared/validators/email');
const styleEngine = require('../src/main/styleEngine');
const { diffStyles } = require('../src/eval/pptxStyleDiff');
const { stripTags, extractArticleFromHtml, extractDocx } = require('../src/main/extract');
const { Store } = require('../src/main/db');
const archive = require('../src/main/archive');
const { generateCardnews } = require('../src/pptx/cardnews');
const JSZip = require('jszip');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, '..', '..', 'templates', '인스타그램_카드뉴스_2025개편.pptx');
const hasTemplate = fs.existsSync(TEMPLATE);

test('이메일 형식 검사기 — DNA 하드 룰', () => {
  const good = checkEmail({
    subject: '[디지스트신문 DNA] 조정부 승격 관련 인터뷰 요청',
    body: '안녕하세요.\n디지스트신문 DNA 기자 홍길동입니다.\n…\n디지스트신문 DNA 기자 홍길동 드림\ndgistdna.com',
    reporterName: '홍길동',
    reporterTitle: '기자',
  });
  assert.equal(good.ok, true);

  const noPrefix = checkEmail({ subject: '인터뷰 요청', body: '디지스트신문 DNA 기자 홍길동입니다. 드림 dgistdna.com' });
  assert.equal(noPrefix.ok, false);
  assert.ok(noPrefix.issues.some((i) => i.type === 'subject-prefix'));

  const noIntro = checkEmail({ subject: '[디지스트신문 DNA] 요청', body: '안녕하세요. 바로 본론입니다. 드림 dgistdna.com' });
  assert.ok(noIntro.issues.some((i) => i.type === 'intro'));
});

test('RAG 스타일 엔진 — BM25 검색', () => {
  const docs = [
    { id: 'a', label: 'A', text: '조정부가 학생단체로 승격되었다. 조정 대회 출전.' },
    { id: 'b', label: 'B', text: '기숙사 전자레인지 사용 규정이 바뀌었다.' },
    { id: 'c', label: 'C', text: '총학생회 선거 일정이 공지되었다.' },
  ];
  const ranked = styleEngine.bm25Rank(docs, '조정부 승격');
  assert.equal(ranked[0].id, 'a');
  assert.ok(ranked[0].score > ranked[1].score);

  // 골드 코퍼스에서 검색 (store 없이)
  const ex = styleEngine.retrieve(null, '조정부 학생단체 승격 카드뉴스', 2);
  assert.ok(ex.length >= 1);
  assert.ok(ex[0].includes('골드 스탠다드'));
});

test('HTML 기사 추출 — 메타데이터 + 본문', () => {
  const html = `<html><head>
    <title>페이지 제목</title>
    <meta property="og:title" content="조정부 승격 확정">
    <meta name="author" content="김기자">
    <meta property="article:published_time" content="2026-06-01T09:00:00">
    <meta property="og:site_name" content="디지스트신문">
    </head><body><nav>메뉴</nav>
    <article><p>첫 문단.</p><p>둘째 문단.</p><script>evil()</script></article>
    <footer>푸터</footer></body></html>`;
  const art = extractArticleFromHtml(html, 'https://example.com/a');
  assert.equal(art.title, '조정부 승격 확정');
  assert.equal(art.author, '김기자');
  assert.equal(art.site, '디지스트신문');
  assert.ok(art.text.includes('첫 문단.') && art.text.includes('둘째 문단.'));
  assert.ok(!art.text.includes('evil') && !art.text.includes('메뉴'));
  assert.equal(stripTags('<b>a&amp;b</b>'), 'a&b');
});

test('docx 텍스트 추출', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml',
    '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>첫 줄</w:t></w:r></w:p><w:p><w:r><w:t>둘째 줄</w:t></w:r></w:p></w:body></w:document>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const text = await extractDocx(buf);
  assert.ok(text.includes('첫 줄') && text.includes('둘째 줄'));
});

test('아카이브 중복 검사', async () => {
  const store = await Store.open(null);
  archive.upsertArticle(store, { title: '조정부, 기타 학생단체 승격', url: 'https://dgistdna.com/1', body: '조정부 관련 본문' });
  archive.upsertArticle(store, { title: '총학 선거 공지', url: 'https://dgistdna.com/2', body: '선거 본문' });
  // 동일 URL upsert는 중복 생성 안 함
  archive.upsertArticle(store, { title: '조정부, 기타 학생단체 승격 (수정)', url: 'https://dgistdna.com/1', body: '조정부 본문 v2' });
  assert.equal(archive.archiveCount(store), 2);

  const hits = archive.searchArchive(store, ['조정부', '승격']);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].title.includes('조정부'));
  assert.equal(archive.searchArchive(store, ['존재하지않는키워드']).length, 0);
});

test('pptx 스타일 diff — 템플릿 충실성 검증기', { skip: !hasTemplate }, async () => {
  const tbuf = fs.readFileSync(TEMPLATE);
  // 생성물은 템플릿의 부분집합이어야 함
  const { buffer } = await generateCardnews(tbuf, {
    coverTitle: '테스트 제목', category: '사회',
    cards: [{ title: '카드', body: '본문' }],
  });
  const ok = await diffStyles(tbuf, buffer);
  assert.equal(ok.ok, true, ok.violations.join(' | '));

  // 위조: 템플릿에 없는 폰트를 몰래 넣으면 잡아야 함
  const eng = require('../src/pptx/engine');
  const zip = await eng.loadPptx(buffer);
  const n = eng.listSlideNumbers(zip)[0];
  const xml = await eng.getSlideXml(zip, n);
  eng.setSlideXml(zip, n, xml.replace(/typeface="[^"]+"/, 'typeface="Comic Sans MS"'));
  const bad = await diffStyles(tbuf, await eng.savePptx(zip));
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => v.includes('Comic Sans')));
});
