/* DNA 편집 스튜디오 렌더러.
 * 제품 기능은 Electron preload의 window.dnaAPI를 통해서만 동작한다. */
'use strict';

const STAGES = [
  { key: 'brainstorm', name: '브레인스토밍' },
  { key: 'collect', name: '자료 수집' },
  { key: 'analyze', name: '분석·제언' },
  { key: 'draft', name: '기사 초안' },
  { key: 'cardnews', name: '카드뉴스' },
];
const STAGE_ORDER = STAGES.map((s) => s.key);
const FB_TAGS = ['구조 좋음', '인용 오류', '톤 부적절', '리드 약함', '사실 정확', '분량 적절'];

// ---------- 레거시 UI fixture (제품 실행 경로에서는 사용하지 않음) ----------
function makeMockAPI() {
  const db = { projects: [], materials: [], outputs: [], records: [], settings: {} };
  const uid = () => Math.random().toString(36).slice(2, 10);
  // 데모용 샘플 프로젝트 시드 — 화면 구경용
  const demoPid = uid();
  db.projects.push({
    id: demoPid,
    title: '조정부, 학생단체 승격의 갈림길',
    keywords: ['조정부', '학생단체 승격'],
    article_type: '스트레이트',
    current_stage: 'draft',
  });
  db.materials.push(
    {
      id: uid(), project_id: demoPid, kind: 'transcript',
      title: '인터뷰 녹취 — 조정부 부장',
      content: '박성현입니다. 2026년도 DGIST 조정부 부장을 맡고 있습니다. 지난 2년간 정기 훈련과 대외 대회 출전 실적을 꾸준히 쌓아 왔다. 앞으로 신입 부원 모집에 힘쓰겠습니다.',
      source: '직접 취재 · 6.28',
    },
    {
      id: uid(), project_id: demoPid, kind: 'file',
      title: '동아리연합회 회칙.pdf',
      content: '제12조(승격) 기타 학생단체 승격은 동아리연합회 전체회의 심의를 거친다.',
      source: '동연 공개자료',
    },
    {
      id: uid(), project_id: demoPid, kind: 'url',
      title: '총학 공지 — 심의 일정',
      content: '동아리연합회는 오는 15일 전체회의에서 조정부의 승격 안건을 다룰 예정이다.',
      source: '총학생회 홈페이지',
    }
  );
  const DEMO_DRAFT = `침체기 딛고 다시 노를 젓다 — 조정부, 학생단체 승격\n\nDGIST 조정부가 2026년 '기타 학생단체'로 승격되었다. 코로나19로 활동이 중단됐던 조정부는 대회 복귀와 운영 정상화를 거쳐 승격 심의를 통과했다.\n\n조정부 부장 박성현 학생은 "지난 2년간 정기 훈련과 대외 대회 출전 실적을 꾸준히 쌓아 왔다"고 말했다.\n\n승격으로 조정부는 예산을 지원받을수 있게 됬다.\n\n---확인 필요---\n- 동아리연합회 심의 일정 확정 여부\n- 승격 이후 예산 규모`;
  return {
    _demo: true,
    async settingsGet(k) { return db.settings[k] || ''; },
    async settingsSet(k, v) { db.settings[k] = v; },
    async hasApiKey() { return false; },
    async hasSmtpPass() { return Boolean(db.settings.smtpPass); },
    async updateStatus() {
      return { enabled: false, status: 'unsupported', currentVersion: '0.3.1', message: '데모 모드에서는 업데이트를 확인하지 않습니다.' };
    },
    async updateCheck() { return this.updateStatus(); },
    async updateInstall() { return this.updateStatus(); },
    onUpdateEvent() { return () => {}; },
    async googleConfigure() { db.settings.googleConfigured = true; return { configured: true }; },
    async googleStatus() {
      return {
        configured: Boolean(db.settings.googleConfigured),
        connected: Boolean(db.settings.googleConnected),
        profile: db.settings.googleConnected
          ? { name: '김유준', email: 'user@example.com', emailVerified: true }
          : null,
      };
    },
    async googleConnect() {
      db.settings.googleConfigured = true;
      db.settings.googleConnected = true;
      return this.googleStatus();
    },
    async googleDisconnect() {
      db.settings.googleConnected = false;
      return this.googleStatus();
    },
    async driveListFiles() {
      return [
        { id: 'demo-img-1', name: 'rowing-cover.jpg', mimeType: 'image/jpeg', size: 102400 },
        { id: 'demo-img-2', name: 'interview-room.png', mimeType: 'image/png', size: 86400 },
      ];
    },
    async driveDownloadFile(fileId) {
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP48OHDfwAJqgP9eS0vlwAAAABJRU5ErkJggg==';
      return { id: fileId, name: `${fileId}.png`, mimeType: 'image/png', dataUrl: `data:image/png;base64,${png}` };
    },
    async driveUploadFile(file) {
      return { id: `demo-${uid()}`, name: file.name, mimeType: file.mimeType || '', size: file.arrayBuffer?.byteLength || 0, webViewLink: '' };
    },
    async devStatus() { return { uploads: [], report: null, activeProfile: '', google: await this.googleStatus() }; },
    async devUploadReference(file) {
      return { id: uid(), name: file.name, kind: file.kind, chars: 0, webViewLink: '' };
    },
    async devAnalyzeReferences() {
      await sleep(600);
      return {
        profileTitle: '데모 자동화 프로필',
        summary: '업로드 자료를 기반으로 기사 규칙과 체크리스트를 정리합니다.',
        rules: ['표본의 문체를 참고하되 사실을 새로 만들지 않습니다.'],
        stageGuidance: [{ stage: 'draft', guidance: '직접인용은 원문 그대로 유지합니다.' }],
        styleSignals: ['간결한 리드', '출처 중심 문장'],
        regressionChecks: ['카드뉴스 최대 12장 유지'],
        risks: ['표본 수가 부족하면 과적합될 수 있습니다.'],
      };
    },
    async devApplyAutomationProfile() { return { ok: true, chars: 120, profile: '데모 자동화 프로필' }; },
    async mailVerify() { return { ok: false, error: '데모 모드 — Electron 앱에서 SMTP 발송이 동작합니다.' }; },
    async mailImapVerify() { return { ok: false, error: '데모 모드 — Electron 앱에서 IMAP 연결 테스트가 동작합니다.' }; },
    async mailInboxList() {
      await sleep(400);
      return { exists: 2, messages: [
        { uid: 2, subject: '조정부 승격 관련 답변드립니다', from: '동아리연합회 <council@dgist.ac.kr>', date: new Date().toISOString(), seen: false, flagged: false, size: 2048 },
        { uid: 1, subject: '인터뷰 가능 일정 안내', from: '학생팀 <student@dgist.ac.kr>', date: new Date(Date.now() - 86400000).toISOString(), seen: true, flagged: false, size: 1024 },
      ] };
    },
    async mailInboxRead(uid) {
      await sleep(350);
      return {
        uid,
        subject: uid === 2 ? '조정부 승격 관련 답변드립니다' : '인터뷰 가능 일정 안내',
        from: uid === 2 ? '동아리연합회 <council@dgist.ac.kr>' : '학생팀 <student@dgist.ac.kr>',
        date: new Date().toISOString(),
        text: uid === 2
          ? '안녕하세요. 조정부 승격 심의 기준과 회의 결과를 아래와 같이 전달드립니다.\n\n1. 활동 실적\n2. 안전 관리 계획\n3. 지속 운영 가능성'
          : '안녕하세요. 이번 주 목요일 오후 인터뷰 가능합니다.',
        attachments: [],
      };
    },
    async mailSend(msg) {
      await sleep(600);
      return { ok: true, messageId: 'demo-mail', accepted: [msg.to].filter(Boolean) };
    },
    async mailContacts() {
      return [
        { name: '동아리연합회', email: 'council@dgist.ac.kr', count: 5 },
        { name: '학생팀 이민호', email: 'student@dgist.ac.kr', count: 3 },
        { name: '기획처', email: 'plan@dgist.ac.kr', count: 1 },
      ];
    },
    async projectCreate(d) { const id = uid(); db.projects.push({ id, title: d.title, keywords: d.keywords || [], article_type: d.articleType || '', current_stage: 'brainstorm' }); return id; },
    async projectList() { return [...db.projects]; },
    async projectGet(id) { return db.projects.find((p) => p.id === id) || null; },
    async projectSetStage(id, st) { const p = db.projects.find((x) => x.id === id); if (p) p.current_stage = st; },
    async projectRename(id, title) { const p = db.projects.find((x) => x.id === id); if (p) p.title = title; },
    async projectDelete(id) { db.projects = db.projects.filter((x) => x.id !== id); db.materials = db.materials.filter((m) => m.project_id !== id); },
    async materialAdd(d) { if (!d.source || !d.source.trim()) throw new Error('출처(source)가 없는 자료는 저장할 수 없습니다.'); const id = uid(); db.materials.push({ id, project_id: d.projectId, ...d }); return id; },
    async materialList(pid) { return db.materials.filter((m) => m.project_id === pid); },
    async materialDelete(id) { db.materials = db.materials.filter((m) => m.id !== id); },
    async materialUpdate(id, d) { if (d.source !== undefined && !String(d.source).trim()) throw new Error('출처는 비울 수 없습니다.'); const m = db.materials.find((x) => x.id === id); if (m) Object.assign(m, d); },
    async outputSave(d) { db.outputs.push({ ...d, version: db.outputs.filter((o) => o.projectId === d.projectId && o.stage === d.stage).length + 1, id: uid(), created_at: new Date().toISOString(), chars: d.content.length }); return { version: db.outputs.filter((o) => o.projectId === d.projectId && o.stage === d.stage).length }; },
    async outputLatest(pid, st) { return [...db.outputs].reverse().find((o) => o.projectId === pid && o.stage === st) || null; },
    async outputVersions(pid, st) { return db.outputs.filter((o) => o.projectId === pid && o.stage === st).map((o) => ({ id: o.id, version: o.version, created_at: o.created_at, chars: o.chars })).reverse(); },
    async outputGet(id) { return db.outputs.find((o) => o.id === id) || null; },
    async recordFinalize() { return 42; },
    async recordFeedback() {},
    async recordMetrics() { return []; },
    async datasetExport() { return '(데모 모드)'; },
    async validateQuotes(draft, pid) {
      const sources = db.materials.filter((m) => m.project_id === pid).map((m) => m.content);
      return mockValidate(draft, sources);
    },
    async validateReadiness(draft, pid) {
      const materials = db.materials.filter((m) => m.project_id === pid);
      const validation = mockValidate(draft, materials.map((m) => m.content));
      const lines = String(draft || '').trim().split(/\r?\n/);
      const title = (lines.shift() || '').trim();
      const rest = lines.join('\n');
      const [body = '', todo = ''] = rest.split(/-{2,}\s*확인 필요\s*-{2,}/i);
      const missing = validation.quotes.filter((q) => q.verdict.status === 'missing').length;
      const sourceCount = new Set(materials.map((m) => m.source).filter((source) => source && !/출처 보완 필요|출처 미확인/.test(source))).size;
      const checks = [
        { id: 'body', label: '기사 본문', status: body.trim() ? 'pass' : 'block', detail: `${body.replace(/\s/g, '').length}자` },
        { id: 'title', label: '제목', status: title ? 'pass' : 'block', detail: title ? `${title.length}자` : '제목 없음' },
        { id: 'sources', label: '취재 근거', status: sourceCount >= 2 ? 'pass' : sourceCount ? 'warn' : 'block', detail: `자료 ${materials.length}건 · 출처 ${sourceCount}곳` },
        { id: 'quotes', label: '직접인용', status: missing ? 'block' : 'pass', detail: missing ? `누락 ${missing}건` : '검증됨' },
        { id: 'todos', label: '확인 필요', status: todo.trim() ? 'block' : 'pass', detail: todo.trim() ? '미확인 항목 있음' : '남은 항목 없음' },
      ];
      const blockers = checks.filter((item) => item.status === 'block');
      const warnings = checks.filter((item) => item.status === 'warn');
      const score = Math.round(checks.reduce((sum, item) => sum + (item.status === 'pass' ? 1 : item.status === 'warn' ? 0.5 : 0), 0) / checks.length * 100);
      return { ready: !blockers.length, score, checks, blockers, warnings, metrics: { materialCount: materials.length, sourceCount } };
    },
    async validateCardplan(plan) { return { ok: true, errors: [], warnings: plan.cards?.length > 10 ? ['카드 수 초과'] : [] }; },
    async aiDraft() { await sleep(600); return { text: DEMO_DRAFT, recordId: 'demo-rec' }; },
    async aiCardplan(_pid, draft) {
      await sleep(600);
      return { recordId: 'demo-rec2', plan: { coverTitle: '침체기 딛고\n다시 노를 젓다', category: '사회', cards: [
        { title: '다시 노를 젓는 조정부', body: 'DGIST 조정부가 2026년 ‘기타 학생단체’로 승격되었다.' },
        { title: 'Q1. 자기소개', body: '간단한 자기소개 부탁드립니다.' },
      ] } };
    },
    async cardnewsGenerate() {
      return {
        outPath: '(데모 모드 — Electron에서만 생성됩니다)',
        warnings: [],
        slideCount: 4,
        outputs: { pptx: { appPath: '(demo)' }, png: { files: [] } },
      };
    },
    async draftExportDocx() { return { outPath: '(데모 모드 — Electron 앱에서 docx가 프로젝트 폴더에 저장됩니다)' }; },
    async draftExportPdf() { return { outPath: '(데모 모드 — Electron 앱에서 PDF가 프로젝트 폴더에 저장됩니다)' }; },
    async filePreview(name) {
      if (/\.pptx$/i.test(name)) return { kind: 'pptx', title: name, slideCount: 2, slides: [{ index: 1, texts: ['커버'] }, { index: 2, texts: ['본문 카드'] }] };
      return { kind: 'docx', title: name, paragraphs: ['데모 미리보기 문단입니다.'] };
    },
    async filePreviewPath(path) { return this.filePreview(path); },
    async fileStoreLocal(file) { return { path: `(demo)/${file.name}`, name: file.name, size: file.arrayBuffer?.byteLength || 0 }; },
    async spellCheck(text) {
      await sleep(500);
      const items = [];
      if (/갓다/.test(text)) items.push({ orgStr: '갓다', candWords: ['갔다'], help: "'가았다'의 준말은 '갔다'입니다." });
      if (/됬/.test(text)) items.push({ orgStr: '됬', candWords: ['됐'], help: "'되었-'의 준말은 '됐-'입니다." });
      const su = text.match(/([가-힣])수 (있|없)/);
      if (su && (su[1].codePointAt(0) - 0xac00) % 28 === 8) items.push({ orgStr: `${su[1]}수 ${su[2]}`, candWords: [`${su[1]} 수 ${su[2]}`], help: "의존명사 '수'는 앞말과 띄어 씁니다." });
      return { engine: 'nara', items };
    },
    async showFile() {},
    async openPath() {},
    async validateEmail(d) {
      const issues = [];
      if (!d.subject.startsWith('[디지스트신문 DNA]')) issues.push({ type: 'subject-prefix', message: '제목이 [디지스트신문 DNA] 로 시작해야 합니다.' });
      return { ok: !issues.length, issues };
    },
    async transcribeDiagnose() { return { whisperBin: null, whisperModel: null, ffmpeg: null }; },
    async transcribeSetup() { await sleep(800); throw new Error('데모 모드 — Electron 앱에서 자동 설치가 동작합니다.'); },
    onTranscribeSetupEvent() { return () => {}; },
    async transcribeAudio(name) { await sleep(900); return { text: `(데모) ${name} 받아쓰기 결과 — Electron 앱에서 whisper.cpp로 실제 전사됩니다.\n박성현: 안녕하세요, 조정부 부장 박성현입니다.`, model: 'ggml-large-v3.bin(데모)' }; },
    async extractUrl(url) { await sleep(400); return { title: '(데모) 추출된 기사 제목', author: '기자명', date: '2026-07-01', site: new URL(url).hostname, url, text: '데모 모드 — Electron에서 실제 본문이 추출됩니다.' }; },
    async extractFile(name) { return `(데모) ${name} 파일에서 추출된 텍스트`; },
    async archiveSearch() { return []; },
    async archiveCount() { return 0; },
    async backupRun() { return '(데모 모드)'; },
    async openExternal(url) { window.open(url, '_blank', 'noopener'); },
    async aiSuggestMaterials() {
      await sleep(600);
      return { recordId: 'demo-sg', suggestions: [
        { title: '동아리연합회 전체회의 회의록 (승격 심의)', why: '심의 기준·표결 결과의 1차 근거', where: '동아리연합회 (공개 요청)', query: 'DGIST 동아리연합회 회의록' },
        { title: '타 대학 조정부 학생단체 운영 사례', why: '승격 기준 비교·맥락 제공', where: '각 대학 총학/동연 홈페이지', query: '대학 조정부 중앙동아리 승격 사례' },
        { title: '본원(학생팀) 공식 입장', why: '반론·상대 입장 확보 — 기사 균형', where: '학생팀 (이메일 문의, 존재 여부 확인 필요)', query: 'DGIST 학생팀 기타 학생단체' },
      ] };
    },
    async aiBrainstorm() {
      await sleep(600);
      return { recordId: 'demo-bs', duplicates: [], plan: {
        angles: [{ type: '스트레이트', summary: '승격 확정 사실 보도', readerInterest: '상', reason: '학생단체 예산·공간 직결' }, { type: '인터뷰', summary: '부장 인터뷰로 부활 서사', readerInterest: '중', reason: '동아리 관계자 관심' }],
        titleCandidates: ['조정부, 기타 학생단체 승격', '침체기 딛고 다시 노를 젓다', '조정부 부활의 조건'],
        sources: ['조정부 부장', '동아리연합회 회장', '학생팀 담당자'],
        questions: ['승격 준비 과정에서 가장 어려웠던 점은?', '승격 이후 달라지는 것은?'],
        checklist: ['동아리연합회 회칙', '승격 심의 일정 공지', '조정부 활동 실적 자료'],
      } };
    },
    async aiEmail(_pid, { recipient, purpose }) {
      await sleep(500);
      return { recordId: 'demo-em', questions: [], email: {
        subject: `[디지스트신문 DNA] ${purpose} 관련 서면 인터뷰 요청`,
        body: `안녕하세요, ${recipient}님.\n\n디지스트신문 DNA 기자 ○○○입니다.\n\n${purpose} 관련하여 서면 인터뷰를 요청드립니다.\n\n디지스트신문 DNA 기자 ○○○ 드림\ndna@dgist.ac.kr | dgistdna.com`,
        attachmentNote: '',
      } };
    },
    async aiAnalyze() {
      await sleep(700);
      return { recordId: 'demo-an', report: {
        timeline: [{ date: '2024', event: '코로나로 활동 중단', sourceIdx: 1 }, { date: '2026-01', event: '기타 학생단체 승격', sourceIdx: 1 }],
        conflicts: [{ topic: '운영 실적', positionA: '실적 충분 (자료 1)', positionB: '실적 부족 (자료 2)' }],
        factcheck: ['승격 심의 일자 확인 필요'],
        stats: [],
        gaps: ['본원 측 입장 미확보 — 반론 취재 필요'],
      } };
    },
  };
  function mockValidate(draft, sources) {
    const curly = /[“”]/.test(draft);
    const straight = /"/.test(draft);
    const qs = [...draft.matchAll(/“([^”]+)”|"([^"]+)"/g)].map((m) => m[1] || m[2]);
    const norm = (s) => s.replace(/[\s“”"‘’'.,!?]/g, '');
    return {
      style: { issues: straight ? [{ type: 'straight-double', message: `직선 큰따옴표 발견 — 곡선(“ ”)으로 바꾸세요.` }] : [] },
      singles: { count: 0, overused: false },
      quotes: qs.map((q) => ({ text: q, verdict: sources.some((s) => norm(s).includes(norm(q))) ? { status: 'exact' } : { status: 'missing' } })),
    };
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

// ?demo 쿼리로 열면 UI 확인용 목 API로 구동 (제품 경로는 항상 preload의 dnaAPI)
const api = window.dnaAPI
  || (new URLSearchParams(location.search).has('demo') ? makeMockAPI() : null);
if (!api) {
  document.body.innerHTML = `
    <main class="electron-required">
      <div class="electron-required-mark">DNA</div>
      <h1>Electron 앱으로 실행해 주세요</h1>
      <p>이 화면은 브라우저 데모로 동작하지 않습니다. 설치된 <b>DNA 편집 스튜디오</b>를 실행하면 실제 프로젝트 DB, Gemini, DGIST 메일, 문서·카드뉴스 생성 기능에 연결됩니다.</p>
    </main>`;
  throw new Error('DNA 편집 스튜디오는 Electron preload가 필요합니다.');
}


// ---------- 아이콘 (inline SVG, stroke 기반) ----------
const ICON_PATHS = {
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.6 1 1.4 1 2.5h6c0-1.1.3-1.9 1-2.5A6 6 0 0 0 12 3z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  gauge: '<path d="M12 15l4-6M3 12a9 9 0 0 1 18 0 8.9 8.9 0 0 1-1.2 4.5H4.2A8.9 8.9 0 0 1 3 12z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  skip: '<path d="M5 4l10 8-10 8V4zM19 5v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  map: '<path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3zM9 3v15M15 6v15"/>',
  paperclip: '<path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5L13 3a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.8-8.8"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 4h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
};
function ic(name) {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}
const STAGE_ICONS = { brainstorm: 'bulb', email: 'mail', collect: 'folder', analyze: 'chart', draft: 'pen', cardnews: 'grid' };

// 버튼 로딩 상태 (텍스트 대신 스피너)
function setBusy(btn, on) {
  if (!btn) return;
  if (on) {
    btn.dataset.idle = btn.innerHTML;
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
    if (btn.dataset.idle) btn.innerHTML = btn.dataset.idle;
  }
}

// ---------- 상태 ----------
const state = {
  projectId: null,
  project: null,
  projects: [],
  stage: 'brainstorm',
  view: 'workflow',
  profile: { name: '', title: '' },
  google: { configured: false, connected: false, profile: null },
  theme: 'ink',
  developerMode: false,
  update: { enabled: false, status: 'idle', currentVersion: '', message: '' },
  autoRuns: new Set(),
  currentRecordId: null,
  rating: 0,
  tags: new Set(),
  cardPlan: null,
  skippedStages: new Set(),
  doc: null,                // 브레인스토밍 기획 문서 (노션식 블록)
  sideOpen: null,           // null = 단계별 자동 (브레인스토밍은 숨김)
};

// 사이드 패널: 프로젝트 없음(온보딩)·브레인스토밍에서는 기본 숨김
function sideVisible() {
  if (!state.projectId) return false;
  if (state.view !== 'workflow') return false;
  return state.sideOpen ?? (state.stage !== 'brainstorm');
}
function applySideVisibility() {
  document.querySelector('.frame').classList.toggle('no-side', !sideVisible());
  const toggle = $('#sideToggle');
  toggle.hidden = !state.projectId || state.view !== 'workflow';
  toggle.innerHTML = `${ic('panel')} ${sideVisible() ? '패널 접기' : '패널 열기'}`;
}

// 상단 브레드크럼: 프로젝트 › 현재 단계
function renderCrumb() {
  const el = $('#crumb');
  if (!el) return;
  if (state.view === 'mail') {
    el.innerHTML = `<span class="cr-dim">메일</span> › <span>DGIST 메일함</span>`;
    return;
  }
  if (state.view === 'flow') {
    el.innerHTML = `<span class="cr-dim">워크플로우</span> › <span>진행 노트</span>`;
    return;
  }
  if (state.view === 'profile') {
    el.innerHTML = `<span class="cr-dim">계정</span> › <span>프로필</span>`;
    return;
  }
  if (state.view === 'developer') {
    el.innerHTML = `<span class="cr-dim">개발자</span> › <span>자동화 프로필</span>`;
    return;
  }
  if (state.view === 'new-project') {
    el.innerHTML = `<span class="cr-dim">프로젝트</span> › <span>새 기사</span>`;
    return;
  }
  if (!state.projectId) { el.textContent = '시작하기'; return; }
  const stageName = STAGES.find((s) => s.key === state.stage)?.name || '';
  el.innerHTML = `<span class="cr-dim"></span> › <span></span>`;
  el.children[0].textContent = state.project?.title || '프로젝트';
  el.children[1].textContent = stageName;
}

function renderGreeting() {
  const el = $('#greeting');
  if (!el) return;
  const hour = new Date().getHours();
  const timeWord = hour < 5 ? '깊은 밤' : hour < 12 ? '좋은 아침' : hour < 18 ? '좋은 오후' : hour < 22 ? '좋은 저녁' : '늦은 밤';
  const name = state.profile.name?.trim();
  const title = state.profile.title?.trim() || '기자';
  el.textContent = name
    ? `${timeWord}, ${title} ${name}님`
    : `${timeWord}, DNA`;
}

function renderHubButtons() {
  $('#mailCenterBtn')?.classList.toggle('active', state.view === 'mail');
  $('#flowMapBtn')?.classList.toggle('active', state.view === 'flow');
  $('#newProjectBtn')?.classList.toggle('active', state.view === 'new-project');
  const devBtn = $('#devModeBtn');
  if (devBtn) {
    const visible = state.developerMode === true;
    devBtn.hidden = !visible;
    devBtn.setAttribute('aria-hidden', visible ? 'false' : 'true');
    devBtn.tabIndex = visible ? 0 : -1;
    devBtn.classList.toggle('active', visible && state.view === 'developer');
    if (!visible && state.view === 'developer') state.view = 'profile';
  }
  $('#settingsBtn')?.classList.toggle('active', state.view === 'profile');
}

const $ = (sel) => document.querySelector(sel);

// 초안 화면 이탈 직전 자동저장 플러시 (렌더링 교체 전에 호출)
let draftFlush = null;

function setSave(text, ok = false) {
  const el = $('#saveState');
  el.textContent = text;
  el.className = 'save' + (ok ? ' ok' : '');
}

// ---------- 프로젝트 ----------
async function refreshProjects() {
  await refreshProfile();
  const list = await api.projectList();
  state.projects = list;
  if (!list.length) {
    state.projectId = null;
    state.project = null;
  } else {
    if (!state.projectId || !list.some((p) => p.id === state.projectId)) {
      state.projectId = list[0].id;
    }
    state.project = list.find((p) => p.id === state.projectId);
    state.stage = state.project.current_stage || 'brainstorm';
    if (!STAGE_ORDER.includes(state.stage)) state.stage = 'collect';
  }
  $('#renameProjectBtn').disabled = !state.projectId;
  $('#deleteProjectBtn').disabled = !state.projectId;
  renderAll();
}

function renderProjectList() {
  const host = $('#projectList');
  if (!host) return;
  host.innerHTML = '';
  if (!state.projects.length) {
    const empty = document.createElement('div');
    empty.className = 'project-empty';
    empty.textContent = '진행 중인 프로젝트가 없습니다.';
    host.appendChild(empty);
    return;
  }
  for (const project of state.projects) {
    const row = document.createElement('button');
    const stageKey = project.id === state.projectId ? state.stage : project.current_stage;
    const stage = STAGES.find((item) => item.key === stageKey) || STAGES[0];
    row.type = 'button';
    row.className = `project-row${project.id === state.projectId ? ' active' : ''}`;
    row.innerHTML = `
      <span class="project-state" aria-hidden="true"></span>
      <span class="project-copy"><b></b><small></small></span>`;
    row.querySelector('b').textContent = project.title || '제목 없는 프로젝트';
    row.querySelector('small').textContent = stage.name;
    row.onclick = () => {
      state.projectId = project.id;
      state.project = project;
      state.stage = STAGE_ORDER.includes(project.current_stage) ? project.current_stage : 'brainstorm';
      state.view = 'workflow';
      state.sideOpen = null;
      renderAll();
    };
    host.appendChild(row);
  }
}

async function refreshProfile() {
  state.profile = {
    name: (await api.settingsGet('reporterName')) || '',
    title: (await api.settingsGet('reporterTitle')) || '',
  };
  state.theme = normalizeTheme((await api.settingsGet('appTheme')) || state.theme);
  state.developerMode = ((await api.settingsGet('developerMode')) || '') === 'true';
  if (!state.developerMode && state.view === 'developer') state.view = 'profile';
  applyTheme(state.theme);
  state.google = await api.googleStatus?.() || { configured: false, connected: false, profile: null };
  state.update = await api.updateStatus?.() || state.update;
  renderRailProfile();
}

// 2026 리디자인 테마: ink(기본) · midnight · porcelain — 구 테마 값은 ink로 흡수
const THEMES = ['ink', 'midnight', 'porcelain'];
function normalizeTheme(theme) {
  return THEMES.includes(theme) ? theme : 'ink';
}
function applyTheme(theme) {
  state.theme = normalizeTheme(theme);
  document.body.dataset.theme = state.theme;
}

function profileInitials() {
  const source = state.profile.name || state.google.profile?.name || 'DNA';
  const compact = String(source).trim().replace(/\s+/g, '');
  return compact === 'DNA' ? 'DNA' : compact.slice(-2);
}

function renderRailProfile() {
  const name = state.profile.name?.trim() || state.google.profile?.name || '프로필';
  const title = state.profile.title?.trim() || (state.google.connected ? state.google.profile?.email : '이름과 계정 설정');
  if ($('#railAvatar')) $('#railAvatar').textContent = profileInitials();
  if ($('#railProfileName')) $('#railProfileName').textContent = name;
  if ($('#railProfileTitle')) $('#railProfileTitle').textContent = title || '기자';
  if ($('.profile-gear')) $('.profile-gear').innerHTML = ic('gear');
}

// ---------- 워크플로우 내비 (레일 세로 목록) ----------
function renderStepper() {
  const el = $('#stepper');
  el.innerHTML = '';
  const curIdx = STAGE_ORDER.indexOf(state.stage);
  STAGES.forEach((s, i) => {
    const div = document.createElement('div');
    const skipped = s.optional && state.skippedStages?.has(s.key) && i < curIdx;
    const current = Boolean(state.projectId) && i === curIdx;
    div.className =
      'nav-item' +
      (current ? ' cur' : skipped ? ' skipped' : state.projectId && i < curIdx ? ' done' : '');
    const mark = skipped ? '–' : i < curIdx ? '✓' : ic(STAGE_ICONS[s.key]);
    div.innerHTML = `<span class="nv-st">${mark}</span><span class="nv-name"></span>` +
      (s.optional ? '<span class="opt-tag">선택</span>' : '');
    div.querySelector('.nv-name').textContent = s.name;
    div.title = s.optional ? '선택 단계 — 필요할 때만 진행합니다' : '';
    if (!state.projectId) {
      div.classList.add('disabled');
      div.setAttribute('aria-disabled', 'true');
    }
    div.onclick = () => {
      if (!state.projectId) return;
      state.view = 'workflow';
      state.stage = s.key;
      if (state.project) state.project.current_stage = s.key;
      if (state.projectId) api.projectSetStage(state.projectId, s.key);
      renderAll();
    };
    el.appendChild(div);
  });
}

// ---------- 자료 패널 ----------
async function renderMaterials() {
  const listEl = $('#materialList');
  listEl.innerHTML = '';
  if (!state.projectId) { $('#matCount').textContent = ''; return; }
  const mats = await api.materialList(state.projectId);
  $('#matCount').textContent = `· ${mats.length}건`;
  for (const m of mats) {
    const div = document.createElement('div');
    div.className = 'm';
    div.innerHTML = `
      <div class="m-top">
        <span class="t"></span>
        <span class="m-acts">
          ${m.meta?.localPath ? `<button class="m-open" title="원본 열기">${ic('folder')}</button>` : ''}
          ${m.meta?.driveWebViewLink ? `<button class="m-drive" title="Drive에서 열기">${ic('link')}</button>` : ''}
          <button class="m-edit" title="편집">${ic('pen')}</button>
          <button class="m-del" title="삭제">${ic('trash')}</button>
        </span>
      </div>
      <span class="s">출처: <b></b> · ${esc(m.kind)}</span>`;
    div.querySelector('.t').textContent = m.title;
    div.querySelector('b').textContent = m.source;
    div.querySelector('.m-del').onclick = async () => {
      if (!confirm(`자료 "${m.title}"을(를) 삭제할까요?`)) return;
      await api.materialDelete(m.id);
      renderMaterials();
      setSave('자료 삭제됨', true);
    };
    div.querySelector('.m-open')?.addEventListener('click', () => api.openPath?.(m.meta.localPath));
    div.querySelector('.m-drive')?.addEventListener('click', () => api.openExternal?.(m.meta.driveWebViewLink));
    div.querySelector('.m-edit').onclick = () => openMaterialEditor(m);
    listEl.appendChild(div);
  }
}

// 자료 편집 다이얼로그 (출처 필수 유지)
function openMaterialEditor(m) {
  const dlg = $('#matEditDlg');
  $('#meTitle').value = m.title;
  $('#meSource').value = m.source;
  $('#meContent').value = m.content;
  $('#meSaveBtn').onclick = async () => {
    try {
      await api.materialUpdate(m.id, {
        title: $('#meTitle').value,
        source: $('#meSource').value,
        content: $('#meContent').value,
      });
      dlg.close();
      renderMaterials();
      setSave('자료 수정됨', true);
    } catch (e) { alert(e.message || e); }
  };
  dlg.showModal();
}

// ---------- 검증 패널 ----------
function renderValidation(res) {
  const box = $('#validatorBox');
  const out = $('#validatorResults');
  box.hidden = false;
  out.innerHTML = '';
  const row = (label, badge, cls) => {
    const div = document.createElement('div');
    div.className = 'chk';
    div.innerHTML = `<span></span><span class="${cls}"></span>`;
    div.children[0].textContent = label;
    div.children[1].textContent = badge;
    out.appendChild(div);
  };
  const missing = res.quotes.filter((q) => q.verdict.status === 'missing');
  const fuzzy = res.quotes.filter((q) => q.verdict.status === 'fuzzy');
  row('직접인용 검증', `${res.quotes.length - missing.length} / ${res.quotes.length}`, missing.length ? 'b-bad' : 'b-ok');
  row('곡선 따옴표', res.style.issues.length ? `문제 ${res.style.issues.length}` : '통과', res.style.issues.length ? 'b-bad' : 'b-ok');
  row('작은따옴표 남용', res.singles.overused ? `${res.singles.count}회` : '통과', res.singles.overused ? 'b-warn' : 'b-ok');

  for (const q of missing) {
    const div = document.createElement('div');
    div.className = 'note alert';
    div.innerHTML = `<span class="lab">인용 검증 실패</span><span></span>`;
    div.children[1].textContent = `“${q.text}” — 자료에서 원문을 찾을 수 없습니다. 간접인용으로 전환하세요.`;
    out.appendChild(div);
  }
  for (const q of fuzzy) {
    const div = document.createElement('div');
    div.className = 'note warn';
    div.innerHTML = `<span class="lab">유사 문장 (${Math.round(q.verdict.score * 100)}%)</span><span></span>`;
    div.children[1].textContent = `“${q.text}” — 원문과 다릅니다. 토씨까지 원문 그대로인지 확인하세요.`;
    out.appendChild(div);
  }
  for (const iss of res.style.issues) {
    const div = document.createElement('div');
    div.className = 'note warn';
    div.innerHTML = `<span class="lab">따옴표</span><span></span>`;
    div.children[1].textContent = iss.message;
    out.appendChild(div);
  }
}

// ---------- 피드백 위젯 ----------
function renderFeedback() {
  const box = $('#feedbackBox');
  box.hidden = !state.currentRecordId;
  if (box.hidden) return;
  const starsEl = $('#stars');
  starsEl.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.textContent = '★';
    s.className = i <= state.rating ? 'on' : '';
    s.onclick = () => { state.rating = i; renderFeedback(); };
    starsEl.appendChild(s);
  }
  const tagsEl = $('#fbTags');
  tagsEl.innerHTML = '';
  for (const t of FB_TAGS) {
    const s = document.createElement('span');
    s.textContent = t;
    s.className = state.tags.has(t) ? 'on' : '';
    s.onclick = () => { state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t); renderFeedback(); };
    tagsEl.appendChild(s);
  }
}

// ---------- 작업 영역 ----------
async function renderWork() {
  // 이전 화면이 초안이었으면 미저장분 강제 저장 후 이탈
  if (draftFlush) { try { draftFlush(); } catch { /* 무시 */ } draftFlush = null; }
  const el = $('#workArea');
  el.innerHTML = '';
  el.classList.remove('work-anim');
  void el.offsetWidth;
  el.classList.add('work-anim');
  if (state.view === 'mail') return renderMailCenter(el);
  if (state.view === 'flow') return renderFlowMap(el);
  if (state.view === 'profile') return renderProfileView(el);
  if (state.view === 'developer') return renderDeveloperMode(el);
  if (state.view === 'new-project') return renderNewProjectView(el);
  if (!state.projectId) {
    const hasKey = await api.hasApiKey();
    const displayName = state.profile.name?.trim() || state.google.profile?.givenName || state.google.profile?.name || '';
    el.innerHTML = `
      <div class="start-screen">
        <div class="start-mark">${ic('pen')}</div>
        <h1>${displayName ? `${esc(displayName)}님, ` : ''}오늘 어떤 기사를 만들까요?</h1>
        <p class="sub">제목과 키워드를 적으면 브레인스토밍 문서가 바로 열립니다.</p>
        <button class="btn primary start-primary" id="obNew">${ic('plus')} 첫 기사 시작하기</button>
        <div class="start-status">
          <button id="obProfile" class="start-status-row">
            <span class="status-icon">${profileInitials()}</span>
            <span><b>${state.profile.name ? '프로필 준비됨' : '프로필 설정'}</b><small>${state.profile.name ? `${esc(state.profile.title || '기자')} ${esc(state.profile.name)}` : '이름과 직함을 저장하세요'}</small></span>
            <span>${ic('gear')}</span>
          </button>
          <button id="obKey" class="start-status-row">
            <span class="status-icon ${hasKey ? 'ready' : ''}">${hasKey ? ic('check') : ic('spark')}</span>
            <span><b>Google AI ${hasKey ? '연결됨' : '연결 필요'}</b><small>${hasKey ? '브레인스토밍을 실행할 수 있습니다' : '프로필에서 Google 계정을 연결하세요'}</small></span>
            <span>${ic('gear')}</span>
          </button>
        </div>
      </div>`;
    $('#obKey').onclick = () => openProfileView();
    $('#obProfile').onclick = () => openProfileView();
    $('#obNew').onclick = () => openProjectDialog('create');
    return;
  }
  if (state.stage === 'brainstorm') return renderBrainstormStage(el);
  if (state.stage === 'email') return renderEmailStage(el);
  if (state.stage === 'collect') return renderCollectStage(el);
  if (state.stage === 'analyze') return renderAnalyzeStage(el);
  if (state.stage === 'draft') return renderDraftStage(el);
  if (state.stage === 'cardnews') return renderCardnewsStage(el);
}

function openNewProjectView() {
  state.view = 'new-project';
  state.sideOpen = false;
  renderAll();
}

function renderNewProjectView(el) {
  const articleTypes = ['스트레이트', '인터뷰', '기획', '사설'];
  el.innerHTML = `
    <article class="project-create-page">
      <header class="project-create-header">
        <span class="flow-page-label">새 프로젝트</span>
        <h1>새 기사 시작</h1>
      </header>

      <form id="newProjectForm" class="project-create-form">
        <label class="project-field">
          <span>기사 제목</span>
          <input id="newProjectTitle" type="text" maxlength="120" placeholder="DGIST 조정부, 다시 노를 젓다" autocomplete="off">
        </label>

        <fieldset class="project-field">
          <legend>기사 유형</legend>
          <div class="project-type-options">
            ${articleTypes.map((type, index) => `
              <label>
                <input type="radio" name="newProjectType" value="${type}" ${index === 0 ? 'checked' : ''}>
                <span>${type}</span>
              </label>`).join('')}
          </div>
        </fieldset>

        <label class="project-field">
          <span>핵심 키워드</span>
          <input id="newProjectKeywords" type="text" maxlength="180" placeholder="조정부, 학생단체, 대회" autocomplete="off">
          <small>쉼표로 구분해 5개까지 저장합니다.</small>
        </label>

        <label class="project-field">
          <span>마감</span>
          <input id="newProjectDeadline" type="datetime-local">
        </label>

        <p id="newProjectError" class="form-error" role="alert"></p>
        <div class="project-create-actions">
          <button id="newProjectCreateBtn" class="btn primary" type="submit">${ic('plus')} 프로젝트 만들기</button>
          <button id="newProjectCancelBtn" class="btn ghost" type="button">취소</button>
        </div>
      </form>
    </article>`;

  const titleInput = $('#newProjectTitle');
  const form = $('#newProjectForm');
  const cancel = () => {
    state.view = 'workflow';
    renderAll();
  };
  $('#newProjectCancelBtn').onclick = cancel;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      $('#newProjectError').textContent = '기사 제목을 입력하세요.';
      titleInput.focus();
      return;
    }
    const keywords = $('#newProjectKeywords').value
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 5);
    const articleType = form.elements.newProjectType.value;
    const deadline = $('#newProjectDeadline').value;
    const button = $('#newProjectCreateBtn');
    setBusy(button, true);
    try {
      state.projectId = await api.projectCreate({ title, keywords, articleType });
      if (deadline) await api.settingsSet(`deadline:${state.projectId}`, deadline);
      state.stage = 'brainstorm';
      state.view = 'workflow';
      state.sideOpen = false;
      await refreshProjects();
      setSave('프로젝트 생성됨', true);
    } catch (error) {
      $('#newProjectError').textContent = error.message || String(error);
      if (document.body.contains(button)) setBusy(button, false);
    }
  };
  requestAnimationFrame(() => titleInput.focus());
}

