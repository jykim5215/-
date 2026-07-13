// Electron 메인 프로세스 — 보안 기본값:
//  - contextIsolation: true, nodeIntegration: false, sandbox: true
//  - API 키는 safeStorage(OS 키체인 연동)로 암호화해 저장. 평문/코드 하드코딩 금지.
const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron');
const { parseDraft } = require('./src/main/docx');
const path = require('path');
const fs = require('fs');

const { Store } = require('./src/main/db');
const projects = require('./src/main/projects');
const records = require('./src/main/records');
const ai = require('./src/main/gemini');
const archive = require('./src/main/archive');
const extract = require('./src/main/extract');
const styleEngine = require('./src/main/styleEngine');
const googleAuth = require('./src/main/googleAuth');
const googleDrive = require('./src/main/googleDrive');
const { createUpdaterController } = require('./src/main/updater');
const JSZip = require('jszip');
const quotes = require('./src/shared/validators/quotes');
const emailCheck = require('./src/shared/validators/email');
const quoteVerify = require('./src/shared/validators/quoteVerify');
const { buildEditorialReadiness } = require('./src/shared/editorialReadiness');
const { validateCardPlan } = require('./src/pptx/cardnewsRules');
const { generateCardnews, planForValidation } = require('./src/pptx/cardnews');
const { exportPptxToPngs } = require('./src/main/pptxExport');
const preview = require('./src/main/preview');

let store = null;
let win = null;
let updater = null;

app.setName('DNA 편집 스튜디오');
app.setAppUserModelId('com.dgistdna.desk');

// 개발 실행: dna-app/templates/, 패키징(electron-builder) 실행: resources/templates/
const TEMPLATE_PATH = () => {
  const dev = path.join(__dirname, '..', 'templates', '인스타그램_카드뉴스_2025개편.pptx');
  if (fs.existsSync(dev)) return dev;
  return path.join(process.resourcesPath || '', 'templates', '인스타그램_카드뉴스_2025개편.pptx');
};

function dataDir() {
  return path.join(app.getPath('userData'), 'dna-data');
}

async function ensureStore() {
  if (!store) {
    store = await Store.open(path.join(dataDir(), 'dna.sqlite'));
    store.persist();
  }
  return store;
}

// ---- API 키 (safeStorage 암호화) ----
function setApiKey(s, key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 환경에서는 OS 암호화 저장을 사용할 수 없습니다.');
  }
  const enc = safeStorage.encryptString(key).toString('base64');
  s.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['apiKeyEnc', enc]);
  s.persist();
}

// 범용 비밀값 암호화 저장 (앱 비밀번호 등)
function setSecret(s, key, value) {
  if (!value) { s.run('DELETE FROM settings WHERE key = ?', [key + 'Enc']); s.persist(); return; }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 환경에서는 OS 암호화 저장을 사용할 수 없습니다.');
  }
  const enc = safeStorage.encryptString(value).toString('base64');
  s.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key + 'Enc', enc]);
  s.persist();
}
function getSecret(s, key) {
  const row = s.get('SELECT value FROM settings WHERE key = ?', [key + 'Enc']);
  if (!row) return null;
  try { return safeStorage.decryptString(Buffer.from(row.value, 'base64')); } catch { return null; }
}
function mailConfig(s) {
  return {
    user: getSetting(s, 'smtpUser'),
    pass: getSecret(s, 'smtpPass') || '',
    host: getSetting(s, 'smtpHost') || 'mail.dgist.ac.kr',
    port: getSetting(s, 'smtpPort') ? Number(getSetting(s, 'smtpPort')) : 587,
    fromName: (() => {
      const n = getSetting(s, 'reporterName'); const t = getSetting(s, 'reporterTitle') || '기자';
      return n ? `디지스트신문 DNA ${t} ${n}` : '디지스트신문 DNA';
    })(),
  };
}

function imapConfig(s) {
  const port = getSetting(s, 'imapPort') ? Number(getSetting(s, 'imapPort')) : 993;
  return {
    user: getSetting(s, 'imapUser') || getSetting(s, 'smtpUser'),
    pass: getSecret(s, 'smtpPass') || '',
    host: getSetting(s, 'imapHost') || 'mail.dgist.ac.kr',
    port,
    secure: getSetting(s, 'imapSecure')
      ? getSetting(s, 'imapSecure') === 'true'
      : port === 993,
  };
}

function getApiKey(s) {
  const row = s.get('SELECT value FROM settings WHERE key = ?', ['apiKeyEnc']);
  if (!row) {
    return process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      null;
  }
  return safeStorage.decryptString(Buffer.from(row.value, 'base64'));
}

function getSetting(s, key, fallback = '') {
  const row = s.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

function setSetting(s, key, value) {
  s.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value ?? '')]);
  s.persist();
}

function deleteSetting(s, key) {
  s.run('DELETE FROM settings WHERE key = ?', [key]);
  s.persist();
}

