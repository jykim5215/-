const path = require('path');

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DEFAULT_FOLDER = 'DNA Editorial Studio References';
const EXPORT_FOLDER = 'DNA Editorial Studio Exports';
const SOURCE_FOLDER = 'DNA Editorial Studio Sources';

function inferMimeType(name = '') {
  const ext = path.extname(String(name)).toLowerCase();
  const map = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.hwpx': 'application/zip',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.srt': 'application/x-subrip',
    '.vtt': 'text/vtt',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.zip': 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function authHeaders(accessToken) {
  if (!accessToken) throw new Error('Google Drive 업로드에는 Google 계정 연결이 필요합니다.');
  return { Authorization: `Bearer ${accessToken}` };
}

function driveErrorMessage(body, fallback = 'Google Drive 요청 실패') {
  return body?.error?.message || body?.error_description || body?.error || fallback;
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label}: ${driveErrorMessage(body, response.statusText)}`);
  return body;
}

function quoteQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder({ accessToken, name = DEFAULT_FOLDER, fetchImpl = globalThis.fetch }) {
  const query = [
    `name='${quoteQuery(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
  ].join(' and ');
  const url = `${DRIVE_API}?${new URLSearchParams({
    q: query,
    fields: 'files(id,name,webViewLink)',
    spaces: 'drive',
    pageSize: '1',
  })}`;
  const response = await fetchImpl(url, { headers: authHeaders(accessToken) });
  const data = await responseJson(response, 'Google Drive 폴더 조회 실패');
  return data.files?.[0] || null;
}

async function createFolder({ accessToken, name = DEFAULT_FOLDER, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(DRIVE_API, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  return responseJson(response, 'Google Drive 폴더 생성 실패');
}

async function ensureFolder(options) {
  return (await findFolder(options)) || createFolder(options);
}

function buildMultipart(metadata, buffer, mimeType, boundary) {
  const head = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
  ].join('\r\n');
  const tail = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([Buffer.from(head + '\r\n'), Buffer.from(buffer), Buffer.from(tail)]);
}

async function uploadFile({
  accessToken,
  name,
  buffer,
  mimeType,
  folderId,
  fetchImpl = globalThis.fetch,
}) {
  if (!name) throw new Error('업로드할 파일 이름이 없습니다.');
  const content = Buffer.from(buffer || []);
  if (!content.length) throw new Error('업로드할 파일이 비어 있습니다.');
  const type = mimeType || inferMimeType(name);
  const boundary = `dna_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: path.basename(String(name)),
    ...(folderId ? { parents: [folderId] } : {}),
  };
  const response = await fetchImpl(`${DRIVE_UPLOAD}?${new URLSearchParams({
    uploadType: 'multipart',
    fields: 'id,name,mimeType,size,webViewLink,webContentLink',
  })}`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: buildMultipart(metadata, content, type, boundary),
  });
  return responseJson(response, 'Google Drive 업로드 실패');
}

async function listFiles({
  accessToken,
  mimePrefix = '',
  query = '',
  pageSize = 30,
  fetchImpl = globalThis.fetch,
}) {
  const clauses = ['trashed=false', "mimeType != 'application/vnd.google-apps.folder'"];
  if (mimePrefix) clauses.push(`mimeType contains '${quoteQuery(mimePrefix)}'`);
  if (query) clauses.push(`name contains '${quoteQuery(query)}'`);
  const url = `${DRIVE_API}?${new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink,iconLink)',
    spaces: 'drive',
    orderBy: 'modifiedTime desc',
    pageSize: String(Math.max(1, Math.min(100, Number(pageSize) || 30))),
  })}`;
  const response = await fetchImpl(url, { headers: authHeaders(accessToken) });
  const data = await responseJson(response, 'Google Drive 파일 목록 실패');
  return data.files || [];
}

async function getFileMetadata({ accessToken, fileId, fetchImpl = globalThis.fetch }) {
  if (!fileId) throw new Error('Google Drive 파일 ID가 없습니다.');
  const url = `${DRIVE_API}/${encodeURIComponent(fileId)}?${new URLSearchParams({
    fields: 'id,name,mimeType,size,modifiedTime,webViewLink',
  })}`;
  const response = await fetchImpl(url, { headers: authHeaders(accessToken) });
  return responseJson(response, 'Google Drive 파일 정보 조회 실패');
}

async function downloadFile({ accessToken, fileId, fetchImpl = globalThis.fetch }) {
  if (!fileId) throw new Error('Google Drive 파일 ID가 없습니다.');
  const meta = await getFileMetadata({ accessToken, fileId, fetchImpl });
  const nativeExports = {
    'application/vnd.google-apps.document': {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: '.docx',
    },
    'application/vnd.google-apps.spreadsheet': {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: '.xlsx',
    },
    'application/vnd.google-apps.presentation': {
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extension: '.pptx',
    },
    'application/vnd.google-apps.drawing': {
      mimeType: 'application/pdf',
      extension: '.pdf',
    },
  };
  const exportTarget = nativeExports[meta.mimeType];
  if (/^application\/vnd\.google-apps\./.test(meta.mimeType || '') && !exportTarget) {
    throw new Error(`이 Google 파일 형식은 앱으로 가져올 수 없습니다: ${meta.mimeType}`);
  }
  const downloadUrl = exportTarget
    ? `${DRIVE_API}/${encodeURIComponent(fileId)}/export?${new URLSearchParams({ mimeType: exportTarget.mimeType })}`
    : `${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetchImpl(downloadUrl, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Google Drive 다운로드 실패: ${driveErrorMessage(body, response.statusText)}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const baseName = String(meta.name || 'drive-file');
  const name = exportTarget && !baseName.toLowerCase().endsWith(exportTarget.extension)
    ? `${baseName}${exportTarget.extension}`
    : baseName;
  return {
    ...meta,
    name,
    mimeType: exportTarget?.mimeType || meta.mimeType,
    buffer: Buffer.from(arrayBuffer),
  };
}

module.exports = {
  DRIVE_API,
  DRIVE_UPLOAD,
  DEFAULT_FOLDER,
  EXPORT_FOLDER,
  SOURCE_FOLDER,
  inferMimeType,
  ensureFolder,
  findFolder,
  createFolder,
  uploadFile,
  listFiles,
  getFileMetadata,
  downloadFile,
};