// ---------- 단계 1: 브레인스토밍 (노션식 문서 에디터) ----------
// 섹션 정의: 마커/색은 은은하게, 구조는 문서 블록으로.
const SEC_DEFS = [
  { key: 'angle', name: '기사 각도', dot: '#3B82F6', marker: '•', ph: '각도 아이디어…' },
  { key: 'title', name: '제목 후보', dot: '#10B981', marker: 'n', ph: '제목 후보…' },
  { key: 'question', name: '취재 질문', dot: '#8B5CF6', marker: 'Q', ph: '질문…' },
  { key: 'checklist', name: '필요 자료 체크리스트', dot: '#F59E0B', marker: 'check', ph: '확보할 자료…' },
  { key: 'source', name: '취재원', dot: '#EC4899', marker: '•', ph: '취재원(직함)…' },
  { key: 'free', name: '메모', dot: '#C7C4BC', marker: '·', ph: '자유 메모…' },
];
let blkSeq = 1;
const newBlock = (text = '', checked = false) => ({ id: 'b' + Date.now() + '-' + blkSeq++, text, checked });

function emptyDoc() {
  return { sections: SEC_DEFS.map((s) => ({ key: s.key, blocks: [] })) };
}
function docSection(key) {
  return state.doc.sections.find((s) => s.key === key);
}

// AI 기획안 → 섹션 블록으로
function planIntoDoc(plan) {
  const add = (key, texts) => {
    const sec = docSection(key);
    for (const t of texts) if (t && String(t).trim()) sec.blocks.push(newBlock(String(t).trim()));
  };
  add('angle', (plan.angles || []).map((a) => `[${a.type}] ${a.summary} — 관심도 ${a.readerInterest} (${a.reason})`));
  add('title', plan.titleCandidates || []);
  add('question', plan.questions || []);
  add('checklist', plan.checklist || []);
  add('source', plan.sources || []);
}

// 저장 형식 (단계 2 질문지·단계 3 추천 맥락과 호환)
function docPayload() {
  return {
    sections: state.doc.sections,
    questions: docSection('question').blocks.map((b) => b.text).filter(Boolean),
    checklist: docSection('checklist').blocks.filter((b) => !b.checked).map((b) => b.text).filter(Boolean),
  };
}

// 이전 형식 호환: {sections} | {notes}(구 보드) | plan JSON
function loadDocFrom(content) {
  const doc = emptyDoc();
  try {
    const data = JSON.parse(content);
    if (data.sections) {
      for (const s of data.sections) {
        const sec = doc.sections.find((x) => x.key === s.key);
        if (sec) sec.blocks = (s.blocks || []).map((b) => ({ ...newBlock(b.text, !!b.checked) }));
      }
    } else if (data.notes) {
      const map = { angle: 'angle', title: 'title', question: 'question', checklist: 'checklist', source: 'source', keyword: 'free', free: 'free' };
      for (const n of data.notes) {
        const sec = doc.sections.find((x) => x.key === (map[n.type] || 'free'));
        sec.blocks.push(newBlock(String(n.text || '').replace(/^☐\s*/, '')));
      }
    } else {
      state.doc = doc;
      planIntoDoc(data);
      return state.doc;
    }
  } catch { /* 빈 문서 유지 */ }
  return doc;
}

async function renderBrainstormStage(el) {
  el.innerHTML = `
    <div class="toolrow" style="margin-top:0">
      <button id="bsGenBtn" class="btn primary">${ic('spark')} AI 기획안 생성</button>
      <button id="bsSaveBtn" class="btn">${ic('save')} 저장</button>
    </div>
    <div id="bsNotes"></div>
    <div class="doc" id="doc"></div>
    <p class="doc-hint">Enter = 아래에 새 블록 · 빈 블록에서 Backspace = 삭제 · ⋮⋮ 드래그 = 순서/섹션 이동 · 취재 질문은 메일함 AI 초안으로, 체크리스트는 자료 추천 맥락으로 연결됩니다.</p>
  `;

  const prev = await api.outputLatest(state.projectId, 'brainstorm');
  state.doc = prev ? loadDocFrom(prev.content) : emptyDoc();
  renderDoc();

  $('#bsGenBtn').onclick = async () => {
    const btn = $('#bsGenBtn');
    setBusy(btn, true);
    try {
      const { plan, recordId, duplicates } = await api.aiBrainstorm(state.projectId);
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      planIntoDoc(plan); // 기존 블록 보존, AI 블록은 각 섹션 뒤에 추가
      renderDoc();
      renderFeedback();
      if (duplicates?.length) {
        note('#bsNotes', 'warn', `과거 기사 중복 가능성 ${duplicates.length}건`,
          duplicates.map((d) => `· ${d.title} (${d.published_at || '날짜 미상'})`).join('\n'));
      } else {
        const n = await api.archiveCount();
        note('#bsNotes', 'ok', '중복 검사', n > 0 ? `아카이브 ${n}건과 겹치는 기사 없음` : '아카이브가 비어 있습니다 — scripts/import-archive.mjs로 과거 기사를 임포트하면 중복 검사가 활성화됩니다.');
      }
    } catch (e) { note('#bsNotes', 'alert', 'AI 오류', e.message || String(e)); }
    finally { setBusy(btn, false); }
  };

  $('#bsSaveBtn').onclick = async () => {
    const content = JSON.stringify(docPayload(), null, 2);
    await api.outputSave({ projectId: state.projectId, stage: 'brainstorm', content });
    if (state.currentRecordId) await api.recordFinalize(state.currentRecordId, content);
    setSave('기획 문서 저장됨', true);
  };
}