function configureGoogleClient(s, rawJson) {
  const config = googleAuth.parseClientCredentials(rawJson);
  const previousClientId = getSetting(s, 'googleClientId');
  setSetting(s, 'googleClientId', config.clientId);
  setSecret(s, 'googleClientSecret', config.clientSecret);
  setSetting(s, 'googleProjectId', config.projectId);
  if (previousClientId && previousClientId !== config.clientId) {
    setSecret(s, 'googleTokens', '');
    deleteSetting(s, 'googleProfile');
  }
  return {
    configured: true,
    clientIdSuffix: config.clientId.slice(-28),
    projectId: config.projectId,
  };
}

function googleStatus(s) {
  let profile = null;
  try { profile = JSON.parse(getSetting(s, 'googleProfile') || 'null'); } catch { /* ignore */ }
  let tokens = null;
  try { tokens = JSON.parse(getSecret(s, 'googleTokens') || 'null'); } catch { /* ignore */ }
  const clientId = getSetting(s, 'googleClientId');
  const missingScopes = tokens ? googleAuth.missingScopes(tokens) : googleAuth.SCOPES;
  return {
    configured: Boolean(clientId && getSecret(s, 'googleClientSecret')),
    connected: Boolean(getSecret(s, 'googleTokens') && profile),
    clientIdSuffix: clientId ? clientId.slice(-28) : '',
    projectId: getSetting(s, 'googleProjectId'),
    missingScopes,
    needsReconnect: Boolean(tokens && missingScopes.length),
    profile,
  };
}

function hasGeminiAuth(s) {
  return Boolean(getSecret(s, 'googleTokens'));
}

async function googleOAuthCredential(s) {
  const raw = getSecret(s, 'googleTokens');
  if (!raw) return null;
  let tokens;
  try { tokens = JSON.parse(raw); } catch { return null; }

  if (!tokens.accessToken || Number(tokens.expiresAt || 0) <= Date.now() + 60000) {
    const refreshed = await googleAuth.refreshAccessToken({
      clientId: getSetting(s, 'googleClientId'),
      clientSecret: getSecret(s, 'googleClientSecret'),
      refreshToken: tokens.refreshToken,
    });
    tokens = {
      ...tokens,
      accessToken: refreshed.access_token,
      scope: refreshed.scope || tokens.scope,
      tokenType: refreshed.token_type || tokens.tokenType || 'Bearer',
      expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    };
    setSecret(s, 'googleTokens', JSON.stringify(tokens));
  }
  return {
    accessToken: tokens.accessToken,
    projectId: getSetting(s, 'googleProjectId'),
  };
}

async function aiCredentials(s) {
  return {
    oauth: await googleOAuthCredential(s),
    automationContext: getSetting(s, 'automationProfile'),
  };
}

async function importGoogleClientFromArgs(s) {
  const index = process.argv.indexOf('--import-google-oauth');
  if (index < 0) return false;
  const filePath = process.argv[index + 1];
  if (!filePath) throw new Error('--import-google-oauth 뒤에 JSON 경로가 필요합니다.');
  configureGoogleClient(s, fs.readFileSync(path.resolve(filePath), 'utf8'));
  console.log('Google OAuth client imported into encrypted app storage.');
  return true;
}

