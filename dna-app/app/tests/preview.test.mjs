import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { previewFile } = require('../src/main/preview');
const { buildDraftDocx } = require('../src/main/docx');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, '..', '..', 'templates', '인스타그램_카드뉴스_2025개편.pptx');

test('preview — DOCX 문단 미리보기', async () => {
  const buffer = await buildDraftDocx('제목\n\n첫 문단입니다.\n\n둘째 문단입니다.', { byline: 'DNA 기자' });
  const preview = await previewFile('draft.docx', buffer);
  assert.equal(preview.kind, 'docx');
  assert.equal(preview.title, 'draft.docx');
  assert.ok(preview.paragraphs.some((p) => p.includes('첫 문단')));
});

test('preview — PPTX 슬라이드 텍스트 미리보기', { skip: !fs.existsSync(TEMPLATE) }, async () => {
  const preview = await previewFile('template.pptx', fs.readFileSync(TEMPLATE));
  assert.equal(preview.kind, 'pptx');
  assert.ok(preview.slideCount >= 1);
  assert.ok(Array.isArray(preview.slides[0].texts));
});
