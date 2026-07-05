// Electron 메인 프로세스 — 보안 기본값:
//  - contextIsolation: true, nodeIntegration: false, sandbox: true
//  - API 키는 safeStorage(OS 키체인 연동)로 암호화해 저장. 평문/코드 하드코딩 금지.
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./src/main/db');
const projects = require('./src/main/projects');
const records = require('./src/main/records');
const claude = require('./src/main/claude');
const quotes = require('./src/shared/validators/quotes');
const quoteVerify = require('./src/shared/validators/quoteVerify');
const { validateCardPlan } = require('./src/pptx/cardnewsRules');
const { generateCardnews } = require('./src/pptx/cardnews');

let store = null;
let win = null;

const TEMPLATE_PATH = () =>
  path.join(__dirname, '..', 'templates', '인스타그램_카드뉴스_2025개편.pptx');

function dataDir() {
  return path.join(app.getPath('userData'), 'dna-data');
}

async function ensureStore() {
  if (!store) store = await Store.open(path.join(dataDir(), 'dna.sqlite'));
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

function getApiKey(s) {
  const row = s.get('SELECT value FROM settings WHERE key = ?', ['apiKeyEnc']);
  if (!row) return process.env.ANTHROPIC_API_KEY || null;
  return safeStorage.decryptString(Buffer.from(row.value, 'base64'));
}

function getSetting(s, key, fallback = '') {
  const row = s.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

function registerIpc() {
  const h = (channel, fn) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      const s = await ensureStore();
      return fn(s, ...args);
    });

  // 설정
  h('settings:get', (s, key) => getSetting(s, key));
  h('settings:set', (s, key, value) => {
    if (key === 'apiKey') return setApiKey(s, value);
    s.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    s.persist();
  });
  h('settings:hasApiKey', (s) => Boolean(getApiKey(s)));

  // 프로젝트 / 자료
  h('project:create', (s, data) => projects.createProject(s, data));
  h('project:list', (s) => projects.listProjects(s));
  h('project:get', (s, id) => projects.getProject(s, id));
  h('project:setStage', (s, id, stage) => projects.setStage(s, id, stage));
  h('material:add', (s, data) => projects.addMaterial(s, data));
  h('material:list', (s, projectId) => projects.listMaterials(s, projectId));

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
  h('validate:cardplan', (_s, plan) => validateCardPlan(plan));

  // AI 호출 + 레코드 자동 생성 (Layer 1: ai_output 저장)
  h('ai:draft', async (s, projectId) => {
    const project = projects.getProject(s, projectId);
    const mats = projects.listMaterials(s, projectId);
    const { text, modelVersion } = await claude.generateDraft({
      apiKey: getApiKey(s),
      project,
      materials: mats,
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
    const { plan, modelVersion } = await claude.planCardnews({
      apiKey: getApiKey(s),
      draftText,
    });
    const recordId = records.createRecord(s, {
      projectId,
      stage: 'cardnews',
      input: { context: draftText.slice(0, 2000) },
      aiOutput: JSON.stringify(plan, null, 2),
      modelVersion,
    });
    return { plan, recordId };
  });

  // 카드뉴스 pptx 생성
  h('cardnews:generate', async (s, projectId, plan) => {
    const buf = fs.readFileSync(TEMPLATE_PATH());
    const { buffer, warnings, slideCount } = await generateCardnews(buf, plan);
    const outDir = path.join(dataDir(), 'projects', projectId);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `카드뉴스-${Date.now()}.pptx`);
    fs.writeFileSync(outPath, buffer);
    return { outPath, warnings, slideCount };
  });

  h('shell:showFile', (_s, p) => shell.showItemInFolder(p));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    title: 'DNA 편집 스튜디오',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