let dragCtx = null; // { fromSec, id }

function renderDoc(focusId = null) {
  const doc = $('#doc');
  if (!doc) return;
  doc.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'doc-title';
  title.textContent = state.project?.title || '기획 문서';
  doc.appendChild(title);

  const kws = document.createElement('div');
  kws.className = 'doc-kws';
  for (const k of state.project?.keywords || []) {
    const chip = document.createElement('span');
    chip.textContent = '# ' + k;
    kws.appendChild(chip);
  }
  doc.appendChild(kws);

  const meta = document.createElement('div');
  meta.className = 'doc-meta';
  const total = state.doc.sections.reduce((s, x) => s + x.blocks.length, 0);
  meta.textContent = `기획 문서 · 블록 ${total}개`;
  doc.appendChild(meta);

  for (const def of SEC_DEFS) {
    const sec = docSection(def.key);
    const secEl = document.createElement('div');
    secEl.className = 'sec';
    secEl.dataset.sec = def.key;

    const h = document.createElement('div');
    h.className = 'sec-h';
    h.innerHTML = `<span class="sec-dot"></span><span class="sec-name"></span><span class="sec-count"></span>`;
    h.querySelector('.sec-dot').style.background = def.dot;
    h.querySelector('.sec-name').textContent = def.name;
    h.querySelector('.sec-count').textContent = sec.blocks.length || '';
    secEl.appendChild(h);

    sec.blocks.forEach((b, idx) => secEl.appendChild(buildBlock(def, sec, b, idx)));

    const add = document.createElement('button');
    add.className = 'blk-add';
    add.textContent = '＋ 추가';
    add.onclick = () => {
      const nb = newBlock('');
      sec.blocks.push(nb);
      renderDoc(nb.id);
    };
    // 섹션 끝으로 드롭 허용
    add.ondragover = (e) => { e.preventDefault(); };
    add.ondrop = (e) => { e.preventDefault(); dropBlock(def.key, null); };
    secEl.appendChild(add);

    doc.appendChild(secEl);
  }

  if (focusId) focusBlock(focusId);
}

function buildBlock(def, sec, b, idx) {
  const row = document.createElement('div');
  row.className = 'blk' + (b.checked ? ' checked' : '');
  row.dataset.id = b.id;

  const handle = document.createElement('span');
  handle.className = 'blk-handle';
  handle.textContent = '⋮⋮';
  handle.draggable = true;
  handle.ondragstart = (e) => {
    dragCtx = { fromSec: sec.key, id: b.id };
    e.dataTransfer.effectAllowed = 'move';
  };
  row.appendChild(handle);

  const marker = document.createElement('span');
  marker.className = 'blk-marker';
  if (def.marker === 'check') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = b.checked;
    cb.onchange = () => { b.checked = cb.checked; row.classList.toggle('checked', b.checked); };
    marker.appendChild(cb);
  } else if (def.marker === 'n') {
    marker.textContent = (idx + 1) + '.';
  } else {
    marker.textContent = def.marker;
  }
  row.appendChild(marker);

  const text = document.createElement('div');
  text.className = 'blk-text';
  text.contentEditable = 'true';
  text.dataset.ph = def.ph;
  text.textContent = b.text;
  text.oninput = () => { b.text = text.textContent; };
  text.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const nb = newBlock('');
      sec.blocks.splice(sec.blocks.indexOf(b) + 1, 0, nb);
      renderDoc(nb.id);
    } else if (e.key === 'Backspace' && !text.textContent) {
      e.preventDefault();
      const i = sec.blocks.indexOf(b);
      sec.blocks.splice(i, 1);
      const prevBlk = sec.blocks[i - 1] || sec.blocks[i];
      renderDoc(prevBlk?.id || null);
    }
  };
  row.appendChild(text);

  const del = document.createElement('button');
  del.className = 'blk-del';
  del.textContent = '✕';
  del.title = '블록 삭제';
  del.onclick = () => {
    sec.blocks.splice(sec.blocks.indexOf(b), 1);
    renderDoc();
  };
  row.appendChild(del);

  // 블록 위로 드롭 → 그 앞에 삽입
  row.ondragover = (e) => { e.preventDefault(); row.classList.add('drag-over'); };
  row.ondragleave = () => row.classList.remove('drag-over');
  row.ondrop = (e) => { e.preventDefault(); row.classList.remove('drag-over'); dropBlock(sec.key, b.id); };

  return row;
}

function dropBlock(toSecKey, beforeId) {
  if (!dragCtx) return;
  const from = docSection(dragCtx.fromSec);
  const i = from.blocks.findIndex((x) => x.id === dragCtx.id);
  if (i < 0) { dragCtx = null; return; }
  const [moved] = from.blocks.splice(i, 1);
  const to = docSection(toSecKey);
  if (beforeId && beforeId !== moved.id) {
    const j = to.blocks.findIndex((x) => x.id === beforeId);
    to.blocks.splice(j < 0 ? to.blocks.length : j, 0, moved);
  } else if (!beforeId) {
    to.blocks.push(moved);
  } else {
    from.blocks.splice(i, 0, moved); // 자기 자신 위 드롭 → 원위치
  }
  dragCtx = null;
  renderDoc(moved.id);
}

