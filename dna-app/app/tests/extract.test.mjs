import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const { extractFile } = require('../src/main/extract');

test('extract — hwpx 텍스트 추출', async () => {
  const zip = new JSZip();
  zip.file('Contents/section0.xml',
    '<hs:sec xmlns:hp="x"><hp:p><hp:run><hp:t>한글 문서 첫 문단</hp:t></hp:run></hp:p><hp:p><hp:t>둘째 문단</hp:t></hp:p></hs:sec>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const text = await extractFile('문서.hwpx', buf);
  assert.match(text, /한글 문서 첫 문단/);
  assert.match(text, /둘째 문단/);
});

test('extract — xlsx 공유 문자열 추출', async () => {
  const zip = new JSZip();
  zip.file('xl/sharedStrings.xml', '<sst><si><t>예산 항목</t></si><si><t>1200만원</t></si></sst>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const text = await extractFile('예산.xlsx', buf);
  assert.match(text, /예산 항목/);
  assert.match(text, /1200만원/);
});

test('extract — 자막(srt)과 html', async () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\n안녕하세요 기자님\n\n2\n00:00:04,000 --> 00:00:06,000\n인터뷰 시작합니다';
  const text = await extractFile('rec.srt', Buffer.from(srt));
  assert.match(text, /안녕하세요 기자님/);
  assert.ok(!/-->/.test(text));
  const html = await extractFile('page.html', Buffer.from('<html><body><p>본문 <b>내용</b></p><script>x()</script></body></html>'));
  assert.match(html, /본문 내용/);
  assert.ok(!/x\(\)/.test(html));
});

test('extract — 모르는 확장자: 텍스트 스니핑 / OOXML 스니핑', async () => {
  const text = await extractFile('메모.dat', Buffer.from('그냥 텍스트 파일입니다.\n둘째 줄.'));
  assert.match(text, /그냥 텍스트 파일/);
  // 확장자가 엉뚱해도 zip 시그니처면 docx로 추출
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>숨은 워드 문서</w:t></w:r></w:p></w:body></w:document>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const sniffed = await extractFile('첨부.bin', buf);
  assert.match(sniffed, /숨은 워드 문서/);
});

test('extract — 오디오/이미지/바이너리 라우팅 코드', async () => {
  await assert.rejects(extractFile('녹음.m4a', Buffer.from('x')), (e) => e.code === 'AUDIO_MEDIA');
  await assert.rejects(extractFile('사진.jpg', Buffer.from('x')), (e) => e.code === 'IMAGE_MEDIA');
  const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x10]);
  await assert.rejects(extractFile('알수없음.xyz', binary), (e) => e.code === 'BINARY_FILE');
});
