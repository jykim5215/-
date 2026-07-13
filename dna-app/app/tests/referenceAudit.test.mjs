import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const JSZip = require('jszip');
const {
  analyzeDocx,
  analyzePptx,
  auditReferencePair,
  deriveCardPlan,
} = require('../src/main/referenceAudit');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, '..', '..', 'templates', '인스타그램_카드뉴스_2025개편.pptx');

test('DOCX 감사: 삭제 텍스트 제외, 댓글과 추적 변경 계수', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>유지 문장</w:t></w:r></w:p>
        <w:del><w:r><w:delText>삭제 문장</w:delText></w:r></w:del>
        <w:p><w:ins><w:r><w:t>삽입 문장</w:t></w:r></w:ins></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>표 내용</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body>
    </w:document>`);
  zip.file('word/comments.xml', `<?xml version="1.0"?>
    <w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:comment w:id="0"><w:p><w:r><w:t>검토</w:t></w:r></w:p></w:comment>
    </w:comments>`);
  const result = await analyzeDocx(await zip.generateAsync({ type: 'nodebuffer' }));

  assert.match(result.text, /유지 문장/);
  assert.match(result.text, /삽입 문장/);
  assert.doesNotMatch(result.text, /삭제 문장/);
  assert.equal(result.metrics.tables, 1);
  assert.equal(result.metrics.comments, 1);
  assert.equal(result.metrics.unresolvedComments, 1);
  assert.equal(result.metrics.trackedInsertions, 1);
  assert.equal(result.metrics.trackedDeletions, 1);
});

test('공식 PPTX 템플릿 구조를 4:5, 9장으로 분석', { skip: !fs.existsSync(TEMPLATE) }, async () => {
  const deck = await analyzePptx(fs.readFileSync(TEMPLATE));
  assert.equal(deck.slideCount, 9);
  assert.ok(Math.abs(deck.aspectRatio - 0.8) < 0.001);
  assert.ok(deck.fonts.some((font) => font.includes('Pretendard')));
  assert.ok(deck.slides[0].visibleText.some((text) => text.includes('폰트 규격')));
});

test('참고 쌍 감사: 재서술된 Q&A와 미해결 교열을 학습 차단', () => {
  const article = {
    text: '박: 선배 부원들의 의지가 가장 중요했습니다.',
    metrics: {
      unresolvedComments: 2,
      trackedInsertions: 1,
      trackedDeletions: 0,
    },
  };
  const shape = (name, text, extra = {}) => ({
    name,
    text,
    paragraphs: [text],
    visible: true,
    fonts: [],
    sizes: [],
    fills: [],
    ...extra,
  });
  const deck = {
    width: 800,
    height: 1000,
    aspectRatio: 0.8,
    slideCount: 3,
    mediaFiles: 0,
    slides: [
      {
        shapes: [
          shape('제목', '조정부의 새 출발', { fonts: ['나눔스퀘어_ac ExtraBold'] }),
          shape('category', '사회', { fills: ['15B1FF'] }),
        ],
        visibleText: ['조정부의 새 출발', '사회'],
        offCanvasText: [],
      },
      {
        shapes: [
          shape('TextBox 4', 'Q1. 극복의 계기', { sizes: [40] }),
          shape('TextBox 6', '박: 선배 부원들의 의지가 재건을 성공으로 이끌었습니다.', { sizes: [32] }),
        ],
        visibleText: ['Q1. 극복의 계기', '박: 선배 부원들의 의지가 재건을 성공으로 이끌었습니다.'],
        offCanvasText: ['한국대학총학생회 공동포럼 제공'],
      },
      {
        shapes: [shape('closing', '이 기사가 궁금하다면?')],
        visibleText: ['이 기사가 궁금하다면?'],
        offCanvasText: [],
      },
    ],
  };

  const plan = deriveCardPlan(deck);
  assert.equal(plan.cards.length, 1);
  const audit = auditReferencePair(article, deck);
  assert.equal(audit.status, 'needs_review');
  assert.ok(audit.blockers.some((item) => item.includes('미해결 댓글')));
  assert.ok(audit.blockers.some((item) => item.includes('연속 발췌')));
  assert.equal(audit.hiddenTemplateText.length, 1);
  // 이 덱은 커버가 1장뿐 — 혼합 덱 차단이 잘못 발동하면 안 됨
  assert.ok(!audit.blockers.some((item) => item.includes('커버형 슬라이드')));

  // 2번째 장 이후에 커버 서체(나눔스퀘어 ExtraBold)가 다시 나오면 혼합 덱으로 차단
  const mixedDeck = {
    ...deck,
    slides: [
      deck.slides[0],
      {
        shapes: [shape('제목', '다른 기사 커버', { fonts: ['나눔스퀘어_ac ExtraBold'] })],
        visibleText: ['다른 기사 커버'],
        offCanvasText: [],
      },
      deck.slides[2],
    ],
  };
  const mixedAudit = auditReferencePair(article, mixedDeck);
  assert.ok(mixedAudit.blockers.some((item) => item.includes('커버형 슬라이드')));

  // 병합 덱: 서로 다른 기사 제목이 카드에 "교차" 반복(A→B→A→B)되면 차단
  const headerCard = (title) => ({
    shapes: [
      shape('TextBox 4', title, { sizes: [40] }),
      shape('TextBox 6', '본문 내용', { sizes: [32] }),
    ],
    visibleText: [title, '본문 내용'],
    offCanvasText: [],
  });
  const interleavedDeck = {
    ...deck,
    slides: [
      deck.slides[0],
      headerCard('기사 A 제목'), headerCard('기사 B 제목'),
      headerCard('기사 A 제목'), headerCard('기사 B 제목'),
      deck.slides[2],
    ],
  };
  const interleavedAudit = auditReferencePair(article, interleavedDeck);
  assert.ok(interleavedAudit.blockers.some((item) => item.includes('교차 반복')));
  // 정상 덱: 섹션 제목이 "연속"으로만 반복(1→1→2→2)되면 차단하지 않음 (실물 LMS 가이드 덱 사례)
  const sectionedDeck = {
    ...deck,
    slides: [
      deck.slides[0],
      headerCard('1. 캘린더 링크 복사'), headerCard('1. 캘린더 링크 복사'),
      headerCard('2. 캘린더 앱에 추가'), headerCard('2. 캘린더 앱에 추가'),
      deck.slides[2],
    ],
  };
  const sectionedAudit = auditReferencePair(article, sectionedDeck);
  assert.ok(!sectionedAudit.blockers.some((item) => item.includes('교차 반복')));
});