function focusBlock(id) {
  const el = document.querySelector(`.blk[data-id="${id}"] .blk-text`);
  if (!el) return;
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// ---------- 단계 2: 취재 이메일 ----------
async function renderEmailStage(el) {
  el.innerHTML = `
    <h1>취재 이메일 작성 <span class="hint" style="font-size:12px; vertical-align:middle; background:var(--bg); padding:3px 10px; border-radius:99px">선택 단계</span></h1>
    <p class="sub">외부 취재가 필요할 때만 — DNA 공식 형식이 자동 적용되고, 단계 1의 질문이 질문지로 첨부됩니다.</p>
    <div class="toolrow">
      <button id="emSkipBtn" class="btn ghost">${ic('skip')} 건너뛰고 자료 수집으로</button>
    </div>
    <div class="cardplan">
      <div class="card-item">
        <input id="emRecipient" placeholder="수신자 (예: 동아리연합회 회장)">
        <input id="emPurpose" placeholder="용건 (예: 조정부 승격 심의 관련 서면 인터뷰)">
        <label style="font-size:13px; margin-top:6px; display:block"><input type="checkbox" id="emExternal"> 학외 인사 (매체 소개 포함)</label>
      </div>
    </div>
    <div class="toolrow">
      <button id="emGenBtn" class="btn primary">${ic('spark')} AI 이메일 생성</button>
      <button id="emCheckBtn" class="btn">형식 검사</button>
      <button id="emSpellBtn" class="btn">${ic('check')} 맞춤법 검사</button>
      <button id="emSaveBtn" class="btn">${ic('save')} 최종본 저장</button>
      <button id="emCopyBtn" class="btn">${ic('copy')} 복사</button>
      <button id="emToMailboxBtn" class="btn">${ic('send')} 메일함에서 보내기</button>
    </div>
    <p class="hint" style="margin:-8px 0 10px">발송·회신 확인은 좌측 <b>메일함</b>에서 합니다 — 여기서 쓴 초안을 그대로 가져갑니다.</p>
    <div id="emNotes"></div>
    <input id="emSubject" style="width:100%; font-family:inherit; font-size:15px; font-weight:700; border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:8px" placeholder="제목">
    <textarea id="emBody" class="editor" style="min-height:320px" placeholder="본문"></textarea>
  `;
  api.outputLatest(state.projectId, 'email').then((prev) => {
    if (!prev) return;
    try {
      const e2 = JSON.parse(prev.content);
      $('#emSubject').value = e2.subject || '';
      $('#emBody').value = e2.body || '';
    } catch { /* 무시 */ }
  }).catch(() => {});

  $('#emSkipBtn').onclick = () => {
    state.skippedStages.add('email');
    state.stage = 'collect';
    if (state.projectId) api.projectSetStage(state.projectId, 'collect');
    setSave('취재 이메일 단계를 건너뛰었습니다', true);
    renderAll();
  };
  $('#emGenBtn').onclick = async () => {
    state.skippedStages.delete('email');
    const btn = $('#emGenBtn');
    setBusy(btn, true);
    try {
      const { email, recordId, questions } = await api.aiEmail(state.projectId, {
        recipient: $('#emRecipient').value || '담당자',
        purpose: $('#emPurpose').value || state.project.title,
        external: $('#emExternal').checked,
      });
      $('#emSubject').value = email.subject;
      $('#emBody').value = email.body;
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      renderFeedback();
      if (questions?.length) note('#emNotes', 'ai', '질문지 자동 첨부', `단계 1의 취재 질문 ${questions.length}개가 본문에 포함되었습니다.`);
      runEmailCheck();
    } catch (e) { note('#emNotes', 'alert', 'AI 오류', e.message || String(e)); }
    finally { setBusy(btn, false); }
  };
  $('#emCheckBtn').onclick = runEmailCheck;
  // 취재원에게 나가는 글이므로 발송 전 맞춤법 검사 (기사와 같은 2중 엔진)
  $('#emSpellBtn').onclick = async () => {
    const btn = $('#emSpellBtn');
    const body = $('#emBody').value;
    if (!body.trim()) return note('#emNotes', 'warn', '맞춤법', '검사할 본문이 없습니다.');
    setBusy(btn, true);
    try {
      const { engine, items } = await api.spellCheck(body);
      $('#emNotes').innerHTML = '';
      if (!items.length) {
        note('#emNotes', 'ok', '맞춤법', `교정할 곳이 없습니다. (엔진: ${engine === 'nara' ? '부산대 맞춤법 검사기' : '로컬 규칙'})`);
        return;
      }
      note('#emNotes', 'warn', `맞춤법 ${items.length}건`,
        items.slice(0, 12).map((it) => `${it.orgStr} → ${it.candWords[0]}`).join('\n')
        + (items.length > 12 ? `\n… 외 ${items.length - 12}건` : ''));
      const fixBtn = document.createElement('button');
      fixBtn.className = 'btn small primary';
      fixBtn.textContent = `모두 적용 (${items.length}건)`;
      fixBtn.onclick = () => {
        let text = $('#emBody').value;
        for (const it of items) text = text.split(it.orgStr).join(it.candWords[0]);
        $('#emBody').value = text;
        fixBtn.disabled = true;
        setSave('맞춤법 교정 적용됨', true);
      };
      $('#emNotes').firstChild?.appendChild(fixBtn);
    } catch (e) {
      note('#emNotes', 'alert', '맞춤법 검사 실패', e.message || String(e));
    } finally { setBusy(btn, false); }
  };
  // 작성한 초안을 메일함 작성창으로 넘겨서 발송 (발송 경로 일원화)
  $('#emToMailboxBtn').onclick = async () => {
    const subject = $('#emSubject').value.trim();
    const body = $('#emBody').value;
    if (!subject && !body.trim()) {
      note('#emNotes', 'warn', '메일함으로', '먼저 제목이나 본문을 작성하세요. (AI 생성 버튼으로 초안을 만들 수 있습니다)');
      return;
    }
    const key = `mailDraft:${state.projectId || 'global'}`;
    await api.settingsSet(key, JSON.stringify({
      to: '', cc: '', bcc: '', subject, body,
      savedAt: new Date().toISOString(),
    }));
    setSave('초안을 메일함 작성창으로 옮겼습니다', true);
    state.view = 'mail';
    renderAll();
  };
  // 제목+본문을 클립보드로 (CMS·메일 붙여넣기용)
  $('#emCopyBtn').onclick = async () => {
    const text = `${$('#emSubject').value}\n\n${$('#emBody').value}`;
    try {
      await navigator.clipboard.writeText(text);
      setSave('제목·본문이 클립보드에 복사됨', true);
    } catch {
      // clipboard API 불가 시 폴백: 선택
      const ta = $('#emBody'); ta.focus(); ta.select();
      note('#emNotes', 'warn', '복사', '자동 복사가 막혀 본문을 선택했습니다 — Ctrl+C로 복사하세요.');
    }
  };
  $('#emSaveBtn').onclick = async () => {
    const content = JSON.stringify({ subject: $('#emSubject').value, body: $('#emBody').value }, null, 2);
    await api.outputSave({ projectId: state.projectId, stage: 'email', content });
    if (state.currentRecordId) await api.recordFinalize(state.currentRecordId, content);
    setSave('이메일 최종본 저장됨', true);
  };
  async function runEmailCheck() {
    const res = await api.validateEmail({ subject: $('#emSubject').value, body: $('#emBody').value });
    $('#emNotes').innerHTML = '';
    if (res.ok && !res.issues.length) note('#emNotes', 'ok', '형식 검사', 'DNA 공식 형식을 모두 충족합니다.');
    for (const iss of res.issues) note('#emNotes', iss.level === 'warn' ? 'warn' : 'alert', '형식', iss.message);
  }
}

function normalizeDgistMailUser(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.includes('@') ? raw : `${raw}@dgist.ac.kr`;
}

async function getMailAccountState() {
  const smtpUser = (await api.settingsGet('smtpUser')) || '';
  const imapUser = (await api.settingsGet('imapUser')) || '';
  return {
    user: smtpUser || imapUser,
    hasPass: Boolean(await api.hasSmtpPass?.()),
  };
}

async function saveDgistMailAccount(userValue, passValue = '') {
  const user = normalizeDgistMailUser(userValue);
  if (!/.+@dgist\.ac\.kr$/i.test(user)) {
    throw new Error('DGIST 이메일 주소 전체 또는 아이디를 입력하세요.');
  }
  await api.settingsSet('smtpUser', user);
  await api.settingsSet('imapUser', user);
  await api.settingsSet('smtpHost', 'mail.dgist.ac.kr');
  await api.settingsSet('smtpPort', '587');
  await api.settingsSet('imapHost', 'mail.dgist.ac.kr');
  await api.settingsSet('imapPort', '993');
  await api.settingsSet('imapSecure', 'true');
  const pass = String(passValue || '').trim();
  if (pass) await api.settingsSet('smtpPass', pass);
  return user;
}

// ---------- 독립 메일함 ----------
async function renderMailCenter(el) {
  let selectedMail = null;
  let composeAttachments = [];
  const account = await getMailAccountState();
  const mailDraftKey = `mailDraft:${state.projectId || 'global'}`;
  let savedDraft = {};
  try { savedDraft = JSON.parse((await api.settingsGet(mailDraftKey)) || '{}'); } catch { savedDraft = {}; }
  const connected = Boolean(account.user && account.hasPass);
  let currentFilter = 'reporting';
  el.innerHTML = `
    <div class="mailx">
      <header class="mailx-bar">
        <h1>메일함</h1>
        <span id="mcAcctChip" class="mailx-acct">
          <span id="mcAcctDot" class="login-dot ${connected ? 'ok' : ''}"></span>
          <b id="mcAcctUser">${connected ? esc(account.user) : '로그인 필요'}</b>
        </span>
        <span class="mailx-spacer"></span>
        <button id="mcAccountBtn" class="btn small ghost">${ic('folder')} 계정</button>
        <button id="mcRefreshBtn" class="btn small">${ic('download')} 새로고침</button>
        <button id="mcComposeFocusBtn" class="btn small primary">${ic('pen')} 새 메일</button>
      </header>

      <section id="mcLoginCard" class="mailx-login" ${connected ? 'hidden' : ''}>
        <h2>DGIST 메일 로그인</h2>
        <p>아이디만 입력하면 @dgist.ac.kr을 자동으로 붙입니다. 비밀번호는 이 컴퓨터에 암호화되어 저장됩니다.</p>
        <input id="mcLoginUser" autocomplete="username" placeholder="DGIST 아이디 또는 전체 이메일" value="${esc(account.user)}">
        <input id="mcLoginPass" type="password" autocomplete="current-password" placeholder="${account.hasPass ? '저장됨 — 변경할 때만 입력' : 'DGIST 메일 비밀번호'}">
        <div class="mailx-login-actions">
          <button id="mcLoginTestBtn" class="btn primary">${ic('check')} 저장하고 연결 확인</button>
          <button id="mcLoginSaveBtn" class="btn ghost">${ic('save')} 저장만</button>
        </div>
        <div id="mcLoginState" class="hint"></div>
      </section>

      <div class="mailx-tabs" id="mcTabs">
        <button class="mailx-tab on" data-filter="reporting">취재 관련</button>
        <button class="mailx-tab" data-filter="unread">안 읽음</button>
        <button class="mailx-tab" data-filter="all">전체</button>
      </div>

      <div class="mailx-grid">
        <div class="mailx-list-pane">
          <div id="mcState" class="hint"></div>
          <div id="mcList" class="mail-list"></div>
        </div>
        <div class="mailx-read-pane">
          <div id="mcPreview" class="mailx-read">
            <span class="hint">메일을 선택하면 본문이 표시됩니다.</span>
          </div>
        </div>
      </div>

      <section id="mcComposer" class="mailx-composer" hidden>
        <div class="mailx-composer-head">
          <b id="mcComposerTitle">새 메일</b>
          <div class="mailx-head-acts">
            <button id="mcAiDraftBtn" type="button">${ic('spark')} AI 초안</button>
            <button id="mcComposerClose" type="button" aria-label="닫기">✕</button>
          </div>
        </div>
        <div class="mailx-composer-body">
          <div class="mailx-ac-wrap"><input id="mcTo" type="email" autocomplete="off" placeholder="받는 사람 — 이름·이메일 입력하면 자동완성" value="${esc(savedDraft.to || '')}"></div>
          <div class="mailx-cc-row">
            <div class="mailx-ac-wrap"><input id="mcCc" autocomplete="off" placeholder="참조 (쉼표로 구분)" value="${esc(savedDraft.cc || '')}"></div>
            <div class="mailx-ac-wrap"><input id="mcBcc" autocomplete="off" placeholder="숨은참조" value="${esc(savedDraft.bcc || '')}"></div>
          </div>
          <input id="mcSubject" placeholder="제목 — [디지스트신문 DNA] ..." value="${esc(savedDraft.subject || '')}">
          <textarea id="mcBody" placeholder="본문">${esc(savedDraft.body || '')}</textarea>
          <label class="attach-pick">${ic('paperclip')} 첨부 추가<input id="mcAttach" type="file" multiple hidden></label>
          <div id="mcAttachList" class="attach-list"></div>
        </div>
        <div class="mailx-composer-foot">
          <button id="mcSendBtn" class="btn primary">${ic('send')} 보내기</button>
          <span id="mcSendState" class="hint"></span>
          <span id="mcDraftState" class="hint">임시저장 대기</span>
        </div>
      </section>
    </div>
  `;

  function openComposer(title) {
    $('#mcComposerTitle').textContent = title || '새 메일';
    $('#mcComposer').hidden = false;
  }
  function closeComposer() {
    $('#mcComposer').hidden = true;
  }
  function setAccountChip(user, ok) {
    $('#mcAcctUser').textContent = user || '로그인 필요';
    $('#mcAcctDot').classList.toggle('ok', Boolean(ok));
  }

  // ---- 받는 사람 자동완성 — 보낸·받은 메일에서 자동 수집한 주소록 사용 ----
  let contactsCache = null;
  async function loadContacts() {
    if (contactsCache) return contactsCache;
    try { contactsCache = (await api.mailContacts?.()) || []; } catch { contactsCache = []; }
    return contactsCache;
  }
  function attachMailAutocomplete(input) {
    const wrap = input.parentElement;
    let box = null;
    let items = [];
    let hl = -1;
    const currentSegment = () => {
      const parts = input.value.split(',');
      return parts[parts.length - 1].trim();
    };
    const close = () => { box?.remove(); box = null; items = []; hl = -1; };
    const pick = (c) => {
      const parts = input.value.split(',');
      parts[parts.length - 1] = (parts.length > 1 ? ' ' : '') + c.email;
      input.value = parts.join(',');
      close();
      input.focus();
      scheduleMailDraftSave();
    };
    const setHl = (i) => {
      hl = i;
      items.forEach((el, j) => el.classList.toggle('hl', j === hl));
      items[hl]?.scrollIntoView({ block: 'nearest' });
    };
    const render = (list) => {
      close();
      if (!list.length) return;
      box = document.createElement('div');
      box.className = 'mailx-ac';
      for (const c of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<b>${esc(c.name || c.email)}</b><small>${esc(c.name ? c.email : '최근 주고받은 주소')}</small>`;
        b.onmousedown = (e) => { e.preventDefault(); pick(c); };
        box.appendChild(b);
      }
      items = [...box.children];
      wrap.appendChild(box);
      setHl(0);
    };
    input.addEventListener('input', async () => {
      const q = currentSegment().toLowerCase();
      if (!q) return close();
      const all = await loadContacts();
      render(all
        .filter((c) => String(c.email || '').toLowerCase().includes(q) || String(c.name || '').toLowerCase().includes(q))
        .slice(0, 6));
    });
    input.addEventListener('keydown', (e) => {
      if (!box) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setHl(Math.min(hl + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(Math.max(hl - 1, 0)); }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        if (items.length) { e.preventDefault(); items[Math.max(hl, 0)].dispatchEvent(new MouseEvent('mousedown')); }
      } else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }
  ['mcTo', 'mcCc', 'mcBcc'].forEach((id) => attachMailAutocomplete($(`#${id}`)));

  $('#mcLoginSaveBtn').onclick = saveLoginOnly;
  $('#mcLoginTestBtn').onclick = saveAndTestLogin;
  $('#mcAccountBtn').onclick = () => {
    const card = $('#mcLoginCard');
    card.hidden = !card.hidden;
    if (!card.hidden) $('#mcLoginUser').focus();
  };
  $('#mcRefreshBtn').onclick = loadMailList;
  document.querySelectorAll('#mcTabs .mailx-tab').forEach((button) => {
    button.onclick = () => {
      document.querySelectorAll('#mcTabs .mailx-tab').forEach((t) => t.classList.remove('on'));
      button.classList.add('on');
      currentFilter = button.dataset.filter;
      loadMailList();
    };
  });
  $('#mcComposeFocusBtn').onclick = () => {
    openComposer('새 메일');
    $('#mcTo').focus();
  };
  $('#mcComposerClose').onclick = closeComposer;
  $('#mcAiDraftBtn').onclick = generateMailDraftInMailbox;
  ['mcTo', 'mcCc', 'mcBcc', 'mcSubject', 'mcBody'].forEach((id) => {
    $(`#${id}`).addEventListener('input', scheduleMailDraftSave);
  });
  if (savedDraft.savedAt) {
    $('#mcDraftState').textContent = `임시저장 불러옴 · ${formatMailDate(savedDraft.savedAt)}`;
    openComposer('쓰던 메일'); // 쓰다 만 메일이 있으면 이어서
  }
  $('#mcAttach').onchange = (e) => {
    composeAttachments = [...composeAttachments, ...Array.from(e.target.files || [])];
    e.target.value = '';
    renderAttachList();
  };
  $('#mcSendBtn').onclick = sendComposedMail;
  if (connected) {
    await loadMailList();
  } else {
    $('#mcState').textContent = '메일 로그인을 저장하면 취재 관련 받은메일을 불러옵니다.';
    $('#mcState').style.color = 'var(--dim)';
  }

  let mailDraftTimer = null;
  function composeSnapshot() {
    return {
      to: $('#mcTo').value,
      cc: $('#mcCc').value,
      bcc: $('#mcBcc').value,
      subject: $('#mcSubject').value,
      body: $('#mcBody').value,
      savedAt: new Date().toISOString(),
    };
  }
  function scheduleMailDraftSave() {
    $('#mcDraftState').textContent = '저장 중…';
    clearTimeout(mailDraftTimer);
    mailDraftTimer = setTimeout(saveMailDraft, 900);
  }
  async function saveMailDraft() {
    try {
      const draft = composeSnapshot();
      if (!draft.to && !draft.cc && !draft.bcc && !draft.subject && !draft.body) {
        await api.settingsSet(mailDraftKey, '');
        $('#mcDraftState').textContent = '임시저장 대기';
        return;
      }
      await api.settingsSet(mailDraftKey, JSON.stringify(draft));
      $('#mcDraftState').textContent = `자동저장 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      $('#mcDraftState').textContent = '자동저장 실패';
    }
  }

  async function generateMailDraftInMailbox() {
    if (!state.projectId) {
      $('#mcSendState').textContent = '프로젝트를 먼저 선택하세요.';
      $('#mcSendState').style.color = 'var(--red)';
      return;
    }
    // Electron은 window.prompt()를 지원하지 않으므로 인라인 안내로 대체
    const recipient = $('#mcTo').value.trim();
    if (!recipient) {
      $('#mcSendState').textContent = '받는 사람을 먼저 입력하면 AI가 초안을 씁니다.';
      $('#mcSendState').style.color = 'var(--red)';
      $('#mcTo').focus();
      return;
    }
    const purpose = $('#mcSubject').value.trim();
    if (!purpose) {
      $('#mcSendState').textContent = '제목 칸에 메일 목적을 먼저 적으면 AI가 초안을 씁니다.';
      $('#mcSendState').style.color = 'var(--red)';
      $('#mcSubject').focus();
      return;
    }
    const btn = $('#mcAiDraftBtn');
    setBusy(btn, true);
    try {
      const { email } = await api.aiEmail(state.projectId, { recipient, purpose, external: false });
      $('#mcTo').value = recipient.includes('@') ? recipient : $('#mcTo').value;
      $('#mcSubject').value = email.subject || '';
      $('#mcBody').value = email.body || '';
      scheduleMailDraftSave();
      setSave('메일 초안 생성됨', true);
    } catch (error) {
      $('#mcSendState').textContent = error.message || String(error);
      $('#mcSendState').style.color = 'var(--red)';
    } finally {
      setBusy(btn, false);
    }
  }

  async function saveLoginOnly() {
    const st = $('#mcLoginState');
    st.textContent = '로그인 정보를 저장하는 중…';
    st.style.color = 'var(--dim)';
    try {
      const pass = $('#mcLoginPass').value;
      if (!pass && !(await api.hasSmtpPass?.())) throw new Error('비밀번호를 입력하세요.');
      const user = await saveDgistMailAccount($('#mcLoginUser').value, pass);
      $('#mcLoginUser').value = user;
      $('#mcLoginPass').value = '';
      $('#mcLoginPass').placeholder = '저장됨 — 변경할 때만 입력';
      setAccountChip(user, true);
      st.textContent = `✓ ${user} 계정을 저장했습니다.`;
      st.style.color = 'var(--green)';
      setSave('DGIST 메일 로그인 저장됨', true);
    } catch (e) {
      st.textContent = '✗ ' + (e.message || e);
      st.style.color = 'var(--red)';
    }
  }

  async function saveAndTestLogin() {
    const st = $('#mcLoginState');
    const btn = $('#mcLoginTestBtn');
    st.textContent = '로그인 저장 후 IMAP/SMTP 연결을 확인하는 중…';
    st.style.color = 'var(--dim)';
    setBusy(btn, true);
    try {
      const pass = $('#mcLoginPass').value;
      if (!pass && !(await api.hasSmtpPass?.())) throw new Error('비밀번호를 입력하세요.');
      const user = await saveDgistMailAccount($('#mcLoginUser').value, pass);
      $('#mcLoginUser').value = user;
      $('#mcLoginPass').value = '';
      $('#mcLoginPass').placeholder = '저장됨 — 변경할 때만 입력';
      const [imap, smtp] = await Promise.all([api.mailImapVerify(), api.mailVerify()]);
      if (!imap.ok) throw new Error(imap.error || 'IMAP 연결 실패');
      if (!smtp.ok) throw new Error(smtp.error || 'SMTP 연결 실패');
      setAccountChip(user, true);
      st.textContent = `✓ ${user} 로그인 성공 — 받기(IMAP)·보내기(SMTP) 모두 확인되었습니다.`;
      st.style.color = 'var(--green)';
      setSave('DGIST 메일 연결 확인됨', true);
      setTimeout(() => { $('#mcLoginCard').hidden = true; }, 1500);
      await loadMailList();
    } catch (e) {
      st.textContent = '✗ ' + (e.message || e);
      st.style.color = 'var(--red)';
    } finally {
      setBusy(btn, false);
    }
  }

  async function loadMailList() {
    const st = $('#mcState');
    const list = $('#mcList');
    const btn = $('#mcRefreshBtn');
    list.innerHTML = '';
    st.textContent = '메일을 불러오는 중…';
    st.style.color = 'var(--dim)';
    setBusy(btn, true);
    try {
      const res = await api.mailInboxList({ limit: 20, filter: currentFilter });
      renderMailList(res.messages || []);
      st.textContent = `✓ ${(res.messages || []).length}건 표시`;
      st.style.color = 'var(--green)';
    } catch (e) {
      st.textContent = '✗ ' + (e.message || e);
      st.style.color = 'var(--red)';
    } finally {
      setBusy(btn, false);
    }
  }

  function renderMailList(messages) {
    const list = $('#mcList');
    const preview = $('#mcPreview');
    selectedMail = null;
    list.innerHTML = '';
    preview.innerHTML = '<span class="hint">메일을 선택하면 본문이 표시됩니다.</span>';
    if (!messages.length) {
      list.innerHTML = '<div class="mail-empty">조건에 맞는 메일이 없습니다.</div>';
      return;
    }
    for (const m of messages) {
      const kind = mailKind(m);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mail-row' + (m.seen ? '' : ' unread');
      btn.innerHTML = `
        <span class="mail-row-top"><span class="mail-subject">${esc(m.subject || '(제목 없음)')}</span><em>${esc(kind)}</em></span>
        <span class="mail-meta">${esc(m.from || '(보낸 사람 없음)')}</span>
        <span class="mail-meta">${esc(formatMailDate(m.date))}</span>`;
      btn.onclick = () => readMail(m.uid, btn);
      list.appendChild(btn);
    }
  }

  function mailKind(message) {
    const text = `${message.subject || ''} ${message.from || ''}`.toLowerCase();
    if (/undeliver|returned|delivery status|반송|전송 실패/.test(text)) return '반송';
    if (/^re:|회신|답변|reply/.test(text)) return '회신';
    if (/인터뷰|취재|질문|요청|서면/.test(text)) return '취재';
    return '일반';
  }

  async function readMail(uid, rowEl) {
    for (const el of document.querySelectorAll('.mail-row')) el.classList.remove('selected');
    rowEl?.classList.add('selected');
    const preview = $('#mcPreview');
    preview.innerHTML = '<span class="hint">메일 본문을 불러오는 중…</span>';
    try {
      selectedMail = await api.mailInboxRead(uid);
      preview.innerHTML = `
        <div class="mail-read-head">
          <b>${esc(selectedMail.subject || '(제목 없음)')}</b>
          <span>${esc(selectedMail.from || '')}</span>
          <small>${esc(formatMailDate(selectedMail.date))}</small>
        </div>
        <pre class="mail-read-body"></pre>
        <div id="mcReadAttachments" class="attach-list"></div>
        <div class="toolrow compact">
          <button id="mcReplyBtn" class="btn small">${ic('reply')} 회신 작성</button>
          <button id="mcSaveMatBtn" class="btn small">${ic('save')} 현재 프로젝트 자료로</button>
        </div>`;
      preview.querySelector('.mail-read-body').textContent = selectedMail.text || '(텍스트 본문 없음)';
      renderReadAttachments(selectedMail.attachments || []);
      $('#mcReplyBtn').onclick = fillReply;
      $('#mcSaveMatBtn').onclick = saveSelectedMailAsMaterial;
      $('#mcSaveMatBtn').disabled = !state.projectId;
    } catch (e) {
      preview.innerHTML = `<div class="note alert"><span class="lab">메일 읽기</span><span>${esc(e.message || e)}</span></div>`;
    }
  }

  function renderReadAttachments(items) {
    const box = $('#mcReadAttachments');
    if (!box) return;
    box.innerHTML = '';
    if (!items.length) return;
    const title = document.createElement('span');
    title.className = 'attach-chip muted';
    title.textContent = `받은 첨부 ${items.length}개`;
    box.appendChild(title);
    for (const item of items) {
      const chip = document.createElement('span');
      chip.className = 'attach-chip';
      chip.textContent = `${item.filename || '(이름 없음)'} · ${formatBytes(item.size || 0)}`;
      box.appendChild(chip);
    }
  }

  function fillReply() {
    if (!selectedMail) return;
    $('#mcTo').value = extractEmail(selectedMail.from);
    $('#mcSubject').value = /^re:/i.test(selectedMail.subject || '') ? selectedMail.subject : `Re: ${selectedMail.subject || ''}`;
    $('#mcBody').value = `\n\n--- 원문 ---\n보낸 사람: ${selectedMail.from || ''}\n날짜: ${formatMailDate(selectedMail.date)}\n\n${selectedMail.text || ''}`;
    openComposer(`회신 — ${extractEmail(selectedMail.from)}`);
    $('#mcBody').focus();
    $('#mcBody').setSelectionRange(0, 0);
    scheduleMailDraftSave();
  }

  async function saveSelectedMailAsMaterial() {
    if (!selectedMail || !state.projectId) return;
    try {
      await api.materialAdd({
        projectId: state.projectId,
        kind: 'note',
        title: selectedMail.subject || '받은메일',
        content: selectedMail.text || '',
        source: `DGIST 메일 · ${selectedMail.from || '보낸 사람 없음'} · ${formatMailDate(selectedMail.date)}`,
      });
      renderMaterials();
      setSave('메일을 현재 프로젝트 자료로 저장했습니다', true);
    } catch (e) {
      $('#mcState').textContent = '✗ ' + (e.message || e);
      $('#mcState').style.color = 'var(--red)';
    }
  }

  function renderAttachList() {
    const list = $('#mcAttachList');
    list.innerHTML = '';
    if (!composeAttachments.length) return;
    composeAttachments.forEach((file, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'attach-chip removable';
      chip.textContent = `${file.name} · ${formatBytes(file.size)} ×`;
      chip.onclick = () => {
        composeAttachments.splice(idx, 1);
        renderAttachList();
      };
      list.appendChild(chip);
    });
  }

  let sendConfirmTimer = null;
  async function sendComposedMail() {
    const st = $('#mcSendState');
    const btn = $('#mcSendBtn');
    const to = $('#mcTo').value.trim();
    if (!/.+@.+\..+/.test(to)) {
      st.textContent = '받는 사람 이메일 주소를 입력하세요.';
      st.style.color = 'var(--red)';
      $('#mcTo').focus();
      return;
    }
    const subject = $('#mcSubject').value.trim();
    // 2단계 확인: 첫 클릭은 확인 모드로 전환, 5초 안에 다시 누르면 발송
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.innerHTML = `${ic('send')} 한 번 더 누르면 발송`;
      st.textContent = `${to}에게 "${subject || '(제목 없음)'}" · 첨부 ${composeAttachments.length}개`;
      st.style.color = 'var(--dim)';
      clearTimeout(sendConfirmTimer);
      sendConfirmTimer = setTimeout(() => {
        btn.classList.remove('confirm');
        btn.innerHTML = `${ic('send')} 보내기`;
        st.textContent = '';
      }, 5000);
      return;
    }
    clearTimeout(sendConfirmTimer);
    btn.classList.remove('confirm');
    btn.innerHTML = `${ic('send')} 보내기`;
    setBusy(btn, true);
    st.textContent = '발송 중…';
    st.style.color = 'var(--dim)';
    try {
      const attachments = await Promise.all(composeAttachments.map(async (file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        buffer: await file.arrayBuffer(),
      })));
      const res = await api.mailSend({
        to,
        cc: $('#mcCc').value.trim(),
        bcc: $('#mcBcc').value.trim(),
        subject,
        body: $('#mcBody').value,
        attachments,
      });
      st.textContent = `✓ 발송됨 → ${(res.accepted || [to]).join(', ')}${res.used ? ` (${res.used.host}:${res.used.port})` : ''}`;
      st.style.color = 'var(--green)';
      composeAttachments = [];
      renderAttachList();
      ['mcTo', 'mcCc', 'mcBcc', 'mcSubject', 'mcBody'].forEach((id) => { $(`#${id}`).value = ''; });
      await api.settingsSet(mailDraftKey, '');
      $('#mcDraftState').textContent = '발송됨';
      setSave('메일 발송 완료', true);
      contactsCache = null; // 방금 보낸 주소가 주소록에 반영되도록
      setTimeout(closeComposer, 1600);
    } catch (e) {
      st.textContent = '✗ ' + (e.message || e);
      st.style.color = 'var(--red)';
    } finally {
      setBusy(btn, false);
    }
  }
}

function extractEmail(text) {
  const m = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : String(text || '').trim();
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

function formatMailDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

// ---------- 단계 3: 자료 수집 ----------
async function renderCollectStage(el) {
  el.innerHTML = `
    <h1>관련 자료 수집</h1>
    <p class="sub">URL·파일(docx/pdf/txt)에서 본문을 자동 추출합니다 — 출처는 필수.</p>
    <div class="cardplan">
      <div class="card-item" style="border-color:#CBD9F2; background:var(--navy-soft)">
        <h4>🔎 AI 추천 자료 <span class="hint">키워드·기획안·이미 모은 자료를 보고 "더 찾아야 할 것"을 제안합니다</span></h4>
        <button id="colSuggestBtn" class="btn primary" style="margin-top:6px">${ic('search')} 추천 받기</button>
        <div id="colSuggestions" style="margin-top:10px"></div>
      </div>
      <div class="card-item">
        <h4>URL 기사 추가</h4>
        <input id="colUrl" placeholder="https://…">
        <button id="colUrlBtn" class="btn" style="margin-top:8px">추출 후 저장</button>
      </div>
      <div class="card-item intake-card">
        <h4>파일 가져오기</h4>
        <div id="colDropZone" class="file-drop-zone" tabindex="0">
          <span class="file-drop-icon">${ic('folder')}</span>
          <b>파일을 여기에 놓으세요</b>
          <small>문서·표·프레젠테이션·사진·음성·영상·기타 파일을 한 번에 자동 분류합니다.</small>
          <div class="file-drop-actions">
            <label class="btn small">${ic('plus')} 로컬 선택<input type="file" id="colFile" multiple hidden></label>
            <button id="colDriveFileBtn" class="btn small ghost" type="button">${ic('folder')} Drive에서 받기</button>
          </div>
        </div>
        <input id="colFileSource" placeholder="출처 메모 (비워 두면 파일 위치를 임시 출처로 기록)">
        <label class="drive-save-option"><input id="colSaveDrive" type="checkbox"> 로컬 파일을 Drive에도 보관</label>
        <div id="colFileQueue" class="file-intake-queue"></div>
      </div>
      <div class="card-item">
        <h4>${ic('mic')} 인터뷰 녹음 받아쓰기 <span class="hint">오디오 → 텍스트 (기기 내 처리, 취재원 보호)</span></h4>
        <input type="file" id="colAudio" accept="audio/*,.m4a,.mp3,.wav,.ogg">
        <input id="colAudioSource" placeholder="출처 (필수 — 예: ○○ 인터뷰 6.28)">
        <button id="colAudioBtn" class="btn" style="margin-top:8px">${ic('mic')} 받아쓰기 → 녹취로 저장</button>
        <div id="colAudioState" class="hint" style="margin-top:6px"></div>
      </div>
    </div>
    <div id="colNotes"></div>
  `;
  const prevSuggestions = await api.outputLatest(state.projectId, 'collect').catch(() => null);
  if (prevSuggestions) {
    try {
      const saved = JSON.parse(prevSuggestions.content);
      renderMaterialSuggestions(saved.suggestions || []);
    } catch { /* ignore */ }
  }

  async function runMaterialSuggestions(auto = false) {
    const btn = $('#colSuggestBtn');
    setBusy(btn, true);
    try {
      const { suggestions, recordId } = await api.aiSuggestMaterials(state.projectId);
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      renderFeedback();
      renderMaterialSuggestions(suggestions || []);
      const content = JSON.stringify({ suggestions: suggestions || [], generatedAt: new Date().toISOString() }, null, 2);
      await api.outputSave({ projectId: state.projectId, stage: 'collect', content });
      if (recordId) await api.recordFinalize(recordId, content);
      if (auto) setSave('자료 추천 자동 실행됨', true);
    } catch (e) {
      note('#colNotes', auto ? 'warn' : 'alert', auto ? '자동 추천 보류' : 'AI 추천 실패', e.message || String(e));
    }
    finally { setBusy(btn, false); }
  }

  function renderMaterialSuggestions(suggestions) {
    const box = $('#colSuggestions');
    box.innerHTML = '';
    if (!suggestions.length) { box.textContent = '추천할 자료가 없습니다 — 이미 충분히 모였습니다.'; return; }
    for (const sg of suggestions) {
      const d = document.createElement('div');
      d.className = 'm';
      d.style.background = 'var(--card)';
      d.innerHTML = `
        <span class="t"></span>
        <span class="s"><b>왜:</b> <span class="sg-why"></span></span>
        <span class="s"><b>어디서:</b> <span class="sg-where"></span></span>
        <div style="display:flex; gap:6px; margin-top:6px">
          <button class="btn small sg-search">웹 검색</button>
          <button class="btn small ghost sg-todo">체크리스트 메모로 저장</button>
        </div>`;
      d.querySelector('.t').textContent = sg.title;
      d.querySelector('.sg-why').textContent = sg.why || '';
      d.querySelector('.sg-where').textContent = sg.where || '';
      d.querySelector('.sg-search').onclick = () =>
        api.openExternal('https://www.google.com/search?q=' + encodeURIComponent(sg.query || sg.title));
      d.querySelector('.sg-todo').onclick = async () => {
        await api.materialAdd({
          projectId: state.projectId, kind: 'note',
          title: `[찾을 것] ${sg.title}`,
          content: `왜: ${sg.why}\n어디서: ${sg.where}\n검색어: ${sg.query || ''}`,
          source: 'AI 추천 — 자료 확보 후 실제 출처로 교체할 것',
        });
        d.querySelector('.sg-todo').textContent = '저장됨 ✓';
        d.querySelector('.sg-todo').disabled = true;
        renderMaterials();
      };
      box.appendChild(d);
    }
  }

  $('#colSuggestBtn').onclick = () => runMaterialSuggestions(false);
  const collectAutoKey = `collect:${state.projectId}`;
  if (!prevSuggestions && !state.autoRuns.has(collectAutoKey)) {
    state.autoRuns.add(collectAutoKey);
    setTimeout(() => runMaterialSuggestions(true), 120);
  };
  // 받아쓰기 엔진 상태 표시 + 원클릭 자동 설치
  async function refreshWhisperState() {
    if (!api.transcribeDiagnose) return;
    try {
      const d = await api.transcribeDiagnose();
      const el = $('#colAudioState');
      if (!el) return;
      if (d.whisperBin && d.whisperModel) {
        el.textContent = `엔진 준비됨 · 모델 ${d.whisperModel.split(/[\\/]/).pop()}`;
        return;
      }
      el.innerHTML = '';
      const span = document.createElement('span');
      span.textContent = '⚠ 받아쓰기 엔진 미설정 — ';
      const btn = document.createElement('button');
      btn.className = 'btn small primary';
      btn.textContent = '자동 설치 (엔진 + 한국어 모델 약 470MB)';
      btn.onclick = async () => {
        setBusy(btn, true);
        const off = api.onTranscribeSetupEvent?.((p) => {
          const mb = (n) => (n / 1024 / 1024).toFixed(0);
          if (p.stage === 'model' || p.stage === 'binary') {
            el.textContent = `${p.stage === 'model' ? '한국어 모델' : '엔진'} 다운로드 중… ${p.total ? `${mb(p.transferred)}MB / ${mb(p.total)}MB (${p.percent}%)` : (p.message || '')}`;
          } else if (p.message) {
            el.textContent = p.message;
          }
        });
        try {
          await api.transcribeSetup({ model: 'small' });
          note('#colNotes', 'ok', '받아쓰기 준비 완료', '엔진과 한국어 모델이 설치되었습니다. 이제 음성 파일을 올리면 바로 받아씁니다.');
        } catch (e) {
          note('#colNotes', 'alert', '자동 설치 실패', (e.message || String(e)) + '\n네트워크를 확인하거나, 설정에서 whisper 경로를 직접 지정할 수도 있습니다.');
        } finally {
          off?.();
          setBusy(btn, false);
          refreshWhisperState();
        }
      };
      span.appendChild(btn);
      el.appendChild(span);
    } catch { /* 무시 */ }
  }
  refreshWhisperState();

  $('#colAudioBtn').onclick = async () => {
    const f = $('#colAudio').files[0];
    if (!f) return note('#colNotes', 'alert', '파일 없음', '오디오 파일을 선택하세요.');
    const source = $('#colAudioSource').value.trim();
    if (!source) return note('#colNotes', 'alert', '출처 필수', '출처 없는 자료는 저장할 수 없습니다.');
    const btn = $('#colAudioBtn');
    setBusy(btn, true);
    $('#colAudioState').textContent = '받아쓰는 중… (녹음 길이에 따라 몇 분 걸릴 수 있습니다)';
    try {
      const buf = await f.arrayBuffer();
      const { text, model } = await api.transcribeAudio(f.name, buf);
      await api.materialAdd({
        projectId: state.projectId, kind: 'transcript',
        title: `녹취 — ${f.name}`, content: text, source,
        meta: { transcribedBy: model || 'whisper', audioFile: f.name },
      });
      note('#colNotes', 'ok', '받아쓰기 완료', `${f.name} → ${text.length.toLocaleString()}자 (인터뷰 녹취로 저장됨 — 기사 초안 인용 검증에 사용됩니다)`);
      $('#colAudioState').textContent = '';
      renderMaterials();
    } catch (e) {
      note('#colNotes', 'alert', '받아쓰기 실패', e.message || String(e));
      $('#colAudioState').textContent = '';
    } finally { setBusy(btn, false); }
  };

  $('#colUrlBtn').onclick = async () => {
    const url = $('#colUrl').value.trim();
    if (!url) return;
    const btn = $('#colUrlBtn');
    setBusy(btn, true);
    try {
      const art = await api.extractUrl(url);
      await api.materialAdd({
        projectId: state.projectId, kind: 'url',
        title: art.title,
        content: art.text,
        source: `${art.site}${art.author ? ' · ' + art.author : ''}${art.date ? ' · ' + art.date.slice(0, 10) : ''}`,
        meta: { url: art.url, author: art.author, date: art.date },
      });
      note('#colNotes', 'ok', '저장됨', `${art.title}\n출처: ${art.site} ${art.author || ''} ${art.date || ''}`);
      $('#colUrl').value = '';
      renderMaterials();
    } catch (e) { note('#colNotes', 'alert', 'URL 추출 실패', e.message || String(e)); }
    finally { setBusy(btn, false); }
  };
  const dropZone = $('#colDropZone');
  const fileQueue = $('#colFileQueue');
  const sourceFor = (file, origin) => {
    const written = $('#colFileSource').value.trim();
    return written || `${origin} · ${file.name} (출처 보완 필요)`;
  };
  const queueRow = (file, origin) => {
    const row = document.createElement('div');
    row.className = 'file-intake-row is-working';
    row.innerHTML = `<span class="file-intake-mark">${ic('folder')}</span><span><b></b><small></small></span><em>분류 중</em>`;
    row.querySelector('b').textContent = file.name;
    row.querySelector('small').textContent = `${origin} · ${formatBytes(file.size)}`;
    fileQueue.prepend(row);
    return row;
  };
  const finishQueueRow = (row, result, failed = false) => {
    row.className = `file-intake-row ${failed ? 'is-failed' : 'is-done'}`;
    row.querySelector('em').textContent = failed ? '실패' : result.kind;
    if (result.detail) row.querySelector('small').textContent = result.detail;
  };

  async function processIncomingFiles(files, origin = '로컬 파일') {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    for (const file of incoming) {
      const row = queueRow(file, origin);
      try {
        const buffer = await file.arrayBuffer();
        const stored = await api.fileStoreLocal({
          projectId: state.projectId,
          name: file.name,
          arrayBuffer: buffer,
        });
        let driveFile = file.driveFile || null;
        if (origin !== 'Google Drive' && $('#colSaveDrive').checked) {
          driveFile = await api.driveUploadFile({
            name: file.name,
            arrayBuffer: buffer,
            mimeType: file.type || '',
          });
        }
        const result = await saveAnyFileAsMaterial(file, sourceFor(file, origin), {
          buffer,
          origin,
          stored,
          driveFile,
        });
        finishQueueRow(row, result);
      } catch (error) {
        finishQueueRow(row, { kind: '실패', detail: error.message || String(error) }, true);
        note('#colNotes', 'alert', `${file.name} 처리 실패`, error.message || String(error));
      }
    }
    $('#colFile').value = '';
    renderMaterials();
  }

  $('#colFile').onchange = (event) => processIncomingFiles(event.target.files, '로컬 파일');
  $('#colDriveFileBtn').onclick = async () => {
    try {
      const selected = await pickDriveFiles();
      if (!selected.length) return;
      const downloaded = [];
      for (const meta of selected) {
        const file = await api.driveDownloadFile(meta.id, { asDataUrl: false });
        downloaded.push({
          name: file.name,
          type: file.mimeType || '',
          size: Number(file.size || file.arrayBuffer?.byteLength || 0),
          driveFile: { id: file.id, name: file.name, webViewLink: file.webViewLink || '' },
          arrayBuffer: async () => file.arrayBuffer || dataUrlToArrayBuffer(file.dataUrl),
        });
      }
      await processIncomingFiles(downloaded, 'Google Drive');
    } catch (error) {
      note('#colNotes', 'alert', 'Drive 가져오기 실패', error.message || String(error));
    }
  };
  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove('is-dragging');
    });
  }
  dropZone.addEventListener('drop', (event) => processIncomingFiles(event.dataTransfer?.files, '로컬 파일'));
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      $('#colFile').click();
    }
  });

  // 모든 원본은 앱 데이터 폴더에 보관하고, 내용에 따라 문서·녹취·사진·첨부 자료로 자동 분류한다.
  async function saveAnyFileAsMaterial(f, source, context = {}) {
    const buf = context.buffer || await f.arrayBuffer();
    const meta = {
      fileName: f.name,
      mimeType: f.type || '',
      origin: context.origin || '로컬 파일',
      localPath: context.stored?.path || '',
      driveFileId: context.driveFile?.id || '',
      driveWebViewLink: context.driveFile?.webViewLink || '',
      sourceNeedsReview: /출처 보완 필요/.test(source),
    };
    try {
      const text = await api.extractFile(f.name, buf);
      await api.materialAdd({ projectId: state.projectId, kind: 'file', title: f.name, content: text, source, meta });
      note('#colNotes', 'ok', '저장됨', `${f.name} (${text.length.toLocaleString()}자 추출)`);
      return { kind: '문서', detail: `${formatBytes(buf.byteLength)} · 텍스트 ${text.length.toLocaleString()}자` };
    } catch (e) {
      const code = String(e.message || e);
      if (/오디오\/영상/.test(code)) {
        note('#colNotes', 'ai', '받아쓰기 시작', `${f.name} — 음성 파일이라 whisper 받아쓰기로 처리합니다.`);
        try {
          const { text, model } = await api.transcribeAudio(f.name, buf);
          await api.materialAdd({
            projectId: state.projectId, kind: 'transcript',
            title: `녹취 — ${f.name}`, content: text, source,
            meta: { ...meta, transcribedBy: model || 'whisper', audioFile: f.name },
          });
          note('#colNotes', 'ok', '받아쓰기 완료', `${f.name} → ${text.length.toLocaleString()}자 (인터뷰 녹취로 저장)`);
          return { kind: '녹취', detail: `${formatBytes(buf.byteLength)} · 텍스트 ${text.length.toLocaleString()}자` };
        } catch (te) {
          await api.materialAdd({
            projectId: state.projectId,
            kind: 'note',
            title: `미디어 — ${f.name}`,
            content: `(원본 파일 보관됨: ${context.stored?.path || f.name})\n받아쓰기 보류: ${te.message || te}`,
            source,
            meta: { ...meta, transcriptionPending: true },
          });
          note('#colNotes', 'warn', '미디어 보관됨', `${f.name} — 원본은 보관했고 받아쓰기는 나중에 다시 실행할 수 있습니다.`);
          return { kind: '미디어', detail: `${formatBytes(buf.byteLength)} · 받아쓰기 보류` };
        }
      }
      if (/이미지 파일/.test(code)) {
        await api.materialAdd({
          projectId: state.projectId, kind: 'note',
          title: `사진 — ${f.name}`,
          content: `(사진 원본: ${context.stored?.path || f.name}, ${formatBytes(buf.byteLength)})\n촬영자·캡션·사용 권한을 확인하세요.`,
          source, meta,
        });
        note('#colNotes', 'ok', '사진 자료로 기록', `${f.name} — 설명 메모가 자료 목록에 추가되었습니다.`);
        return { kind: '사진', detail: `${formatBytes(buf.byteLength)} · 원본 보관됨` };
      }
      await api.materialAdd({
        projectId: state.projectId, kind: 'note',
        title: `파일 — ${f.name}`,
        content: `(원본 파일 보관됨: ${context.stored?.path || f.name}, ${formatBytes(buf.byteLength)})\n${e.message || e}`,
        source, meta,
      });
      note('#colNotes', 'warn', '첨부 자료로 기록', `${f.name} — 원본을 보관하고 첨부 자료로 분류했습니다.`);
      return { kind: '첨부', detail: `${formatBytes(buf.byteLength)} · 원본 보관됨` };
    }
  }
}