function readJsonSetting(s, key, fallback) {
  try {
    const raw = getSetting(s, key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonSetting(s, key, value) {
  setSetting(s, key, JSON.stringify(value));
}

function developerDir() {
  const dir = path.join(dataDir(), 'developer-references');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFileStem(name) {
  return path.basename(String(name || 'reference')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) || 'reference';
}

function automationProfileMarkdown(profile) {
  const p = profile || {};
  const lines = [
    `# ${p.profileTitle || 'DNA 자동화 프로필'}`,
    '',
    `업데이트: ${new Date().toISOString()}`,
    '',
    p.summary ? `## 요약\n${p.summary}` : '',
    Array.isArray(p.rules) && p.rules.length
      ? `## 공통 규칙\n${p.rules.map((rule) => `- ${rule}`).join('\n')}`
      : '',
    Array.isArray(p.stageGuidance) && p.stageGuidance.length
      ? `## 단계별 지침\n${p.stageGuidance.map((item) => `### ${item.stage}\n${item.guidance}`).join('\n\n')}`
      : '',
    Array.isArray(p.styleSignals) && p.styleSignals.length
      ? `## 스타일 신호\n${p.styleSignals.map((signal) => `- ${signal}`).join('\n')}`
      : '',
    Array.isArray(p.checklists) && p.checklists.length
      ? `## 체크리스트\n${p.checklists.map((list) => `### ${list.name}\n${(list.items || []).map((item) => `- ${item}`).join('\n')}`).join('\n\n')}`
      : '',
    Array.isArray(p.risks) && p.risks.length
      ? `## 주의점\n${p.risks.map((risk) => `- ${risk}`).join('\n')}`
      : '',
  ];
  return lines.filter(Boolean).join('\n\n').trim();
}

function developerStatus(s) {
  const uploads = readJsonSetting(s, 'devReferences', []);
  let report = null;
  try { report = JSON.parse(getSetting(s, 'devLastReport') || 'null'); } catch { /* ignore */ }
  return {
    uploads: uploads.map(({ localTextPath, ...item }) => item),
    report,
    activeProfile: getSetting(s, 'automationProfile'),
    google: googleStatus(s),
  };
}

function projectOutputDir(projectId) {
  const outDir = path.join(dataDir(), 'projects', String(projectId || 'exports'));
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

async function uploadBufferToDrive(s, { name, buffer, mimeType, folderName = googleDrive.EXPORT_FOLDER }) {
  const credential = await googleOAuthCredential(s);
  if (!credential?.accessToken) throw new Error('Google Drive 저장에는 Google 계정 연결이 필요합니다.');
  const folder = await googleDrive.ensureFolder({
    accessToken: credential.accessToken,
    name: folderName,
  });
  return googleDrive.uploadFile({
    accessToken: credential.accessToken,
    name,
    buffer,
    mimeType: mimeType || googleDrive.inferMimeType(name),
    folderId: folder.id,
  });
}

function photoFromDataUrl(photo) {
  if (!photo || !photo.dataUrl) return undefined;
  const match = String(photo.dataUrl).match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i);
  if (!match) return undefined;
  return {
    buffer: Buffer.from(match[2], 'base64'),
    ext: match[1].toLowerCase().replace('jpeg', 'jpg'),
  };
}

function decodeCardnewsPhotos(plan) {
  return {
    ...plan,
    coverPhoto: photoFromDataUrl(plan.coverPhoto),
    cards: (plan.cards || []).map((card) => ({ ...card, photo: photoFromDataUrl(card.photo) })),
  };
}

function registerIpc() {
  const h = (channel, fn) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        const s = await ensureStore();
        return await fn(s, ...args);
      } catch (error) {
        console.error(`[IPC ${channel}]`, error);
        throw error;
      }
    });

  // 설정
  h('settings:get', (s, key) => getSetting(s, key));
  h('settings:set', (s, key, value) => {
    if (key === 'apiKey') return setApiKey(s, value);
    if (key === 'smtpPass') return setSecret(s, 'smtpPass', value); // 앱 비밀번호는 암호화 저장
    s.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    s.persist();
  });
  h('settings:hasApiKey', (s) => hasGeminiAuth(s));
  h('settings:hasSmtpPass', (s) => Boolean(getSecret(s, 'smtpPass')));
  h('update:status', () => updater?.getStatus() || { enabled: false, status: 'unsupported' });
  h('update:check', () => updater?.checkForUpdates({ manual: true }) || { enabled: false, status: 'unsupported' });
  h('update:install', () => updater?.installUpdate() || { enabled: false, status: 'unsupported' });
  h('google:configure', (s, rawJson) => configureGoogleClient(s, rawJson));
  h('google:status', (s) => googleStatus(s));
  h('google:connect', async (s) => {
    const clientId = getSetting(s, 'googleClientId');
    const clientSecret = getSecret(s, 'googleClientSecret');
    const result = await googleAuth.connect({
      clientId,
      clientSecret,
      openExternal: (url) => shell.openExternal(url),
    });
    setSecret(s, 'googleTokens', JSON.stringify(result.tokens));
    setSetting(s, 'googleProfile', JSON.stringify(result.profile));
    if (!getSetting(s, 'reporterName') && result.profile.name) {
      setSetting(s, 'reporterName', result.profile.name);
    }
    return googleStatus(s);
  });
  h('google:disconnect', (s) => {
    setSecret(s, 'googleTokens', '');
    deleteSetting(s, 'googleProfile');
    return googleStatus(s);
  });
  h('drive:listFiles', async (s, opts = {}) => {
    const credential = await googleOAuthCredential(s);
    if (!credential?.accessToken) throw new Error('Google Drive 파일을 보려면 Google 계정 연결이 필요합니다.');
    const kind = String(opts.kind || '');
    const mimePrefix = opts.mimePrefix || (kind === 'image' ? 'image/' : '');
    return googleDrive.listFiles({
      accessToken: credential.accessToken,
      mimePrefix,
      query: opts.query || '',
      pageSize: opts.pageSize || 30,
    });
  });
  h('drive:downloadFile', async (s, fileId, opts = {}) => {
    const credential = await googleOAuthCredential(s);
    if (!credential?.accessToken) throw new Error('Google Drive 파일을 가져오려면 Google 계정 연결이 필요합니다.');
    const file = await googleDrive.downloadFile({
      accessToken: credential.accessToken,
      fileId,
    });
    const result = {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: Number(file.size || file.buffer.length || 0),
      webViewLink: file.webViewLink || '',
      arrayBuffer: file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength),
    };
    if (opts.asDataUrl !== false) {
      result.dataUrl = `data:${file.mimeType || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;
    }
    return result;
  });
  h('drive:uploadFile', async (s, { name, arrayBuffer, mimeType = '' }) => {
    const credential = await googleOAuthCredential(s);
    if (!credential?.accessToken) throw new Error('Google Drive에 파일을 보내려면 Google 계정 연결이 필요합니다.');
    const buffer = Buffer.from(arrayBuffer || []);
    const folder = await googleDrive.ensureFolder({
      accessToken: credential.accessToken,
      name: googleDrive.SOURCE_FOLDER,
    });
    const uploaded = await googleDrive.uploadFile({
      accessToken: credential.accessToken,
      name,
      buffer,
      mimeType: mimeType || googleDrive.inferMimeType(name),
      folderId: folder.id,
    });
    return {
      id: uploaded.id,
      name: uploaded.name,
      mimeType: uploaded.mimeType || mimeType || googleDrive.inferMimeType(name),
      size: Number(uploaded.size || buffer.length),
      webViewLink: uploaded.webViewLink || '',
    };
  });

  // 개발자 모드: 지침/표본 업로드 → Drive 보관 → AI 자동화 프로필 제안
  h('dev:status', (s) => developerStatus(s));
  h('dev:uploadReference', async (s, { name, arrayBuffer, kind = 'reference' }) => {
    const credential = await googleOAuthCredential(s);
    if (!credential?.accessToken) throw new Error('개발자 자료 업로드에는 Google 계정 연결이 필요합니다.');
    const buffer = Buffer.from(arrayBuffer || []);
    const mimeType = googleDrive.inferMimeType(name);
    const folder = await googleDrive.ensureFolder({
      accessToken: credential.accessToken,
      name: googleDrive.DEFAULT_FOLDER,
    });
    const uploaded = await googleDrive.uploadFile({
      accessToken: credential.accessToken,
      name,
      buffer,
      mimeType,
      folderId: folder.id,
    });
    let text = '';
    try {
      text = await extract.extractFile(name, buffer);
    } catch {
      if (/^text\//i.test(mimeType) || /\.(md|txt)$/i.test(String(name))) text = buffer.toString('utf8');
    }
    const id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const localTextPath = path.join(developerDir(), `${id}-${safeFileStem(name)}.txt`);
    fs.writeFileSync(localTextPath, text || '', 'utf8');
    const uploads = readJsonSetting(s, 'devReferences', []);
    const item = {
      id,
      name: path.basename(String(name || 'reference')),
      kind,
      mimeType,
      chars: text.length,
      driveFileId: uploaded.id,
      webViewLink: uploaded.webViewLink || '',
      uploadedAt: new Date().toISOString(),
      localTextPath,
    };
    uploads.unshift(item);
    writeJsonSetting(s, 'devReferences', uploads.slice(0, 40));
    const { localTextPath: _omit, ...safeItem } = item;
    return safeItem;
  });
  h('dev:analyzeReferences', async (s) => {
    const uploads = readJsonSetting(s, 'devReferences', []);
    const files = uploads
      .filter((item) => item.localTextPath && fs.existsSync(item.localTextPath))
      .slice(0, 12)
      .map((item) => ({
        name: item.name,
        kind: item.kind,
        text: fs.readFileSync(item.localTextPath, 'utf8'),
      }))
      .filter((item) => item.text.trim());
    if (!files.length) throw new Error('분석할 텍스트가 있는 개발자 자료가 없습니다. docx, pdf, txt, md 파일을 먼저 업로드하세요.');
    const credentials = await aiCredentials(s);
    const { profile, modelVersion } = await ai.analyzeDeveloperBundle({
      ...credentials,
      files,
    });
    const report = {
      ...profile,
      modelVersion,
      sourceCount: files.length,
      analyzedAt: new Date().toISOString(),
    };
    setSetting(s, 'devLastReport', JSON.stringify(report));
    return report;
  });
  h('dev:applyAutomationProfile', (s, profile) => {
    const source = profile || readJsonSetting(s, 'devLastReport', null);
    if (!source) throw new Error('적용할 자동화 분석 결과가 없습니다.');
    const markdown = automationProfileMarkdown(source);
    setSetting(s, 'automationProfile', markdown);
    return { ok: true, chars: markdown.length, profile: markdown };
  });

  // 이메일 발송 (SMTP)
  // 폴백(465↔587, 전체주소↔아이디)으로 통한 조합은 설정에 저장해 다음부터 바로 사용한다.
  const rememberSmtpPlan = (s, used) => {
    if (used && used.port) setSetting(s, 'smtpPort', String(used.port));
  };
  // 주소록 자동 수집 — 보낸 수신자·받은 발신자를 모아 작성창 자동완성에 사용
  const harvestContacts = (s, rawEntries) => {
    try {
      const contacts = require('./src/main/contacts');
      const merged = contacts.mergeContacts(readJsonSetting(s, 'mailContacts', []), rawEntries);
      writeJsonSetting(s, 'mailContacts', merged);
    } catch { /* 주소록 수집 실패는 발송/수신을 막지 않음 */ }
  };
  h('mail:contacts', (s) => readJsonSetting(s, 'mailContacts', []));
  h('mail:verify', async (s) => {
    const { verify } = require('./src/main/mailer');
    const res = await verify(mailConfig(s));
    if (res.ok) rememberSmtpPlan(s, res.used);
    return res;
  });
  h('mail:send', async (s, msg) => {
    const { sendMail } = require('./src/main/mailer');
    const res = await sendMail(msg, mailConfig(s));
    rememberSmtpPlan(s, res.used);
    harvestContacts(s, [msg.to, msg.cc, msg.bcc]);
    return res;
  });
  h('mail:imapVerify', async (s) => {
    const { verifyInbox } = require('./src/main/imap');
    return verifyInbox(imapConfig(s));
  });
  h('mail:inboxList', async (s, opts = {}) => {
    const { listInbox } = require('./src/main/imap');
    const res = await listInbox(imapConfig(s), opts);
    harvestContacts(s, (res.messages || []).map((m) => m.from));
    return res;
  });
  h('mail:inboxRead', async (s, uid) => {
    const { readInboxMessage } = require('./src/main/imap');
    return readInboxMessage(imapConfig(s), uid);
  });

  // 프로젝트 / 자료
  h('project:create', (s, data) => projects.createProject(s, data));
  h('project:list', (s) => projects.listProjects(s));
  h('project:get', (s, id) => projects.getProject(s, id));
  h('project:setStage', (s, id, stage) => projects.setStage(s, id, stage));
  h('project:rename', (s, id, title) => projects.renameProject(s, id, title));
  h('project:delete', (s, id) => projects.deleteProject(s, id));
  h('material:add', (s, data) => projects.addMaterial(s, data));
  h('material:list', (s, projectId) => projects.listMaterials(s, projectId));
  h('material:delete', (s, id) => projects.deleteMaterial(s, id));
  h('material:update', (s, id, data) => projects.updateMaterial(s, id, data));
  h('output:versions', (s, projectId, stage) => projects.listStageVersions(s, projectId, stage));
  h('output:get', (s, id) => projects.getStageOutput(s, id));

  // 산출물 / 학습 레코드
  h('output:save', (s, data) => projects.saveStageOutput(s, data));
  h('output:latest', (s, projectId, stage) => projects.latestStageOutput(s, projectId, stage));
  h('record:finalize', (s, recordId, text) => records.finalizeRecord(s, recordId, text));
  h('record:feedback', (s, recordId, fb) => records.setFeedback(s, recordId, fb));
  h('record:metrics', (s) => records.metrics(s));
  h('dataset:export', async (s, opts) => {
    const jsonl = records.exportDataset(s, opts);
    const out = path.join(dataDir(), `dataset-${Date.now()}.jsonl`);
    fs.writeFileSync(out, jsonl);
    return out;
  });

  // 검증기 (로컬, 확정적)
  h('validate:quotes', (s, draft, projectId) => {
    const sources = projects.listMaterials(s, projectId).map((m) => m.content);
    return {
      style: quotes.checkQuoteStyle(draft),
      singles: quotes.checkSingleQuoteOveruse(draft),
      quotes: quoteVerify.verifyDraftQuotes(draft, sources),
    };
  });
  h('validate:readiness', (s, draft, projectId) => {
    const materials = projects.listMaterials(s, projectId);
    const quoteResults = quoteVerify.verifyDraftQuotes(draft, materials.map((m) => m.content));
    return buildEditorialReadiness({ draft, materials, quoteResults });
  });
  h('validate:cardplan', (s, plan, projectId) => {
    const draft = projectId ? projects.latestStageOutput(s, projectId, 'draft') : null;
    return validateCardPlan(planForValidation(plan), { sourceText: draft?.content || '' });
  });

  // 인터뷰 오디오 → 텍스트 (로컬 whisper.cpp)
  h('transcribe:diagnose', (s) => {
    const { diagnose } = require('./src/main/transcribe');
    return diagnose({
      whisperBin: getSetting(s, 'whisperBin'),
      whisperModel: getSetting(s, 'whisperModel'),
      ffmpeg: getSetting(s, 'ffmpegPath'),
    });
  });
  // 받아쓰기 엔진 자동 설치: whisper.cpp 바이너리 + 한국어 모델 다운로드 후 설정 자동 기록
  h('transcribe:setup', async (s, opts = {}) => {
    const { setupWhisper } = require('./src/main/whisperSetup');
    const result = await setupWhisper({
      dir: path.join(app.getPath('userData'), 'whisper'),
      model: opts.model || 'small',
      onProgress: (p) => {
        if (win?.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send('transcribe:setupEvent', p);
        }
      },
    });
    setSetting(s, 'whisperBin', result.bin);
    setSetting(s, 'whisperModel', result.model);
    return result;
  });
  h('transcribe:audio', async (s, name, arrayBuffer) => {
    const { transcribeAudio } = require('./src/main/transcribe');
    const tmp = path.join(app.getPath('temp'), `dna_audio_${Date.now()}_${path.basename(name)}`);
    fs.writeFileSync(tmp, Buffer.from(arrayBuffer));
    try {
      return transcribeAudio(tmp, {
        whisperBin: getSetting(s, 'whisperBin') || undefined,
        whisperModel: getSetting(s, 'whisperModel') || undefined,
        ffmpeg: getSetting(s, 'ffmpegPath') || undefined,
      });
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });

  // 단계 3: URL 추출 / 파일 텍스트 추출
  h('extract:url', async (_s, url) => extract.fetchArticle(url));
  h('extract:file', async (_s, name, arrayBuffer) =>
    extract.extractFile(name, Buffer.from(arrayBuffer))
  );
  h('file:preview', async (_s, name, arrayBuffer) =>
    preview.previewFile(name, Buffer.from(arrayBuffer))
  );
  h('file:previewPath', async (_s, filePath) => {
    const resolved = path.resolve(String(filePath || ''));
    return preview.previewFile(path.basename(resolved), fs.readFileSync(resolved));
  });
  h('file:storeLocal', (_s, { projectId, name, arrayBuffer }) => {
    if (!projectId) throw new Error('파일을 저장할 프로젝트가 없습니다.');
    const dir = path.join(dataDir(), 'attachments', safeFileStem(projectId));
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${Date.now()}-${safeFileStem(name || 'attachment')}`;
    const filePath = path.join(dir, fileName);
    const buffer = Buffer.from(arrayBuffer || []);
    if (!buffer.length) throw new Error('빈 파일은 저장할 수 없습니다.');
    fs.writeFileSync(filePath, buffer);
    return { path: filePath, name: path.basename(String(name || fileName)), size: buffer.length };
  });

  // 아카이브 중복 검사
  h('archive:search', (s, keywords) => archive.searchArchive(s, keywords));
  h('archive:count', (s) => archive.archiveCount(s));

  // 이메일 형식 검사 (rule-based)
  h('validate:email', async (s, data) =>
    emailCheck.checkEmail({
      ...data,
      reporterName: getSetting(s, 'reporterName'),
      reporterTitle: getSetting(s, 'reporterTitle'),
    })
  );

  // 단계 1: 브레인스토밍 (+ 아카이브 중복 검사 결과 동봉)
  h('ai:brainstorm', async (s, projectId) => {
    const project = projects.getProject(s, projectId);
    const credentials = await aiCredentials(s);
    const { data, modelVersion } = await ai.brainstorm({
      ...credentials,
      keywords: project.keywords,
      context: project.title,
    });
    const recordId = records.createRecord(s, {
      projectId, stage: 'brainstorm',
      input: { keywords: project.keywords },
      aiOutput: JSON.stringify(data, null, 2),
      modelVersion,
    });
    const duplicates = archive.searchArchive(s, project.keywords);
    return { plan: data, recordId, duplicates };
  });

  // 단계 2: 취재 이메일
  h('ai:email', async (s, projectId, { recipient, purpose, external }) => {
    const bs = projects.latestStageOutput(s, projectId, 'brainstorm');
    let questions = [];
    try { questions = JSON.parse(bs?.content || '{}').questions || []; } catch { /* 무시 */ }
    const credentials = await aiCredentials(s);
    const { data, modelVersion } = await ai.writeEmail({
      ...credentials,
      reporterName: getSetting(s, 'reporterName'),
      reporterTitle: getSetting(s, 'reporterTitle') || '기자',
      recipient, purpose, external, questions,
    });
    const recordId = records.createRecord(s, {
      projectId, stage: 'email',
      input: { context: `수신자:${recipient} 용건:${purpose}` },
      aiOutput: JSON.stringify(data, null, 2),
      modelVersion,
    });
    return { email: data, recordId, questions };
  });

  // 단계 3: AI 추천 자료
  h('ai:suggestMaterials', async (s, projectId) => {
    const project = projects.getProject(s, projectId);
    const mats = projects.listMaterials(s, projectId);
    let checklist = [];
    try {
      const bs = projects.latestStageOutput(s, projectId, 'brainstorm');
      checklist = JSON.parse(bs?.content || '{}').checklist || [];
    } catch { /* 무시 */ }
    const credentials = await aiCredentials(s);
    const { data, modelVersion } = await ai.suggestMaterials({
      ...credentials, project, materials: mats, checklist,
    });
    const recordId = records.createRecord(s, {
      projectId, stage: 'collect',
      input: { keywords: project.keywords, materials: mats.map((m) => m.title) },
      aiOutput: JSON.stringify(data, null, 2),
      modelVersion,
    });
    return { suggestions: data.suggestions || [], recordId };
  });

  // 외부 링크는 기본 브라우저·메일앱으로 (http/https/mailto만 허용)
  h('shell:openExternal', (_s, url) => {
    const u = new URL(url);
    if (!/^(https?|mailto):$/.test(u.protocol)) throw new Error('http/https/mailto만 허용됩니다.');
    return shell.openExternal(url);
  });

  // 단계 4: 자료 분석·제언
  h('ai:analyze', async (s, projectId) => {
    const project = projects.getProject(s, projectId);
    const mats = projects.listMaterials(s, projectId);
    if (!mats.length) throw new Error('수집된 자료가 없습니다. 단계 3에서 자료를 먼저 추가하세요.');
    const credentials = await aiCredentials(s);
    const { data, modelVersion } = await ai.analyze({
      ...credentials, project, materials: mats,
    });
    const recordId = records.createRecord(s, {
      projectId, stage: 'analyze',
      input: { materials: mats.map((m) => m.title) },
      aiOutput: JSON.stringify(data, null, 2),
      modelVersion,
    });
    return { report: data, recordId };
  });

  // 프로젝트 폴더 자동 백업 (거버넌스 — 배포 zip과 별도)
  h('backup:run', async (s) => {
    const zip = new JSZip();
    const base = dataDir();
    const addDir = (dir, prefix) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) addDir(p, `${prefix}/${e.name}`);
        else zip.file(`${prefix}/${e.name}`, fs.readFileSync(p));
      }
    };
    if (fs.existsSync(path.join(base, 'dna.sqlite'))) {
      zip.file('dna.sqlite', fs.readFileSync(path.join(base, 'dna.sqlite')));
    }
    addDir(path.join(base, 'projects'), 'projects');
    const outDir = path.join(base, 'backups');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
    fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    return out;
  });

  // AI 호출 + 레코드 자동 생성 (Layer 1: ai_output 저장)
  h('ai:draft', async (s, projectId) => {
    const project = projects.getProject(s, projectId);
    const mats = projects.listMaterials(s, projectId);
    // RAG: 유사 우수 사례를 few-shot으로 동적 삽입 (Layer 2)
    const styleExamples = styleEngine.retrieve(
      s, `${project.title} ${(project.keywords || []).join(' ')}`, 2
    );
    const credentials = await aiCredentials(s);
    const { text, modelVersion } = await ai.generateDraft({
      ...credentials,
      project,
      materials: mats,
      styleExamples,
    });
    const recordId = records.createRecord(s, {
      projectId,
      stage: 'draft',
      input: { keywords: project.keywords, materials: mats.map((m) => m.title) },
      aiOutput: text,
      modelVersion,
    });
    return { text, recordId };
  });

  h('ai:cardplan', async (s, projectId, draftText) => {
    const credentials = await aiCredentials(s);
    const { plan, modelVersion } = await ai.planCardnews({
      ...credentials,
      draftText,
    });
    const validation = validateCardPlan(planForValidation(plan), { sourceText: draftText });
    if (!validation.ok) {
      const err = new Error('카드뉴스 구성안이 DNA 원문 발췌 규칙을 통과하지 못했습니다.\n' + validation.errors.join('\n'));
      err.validation = validation;
      throw err;
    }
    const recordId = records.createRecord(s, {
      projectId,
      stage: 'cardnews',
      input: { context: draftText.slice(0, 2000) },
      aiOutput: JSON.stringify(plan, null, 2),
      modelVersion,
    });
    return { plan, recordId };
  });

  // 맞춤법 검사 (nara-speller 우선, 실패 시 로컬 규칙 폴백)
  h('spell:check', async (_s, text) => {
    const { checkSpelling } = require('./src/main/speller');
    return checkSpelling(text);
  });

  // 단계 5: 기사 초안 docx 내보내기
  h('draft:exportDocx', async (s, projectId, draftText) => {
    const { buildDraftDocx } = require('./src/main/docx');
    const name = getSetting(s, 'reporterName');
    const title = getSetting(s, 'reporterTitle') || '기자';
    const byline = name ? `디지스트신문 DNA ${title} ${name}` : '디지스트신문 DNA';
    const buf = await buildDraftDocx(draftText, { byline });
    const outDir = path.join(dataDir(), 'projects', projectId);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `기사초안-${Date.now()}.docx`);
    fs.writeFileSync(outPath, buf);
    return { outPath };
  });

  // 단계 5: 기사 초안 PDF 내보내기 (Electron 내장 printToPDF — 외부 의존성 없음)
  h('draft:exportPdf', async (s, projectId, draftText) => {
    const { title, paragraphs, todos } = parseDraft(draftText);
    const name = getSetting(s, 'reporterName');
    const rtitle = getSetting(s, 'reporterTitle') || '기자';
    const byline = name ? `디지스트신문 DNA ${rtitle} ${name}` : '디지스트신문 DNA';
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { margin: 20mm; }
      body { font-family: 'Malgun Gothic','Apple SD Gothic Neo',sans-serif; color:#1a1a1a; line-height:1.9; font-size:11pt; }
      h1 { font-size:20pt; margin:0 0 6px; }
      .byline { color:#666; font-size:10pt; border-bottom:1px solid #ddd; padding-bottom:10px; margin-bottom:16px; }
      p { margin:0 0 12px; }
      .todo { color:#b3261e; font-size:10pt; border-top:1px dashed #ccc; padding-top:10px; margin-top:16px; }
    </style></head><body>
      <h1>${esc(title || '(제목 없음)')}</h1>
      <div class="byline">${esc(byline)}</div>
      ${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
      ${todos.length ? `<div class="todo">※ 확인 필요<br>${todos.map((t) => '· ' + esc(t)).join('<br>')}</div>` : ''}
    </body></html>`;

    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      const outDir = path.join(dataDir(), 'projects', projectId);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `기사초안-${Date.now()}.pdf`);
      fs.writeFileSync(outPath, pdf);
      return { outPath };
    } finally {
      win.destroy();
    }
  });

  // 카드뉴스 생성: 템플릿 기반 PPTX + 선택 시 PNG/Drive/로컬 저장
  h('cardnews:generate', async (s, projectId, plan, options = {}) => {
    const template = fs.readFileSync(TEMPLATE_PATH());
    const draft = projects.latestStageOutput(s, projectId, 'draft');
    const decoded = decodeCardnewsPhotos(plan);
    const { buffer, warnings, slideCount } = await generateCardnews(template, decoded, {
      sourceText: draft?.content || '',
    });

    const outDir = projectOutputDir(projectId);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = safeFileStem(plan.coverTitle || 'cardnews').replace(/\s+/g, '-');
    const pptxName = `${baseName || 'cardnews'}-${stamp}.pptx`;
    const outPath = path.join(outDir, pptxName);
    fs.writeFileSync(outPath, buffer);

    const formats = {
      pptx: options.formats?.pptx !== false,
      png: Boolean(options.formats?.png),
    };
    const destinations = {
      local: Boolean(options.destinations?.local),
      drive: Boolean(options.destinations?.drive),
    };
    const result = {
      outPath,
      warnings: [...warnings],
      slideCount,
      outputs: {
        pptx: { appPath: outPath, name: pptxName },
        png: null,
      },
    };

    if (formats.pptx && destinations.local) {
      const saved = await dialog.showSaveDialog(win, {
        title: '카드뉴스 PPTX 저장',
        defaultPath: pptxName,
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      });
      if (!saved.canceled && saved.filePath) {
        fs.copyFileSync(outPath, saved.filePath);
        result.outputs.pptx.localPath = saved.filePath;
      }
    }

    if (formats.pptx && destinations.drive) {
      result.outputs.pptx.driveFile = await uploadBufferToDrive(s, {
        name: pptxName,
        buffer,
        mimeType: googleDrive.inferMimeType(pptxName),
      });
    }

    if (formats.png) {
      const pngDir = path.join(outDir, `${path.parse(pptxName).name}-png`);
      try {
        const exported = exportPptxToPngs(outPath, pngDir);
        result.outputs.png = {
          appDir: pngDir,
          engine: exported.engine,
          files: exported.files.map((filePath) => ({
            name: path.basename(filePath),
            path: filePath,
            size: fs.statSync(filePath).size,
          })),
        };
        result.warnings.push(
          exported.engine === 'powerpoint'
            ? 'PNG는 PowerPoint로 렌더링되어 현재 PC의 실제 폰트를 기준으로 저장되었습니다.'
            : 'PNG는 LibreOffice로 렌더링되었습니다. 발행 전 PowerPoint 폰트 환경에서 줄바꿈을 확인하세요.'
        );
        if (destinations.local) {
          const picked = await dialog.showOpenDialog(win, {
            title: '카드뉴스 PNG 저장 폴더 선택',
            properties: ['openDirectory', 'createDirectory'],
          });
          if (!picked.canceled && picked.filePaths?.[0]) {
            const targetDir = picked.filePaths[0];
            result.outputs.png.localDir = targetDir;
            exported.files.forEach((filePath, index) => {
              const target = path.join(targetDir, `${path.parse(pptxName).name}-${String(index + 1).padStart(2, '0')}.png`);
              fs.copyFileSync(filePath, target);
            });
          }
        }
        if (destinations.drive) {
          result.outputs.png.driveFiles = [];
          for (const filePath of exported.files) {
            result.outputs.png.driveFiles.push(await uploadBufferToDrive(s, {
              name: path.basename(filePath),
              buffer: fs.readFileSync(filePath),
              mimeType: 'image/png',
            }));
          }
        }
      } catch (error) {
        const details = error.details?.length ? `\n${error.details.join('\n')}` : '';
        result.warnings.push(`${error.message || error}${details}`);
      }
    }

    return result;
  });

  h('shell:showFile', (_s, p) => shell.showItemInFolder(p));
  h('shell:openPath', (_s, p) => shell.openPath(p));
}

function createWindow() {
  win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 700,
    title: 'DNA 편집 스튜디오',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await ensureStore();
  console.log(`DNA data: ${dataDir()}`);
  if (await importGoogleClientFromArgs(store)) {
    app.quit();
    return;
  }
  updater = createUpdaterController({ app, getWindow: () => win });
  registerIpc();
  createWindow();
  updater.scheduleStartupCheck();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
