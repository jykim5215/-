import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  inferMimeType,
  ensureFolder,
  uploadFile,
  listFiles,
  downloadFile,
} = require('../src/main/googleDrive');

test('googleDrive — 파일 MIME 타입 추론', () => {
  assert.equal(inferMimeType('guide.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(inferMimeType('deck.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(inferMimeType('table.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(inferMimeType('photo.webp'), 'image/webp');
  assert.equal(inferMimeType('note.md'), 'text/markdown');
});

test('googleDrive — 폴더가 없으면 생성', async () => {
  const calls = [];
  const folder = await ensureFolder({
    accessToken: 'token',
    name: 'DNA Test',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('?')) return { ok: true, json: async () => ({ files: [] }) };
      return { ok: true, json: async () => ({ id: 'folder-id', name: 'DNA Test' }) };
    },
  });
  assert.equal(folder.id, 'folder-id');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
  assert.equal(JSON.parse(calls[1].options.body).mimeType, 'application/vnd.google-apps.folder');
});

test('googleDrive — multipart 업로드 요청', async () => {
  let seen;
  const uploaded = await uploadFile({
    accessToken: 'token',
    name: 'guide.md',
    buffer: Buffer.from('hello'),
    folderId: 'folder-id',
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return { ok: true, json: async () => ({ id: 'file-id', name: 'guide.md' }) };
    },
  });
  assert.equal(uploaded.id, 'file-id');
  assert.match(String(seen.url), /uploadType=multipart/);
  assert.match(seen.options.headers['Content-Type'], /multipart\/related/);
  assert.match(seen.options.body.toString(), /"parents":\["folder-id"\]/);
  assert.match(seen.options.body.toString(), /hello/);
});

test('googleDrive — 이미지 목록 조회', async () => {
  let seen;
  const files = await listFiles({
    accessToken: 'token',
    mimePrefix: 'image/',
    query: 'rowing',
    fetchImpl: async (url, options = {}) => {
      seen = { url, options };
      return { ok: true, json: async () => ({ files: [{ id: 'img', name: 'rowing.png' }] }) };
    },
  });
  assert.equal(files[0].id, 'img');
  assert.equal(seen.options.headers.Authorization, 'Bearer token');
  const query = new URL(String(seen.url)).searchParams.get('q');
  assert.match(query, /mimeType contains 'image\//);
  assert.match(query, /name contains 'rowing'/);
});

test('googleDrive — 파일 다운로드', async () => {
  const calls = [];
  const file = await downloadFile({
    accessToken: 'token',
    fileId: 'file-id',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!String(url).includes('alt=media')) {
        return { ok: true, json: async () => ({ id: 'file-id', name: 'photo.png', mimeType: 'image/png', size: '5' }) };
      }
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer };
    },
  });
  assert.equal(file.name, 'photo.png');
  assert.equal(file.mimeType, 'image/png');
  assert.ok(file.buffer.length > 0);
  assert.match(String(calls[1].url), /alt=media/);
});

test('googleDrive — Google 문서는 DOCX로 내보내 받아온다', async () => {
  const calls = [];
  const file = await downloadFile({
    accessToken: 'token',
    fileId: 'google-doc-id',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!String(url).includes('/export?')) {
        return {
          ok: true,
          json: async () => ({
            id: 'google-doc-id',
            name: '취재 메모',
            mimeType: 'application/vnd.google-apps.document',
          }),
        };
      }
      return { ok: true, arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer };
    },
  });
  assert.equal(file.name, '취재 메모.docx');
  assert.equal(file.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(String(calls[1].url), /\/export\?/);
  assert.match(String(calls[1].url), /wordprocessingml/);
});