// ---------- 단계 4: 분석·제언 ----------
async function renderAnalyzeStage(el) {
  el.innerHTML = `
    <h1>자료 분석 및 제언</h1>
    <p class="sub">화면에 들어오면 수집 자료를 자동으로 읽고 타임라인 · 상충 주장 · 팩트체크 · 부족한 것을 정리합니다.</p>
    <div class="toolrow">
      <button id="anGenBtn" class="btn primary">${ic('spark')} AI 분석 다시 실행</button>
      <button id="anSaveBtn" class="btn" disabled>${ic('save')} 리포트 저장</button>
    </div>
    <div id="anNotes"></div>
    <div id="anResult" class="cardplan"></div>
  `;
  const prev = await api.outputLatest(state.projectId, 'analyze');
  if (prev) { try { renderReport(JSON.parse(prev.content)); $('#anSaveBtn').disabled = true; } catch { /* 무시 */ } }

  let current = null;
  async function saveCurrentReport() {
    if (!current) return;
    const content = JSON.stringify(current, null, 2);
    await api.outputSave({ projectId: state.projectId, stage: 'analyze', content });
    if (state.currentRecordId) await api.recordFinalize(state.currentRecordId, content);
    setSave('분석 리포트 저장됨', true);
    $('#anSaveBtn').disabled = true;
  }

  async function runAnalysis(auto = false) {
    const btn = $('#anGenBtn');
    setBusy(btn, true);
    try {
      const { report, recordId } = await api.aiAnalyze(state.projectId);
      current = report;
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      renderReport(report);
      renderFeedback();
      $('#anSaveBtn').disabled = false;
      if (auto) await saveCurrentReport();
    } catch (e) { note('#anNotes', auto ? 'warn' : 'alert', auto ? '자동 분석 보류' : '분석 오류', e.message || String(e)); }
    finally { setBusy(btn, false); }
  }

  $('#anGenBtn').onclick = () => runAnalysis(false);
  $('#anSaveBtn').onclick = saveCurrentReport;
  const mats = await api.materialList(state.projectId).catch(() => []);
  const analyzeAutoKey = `analyze:${state.projectId}`;
  if (!prev && mats.length && !state.autoRuns.has(analyzeAutoKey)) {
    state.autoRuns.add(analyzeAutoKey);
    setTimeout(() => runAnalysis(true), 120);
  } else if (!prev && !mats.length) {
    note('#anNotes', 'warn', '자료 필요', '분석할 수집 자료가 없습니다. 자료 수집 단계에서 URL, 파일, 녹취, 메일 회신을 먼저 추가하세요.');
  }

  function renderReport(r) {
    const area = $('#anResult');
    area.innerHTML = '';
    const card = (title, html) => {
      const d = document.createElement('div');
      d.className = 'card-item';
      d.innerHTML = `<h4>${title}</h4>${html}`;
      area.appendChild(d);
    };
    if (r.timeline?.length) card('핵심 사실 타임라인', '<p>' + r.timeline.map((t) => `<b>${esc(t.date)}</b> — ${esc(t.event)} <span class="hint">[자료 ${esc(String(t.sourceIdx ?? '?'))}]</span>`).join('<br>') + '</p>');
    if (r.conflicts?.length) card('⚠ 상충되는 주장', '<p>' + r.conflicts.map((c) => `<b>${esc(c.topic)}</b><br>A: ${esc(c.positionA)}<br>B: ${esc(c.positionB)}`).join('<br><br>') + '</p>');
    if (r.factcheck?.length) card('팩트체크 리스트', '<p>' + r.factcheck.map((f) => `☐ ${esc(f)}`).join('<br>') + '</p>');
    if (r.stats?.length) card('수치 데이터', '<p>' + r.stats.map((sd) => `${esc(sd.label)}: <b>${esc(String(sd.value))}</b> <span class="hint">[자료 ${esc(String(sd.sourceIdx ?? '?'))}]</span>`).join('<br>') + '</p>');
    if (r.gaps?.length) {
      const d = document.createElement('div');
      d.className = 'note alert';
      d.innerHTML = `<span class="lab">이 기사에 부족한 것</span><span>${r.gaps.map(esc).join('<br>')}</span>`;
      area.appendChild(d);
    }
  }
}

// 초안 텍스트 → 미리보기 HTML (첫 줄=제목, ---확인 필요--- 섹션, 인용 하이라이트)
function buildDraftPreviewHtml(text, quoteResults) {
  const lines = String(text).replace(/\r\n/g, '\n').trim().split('\n');
  const title = lines.shift() || '';
  const rest = lines.join('\n').trim();
  const [bodyPart, todoPart] = rest.split(/-{2,}\s*확인 필요\s*-{2,}/);

  const statusByQuote = new Map();
  for (const q of quoteResults) {
    if (q.verdict) statusByQuote.set(q.text, q.verdict.status);
  }
  const highlight = (escapedPara, rawPara) => {
    let out = escapedPara;
    for (const [qText, status] of statusByQuote) {
      if (!rawPara.includes(qText)) continue;
      for (const [open, close] of [['“', '”'], ['"', '"']]) {
        const target = esc(open + qText + close);
        if (out.includes(target)) {
          out = out.split(target).join(`<span class="q-${status}" title="인용 검증: ${status}">${target}</span>`);
        }
      }
    }
    return out;
  };

  const paras = (bodyPart || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const todos = (todoPart || '').split('\n').map((t) => t.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
  return [
    `<h2>${esc(title)}</h2>`,
    `<div class="byline">디지스트신문 DNA · 초안 미리보기 <span class="hint">(docx 내보내기와 동일 구성 · <span class="q-exact">초록=검증됨</span> <span class="q-fuzzy">노랑=원문과 다름</span> <span class="q-missing">빨강=근거 없음</span>)</span></div>`,
    ...paras.map((p) => `<p>${highlight(esc(p), p)}</p>`),
    todos.length ? `<div class="todo">※ 확인 필요<br>${todos.map((t) => '· ' + esc(t)).join('<br>')}</div>` : '',
  ].join('');
}

// 편집창 backdrop용: 원문 텍스트를 그대로 두되 직접인용만 검증색 <mark>로 감싼다.
// textarea와 글자 위치가 1:1로 맞아야 하므로 텍스트 외 문자를 추가/삭제하지 않는다.
function buildHighlightHtml(text, quoteResults) {
  const statusByQuote = new Map();
  for (const q of quoteResults) if (q.verdict) statusByQuote.set(q.text, q.verdict.status);
  // 직접인용 위치를 찾아 마킹 (곡선/직선 큰따옴표 포함)
  const marks = [];
  const re = /[“"]([^”"]+)[”"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1];
    const status = statusByQuote.get(inner);
    if (status) marks.push({ start: m.index, end: m.index + m[0].length, status });
  }
  marks.sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const mk of marks) {
    out += esc(text.slice(pos, mk.start));
    out += `<mark class="hl-${mk.status}">${esc(text.slice(mk.start, mk.end))}</mark>`;
    pos = mk.end;
  }
  out += esc(text.slice(pos));
  return out + '\n'; // 마지막 줄 높이 보정
}

// HTML 이스케이프 (AI/사용자 텍스트를 innerHTML 조각에 넣을 때 필수)
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renderDraftStage(el) {
  el.innerHTML = `
    <h1>기사 초안</h1>
    <p class="sub">근거, 직접인용, 미확인 항목을 출고 전에 점검합니다.</p>
    <div class="toolrow">
      <button id="genBtn" class="btn primary">${ic('spark')} AI 초안 생성</button>
      <button id="checkBtn" class="btn">인용·따옴표 검사</button>
      <button id="previewBtn" class="btn">${ic('eye')} 미리보기</button>
      <button id="spellBtn" class="btn">${ic('check')} 맞춤법 검사</button>
      <button id="saveDraftBtn" class="btn">${ic('save')} 최종본 저장</button>
      <button id="docxBtn" class="btn">${ic('download')} docx</button>
      <button id="pdfBtn" class="btn">${ic('download')} PDF</button>
      <button id="verBtn" class="btn ghost">${ic('clock')} 버전</button>
    </div>
    <div id="draftNotes"></div>
    <section id="readinessPanel" class="readiness-panel" aria-live="polite"></section>
    <div id="spellPanel" class="spell-panel" hidden></div>
    <div id="verPanel" class="ver-panel" hidden></div>
    <div class="editor-wrap">
      <div id="draftBackdrop" class="editor-backdrop" aria-hidden="true"></div>
      <textarea id="draftEditor" class="editor" placeholder="AI 초안을 생성하거나 직접 작성하세요. (첫 줄 = 제목)"></textarea>
    </div>
    <div id="draftPreview" class="draft-preview" hidden></div>
    <div class="editor-foot">
      <span id="charCount" class="char-count"></span>
      <span id="autosaveState" class="autosave-state"></span>
    </div>
  `;
  const prev = await api.outputLatest(state.projectId, 'draft');
  if (prev) $('#draftEditor').value = prev.content;

  const editor = $('#draftEditor');
  const backdrop = $('#draftBackdrop');
  updateCharCount();
  editor.addEventListener('input', () => { updateCharCount(); scheduleAutosave(); scheduleHighlight(); scheduleReadiness(); });
  editor.addEventListener('scroll', () => { backdrop.scrollTop = editor.scrollTop; backdrop.scrollLeft = editor.scrollLeft; });

  let readinessTimer = null;
  function scheduleReadiness() {
    clearTimeout(readinessTimer);
    readinessTimer = setTimeout(refreshReadiness, 850);
  }
  async function refreshReadiness() {
    const panel = $('#readinessPanel');
    if (!panel) return null;
    try {
      const report = await api.validateReadiness(editor.value, state.projectId);
      if (!$('#readinessPanel')) return report;
      const labels = { pass: '통과', warn: '확인', block: '해결 필요' };
      panel.className = `readiness-panel ${report.ready ? 'is-ready' : 'has-blockers'}`;
      panel.innerHTML = `
        <header class="readiness-head">
          <div><span>출고 점검</span><b>${report.ready ? '출고 가능' : `${report.blockers.length}건 해결 필요`}</b></div>
          <strong>${report.score}<small>/100</small></strong>
        </header>
        <div class="readiness-checks">
          ${report.checks.map((item) => `
            <div class="readiness-check is-${item.status}">
              <span class="readiness-mark">${item.status === 'pass' ? '✓' : '!'}</span>
              <span><b>${esc(item.label)}</b><small>${esc(item.detail)}</small></span>
              <em>${labels[item.status]}</em>
            </div>`).join('')}
        </div>`;
      return report;
    } catch (error) {
      panel.className = 'readiness-panel has-blockers';
      panel.innerHTML = `<div class="readiness-error">출고 점검을 불러오지 못했습니다. ${esc(error.message || String(error))}</div>`;
      return null;
    }
  }
  refreshReadiness();

  // 인라인 인용 하이라이트 — 편집창 뒤 backdrop에 검증 결과색으로 직접인용을 칠한다.
  let hlTimer = null;
  function scheduleHighlight() { clearTimeout(hlTimer); hlTimer = setTimeout(paintHighlight, 700); }
  async function paintHighlight() {
    const text = editor.value;
    let quotes = [];
    try { quotes = (await api.validateQuotes(text, state.projectId)).quotes || []; } catch { /* 무시 */ }
    backdrop.innerHTML = buildHighlightHtml(text, quotes);
    backdrop.scrollTop = editor.scrollTop;
  }
  paintHighlight();

  // 글자 수 (공백 포함/제외) + 예상 카드 수(380자 기준)
  function updateCharCount() {
    const v = editor.value;
    const withSpace = v.length;
    const noSpace = v.replace(/\s/g, '').length;
    const cards = Math.max(1, Math.ceil(noSpace / 380));
    $('#charCount').textContent = `${withSpace.toLocaleString()}자 · 공백 제외 ${noSpace.toLocaleString()}자 · 카드뉴스 약 ${cards}장`;
  }

  // 디바운스 자동 저장 (2초 무입력 시) — 새 버전으로 저장, 학습 레코드도 갱신
  let autosaveTimer = null;
  function scheduleAutosave() {
    $('#autosaveState').textContent = '수정 중…';
    $('#autosaveState').className = 'autosave-state dirty';
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(doAutosave, 2000);
  }
  async function doAutosave() {
    const text = editor.value;
    if (!text.trim()) return;
    try {
      const { version } = await api.outputSave({ projectId: state.projectId, stage: 'draft', content: text });
      if (state.currentRecordId) await api.recordFinalize(state.currentRecordId, text);
      const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      $('#autosaveState').textContent = `자동 저장됨 v${version} · ${t}`;
      $('#autosaveState').className = 'autosave-state saved';
    } catch (e) {
      $('#autosaveState').textContent = '자동 저장 실패 — 수동 저장하세요';
      $('#autosaveState').className = 'autosave-state fail';
    }
  }
  // 화면 이탈 직전 강제 저장 (미저장 유실 방지)
  draftFlush = () => { clearTimeout(autosaveTimer); if (editor.value.trim() && editor.value !== (prev?.content || '')) doAutosave(); };

  // 버전 이력 패널
  $('#verBtn').onclick = async () => {
    const panel = $('#verPanel');
    if (!panel.hidden) { panel.hidden = true; return; }
    const versions = await api.outputVersions(state.projectId, 'draft');
    panel.innerHTML = '';
    if (!versions.length) { panel.innerHTML = '<div class="ver-empty">저장된 버전이 없습니다. 저장하면 이력이 쌓입니다.</div>'; panel.hidden = false; return; }
    const head = document.createElement('div');
    head.className = 'ver-head';
    head.innerHTML = `<b>버전 이력 ${versions.length}개</b><span class="hint">클릭하면 미리보기 · 복원하면 그 내용이 새 버전으로 저장됩니다</span>`;
    panel.appendChild(head);
    for (const v of versions) {
      const row = document.createElement('div');
      row.className = 'ver-row';
      const t = new Date(v.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      row.innerHTML = `<span class="ver-n">v${v.version}</span><span class="ver-t"></span><span class="ver-c">${(v.chars || 0).toLocaleString()}자</span><button class="btn small ver-restore">이 버전으로</button>`;
      row.querySelector('.ver-t').textContent = t;
      row.querySelector('.ver-restore').onclick = async () => {
        const full = await api.outputGet(v.id);
        if (!full) return;
        editor.value = full.content;
        updateCharCount();
        panel.hidden = true;
        setSave(`v${v.version} 복원됨 — 저장하면 새 버전이 됩니다`, true);
      };
      panel.appendChild(row);
    }
    panel.hidden = false;
  };

  $('#genBtn').onclick = async () => {
    const btn = $('#genBtn');
    setBusy(btn, true);
    try {
      const { text, recordId } = await api.aiDraft(state.projectId);
      editor.value = text;
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      setSave('초안 생성됨 — 검토 후 수정하세요', true);
      renderFeedback();
      updateCharCount();
      paintHighlight();
      refreshReadiness();
      runCheck();
    } catch (e) {
      note('#draftNotes', 'alert', 'AI 오류', e.message || String(e));
      setSave('오류');
    } finally { setBusy(btn, false); }
  };
  $('#checkBtn').onclick = runCheck;

  // 맞춤법 검사 (부산대·나라인포테크 검사기 → 실패 시 로컬 규칙)
  $('#spellBtn').onclick = async () => {
    const btn = $('#spellBtn');
    setBusy(btn, true);
    try {
      const { engine, items, naraError } = await api.spellCheck($('#draftEditor').value);
      renderSpellPanel(engine, items, naraError);
    } catch (e) { note('#draftNotes', 'alert', '맞춤법 검사 실패', e.message || String(e)); }
    finally { setBusy(btn, false); }
  };

  function renderSpellPanel(engine, items, naraError) {
    const panel = $('#spellPanel');
    panel.hidden = false;
    panel.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'spell-head';
    const engineLabel = engine === 'nara'
      ? '한국어 맞춤법/문법 검사기 (부산대 인공지능연구실 · 나라인포테크)'
      : '로컬 규칙 검사기' + (naraError ? ' — 검사기 서버 연결 실패, 오프라인 규칙만 적용' : '');
    head.innerHTML = `<b>맞춤법 ${items.length ? `교정 제안 ${items.length}건` : '이상 없음 ✓'}</b><span class="hint"></span>
      <button class="btn small" id="spellAllBtn" ${items.length ? '' : 'hidden'}>모두 적용</button>
      <button class="btn small ghost" id="spellCloseBtn">닫기</button>`;
    head.querySelector('.hint').textContent = engineLabel;
    panel.appendChild(head);

    const applyOne = (orgStr, cand) => {
      const ta = $('#draftEditor');
      if (!ta.value.includes(orgStr)) return false;
      ta.value = ta.value.split(orgStr).join(cand);
      return true;
    };

    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'spell-item';
      row.innerHTML = `
        <span class="sp-org"></span><span class="sp-arrow">→</span>
        ${it.candWords.length > 1
          ? `<select class="sp-cand">${it.candWords.map((c) => `<option></option>`).join('')}</select>`
          : '<b class="sp-cand-one"></b>'}
        <button class="btn small sp-apply">적용</button>
        <button class="btn small ghost sp-skip">무시</button>
        <div class="sp-help"></div>`;
      row.querySelector('.sp-org').textContent = it.orgStr;
      if (it.candWords.length > 1) {
        [...row.querySelectorAll('option')].forEach((o, i) => { o.textContent = it.candWords[i]; o.value = it.candWords[i]; });
      } else {
        row.querySelector('.sp-cand-one').textContent = it.candWords[0];
      }
      row.querySelector('.sp-help').textContent = it.help || '';
      row.querySelector('.sp-apply').onclick = () => {
        const cand = it.candWords.length > 1 ? row.querySelector('.sp-cand').value : it.candWords[0];
        if (applyOne(it.orgStr, cand)) { row.classList.add('applied'); row.querySelector('.sp-apply').textContent = '적용됨 ✓'; row.querySelector('.sp-apply').disabled = true; }
        else { row.querySelector('.sp-help').textContent = '본문에서 해당 표현을 찾지 못했습니다 (이미 수정됨).'; }
      };
      row.querySelector('.sp-skip').onclick = () => row.remove();
      panel.appendChild(row);
    }

    $('#spellCloseBtn').onclick = () => { panel.hidden = true; };
    const allBtn = $('#spellAllBtn');
    if (allBtn) allBtn.onclick = () => {
      for (const row of panel.querySelectorAll('.spell-item:not(.applied)')) {
        row.querySelector('.sp-apply')?.click();
      }
    };
  }

  // 미리보기 ↔ 편집 토글 (직접인용은 검증 결과 색으로 하이라이트)
  $('#previewBtn').onclick = async () => {
    const ta = $('#draftEditor');
    const pv = $('#draftPreview');
    if (pv.hidden) {
      const res = await api.validateQuotes(ta.value, state.projectId);
      pv.innerHTML = buildDraftPreviewHtml(ta.value, res.quotes || []);
      pv.hidden = false; ta.hidden = true;
      $('#previewBtn').innerHTML = `${ic('pen')} 편집으로`;
      renderValidation(res);
    } else {
      pv.hidden = true; ta.hidden = false;
      $('#previewBtn').innerHTML = `${ic('eye')} 미리보기`;
    }
  };

  // docx 내보내기
  $('#docxBtn').onclick = async () => {
    const text = $('#draftEditor').value;
    if (!text.trim()) return note('#draftNotes', 'alert', '내용 없음', '내보낼 초안이 없습니다.');
    try {
      const readiness = await refreshReadiness();
      if (readiness && !readiness.ready) {
        note('#draftNotes', 'warn', '출고 점검 미통과', readiness.blockers.map((item) => `${item.label}: ${item.detail}`).join('\n'));
      }
      const { outPath } = await api.draftExportDocx(state.projectId, text);
      note('#draftNotes', 'ok', 'docx 저장됨', outPath);
      const data = await api.filePreviewPath(outPath);
      showFilePreview(data, { path: outPath });
      if (api.showFile && !api._demo) api.showFile(outPath);
    } catch (e) { note('#draftNotes', 'alert', 'docx 실패', e.message || String(e)); }
  };
  $('#pdfBtn').onclick = async () => {
    const text = $('#draftEditor').value;
    if (!text.trim()) return note('#draftNotes', 'alert', '내용 없음', '내보낼 초안이 없습니다.');
    const btn = $('#pdfBtn'); setBusy(btn, true);
    try {
      const readiness = await refreshReadiness();
      if (readiness && !readiness.ready) {
        note('#draftNotes', 'warn', '출고 점검 미통과', readiness.blockers.map((item) => `${item.label}: ${item.detail}`).join('\n'));
      }
      const { outPath } = await api.draftExportPdf(state.projectId, text);
      note('#draftNotes', 'ok', 'PDF 저장됨', outPath);
      if (api.showFile && !api._demo) api.showFile(outPath);
    } catch (e) { note('#draftNotes', 'alert', 'PDF 실패', e.message || String(e)); }
    finally { setBusy(btn, false); }
  };
  $('#saveDraftBtn').onclick = async () => {
    const text = $('#draftEditor').value;
    await api.outputSave({ projectId: state.projectId, stage: 'draft', content: text });
    const readiness = await refreshReadiness();
    if (state.currentRecordId) {
      const dist = await api.recordFinalize(state.currentRecordId, text);
      setSave(`최종본 저장됨 · 출고 점검 ${readiness?.score ?? '-'}점 (수정량 ${dist})`, true);
    } else {
      setSave(`최종본 저장됨 · 출고 점검 ${readiness?.score ?? '-'}점`, true);
    }
  };
  async function runCheck() {
    const res = await api.validateQuotes($('#draftEditor').value, state.projectId);
    renderValidation(res);
    await refreshReadiness();
  }
}

