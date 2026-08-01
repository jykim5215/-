// Electron 메인 프로세스 — 보안 기본값:
//  - contextIsolation: true, nodeIntegration: false, sandbox: true
//  - API 키는 safeStorage(OS 키체인 연동)로 암호화해 저장. 평문/코드 하드코딩 금지.
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const { parseDraft } = require('./src/main/docx');
const path = require('path');
const fs = require('fs');

const { Store } = require('./src/main/db');
const projects = require('./src/main/projects');
const records = require('./src/main/records');
const claude = require('./src/main/claude');
const archive = require('./src/main/archive');
const extract = require('./src/main/extract');
const styleEngine = require('./src/main/styleEngine');
const JSZip = require('jszip');
const quotes = require('./src/shared/validators/quotes');
const emailCheck = require('./src/shared/validators/email');
const quoteVerify = require('./src/shared/validators/quoteVerify');
const { validateCardPlan } = require('./src/pptx/cardnewsRules');
const { generateCardnews } = require('./src/pptx/cardnews');

let store = null;
let win = null;

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
    host: getSetting(s, 'smtpHost') || undefined,
    port: getSetting(s, 'smtpPort') ? Number(getSetting(s, 'smtpPort')) : undefined,
    fromName: (() => {
      const n = getSetting(s, 'reporterName'); const t = getSetting(s, 'reporterTitle') || '기자';
      return n ? `디지스트신문 DNA ${t} ${n}` : '디지스트신문 DNA';
    })(),
  };
}

// 수신(IMAP) 설정. 계정·비밀번호는 발송과 같은 것을 쓴다 (같은 DGIST 계정).
function imapCfg(s) {
  return {
    user: getSetting(s, 'smtpUser'),
    pass: getSecret(s, 'smtpPass') || '',
    imapHost: getSetting(s, 'imapHost') || undefined,
    imapPort: getSetting(s, 'imapPort') || undefined,
  };
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
    if (key === 'smtpPass') return setSecret(s, 'smtpPass', value); // 앱 비밀번호는 암호화 저장
    s.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    s.persist();
  });
  h('settings:hasApiKey', (s) => Boolean(getApiKey(s)));
  h('settings:hasSmtpPass', (s) => Boolean(getSecret(s, 'smtpPass')));

  // 이메일 발송 (SMTP)
  h('mail:verify', async (s) => {
    const { verify } = require('./src/main/mailer');
    return verify(mailConfig(s));
  });
  h('mail:send', async (s, msg) => {
    const { sendMail } = require('./src/main/mailer');
    const res = await sendMail(msg, mailConfig(s));
    return res;
  });

  // 메일 수신 (IMAP) — 취재원 답신을 앱 안에서 받아본다
  h('mail:imapVerify', async (s) => require('./src/main/mailbox').verify(imapCfg(s)));
  h('mail:fetch', async (s, opts) => {
    const mailbox = require('./src/main/mailbox');
    const { triage } = require('./src/main/mail-triage');
    const res = await mailbox.fetchRecent(imapCfg(s), opts || {});
    // 규칙 기반 분류는 항상, AI 분류는 키가 있을 때만 (본문은 기기에 남는다)
    const { briefing, ai } = await triage({
      apiKey: getApiKey(s),
      emails: res.emails,
      interests: getSetting(s, 'mailInterests'),
    });
    return { ...res, briefing, ai };
  });
  h('mail:markRead', (s, uid, folder, seen) =>
    require('./src/main/mailbox').markRead(imapCfg(s), uid, folder, seen));
  h('mail:markAllRead', (s, folder) =>
    require('./src/main/mailbox').markAllRead(imapCfg(s), folder));
  h('mail:delete', (s, uid, folder) =>
    require('./src/main/mailbox').deleteMessage(imapCfg(s), uid, folder));

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
  h('validate:cardplan', (_s, plan) => validateCardPlan(plan));

  // 인터뷰 오디오 → 텍스트 (로컬 whisper.cpp)
  h('transcribe:diagnose', (s) => {
    const { diagnose } = require('./src/main/transcribe');
    return diagnose({
      whisperBin: getSetting(s, 'whisperBin'),
      whisperModel: getSetting(s, 'whisperModel'),
      ffmpeg: getSetting(s, 'ffmpegPath'),
    });
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
    const { data, modelVersion } = await claude.brainstorm({
      apiKey: getApiKey(s),
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
    const { data, modelVersion } = await claude.writeEmail({
      apiKey: getApiKey(s),
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
    const { data, modelVersion } = await claude.suggestMaterials({
      apiKey: getApiKey(s), project, materials: mats, checklist,
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
    const { data, modelVersion } = await claude.analyze({
      apiKey: getApiKey(s), project, materials: mats,
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
    const { text, modelVersion } = await claude.generateDraft({
      apiKey: getApiKey(s),
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

  // 카드뉴스 pptx 생성
  h('cardnews:generate', async (s, projectId, plan) => {
    const buf = fs.readFileSync(TEMPLATE_PATH());
    // 렌더러가 data URL로 넘긴 사진을 Buffer로 디코딩 (커버 + 카드별)
    const decodePhoto = (p) => {
      if (!p || !p.dataUrl) return undefined;
      const m = p.dataUrl.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i);
      if (!m) return undefined;
      return { buffer: Buffer.from(m[2], 'base64'), ext: m[1].toLowerCase() };
    };
    const decoded = {
      ...plan,
      coverPhoto: decodePhoto(plan.coverPhoto),
      cards: (plan.cards || []).map((c) => ({ ...c, photo: decodePhoto(c.photo) })),
    };
    const { buffer, warnings, slideCount } = await generateCardnews(buf, decoded);
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
