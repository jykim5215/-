import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const eng = require('../src/pptx/engine');
const { escapeXmlText, unescapeXmlText } = require('../src/pptx/escape');
const { generateCardnews } = require('../src/pptx/cardnews');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, '..', '..', 'templates', '인스타그램_카드뉴스_2025개편.pptx');
const hasTemplate = fs.existsSync(TEMPLATE);

test('XML 이스케이프 빌더 — 유니코드 수동 이스케이프', () => {
  assert.equal(escapeXmlText('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&apos;');
  assert.equal(escapeXmlText('한'), '&#xD55C;');
  assert.equal(unescapeXmlText(escapeXmlText('조정부 “승격” <완료> & 100%')), '조정부 “승격” <완료> & 100%');
});

test('PPTX 형광펜 마크업 파싱', () => {
  assert.deepEqual(eng.parseMarkedText('조정부가 ==기타 학생단체==로 승격'), [
    { text: '조정부가 ', highlight: false },
    { text: '기타 학생단체', highlight: true },
    { text: '로 승격', highlight: false },
  ]);
});

test('실제 템플릿: 텍스트 교체 + 슬라이드 복제/삭제', { skip: !hasTemplate }, async () => {
  const zip = await eng.loadPptx(fs.readFileSync(TEMPLATE));
  assert.deepEqual(await eng.slideOrder(zip), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // 문단 교체 (여러 run으로 쪼개진 문단)
  let xml = await eng.getSlideXml(zip, 2);
  const r = eng.replaceParagraphText(xml, '국회의원 된 썰 푼다 ', '조정부 승격 확정');
  assert.equal(r.count, 1);
  assert.ok(eng.extractParagraphTexts(r.xml).includes('조정부 승격 확정'));
  // xml:space="preserve" 명시 확인
  assert.ok(r.xml.includes('xml:space="preserve"'));

  // 복제: rId 자동 증가 + sldIdLst 등록 (src 바로 뒤)
  const newNum = await eng.cloneSlide(zip, 5);
  assert.equal(newNum, 10);
  assert.deepEqual(await eng.slideOrder(zip), [1, 2, 3, 4, 5, 10, 6, 7, 8, 9]);
  const ct = await zip.file('[Content_Types].xml').async('string');
  assert.ok(ct.includes('/ppt/slides/slide10.xml'));
  const rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  const m = rels.match(/<Relationship[^>]*Target="slides\/slide10\.xml"[^>]*\/>/);
  assert.ok(m, '새 슬라이드가 presentation rels에 등록됨');
  const newRId = m[0].match(/Id="(rId\d+)"/)[1];
  // rId 자동 증가: 기존 rId 중 최댓값 + 1이어야 하며 중복이 없어야 함
  const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((x) => parseInt(x[1], 10));
  assert.equal(new Set(ids).size, ids.length, 'rId 중복 없음');
  assert.equal(parseInt(newRId.slice(3), 10), Math.max(...ids), '새 rId가 최댓값');

  // 삭제
  await eng.deleteSlide(zip, 1);
  assert.deepEqual(await eng.slideOrder(zip), [2, 3, 4, 5, 10, 6, 7, 8, 9]);

  // 재패킹 후 재로딩 가능 + theme/content type 보존
  const buf = await eng.savePptx(zip);
  const zip2 = await eng.loadPptx(buf);
  assert.deepEqual(await eng.slideOrder(zip2), [2, 3, 4, 5, 10, 6, 7, 8, 9]);
  const ct2 = await zip2.file('[Content_Types].xml').async('string');
  assert.ok(ct2.includes('theme'));
});

test('사진 주입 — 도형 이름으로 이미지 교체 (B묶음)', { skip: !hasTemplate }, async () => {
  const zip = await eng.loadPptx(fs.readFileSync(TEMPLATE));
  // 1x1 PNG
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000101ff5b8f4b0000000049454e44ae426082', 'hex');
  // 커버(slide2) 그림 11 교체 — 같은 확장자(png)
  const r = await eng.replaceImageByShapeName(zip, 2, '그림 11', png, 'png');
  assert.ok(r.rId.startsWith('rId'));
  // 교체된 미디어 바이트가 실제로 반영됐는지
  const mediaPath = 'ppt/' + r.replaced.replace(/^\.\.\//, '');
  const bytes = await zip.file(mediaPath).async('nodebuffer');
  assert.equal(bytes.length, png.length);
  // 재패킹 후에도 유효
  const buf = await eng.savePptx(zip);
  const zip2 = await eng.loadPptx(buf);
  assert.deepEqual(await eng.slideOrder(zip2), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // 다른 확장자(jpg) → 새 미디어 파트 + content type default 보장
  const zipB = await eng.loadPptx(fs.readFileSync(TEMPLATE));
  const jpg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  await eng.replaceImageByShapeName(zipB, 5, '그림 9', jpg, 'jpg');
  const ct = await zipB.file('[Content_Types].xml').async('string');
  assert.ok(/Extension="jpg"/i.test(ct) || /Extension="jpeg"/i.test(ct));

  // 없는 도형은 에러
  await assert.rejects(eng.replaceImageByShapeName(zip, 2, '없는도형', png, 'png'), /도형/);
});

test('카드뉴스 end-to-end 생성 — 템플릿 충실성', { skip: !hasTemplate }, async () => {
  const plan = {
    coverTitle: '침체기 딛고\n다시 노를 젓다',
    category: '사회',
    cards: [
      { title: '다시 노를 젓는 조정부', body: 'DGIST 조정부가 2026년 ‘==기타 학생단체==’로 승격되었다.\n대회 복귀와 운영 정상화가 근거가 됐다.', photoCredit: 'DGIST 조정부' },
      { title: '기타 학생단체란?', body: '본원 부서가 공식 업무 수행을 위해 직접 조직·관리하는 행정 연계 단체다.' },
      { title: 'Q1. 자기소개', body: '박성현 부장: 2026년도 DGIST 조정부 부장을 맡고 있다.' },
    ],
  };
  const { buffer, slideCount, warnings } = await generateCardnews(fs.readFileSync(TEMPLATE), plan);
  assert.equal(slideCount, 5); // 커버 + 카드 3 + 마무리
  assert.ok(warnings.some((w) => w.includes('폰트')));

  const zip = await eng.loadPptx(buffer);
  const order = await eng.slideOrder(zip);
  assert.equal(order.length, 5);

  // 커버: 제목 2줄 + 카테고리
  const coverXml = await eng.getSlideXml(zip, order[0]);
  const coverParas = eng.extractParagraphTexts(coverXml);
  assert.ok(coverParas.includes('침체기 딛고'));
  assert.ok(coverParas.includes('다시 노를 젓다'));
  assert.ok(coverParas.includes('사회'));

  // 카드 1: 제목·본문·사진출처, 예시 텍스트 잔존 없음
  const c1 = eng.extractParagraphTexts(await eng.getSlideXml(zip, order[1]));
  assert.ok(c1.includes('다시 노를 젓는 조정부'));
  assert.ok(c1.some((p) => p.includes('기타 학생단체’로 승격')));
  assert.ok(c1.includes('사진 = DGIST 조정부 제공'));
  assert.ok(!c1.some((p) => p.includes('정치')), '예시 본문 제거됨');

  // 카드 순서 보존
  const c2 = eng.extractParagraphTexts(await eng.getSlideXml(zip, order[2]));
  assert.ok(c2.includes('기타 학생단체란?'));
  const c3 = eng.extractParagraphTexts(await eng.getSlideXml(zip, order[3]));
  assert.ok(c3.includes('Q1. 자기소개'));
  // 직접 촬영 아님 표기 없음
  assert.ok(!c2.some((p) => p.startsWith('사진 =')));

  // 마무리 장 (기본 variant 9 — 마스코트)
  const lastParas = eng.extractParagraphTexts(await eng.getSlideXml(zip, order[4]));
  assert.ok(lastParas.some((p) => p.includes('dgistdna.com')));

  // 폰트·색 보존: 본문 카드에 템플릿 폰트가 그대로
  const c1xml = await eng.getSlideXml(zip, order[1]);
  assert.ok(c1xml.includes('Pretendard'));
  assert.ok(c1xml.includes('3B3838') || c1xml.includes('FFFBF7'));
  assert.ok(c1xml.includes('<a:highlight>'));

  // 규격 위반 시 에러
  await assert.rejects(
    generateCardnews(fs.readFileSync(TEMPLATE), { coverTitle: '', category: '사회', cards: [] }),
    /규격 위반/
  );
});