async function renderCardnewsStage(el) {
  el.innerHTML = `
    <h1>카드뉴스 제작</h1>
    <div class="cardnews-console">
      <div class="toolrow">
        <button id="planBtn" class="btn primary">${ic('spark')} AI 구성안</button>
        <button id="cnExportBtn" class="btn" disabled>${ic('download')} 내보내기</button>
        <button id="cnPreviewBtn" class="btn ghost" disabled>${ic('eye')} 미리보기</button>
      </div>
      <div class="export-picks">
        <label><input id="cnFormatPptx" type="checkbox" checked> PPTX</label>
        <label><input id="cnFormatPng" type="checkbox"> PNG</label>
        <span class="divider"></span>
        <label><input id="cnSaveLocal" type="checkbox" checked> 로컬</label>
        <label><input id="cnSaveDrive" type="checkbox"> Drive</label>
      </div>
    </div>
    <div id="cnNotes"></div>
    <div id="planArea" class="cardplan"></div>
  `;
  $('#planBtn').onclick = async () => {
    const draft = await api.outputLatest(state.projectId, 'draft');
    if (!draft || !draft.content) {
      return note('#cnNotes', 'alert', '초안 없음', '먼저 기사 초안을 저장하세요.');
    }
    const btn = $('#planBtn');
    setBusy(btn, true);
    try {
      const { plan, recordId } = await api.aiCardplan(state.projectId, draft.content);
      state.cardPlan = plan;
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      renderPlanEditor(plan);
      renderFeedback();
      $('#cnExportBtn').disabled = false;
      const v = await api.validateCardplan(plan, state.projectId);
      if (v.warnings?.length) note('#cnNotes', 'warn', '규격 경고', v.warnings.join('\n'));
      if (v.errors?.length) note('#cnNotes', 'alert', '규격 위반', v.errors.join('\n'));
    } catch (e) {
      note('#cnNotes', 'alert', 'AI 오류', e.message || String(e));
    } finally { setBusy(btn, false); }
  };

  $('#cnExportBtn').onclick = async () => {
    collectPlanFromEditor();
    if (!$('#cnFormatPptx').checked && !$('#cnFormatPng').checked) {
      return note('#cnNotes', 'alert', '형식 선택', 'PPTX 또는 PNG를 선택하세요.');
    }
    const btn = $('#cnExportBtn');
    setBusy(btn, true);
    try {
      const result = await api.cardnewsGenerate(state.projectId, state.cardPlan, {
        formats: {
          pptx: $('#cnFormatPptx').checked,
          png: $('#cnFormatPng').checked,
        },
        destinations: {
          local: $('#cnSaveLocal').checked,
          drive: $('#cnSaveDrive').checked,
        },
      });
      state.lastCardnewsOut = result.outPath;
      $('#cnPreviewBtn').disabled = false;
      const pieces = [`PPTX ${result.slideCount}장`];
      if (result.outputs?.png?.files?.length) pieces.push(`PNG ${result.outputs.png.files.length}장`);
      if (result.outputs?.pptx?.driveFile) pieces.push('Drive 저장');
      note('#cnNotes', 'ok', '내보내기 완료', `${pieces.join(' · ')}\n${result.outPath}`);
      if (result.outputs?.pptx?.localPath) note('#cnNotes', 'ok', '로컬 PPTX', result.outputs.pptx.localPath);
      if (result.outputs?.png?.localDir) note('#cnNotes', 'ok', '로컬 PNG', result.outputs.png.localDir);
      if (result.warnings?.length) note('#cnNotes', 'warn', '확인 필요', result.warnings.join('\n'));
      if (state.currentRecordId) {
        await api.recordFinalize(state.currentRecordId, JSON.stringify(state.cardPlan, null, 2));
      }
    } catch (e) {
      note('#cnNotes', 'alert', '생성 실패', e.message || String(e));
    } finally {
      setBusy(btn, false);
    }
  };
  $('#cnPreviewBtn').onclick = async () => {
    if (!state.lastCardnewsOut) return;
    try {
      const data = await api.filePreviewPath(state.lastCardnewsOut);
      showFilePreview(data, { path: state.lastCardnewsOut });
    } catch (error) {
      note('#cnNotes', 'alert', '미리보기 실패', error.message || String(error));
    }
  };

  function renderPlanEditor(plan) {
    const area = $('#planArea');
    area.innerHTML = '';

    // 커버: 편집 폼 + 실시간 미리보기
    const cover = document.createElement('div');
    cover.className = 'card-item cn-grid';
    cover.innerHTML = `
      <div><h4>커버</h4>
        <textarea id="cpTitle" rows="2" placeholder="커버 제목 (최대 2줄 — 줄바꿈으로 구분)"></textarea>
        <input id="cpCategory" placeholder="카테고리 (대괄호 금지)">
        <div class="photo-actions">
          <label class="photo-pick">${ic('image')} 로컬<input type="file" id="cpPhoto" accept="image/png,image/jpeg,image/webp" hidden></label>
          <button id="cpDrivePhoto" class="btn small ghost">${ic('folder')} Drive</button>
        </div>
      </div>
      <div class="cn-prev cover" id="prevCover">
        <span class="photo-hint">사진</span>
        <span class="cat"></span><span class="ttl"></span>
      </div>`;
    area.appendChild(cover);
    $('#cpTitle').value = plan.coverTitle || '';
    $('#cpCategory').value = plan.category || '';
    $('#cpPhoto').onchange = (e) => pickPhoto(e.target, (dataUrl) => {
      plan.coverPhoto = { dataUrl };
      $('#prevCover').style.backgroundImage = `url(${dataUrl})`;
      $('#prevCover').classList.add('has-photo');
    });
    $('#cpDrivePhoto').onclick = async () => {
      const picked = await pickDrivePhoto();
      if (!picked) return;
      plan.coverPhoto = { dataUrl: picked.dataUrl, source: 'drive', name: picked.name };
      $('#prevCover').style.backgroundImage = `url(${picked.dataUrl})`;
      $('#prevCover').classList.add('has-photo');
    };

    (plan.cards || []).forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'card-item cn-grid cn-card';
      d.innerHTML = `
        <div><h4>카드 ${i + 1}</h4>
          <input class="cTitle" placeholder="카드 제목">
          <textarea class="cBody" rows="5" placeholder="카드 본문 (최대 380자 권장)"></textarea>
          <button class="btn small ghost cMark">${ic('check')} 형광펜</button>
          <input class="cCredit" placeholder="사진 출처 (퍼온 사진만, 예: 대한민국 국회)">
          <div class="photo-actions">
            <label class="photo-pick">${ic('image')} 로컬<input type="file" class="cPhoto" accept="image/png,image/jpeg,image/webp" hidden></label>
            <button class="btn small ghost cDrivePhoto">${ic('folder')} Drive</button>
          </div>
        </div>
        <div class="cn-prev body">
          <span class="h"></span><span class="b"></span>
          <span class="credit"></span><span class="logo">DGIST 로고</span>
        </div>`;
      area.appendChild(d);
      d.querySelector('.cTitle').value = c.title || '';
      d.querySelector('.cBody').value = c.body || '';
      d.querySelector('.cCredit').value = c.photoCredit || '';
      d.querySelector('.cPhoto').onchange = (e) => pickPhoto(e.target, (dataUrl) => {
        c.photo = { dataUrl };
        const prev = d.querySelector('.cn-prev');
        prev.style.backgroundImage = `url(${dataUrl})`;
        prev.classList.add('has-photo');
      });
      d.querySelector('.cDrivePhoto').onclick = async () => {
        const picked = await pickDrivePhoto();
        if (!picked) return;
        c.photo = { dataUrl: picked.dataUrl, source: 'drive', name: picked.name };
        const prev = d.querySelector('.cn-prev');
        prev.style.backgroundImage = `url(${picked.dataUrl})`;
        prev.classList.add('has-photo');
      };
      d.querySelector('.cMark').onclick = () => {
        wrapSelectionWithHighlight(d.querySelector('.cBody'));
        updatePreviews();
      };
    });

    // 마무리 장 (고정 양식 미리보기)
    const last = document.createElement('div');
    last.className = 'card-item cn-grid';
    last.innerHTML = `
      <div><h4>마무리 장</h4><p class="sub" style="margin:0">공식 양식 그대로 들어갑니다 (마스코트 + 링크).</p></div>
      <div class="cn-prev last"><span class="mascot">DNA</span><span class="q">이 기사가 궁금하다면?</span><span class="u">https://dgistdna.com/</span></div>`;
    area.appendChild(last);

    area.addEventListener('input', updatePreviews);
    updatePreviews();
  }

  // 편집 폼 값 → 미리보기 즉시 반영 (분량 초과 경고 포함)
  function updatePreviews() {
    const pc = $('#prevCover');
    if (pc) {
      pc.querySelector('.cat').textContent = $('#cpCategory').value || '카테고리';
      pc.querySelector('.ttl').textContent = $('#cpTitle').value || '커버 제목';
    }
    for (const d of document.querySelectorAll('#planArea .cn-card')) {
      const body = d.querySelector('.cBody').value;
      const prev = d.querySelector('.cn-prev');
      prev.querySelector('.h').textContent = d.querySelector('.cTitle').value || '제목';
      prev.querySelector('.b').textContent = body.replace(/==([\s\S]+?)==/g, '$1');
      const credit = d.querySelector('.cCredit').value.trim();
      prev.querySelector('.credit').textContent = credit ? `사진 = ${credit} 제공` : '';
      const over = body.replace(/==([\s\S]+?)==/g, '$1').replace(/\s+/g, ' ').length > 380;
      prev.classList.toggle('overflow-warn', over);
      let chip = prev.querySelector('.cn-warn-chip');
      if (over && !chip) {
        chip = document.createElement('span');
        chip.className = 'cn-warn-chip';
        chip.textContent = '분량 초과 — 로고 침범 위험';
        prev.appendChild(chip);
      } else if (!over && chip) chip.remove();
    }
  }

  function collectPlanFromEditor() {
    if (!state.cardPlan) return;
    const plan = state.cardPlan;
    plan.coverTitle = $('#cpTitle').value;
    plan.category = $('#cpCategory').value;
    // 사진(plan.coverPhoto / plan.cards[i].photo)은 pickPhoto가 이미 객체에 심어둠 — 순서 유지하며 보존
    const prevCards = plan.cards || [];
    plan.cards = [...document.querySelectorAll('#planArea .cn-card')].map((d, i) => ({
      title: d.querySelector('.cTitle').value,
      body: d.querySelector('.cBody').value,
      photoCredit: d.querySelector('.cCredit').value || undefined,
      photo: prevCards[i]?.photo,
    }));
  }
}

// 파일 입력 → data URL (5MB 상한, png/jpeg만). 성공 시 cb(dataUrl).
function pickPhoto(input, cb) {
  const f = input.files && input.files[0];
  if (!f) return;
  if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) { alert('PNG, JPEG, WEBP만 넣을 수 있습니다.'); return; }
  if (f.size > 5 * 1024 * 1024) { alert('사진은 5MB 이하만 넣을 수 있습니다. 미리 리사이즈하세요.'); return; }
  const reader = new FileReader();
  reader.onload = () => cb(reader.result);
  reader.readAsDataURL(f);
}

async function pickDrivePhoto() {
  if (!state.google.connected) {
    alert('설정에서 Google 계정을 먼저 연결하세요.');
    return null;
  }
  const dlg = document.createElement('dialog');
  dlg.className = 'drive-picker';
  dlg.innerHTML = `
    <div class="dialog-head">
      <h2>Drive 사진</h2>
      <button class="icon-btn drive-close" type="button" aria-label="닫기">×</button>
    </div>
    <div class="drive-search">
      <input id="drivePhotoQuery" placeholder="파일명 검색">
      <button id="drivePhotoSearch" class="btn small">${ic('search')} 검색</button>
    </div>
    <div id="drivePhotoList" class="drive-file-list"></div>
  `;
  document.body.appendChild(dlg);
  const list = dlg.querySelector('#drivePhotoList');
  let picked = null;
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const close = () => {
    if (dlg.open) dlg.close();
    dlg.remove();
    done();
  };
  dlg.querySelector('.drive-close').onclick = close;
  dlg.addEventListener('cancel', close);
  async function load() {
    list.innerHTML = '<div class="mail-empty">불러오는 중…</div>';
    try {
      const files = await api.driveListFiles({ kind: 'image', query: dlg.querySelector('#drivePhotoQuery').value.trim(), pageSize: 40 });
      if (!files.length) {
        list.innerHTML = '<div class="mail-empty">표시할 이미지가 없습니다.</div>';
        return;
      }
      list.innerHTML = '';
      files.forEach((file) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'drive-file-row';
        row.innerHTML = `
          <span class="drive-thumb">${ic('image')}</span>
          <span><b>${esc(file.name || '이미지')}</b><small>${esc(file.mimeType || '')}</small></span>`;
        row.onclick = async () => {
          row.classList.add('loading-row');
          try {
            picked = await api.driveDownloadFile(file.id);
            close();
          } catch (error) {
            row.classList.remove('loading-row');
            alert(error.message || String(error));
          }
        };
        list.appendChild(row);
      });
    } catch (error) {
      list.innerHTML = `<div class="note alert"><span class="lab">Drive</span><span>${esc(error.message || error)}</span></div>`;
    }
  }
  dlg.querySelector('#drivePhotoSearch').onclick = load;
  dlg.querySelector('#drivePhotoQuery').onkeydown = (event) => {
    if (event.key === 'Enter') load();
  };
  dlg.showModal();
  await load();
  await finished;
  return picked;
}

function dataUrlToArrayBuffer(dataUrl = '') {
  const comma = String(dataUrl).indexOf(',');
  if (comma < 0) throw new Error('Drive 파일 데이터를 읽을 수 없습니다.');
  const binary = atob(String(dataUrl).slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function pickDriveFiles() {
  if (!state.google.connected) {
    alert('설정에서 Google 계정을 먼저 연결하세요.');
    return [];
  }
  const dlg = document.createElement('dialog');
  dlg.className = 'drive-picker drive-material-picker';
  dlg.innerHTML = `
    <div class="dialog-head">
      <div><h2>Drive 파일 가져오기</h2><p class="hint">형식과 관계없이 여러 파일을 선택할 수 있습니다.</p></div>
      <button class="icon-btn drive-close" type="button" aria-label="닫기">×</button>
    </div>
    <div class="drive-search">
      <input id="driveFileQuery" placeholder="파일명 검색">
      <button id="driveFileSearch" class="btn small">${ic('search')} 검색</button>
    </div>
    <div id="driveMaterialList" class="drive-file-list"></div>
    <div class="drive-picker-foot">
      <span id="driveSelectedCount" class="hint">0개 선택</span>
      <button id="driveImportSelected" class="btn primary" disabled>${ic('download')} 가져오기</button>
    </div>`;
  document.body.appendChild(dlg);
  const list = dlg.querySelector('#driveMaterialList');
  const selected = new Map();
  let settled = false;
  let resolveSelection;
  const result = new Promise((resolve) => { resolveSelection = resolve; });
  const finish = (files = []) => {
    if (settled) return;
    settled = true;
    if (dlg.open) dlg.close();
    dlg.remove();
    resolveSelection(files);
  };
  const updateSelection = () => {
    dlg.querySelector('#driveSelectedCount').textContent = `${selected.size}개 선택`;
    dlg.querySelector('#driveImportSelected').disabled = selected.size === 0;
  };
  dlg.querySelector('.drive-close').onclick = () => finish([]);
  dlg.addEventListener('cancel', (event) => { event.preventDefault(); finish([]); });
  dlg.querySelector('#driveImportSelected').onclick = () => finish([...selected.values()]);

  async function load() {
    list.innerHTML = '<div class="mail-empty">불러오는 중…</div>';
    selected.clear();
    updateSelection();
    try {
      const files = await api.driveListFiles({
        query: dlg.querySelector('#driveFileQuery').value.trim(),
        pageSize: 60,
      });
      if (!files.length) {
        list.innerHTML = '<div class="mail-empty">표시할 파일이 없습니다.</div>';
        return;
      }
      list.innerHTML = '';
      for (const file of files) {
        const row = document.createElement('label');
        row.className = 'drive-file-row drive-material-row';
        row.innerHTML = `
          <input type="checkbox">
          <span class="drive-thumb">${ic('folder')}</span>
          <span><b>${esc(file.name || '파일')}</b><small>${esc(file.mimeType || '파일')} · ${formatBytes(file.size)}</small></span>`;
        row.querySelector('input').onchange = (event) => {
          if (event.target.checked) selected.set(file.id, file);
          else selected.delete(file.id);
          row.classList.toggle('selected', event.target.checked);
          updateSelection();
        };
        list.appendChild(row);
      }
    } catch (error) {
      list.innerHTML = `<div class="note alert"><span class="lab">Drive</span><span>${esc(error.message || error)}</span></div>`;
    }
  }
  dlg.querySelector('#driveFileSearch').onclick = load;
  dlg.querySelector('#driveFileQuery').onkeydown = (event) => {
    if (event.key === 'Enter') load();
  };
  dlg.showModal();
  await load();
  return result;
}

function showFilePreview(data, options = {}) {
  const old = $('#filePreviewDlg');
  if (old) old.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'filePreviewDlg';
  dlg.className = 'file-preview-dialog';
  const body = data.kind === 'pptx'
    ? `<div class="ppt-preview">
        ${(data.slides || []).map((slide) => `
          <section class="ppt-slide-preview">
            <b>${slide.index}</b>
            <div>${(slide.texts || []).length ? slide.texts.map((text) => `<p>${esc(text)}</p>`).join('') : '<p class="hint">텍스트 없음</p>'}</div>
          </section>
        `).join('')}
      </div>`
    : `<article class="docx-preview">
        ${(data.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('') || '<p class="hint">표시할 문단이 없습니다.</p>'}
      </article>`;
  dlg.innerHTML = `
    <div class="dialog-head">
      <div><h2>${esc(data.title || '미리보기')}</h2><p class="hint">${data.kind === 'pptx' ? `${data.slideCount || 0}장` : 'DOCX'}</p></div>
      <button class="icon-btn preview-close" type="button" aria-label="닫기">×</button>
    </div>
    <div class="preview-actions">
      ${options.path ? `<button id="previewOpenOriginal" class="btn small">${ic('folder')} 원본 열기</button>` : ''}
    </div>
    <div class="preview-body">${body}</div>
  `;
  document.body.appendChild(dlg);
  dlg.querySelector('.preview-close').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  $('#previewOpenOriginal')?.addEventListener('click', () => api.openPath?.(options.path));
  dlg.showModal();
}

function note(sel, cls, label, text) {
  const host = $(sel);
  if (!host) return; // 화면 전환 후 늦게 도착한 비동기 알림은 조용히 버림
  const div = document.createElement('div');
  div.className = `note ${cls}`;
  div.innerHTML = `<span class="lab"></span><span style="white-space:pre-wrap"></span>`;
  div.children[0].textContent = label;
  div.children[1].textContent = text;
  host.prepend(div);
}

const FLOW_META = {
  brainstorm: {
    lane: '기획',
    brief: '각도, 제목, 질문, 필요한 자료를 먼저 세웁니다.',
  },
  collect: {
    lane: '취재',
    brief: 'URL, 파일, 녹취, 메모를 출처와 함께 모읍니다.',
  },
  analyze: {
    lane: '검증',
    brief: '자료의 타임라인, 쟁점, 빈틈을 정리합니다.',
  },
  draft: {
    lane: '작성',
    brief: '수집 근거와 DNA 문체를 바탕으로 초안을 씁니다.',
  },
  cardnews: {
    lane: '발행',
    brief: '기사 초안을 카드뉴스 구성안과 pptx로 완성합니다.',
  },
};
const FLOW_STATUS = {
  done: '완료',
  current: '진행 중',
  attention: '확인 필요',
  waiting: '대기',
  skipped: '건너뜀',
};

async function buildFlowData() {
  const outputs = {};
  await Promise.all(STAGE_ORDER.map(async (stage) => {
    outputs[stage] = state.projectId
      ? await api.outputLatest(state.projectId, stage).catch(() => null)
      : null;
  }));
  const materials = state.projectId ? await api.materialList(state.projectId).catch(() => []) : [];
  const readiness = outputs.draft?.content
    ? await api.validateReadiness(outputs.draft.content, state.projectId).catch(() => null)
    : null;
  const curIdx = Math.max(0, STAGE_ORDER.indexOf(state.stage));
  const stages = STAGES.map((stage, idx) => {
    const key = stage.key;
    const skipped = stage.optional && state.skippedStages.has(key) && idx < curIdx;
    const hasOutput = Boolean(outputs[key]);
    const hasSignal = key === 'collect' ? materials.length > 0 : hasOutput;
    const status = skipped
      ? 'skipped'
      : idx === curIdx
        ? 'current'
        : hasSignal
          ? 'done'
          : idx < curIdx
            ? 'attention'
            : 'waiting';
    return {
      ...stage,
      lane: FLOW_META[key].lane,
      brief: FLOW_META[key].brief,
      status,
      summary: flowStageSummary(key, { outputs, materials, readiness, skipped }),
    };
  });
  return { outputs, materials, readiness, curIdx, stages };
}

function flowStageSummary(key, data) {
  if (data.skipped) return '선택 단계라 이번 프로젝트에서는 건너뛰었습니다.';
  if (key === 'collect') {
    const count = data.materials.length;
    return count ? `수집 자료 ${count}건이 연결되어 있습니다.` : '아직 연결된 수집 자료가 없습니다.';
  }
  if (key === 'cardnews') {
    if (state.cardPlan?.cards?.length) return `카드뉴스 구성안 ${state.cardPlan.cards.length}장이 편집 중입니다.`;
    return data.outputs.draft ? '기사 초안을 바탕으로 카드뉴스 구성안을 만들 차례입니다.' : '기사 초안이 저장되면 카드뉴스 제작을 시작할 수 있습니다.';
  }
  if (key === 'draft' && data.readiness) {
    const blockers = data.readiness.blockers?.length || 0;
    return blockers
      ? `출고 점검 ${data.readiness.score}점 · 막는 항목 ${blockers}건`
      : `출고 점검 ${data.readiness.score}점 · 출고 가능`;
  }
  const labels = {
    brainstorm: ['기획 노트가 저장되어 있습니다.', '기획 노트를 아직 저장하지 않았습니다.'],
    analyze: ['분석·제언 메모가 저장되어 있습니다.', '수집 자료를 읽고 쟁점과 빈틈을 정리할 차례입니다.'],
    draft: ['기사 초안 저장본이 있습니다.', '아직 저장된 기사 초안이 없습니다.'],
  };
  const [yes, no] = labels[key] || ['저장본이 있습니다.', '저장본이 없습니다.'];
  return data.outputs[key] ? yes : no;
}

function flowChecklistFor(stageKey, data) {
  const out = data.outputs;
  const materialCount = data.materials.length;
  const tasks = {
    brainstorm: [
      { id: 'angle', text: '기사 각도와 핵심 질문을 정리하기', autoDone: Boolean(out.brainstorm) },
      { id: 'sources', text: '취재원과 필요한 자료 목록을 체크리스트로 만들기', autoDone: Boolean(out.brainstorm) },
      { id: 'open-mail', text: '필요한 취재 요청은 메일함에서 작성하기', autoDone: false },
    ],
    collect: [
      { id: 'three-sources', text: '출처가 있는 자료를 3건 이상 모으기', autoDone: materialCount >= 3 },
      { id: 'interview', text: '인터뷰 녹취나 서면 답변을 추가하기', autoDone: data.materials.some((m) => /인터뷰|녹취|서면|답변/.test(`${m.kind} ${m.title} ${m.source}`)) },
      { id: 'source-check', text: '모든 자료의 출처가 비어 있지 않은지 확인하기', autoDone: materialCount > 0 && data.materials.every((m) => String(m.source || '').trim()) },
    ],
    analyze: [
      { id: 'timeline', text: '타임라인과 핵심 쟁점을 요약하기', autoDone: Boolean(out.analyze) },
      { id: 'holes', text: '확인 필요 항목과 반론 가능성을 적기', autoDone: Boolean(out.analyze) },
      { id: 'move-draft', text: '초안으로 넘길 핵심 근거를 고르기', autoDone: data.curIdx > STAGE_ORDER.indexOf('analyze') },
    ],
    draft: [
      { id: 'write-draft', text: '기사 초안을 저장하기', autoDone: Boolean(out.draft) },
      {
        id: 'quote-check',
        text: '직접인용과 출처 검사를 통과시키기',
        autoDone: ['quotes', 'sources'].every((id) => data.readiness?.checks?.find((item) => item.id === id)?.status === 'pass'),
      },
      { id: 'spell-check', text: '맞춤법 검사와 최종 문장 다듬기', autoDone: false },
    ],
    cardnews: [
      { id: 'card-plan', text: '카드뉴스 구성안을 생성하고 카드 흐름을 검토하기', autoDone: Boolean(state.cardPlan?.cards?.length) },
      { id: 'credits', text: '사진·캡션·크레딧을 확인하기', autoDone: false },
      { id: 'export-pptx', text: 'PPTX를 생성하고 발행 전 검수하기', autoDone: false },
    ],
  };
  return tasks[stageKey] || [];
}

async function loadFlowNote(projectId, stageKey) {
  if (!projectId) return { checks: {}, custom: [] };
  try {
    const raw = await api.settingsGet(`flowNote:${projectId}:${stageKey}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {},
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    };
  } catch {
    return { checks: {}, custom: [] };
  }
}

// 선택 영역을 ==강조== 마크로 감싸기 (카드뉴스 본문 편집에서 사용)
function wrapSelectionWithHighlight(textarea) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  const before = textarea.value.slice(0, start);
  const selected = textarea.value.slice(start, end) || '강조 문장';
  const after = textarea.value.slice(end);
  textarea.value = `${before}==${selected}==${after}`;
  textarea.focus();
  textarea.setSelectionRange(start + 2, start + 2 + selected.length);
}

async function saveFlowNote(stageKey, noteState) {
  if (!state.projectId) return;
  await api.settingsSet(`flowNote:${state.projectId}:${stageKey}`, JSON.stringify(noteState));
}

function deadlineInfo(value) {
  if (!value) return { label: '미설정', detail: '마감 시간을 지정하세요.', tone: '' };
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return { label: '미설정', detail: '마감 시간을 다시 지정하세요.', tone: '' };
  const diff = target.getTime() - Date.now();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.ceil(Math.abs(diff) / day);
  const label = diff < 0 ? `D+${Math.max(1, days)}` : diff < day ? '오늘' : `D-${days}`;
  return {
    label,
    detail: target.toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }),
    tone: diff < 0 ? 'overdue' : diff < day ? 'soon' : '',
  };
}

async function renderFlowMap(el) {
  if (!state.projectId) {
    el.innerHTML = `
      <div class="flow-note empty">
        <div class="flow-note-icon">${ic('map')}</div>
        <h1>진행 노트</h1>
        <p class="sub">새 프로젝트를 만들면 기사 진행 상황과 다음 할 일을 한 화면에서 관리할 수 있습니다.</p>
        <button id="flowNewProjectBtn" class="btn primary">${ic('plus')} 새 프로젝트 만들기</button>
      </div>`;
    $('#flowNewProjectBtn').onclick = () => $('#newProjectBtn').click();
    return;
  }

  const data = await buildFlowData();
  const curStage = data.stages[data.curIdx] || data.stages[0];
  const focusStage = data.stages.find((stage) => stage.status === 'attention') || curStage;
  const doneCount = data.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const progressPct = Math.round(((doneCount + (curStage?.status === 'current' ? 0.45 : 0)) / STAGES.length) * 100);
  const noteState = await loadFlowNote(state.projectId, focusStage.key);
  const baseTasks = flowChecklistFor(focusStage.key, data);
  const customTasks = noteState.custom || [];
  const checkedTotal = baseTasks.filter((t) => t.autoDone || noteState.checks[t.id]).length + customTasks.filter((t) => t.checked).length;
  const taskTotal = baseTasks.length + customTasks.length;
  const deadlineValue = (await api.settingsGet(`deadline:${state.projectId}`)) || '';
  const deadline = deadlineInfo(deadlineValue);
  const readiness = data.readiness;
  const readinessDetail = readiness
    ? readiness.ready
      ? '출고를 막는 항목이 없습니다.'
      : `${readiness.blockers.length}건을 해결해야 합니다.`
    : '초안을 저장하면 자동 점검합니다.';

  el.innerHTML = `
    <article class="flow-note">
      <header class="flow-note-header">
        <div class="flow-note-icon">${ic('map')}</div>
        <div>
          <span class="flow-page-label">진행 노트</span>
          <h1>${esc(state.project.title || '제목 없는 프로젝트')}</h1>
          <p class="sub">진행, 마감, 취재 근거와 출고 준비 상태를 한 문서에서 봅니다.</p>
        </div>
      </header>

      <section class="flow-note-block flow-overview">
        <div>
          <span class="flow-muted">현재 위치</span>
          <b>${esc(curStage.name)}</b>
          <small>${esc(curStage.summary)}</small>
        </div>
        <div>
          <span class="flow-muted">전체 진행</span>
          <b>${progressPct}%</b>
          <small>${doneCount}/${STAGES.length} 단계 완료 · 누락 단계는 완료로 계산하지 않음</small>
        </div>
        <div>
          <span class="flow-muted">출고 점검</span>
          <b>${readiness ? `${readiness.score}점` : '초안 전'}</b>
          <small>${esc(readinessDetail)}</small>
        </div>
        <div class="flow-deadline ${deadline.tone}">
          <span class="flow-muted">마감</span>
          <b id="flowDeadlineLabel">${esc(deadline.label)}</b>
          <small>${esc(deadline.detail)}</small>
          <input id="flowDeadlineInput" type="datetime-local" value="${esc(deadlineValue)}" aria-label="기사 마감 시간">
        </div>
      </section>

      <div class="flow-progress-track" aria-label="전체 진행률">
        <span style="width:${Math.max(6, Math.min(100, progressPct))}%"></span>
      </div>

      <section class="flow-note-block">
        <div class="flow-block-head">
          <h2>워크플로우</h2>
          <span class="hint">행을 클릭하면 해당 단계 작업 화면으로 이동합니다.</span>
        </div>
        <div class="flow-board">
          ${data.stages.map((stage) => `
            <button class="flow-row is-${stage.status}" data-stage="${stage.key}">
              <span class="flow-row-icon">${stage.status === 'done' || stage.status === 'skipped' ? '✓' : stage.status === 'attention' ? '!' : ic(STAGE_ICONS[stage.key])}</span>
              <span class="flow-row-main">
                <b>${esc(stage.name)}</b>
                <small>${esc(stage.summary)}</small>
              </span>
              <span class="flow-row-brief">${esc(stage.brief)}</span>
              <span class="flow-row-lane">${esc(stage.lane)}</span>
              <span class="flow-row-status">${FLOW_STATUS[stage.status]}</span>
            </button>
          `).join('')}
        </div>
      </section>

      <section class="flow-note-grid">
        <div class="flow-note-block">
          <div class="flow-block-head">
            <h2>다음 할 일</h2>
            <span class="hint">${esc(focusStage.name)} · ${checkedTotal}/${taskTotal || baseTasks.length}</span>
          </div>
          <div class="flow-checklist">
            ${baseTasks.map((task) => {
              const checked = task.autoDone || noteState.checks[task.id];
              return `
                <label class="flow-check ${task.autoDone ? 'auto' : ''}">
                  <input type="checkbox" data-flow-check="${esc(task.id)}" ${checked ? 'checked' : ''}>
                  <span>${esc(task.text)}</span>
                  ${task.autoDone ? '<em>자동 확인</em>' : ''}
                </label>`;
            }).join('')}
            ${customTasks.map((task) => `
              <label class="flow-check custom">
                <input type="checkbox" data-custom-check="${esc(task.id)}" ${task.checked ? 'checked' : ''}>
                <span>${esc(task.text)}</span>
                <button class="flow-check-remove" data-custom-remove="${esc(task.id)}" type="button">×</button>
              </label>
            `).join('')}
          </div>
          <div class="flow-add-check">
            <input id="flowNewCheck" placeholder="직접 할 일 추가">
            <button id="flowAddCheckBtn" class="btn small">${ic('plus')} 추가</button>
          </div>
        </div>

        <div class="flow-note-block">
          <div class="flow-block-head">
            <h2>바로 열기</h2>
          </div>
          <div class="flow-actions">
            <button id="flowOpenCurrentBtn" class="btn primary">${ic(STAGE_ICONS[focusStage.key])} ${esc(focusStage.name)} 열기</button>
            <button id="flowOpenMailBtn" class="btn">${ic('inbox')} 메일함 열기</button>
            <button id="flowRefreshBtn" class="btn ghost">${ic('download')} 진행 상태 새로고침</button>
          </div>
        </div>
      </section>
    </article>
  `;

  el.querySelectorAll('.flow-row').forEach((node) => {
    node.onclick = () => {
      state.view = 'workflow';
      state.stage = node.dataset.stage;
      if (state.projectId) api.projectSetStage(state.projectId, state.stage);
      renderAll();
    };
  });
  el.querySelectorAll('[data-flow-check]').forEach((box) => {
    box.onchange = async () => {
      noteState.checks[box.dataset.flowCheck] = box.checked;
      await saveFlowNote(focusStage.key, noteState);
      setSave('진행 노트 체크리스트 저장됨', true);
    };
  });
  el.querySelectorAll('[data-custom-check]').forEach((box) => {
    box.onchange = async () => {
      const item = noteState.custom.find((t) => t.id === box.dataset.customCheck);
      if (item) item.checked = box.checked;
      await saveFlowNote(focusStage.key, noteState);
      setSave('진행 노트 체크리스트 저장됨', true);
    };
  });
  el.querySelectorAll('[data-custom-remove]').forEach((btn) => {
    btn.onclick = async () => {
      noteState.custom = noteState.custom.filter((t) => t.id !== btn.dataset.customRemove);
      await saveFlowNote(focusStage.key, noteState);
      renderFlowMap(el);
      setSave('체크리스트 항목 삭제됨', true);
    };
  });
  $('#flowAddCheckBtn').onclick = async () => {
    const input = $('#flowNewCheck');
    const text = input.value.trim();
    if (!text) return;
    noteState.custom.push({ id: 'c' + Date.now().toString(36), text, checked: false });
    await saveFlowNote(focusStage.key, noteState);
    input.value = '';
    renderFlowMap(el);
    setSave('체크리스트 항목 추가됨', true);
  };
  $('#flowNewCheck').onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#flowAddCheckBtn').click();
    }
  };
  $('#flowOpenCurrentBtn').onclick = () => {
    state.view = 'workflow';
    state.stage = focusStage.key;
    if (state.projectId) api.projectSetStage(state.projectId, state.stage);
    renderAll();
  };
  $('#flowOpenMailBtn').onclick = () => {
    state.view = 'mail';
    renderAll();
  };
  $('#flowDeadlineInput').onchange = async (event) => {
    await api.settingsSet(`deadline:${state.projectId}`, event.target.value || '');
    setSave(event.target.value ? '마감 시간 저장됨' : '마감 시간 해제됨', true);
    renderFlowMap(el);
  };
  $('#flowRefreshBtn').onclick = () => renderFlowMap(el);
}

// ---------- 개발자 모드 ----------
async function renderDeveloperMode(el) {
  const status = await api.devStatus?.() || { uploads: [], report: null, activeProfile: '', google: state.google };
  const uploads = status.uploads || [];
  const report = status.report;
  const google = status.google || state.google;
  el.innerHTML = `
    <article class="developer-page">
      <header class="developer-hero">
        <div>
          <span class="flow-page-label">개발자 모드</span>
          <h1>자동화 프로필 업데이트</h1>
          <p class="sub">기사 지침과 표본을 Drive에 보관하고, AI 분석 결과를 앱의 다음 자동화 지침으로 반영합니다.</p>
        </div>
        <span class="section-state ${status.activeProfile ? 'ready' : 'standby'}">${status.activeProfile ? '프로필 적용됨' : '대기'}</span>
      </header>

      <section class="developer-grid">
        <div class="developer-block">
          <div class="flow-block-head">
            <h2>자료 업로드</h2>
            <span class="hint">${google.connected ? 'Google Drive 연결됨' : 'Google 연결 필요'}</span>
          </div>
          <div class="developer-upload">
            <select id="devKind">
              <option value="article_guideline">기사 지침</option>
              <option value="article_sample">기사 표본</option>
              <option value="cardnews_sample">카드뉴스 표본</option>
              <option value="workflow_note">워크플로우 지침</option>
            </select>
            <label class="dev-file-pick">${ic('folder')} 파일 선택<input id="devFile" type="file" accept=".docx,.pdf,.txt,.md,.pptx" multiple hidden></label>
          </div>
          <div id="devUploadState" class="hint"></div>
          <div id="devUploadList" class="developer-upload-list">
            ${uploads.length ? uploads.map((item) => `
              <div class="developer-upload-row">
                <b>${esc(item.name)}</b>
                <span>${esc(item.kind)} · ${Number(item.chars || 0).toLocaleString()}자 추출</span>
                ${item.webViewLink ? `<button class="btn small ghost" data-open-drive="${esc(item.webViewLink)}">${ic('link')} Drive</button>` : ''}
              </div>
            `).join('') : '<div class="mail-empty">아직 업로드한 개발자 자료가 없습니다.</div>'}
          </div>
          <details class="profile-advanced">
            <summary>OAuth 클라이언트 진단</summary>
            <p class="hint">일반 사용자는 건드리지 않습니다. 새 배포 환경에서 Google 연결 설정이 비어 있을 때 개발자가 한 번만 등록합니다.</p>
            <input id="devGoogleClientFile" type="file" accept=".json,application/json" hidden>
            <button id="devGoogleImportBtn" class="btn small ghost">${ic('folder')} OAuth 클라이언트 등록</button>
            <span id="devGoogleState" class="hint"></span>
          </details>
        </div>

        <div class="developer-block">
          <div class="flow-block-head">
            <h2>AI 분석</h2>
            <span class="hint">규칙, 체크리스트, 위험요소로 정리</span>
          </div>
          <div class="toolrow compact">
            <button id="devAnalyzeBtn" class="btn primary" ${uploads.length ? '' : 'disabled'}>${ic('spark')} 업로드 자료 분석</button>
            <button id="devApplyBtn" class="btn" ${report ? '' : 'disabled'}>${ic('check')} 자동화 프로필 적용</button>
          </div>
          <div id="devAnalyzeState" class="hint"></div>
          <div id="devReport" class="developer-report">
            ${report ? renderDeveloperReportHtml(report) : '<span class="hint">분석을 실행하면 이곳에 앱 업데이트 제안이 표시됩니다.</span>'}
          </div>
        </div>
      </section>

      <section class="developer-block">
        <div class="flow-block-head">
          <h2>현재 적용된 프로필</h2>
          <span class="hint">다음 AI 호출부터 시스템 지침에 함께 들어갑니다.</span>
        </div>
        <pre class="developer-profile-preview">${esc(status.activeProfile || '아직 적용된 자동화 프로필이 없습니다.')}</pre>
      </section>
    </article>`;

  el.querySelectorAll('[data-open-drive]').forEach((btn) => {
    btn.onclick = () => api.openExternal(btn.dataset.openDrive);
  });
  $('#devGoogleImportBtn')?.addEventListener('click', () => $('#devGoogleClientFile').click());
  $('#devGoogleClientFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const st = $('#devGoogleState');
    st.textContent = '등록 중...';
    try {
      await api.googleConfigure(await file.text());
      state.google = await api.googleStatus();
      st.textContent = 'OAuth 클라이언트 등록 완료';
      st.style.color = 'var(--green)';
      setSave('Google OAuth 클라이언트 등록됨', true);
    } catch (error) {
      st.textContent = '등록 실패: ' + (error.message || error);
      st.style.color = 'var(--red)';
    } finally {
      event.target.value = '';
    }
  });
  $('#devFile').onchange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const st = $('#devUploadState');
    st.textContent = 'Google Drive에 업로드하는 중...';
    st.style.color = 'var(--dim)';
    try {
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        await api.devUploadReference({
          name: file.name,
          kind: $('#devKind').value,
          arrayBuffer,
        });
      }
      setSave('개발자 자료 업로드 완료', true);
      await renderDeveloperMode(el);
    } catch (error) {
      st.textContent = '업로드 실패: ' + (error.message || error);
      st.style.color = 'var(--red)';
    } finally {
      event.target.value = '';
    }
  };
  $('#devAnalyzeBtn')?.addEventListener('click', async () => {
    const btn = $('#devAnalyzeBtn');
    const st = $('#devAnalyzeState');
    setBusy(btn, true);
    st.textContent = 'AI가 표본 구조와 지침을 분석하는 중...';
    st.style.color = 'var(--dim)';
    try {
      const result = await api.devAnalyzeReferences();
      setSave('개발자 자료 분석 완료', true);
      $('#devReport').innerHTML = renderDeveloperReportHtml(result);
      $('#devApplyBtn').disabled = false;
      st.textContent = `${result.sourceCount || uploads.length}개 자료 분석 완료`;
      st.style.color = 'var(--green)';
    } catch (error) {
      st.textContent = '분석 실패: ' + (error.message || error);
      st.style.color = 'var(--red)';
    } finally {
      setBusy(btn, false);
    }
  });
  $('#devApplyBtn')?.addEventListener('click', async () => {
    const btn = $('#devApplyBtn');
    setBusy(btn, true);
    try {
      await api.devApplyAutomationProfile();
      setSave('자동화 프로필 적용됨', true);
      await renderDeveloperMode(el);
    } catch (error) {
      $('#devAnalyzeState').textContent = '적용 실패: ' + (error.message || error);
      $('#devAnalyzeState').style.color = 'var(--red)';
    } finally {
      if (document.body.contains(btn)) setBusy(btn, false);
    }
  });
}

function renderDeveloperReportHtml(report) {
  const list = (items) => Array.isArray(items) && items.length
    ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '<p class="hint">없음</p>';
  const stage = Array.isArray(report.stageGuidance) && report.stageGuidance.length
    ? report.stageGuidance.map((item) => `<div class="developer-stage"><b>${esc(item.stage)}</b><span>${esc(item.guidance)}</span></div>`).join('')
    : '<p class="hint">단계별 지침 없음</p>';
  return `
    <div class="developer-report-head">
      <b>${esc(report.profileTitle || '자동화 프로필 제안')}</b>
      <span>${esc(report.summary || '')}</span>
    </div>
    <div class="developer-report-grid">
      <section><h3>공통 규칙</h3>${list(report.rules)}</section>
      <section><h3>스타일 신호</h3>${list(report.styleSignals)}</section>
      <section><h3>회귀 체크</h3>${list(report.regressionChecks)}</section>
      <section><h3>주의점</h3>${list(report.risks)}</section>
    </div>
    <section class="developer-stage-list"><h3>단계별 지침</h3>${stage}</section>`;
}

// ---------- 프로필 / 연결 설정 ----------
function openProfileView() {
  state.view = 'profile';
  renderAll();
}

function profileStatusText() {
  if (state.google.connected) return state.google.profile?.email || 'Google 계정 연결됨';
  if (state.google.configured) return 'Google 연결 준비됨';
  return 'Google 연결 설정이 필요합니다';
}

async function saveProfileFields() {
  await api.settingsSet('reporterName', $('#profileName').value.trim());
  await api.settingsSet('reporterTitle', $('#profileTitle').value.trim());
  const selectedTheme = document.querySelector('input[name="appTheme"]:checked')?.value || state.theme || 'ink';
  await api.settingsSet('appTheme', selectedTheme);
  applyTheme(selectedTheme);
  const developerMode = Boolean($('#developerModeToggle')?.checked);
  await api.settingsSet('developerMode', developerMode ? 'true' : 'false');
  state.developerMode = developerMode;

  const user = normalizeDgistMailUser($('#profileMailUser').value);
  await api.settingsSet('smtpUser', user);
  await api.settingsSet('imapUser', user);
  await api.settingsSet('smtpHost', $('#profileSmtpHost').value.trim());
  await api.settingsSet('smtpPort', $('#profileSmtpPort').value.trim());
  await api.settingsSet('imapHost', $('#profileImapHost').value.trim());
  await api.settingsSet('imapPort', $('#profileImapPort').value.trim());
  const pass = $('#profileMailPass').value.trim();
  if (pass) await api.settingsSet('smtpPass', pass);

  await api.settingsSet('whisperBin', $('#profileWhisperBin').value.trim());
  await api.settingsSet('whisperModel', $('#profileWhisperModel').value.trim());
  await refreshProfile();
}

function updateBadgeClass(update = {}) {
  if (update.downloaded || update.status === 'current') return 'ready';
  if (update.status === 'available' || update.status === 'downloading' || update.status === 'checking') return 'standby';
  return '';
}

function updateBadgeText(update = {}) {
  const status = update.status || 'idle';
  if (!update.enabled) return '설치본 필요';
  if (update.downloaded) return '설치 준비됨';
  if (status === 'downloading') return '다운로드 중';
  if (status === 'checking') return '확인 중';
  if (status === 'current') return '최신';
  if (status === 'available') return '새 버전';
  if (status === 'error') return '확인 실패';
  return '대기';
}

function formatUpdateBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderUpdateStatusHtml(update = {}) {
  const progress = update.progress?.percent != null ? Math.round(update.progress.percent) : null;
  const version = update.availableVersion || update.info?.version || '';
  const detail = update.error || update.message || '업데이트 확인 대기 중';
  return `
    <div class="update-card-main">
      <b>현재 버전 ${esc(update.currentVersion || '알 수 없음')}${version ? ` → ${esc(version)}` : ''}</b>
      <span>${esc(detail)}</span>
    </div>
    <div class="update-progress" aria-label="업데이트 진행률">
      <span style="width:${progress == null ? 0 : Math.max(4, Math.min(100, progress))}%"></span>
    </div>
    <small>${progress == null ? 'GitHub Releases에 새 버전이 올라오면 자동으로 확인합니다.' : `${progress}% · ${formatUpdateBytes(update.progress?.transferred)} / ${formatUpdateBytes(update.progress?.total)}`}</small>`;
}

function renderProfileUpdateStatus() {
  const box = $('#profileUpdateBox');
  if (box) box.innerHTML = renderUpdateStatusHtml(state.update);
  const badge = $('#updateStateBadge');
  if (badge) {
    badge.textContent = updateBadgeText(state.update);
    badge.className = `section-state ${updateBadgeClass(state.update)}`;
  }
  const installBtn = $('#profileUpdateInstallBtn');
  if (installBtn) installBtn.disabled = !state.update?.downloaded;
}

async function renderProfileView(el) {
  await refreshProfile();
  const [hasGoogleAi, hasMailPass] = await Promise.all([
    api.hasApiKey(),
    api.hasSmtpPass?.() || false,
  ]);
  const values = {};
  for (const key of [
    'smtpUser', 'imapUser', 'smtpHost', 'smtpPort', 'imapHost', 'imapPort',
    'whisperBin', 'whisperModel',
  ]) values[key] = await api.settingsGet(key);

  const googleName = state.google.profile?.name || state.profile.name || 'Google 계정';
  el.innerHTML = `
    <div class="profile-page">
      <header class="profile-hero">
        <div class="profile-avatar-large">${esc(profileInitials())}</div>
        <div class="profile-identity">
          <h1>${esc(state.profile.name || googleName || '내 프로필')}</h1>
          <p>${esc(state.profile.title || '기자')} · ${esc(profileStatusText())}</p>
        </div>
        <button id="profileSaveBtn" class="btn primary">${ic('save')} 변경사항 저장</button>
      </header>

      <section class="profile-section">
        <div class="profile-section-head">
          <div><h2>기자 프로필</h2><p>인사말, 이메일 서명, 기사 내보내기에 사용됩니다.</p></div>
          <span class="section-state ${state.profile.name ? 'ready' : ''}">${state.profile.name ? '설정됨' : '입력 필요'}</span>
        </div>
        <div class="profile-grid two">
          <label>이름<input id="profileName" value="${esc(state.profile.name)}" placeholder="김유준"></label>
          <label>직함<input id="profileTitle" value="${esc(state.profile.title)}" placeholder="기자"></label>
        </div>
      </section>

      <section class="profile-section">
        <div class="profile-section-head">
          <div><h2>Google 계정</h2><p>Gemini AI와 개발자 자료 Drive 업로드를 같은 계정으로 처리합니다.</p></div>
          <span class="section-state ${state.google.connected && !state.google.needsReconnect ? 'ready' : state.google.configured ? 'standby' : ''}">${state.google.connected && !state.google.needsReconnect ? '연결됨' : state.google.needsReconnect ? '권한 갱신 필요' : state.google.configured ? '준비됨' : '미설정'}</span>
        </div>
        <div class="connection-row">
          <div class="connection-mark google-mark">G</div>
          <div class="connection-copy">
            <b>${esc(state.google.connected ? googleName : 'Google 계정 연결')}</b>
            <span>${esc(state.google.needsReconnect ? 'Drive 업로드 권한을 추가하려면 다시 연결하세요.' : profileStatusText())}</span>
          </div>
          <div class="connection-actions">
            ${(!state.google.connected || state.google.needsReconnect)
              ? `<button id="googleConnectBtn" class="btn" ${state.google.configured ? '' : 'disabled'}>${ic('link')} ${state.google.needsReconnect ? '권한 갱신' : 'Google로 연결'}</button>`
              : ''}
            ${state.google.connected ? `<button id="googleDisconnectBtn" class="btn ghost">연결 해제</button>` : ''}
          </div>
        </div>
        <div id="googleProfileNote" class="profile-note"></div>
      </section>

      <section class="profile-section">
        <div class="profile-section-head">
          <div><h2>AI 연결</h2><p>브레인스토밍, 자료 분석, 기사 초안과 카드뉴스 구성안은 Google 계정으로 실행됩니다.</p></div>
          <span class="section-state ${hasGoogleAi ? 'ready' : ''}">${hasGoogleAi ? '사용 가능' : 'Google 연결 필요'}</span>
        </div>
        <div class="ai-account-card">
          <b>${hasGoogleAi ? 'Google 계정만으로 Gemini 호출 준비됨' : 'Google 계정을 먼저 연결하세요'}</b>
          <span>${hasGoogleAi ? 'API 키 입력 없이 OAuth 토큰으로 AI 기능을 호출합니다.' : '위 Google 계정 버튼을 누르면 브라우저 인증 후 앱으로 돌아옵니다.'}</span>
        </div>
      </section>

      <section class="profile-section">
        <div class="profile-section-head">
          <div><h2>앱 디자인</h2></div>
          <span class="section-state ready">선택 가능</span>
        </div>
        <div class="theme-grid">
          ${[
            ['ink', 'Ink Editorial', '밝은 종이와 세리프 헤드라인, 주황 잉크 포인트'],
            ['midnight', 'Midnight Signal', '다크 모드 + 인디고 시그널 글로우'],
            ['porcelain', 'Porcelain Studio', '쿨그레이와 흰 카드, 코발트 블루'],
          ].map(([value, name, desc]) => `
            <label class="theme-choice">
              <input type="radio" name="appTheme" value="${value}" ${state.theme === value ? 'checked' : ''}>
              <span class="theme-swatch theme-${value}"></span>
              <b>${name}</b>
              <small>${desc}</small>
            </label>
          `).join('')}
        </div>
      </section>

      <section class="profile-section">
        <div class="profile-section-head">
          <div><h2>개발자 모드</h2></div>
          <span class="section-state ${state.developerMode ? 'ready' : ''}">${state.developerMode ? '켜짐' : '꺼짐'}</span>
        </div>
        <label class="switch-row">
          <input id="developerModeToggle" type="checkbox" ${state.developerMode ? 'checked' : ''}>
          <span>설정·표본 업데이트 도구 보이기</span>
        </label>
      </section>

      <section class="profile-section">
        <div class="profile-section-head">
          <div><h2>앱 업데이트</h2></div>
          <span id="updateStateBadge" class="section-state ${updateBadgeClass(state.update)}">${esc(updateBadgeText(state.update))}</span>
        </div>
        <div id="profileUpdateBox" class="update-card">
          ${renderUpdateStatusHtml(state.update)}
        </div>
        <div class="connection-actions left">
          <button id="profileUpdateCheckBtn" class="btn">${ic('download')} 업데이트 확인</button>
          <button id="profileUpdateInstallBtn" class="btn primary" ${state.update?.downloaded ? '' : 'disabled'}>${ic('check')} 재시작하여 설치</button>
        </div>
      </section>

      <section class="profile-section">
        <div class="profile-section-head">
          <div><h2>DGIST 메일</h2><p>취재 메일 발송과 회신·취재 요청 메일 수신에 사용됩니다.</p></div>
          <span class="section-state ${values.smtpUser && hasMailPass ? 'ready' : ''}">${values.smtpUser && hasMailPass ? '로그인 정보 저장됨' : '로그인 필요'}</span>
        </div>
        <div class="profile-grid two">
          <label>학교 이메일<input id="profileMailUser" value="${esc(values.smtpUser || values.imapUser || '')}" placeholder="아이디 또는 전체 이메일"></label>
          <label>메일 비밀번호<input id="profileMailPass" type="password" placeholder="${hasMailPass ? '저장됨 · 변경할 때만 입력' : 'DGIST 메일 비밀번호'}"></label>
        </div>
        <div class="connection-actions left">
          <button id="profileSmtpTestBtn" class="btn ghost">SMTP 테스트</button>
          <button id="profileImapTestBtn" class="btn ghost">IMAP 테스트</button>
          <span id="profileMailState" class="profile-note inline"></span>
        </div>
        <details class="profile-advanced">
          <summary>서버 상세 설정</summary>
          <div class="profile-grid four">
            <label>SMTP 호스트<input id="profileSmtpHost" value="${esc(values.smtpHost || 'mail.dgist.ac.kr')}"></label>
            <label>SMTP 포트<input id="profileSmtpPort" value="${esc(values.smtpPort || '587')}"></label>
            <label>IMAP 호스트<input id="profileImapHost" value="${esc(values.imapHost || 'mail.dgist.ac.kr')}"></label>
            <label>IMAP 포트<input id="profileImapPort" value="${esc(values.imapPort || '993')}"></label>
          </div>
        </details>
      </section>

      <section class="profile-section">
        <details class="profile-advanced">
          <summary>로컬 인터뷰 받아쓰기</summary>
          <div class="profile-grid two">
            <label>whisper 바이너리<input id="profileWhisperBin" value="${esc(values.whisperBin || '')}" placeholder="whisper-cli 경로"></label>
            <label>whisper 모델<input id="profileWhisperModel" value="${esc(values.whisperModel || '')}" placeholder="ggml-*.bin 경로"></label>
          </div>
        </details>
      </section>
    </div>`;

  $('#profileSaveBtn').onclick = async () => {
    const btn = $('#profileSaveBtn');
    setBusy(btn, true);
    try {
      await saveProfileFields();
      setSave('프로필 저장됨', true);
      renderGreeting();
      renderRailProfile();
      await renderProfileView(el);
    } catch (error) {
      note('#googleProfileNote', 'alert', '저장 실패', error.message || String(error));
    } finally {
      if (document.body.contains(btn)) setBusy(btn, false);
    }
  };

  if ($('#googleConnectBtn')) {
    $('#googleConnectBtn').onclick = async () => {
      const btn = $('#googleConnectBtn');
      setBusy(btn, true);
      note('#googleProfileNote', 'ok', 'Google 로그인 대기', '브라우저에서 계정을 선택하고 동의하면 자동으로 돌아옵니다.');
      try {
        state.google = await api.googleConnect();
        await refreshProfile();
        setSave('Google 계정 연결됨', true);
        await renderProfileView(el);
      } catch (error) {
        const label = state.google.connected ? 'Google 권한 갱신 실패' : 'Google 연결 실패';
        const text = state.google.connected
          ? `${error.message || String(error)}\n이미 연결된 계정은 계속 사용할 수 있습니다. Drive 업로드 권한이 필요하면 다시 시도하세요.`
          : (error.message || String(error));
        note('#googleProfileNote', 'alert', label, text);
      } finally {
        if (document.body.contains(btn)) setBusy(btn, false);
      }
    };
  }
  if ($('#googleDisconnectBtn')) {
    $('#googleDisconnectBtn').onclick = async () => {
      state.google = await api.googleDisconnect();
      setSave('Google 계정 연결 해제됨', true);
      await renderProfileView(el);
    };
  }
  el.querySelectorAll('input[name="appTheme"]').forEach((input) => {
    input.onchange = () => applyTheme(input.value);
  });
  $('#developerModeToggle')?.addEventListener('change', async (event) => {
    state.developerMode = event.target.checked;
    await api.settingsSet('developerMode', state.developerMode ? 'true' : 'false');
    renderHubButtons();
    setSave(state.developerMode ? '개발자 모드 켜짐' : '개발자 모드 꺼짐', true);
  });
  $('#profileUpdateCheckBtn')?.addEventListener('click', async () => {
    const btn = $('#profileUpdateCheckBtn');
    setBusy(btn, true);
    try {
      state.update = await api.updateCheck();
      renderProfileUpdateStatus();
    } catch (error) {
      state.update = { ...state.update, status: 'error', error: error.message || String(error), message: '업데이트 확인 실패' };
      renderProfileUpdateStatus();
    } finally {
      setBusy(btn, false);
    }
  });
  $('#profileUpdateInstallBtn')?.addEventListener('click', async () => {
    const btn = $('#profileUpdateInstallBtn');
    setBusy(btn, true);
    try {
      state.update = await api.updateInstall();
      renderProfileUpdateStatus();
    } catch (error) {
      state.update = { ...state.update, status: 'error', error: error.message || String(error), message: '업데이트 설치 시작 실패' };
      renderProfileUpdateStatus();
      setBusy(btn, false);
    }
  });

  const saveMailFields = async () => {
    const user = normalizeDgistMailUser($('#profileMailUser').value);
    $('#profileMailUser').value = user;
    await api.settingsSet('smtpUser', user);
    await api.settingsSet('imapUser', user);
    await api.settingsSet('smtpHost', $('#profileSmtpHost').value.trim());
    await api.settingsSet('smtpPort', $('#profileSmtpPort').value.trim());
    await api.settingsSet('imapHost', $('#profileImapHost').value.trim());
    await api.settingsSet('imapPort', $('#profileImapPort').value.trim());
    const pass = $('#profileMailPass').value.trim();
    if (pass) await api.settingsSet('smtpPass', pass);
  };
  $('#profileSmtpTestBtn').onclick = async () => {
    const status = $('#profileMailState');
    status.textContent = 'SMTP 확인 중';
    try {
      await saveMailFields();
      const result = await api.mailVerify();
      status.textContent = result.ok ? 'SMTP 연결 성공' : result.error;
      status.className = `profile-note inline ${result.ok ? 'success' : 'error'}`;
    } catch (error) {
      status.textContent = error.message || String(error);
      status.className = 'profile-note inline error';
    }
  };
  $('#profileImapTestBtn').onclick = async () => {
    const status = $('#profileMailState');
    status.textContent = 'IMAP 확인 중';
    try {
      await saveMailFields();
      const result = await api.mailImapVerify();
      status.textContent = result.ok ? 'IMAP 연결 성공' : result.error;
      status.className = `profile-note inline ${result.ok ? 'success' : 'error'}`;
    } catch (error) {
      status.textContent = error.message || String(error);
      status.className = 'profile-note inline error';
    }
  };
}

// ---------- 이벤트 ----------
function closeProjectDialog() {
  $('#projectDlg').close();
  $('#projectError').textContent = '';
}
function openProjectDialog() {
  $('#projectTitleInput').value = state.project?.title || '';
  $('#projectSaveBtn').innerHTML = `${ic('save')} 이름 저장`;
  $('#projectError').textContent = '';
  $('#projectDlg').showModal();
  $('#projectTitleInput').focus();
}
$('#newProjectBtn').onclick = openNewProjectView;
$('#renameProjectBtn').onclick = () => {
  if (state.projectId) openProjectDialog();
};
$('#projectCloseBtn').onclick = closeProjectDialog;
$('#projectCancelBtn').onclick = closeProjectDialog;
$('#projectSaveBtn').onclick = async () => {
  const title = $('#projectTitleInput').value.trim();
  if (!title) {
    $('#projectError').textContent = '기사 제목을 입력하세요.';
    $('#projectTitleInput').focus();
    return;
  }
  const btn = $('#projectSaveBtn');
  setBusy(btn, true);
  try {
    await api.projectRename(state.projectId, title);
    closeProjectDialog();
    await refreshProjects();
    setSave('제목 변경됨', true);
  } catch (error) {
    $('#projectError').textContent = error.message || String(error);
  } finally {
    if (document.body.contains(btn)) setBusy(btn, false);
  }
};
$('#projectTitleInput').onkeydown = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('#projectSaveBtn').click();
  }
};
$('#deleteProjectBtn').onclick = async () => {
  if (!state.projectId) return;
  if (!confirm(`프로젝트 "${state.project?.title}"과(와) 모든 자료·산출물을 삭제할까요? 되돌릴 수 없습니다.`)) return;
  await api.projectDelete(state.projectId);
  state.projectId = null;
  refreshProjects();
  setSave('프로젝트 삭제됨', true);
};
$('#meCloseBtn').onclick = () => $('#matEditDlg').close();
$('#matAddBtn').onclick = async () => {
  try {
    await api.materialAdd({
      projectId: state.projectId,
      kind: $('#matKind').value,
      title: $('#matTitle').value || '(제목 없음)',
      content: $('#matContent').value,
      source: $('#matSource').value,
    });
    $('#matTitle').value = ''; $('#matContent').value = ''; $('#matSource').value = '';
    renderMaterials();
    setSave('자료 저장됨', true);
  } catch (e) {
    alert(e.message || e);
  }
};
$('#fbSaveBtn').onclick = async () => {
  if (!state.currentRecordId) return;
  await api.recordFeedback(state.currentRecordId, { rating: state.rating || undefined, tags: [...state.tags] });
  setSave('평가 저장됨 — 감사합니다', true);
};
$('#sideToggle').onclick = () => {
  state.sideOpen = !sideVisible();
  applySideVisibility();
};

$('#dashBtn').onclick = async () => {
  const m = await api.recordMetrics();
  const cnt = await api.archiveCount();
  const body = $('#dashBody');
  body.innerHTML = '';
  if (!m.length) {
    body.textContent = '완료된 레코드가 아직 없습니다. 각 단계에서 "최종본 저장"을 하면 지표가 쌓입니다.';
  } else {
    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse';
    table.innerHTML = '<tr style="color:var(--dim); font-size:12px"><th align="left">단계</th><th align="right">레코드</th><th align="right">평균 수정량</th><th align="right">평균 평점</th></tr>';
    for (const row of m) {
      const tr = document.createElement('tr');
      const cells = [row.stage, row.n, row.avg_edit_distance != null ? Math.round(row.avg_edit_distance) : '—', row.avg_rating != null ? Number(row.avg_rating).toFixed(1) : '—'];
      tr.innerHTML = cells.map((c, i) => `<td align="${i ? 'right' : 'left'}" style="padding:5px 0; border-top:1px solid var(--line)">${esc(String(c))}</td>`).join('');
      table.appendChild(tr);
    }
    body.appendChild(table);
  }
  const p = document.createElement('p');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = `아카이브: 과거 기사 ${cnt}건 (브레인스토밍 중복 검사에 사용)`;
  body.appendChild(p);
  $('#dashDlg').showModal();
};
$('#dashCloseBtn').onclick = () => $('#dashDlg').close();
$('#dashBackupBtn').onclick = async () => {
  const out = await api.backupRun();
  setSave('백업 생성됨: ' + out, true);
  $('#dashDlg').close();
};

$('#flowMapBtn').onclick = () => {
  state.view = 'flow';
  renderAll();
};
$('#mailCenterBtn').onclick = () => {
  state.view = 'mail';
  renderAll();
};
$('#devModeBtn').onclick = () => {
  if (!state.developerMode) return;
  state.view = 'developer';
  renderAll();
};

$('#settingsBtn').onclick = openProfileView;

// ---------- 전역 단축키 ----------
// Ctrl/Cmd+S = 현재 단계 저장, Ctrl/Cmd+Enter = 현재 단계 AI 실행
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const saveBtns = { draft: 'saveDraftBtn', email: 'emSaveBtn', brainstorm: 'bsSaveBtn', analyze: 'anSaveBtn' };
  const aiBtns = { draft: 'genBtn', email: 'emGenBtn', brainstorm: 'bsGenBtn', analyze: 'anGenBtn', cardnews: 'planBtn', collect: 'colSuggestBtn' };
  if (e.key === 's') {
    e.preventDefault();
    document.getElementById(saveBtns[state.stage])?.click();
  } else if (e.key === 'Enter') {
    const btn = document.getElementById(aiBtns[state.stage]);
    if (btn) { e.preventDefault(); btn.click(); }
  }
});

function renderAll() {
  renderGreeting();
  renderHubButtons();
  renderProjectList();
  renderStepper();
  renderCrumb();
  renderWork();
  renderMaterials();
  renderFeedback();
  applySideVisibility();
}

// 레일 아이콘
$('#newProjectBtn').innerHTML = ic('plus');
$('#renameProjectBtn').innerHTML = ic('pen');
$('#deleteProjectBtn').innerHTML = ic('trash');
$('#dashBtn').innerHTML = `${ic('gauge')} 지표와 백업`;
$('#sideToggle').innerHTML = `${ic('panel')} 패널`;
$('#flowMapBtn').innerHTML = `${ic('map')} 진행 노트`;
$('#mailCenterBtn').innerHTML = `${ic('inbox')} 메일함`;
$('#devModeBtn').innerHTML = `${ic('spark')} 개발자 모드`;
if (api.onUpdateEvent) {
  api.onUpdateEvent((payload) => {
    state.update = payload || state.update;
    renderProfileUpdateStatus();
  });
}
refreshProjects();
