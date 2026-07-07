/* DNA 편집 스튜디오 렌더러.
 * window.dnaAPI(Electron preload)가 없으면 브라우저 데모 모드로 동작한다
 * (인메모리 저장 + 캔드 AI 응답) — UI 검토용. */
'use strict';

const STAGES = [
  { key: 'brainstorm', name: '브레인스토밍' },
  { key: 'email', name: '취재 이메일', optional: true },
  { key: 'collect', name: '자료 수집' },
  { key: 'analyze', name: '분석·제언' },
  { key: 'draft', name: '기사 초안' },
  { key: 'cardnews', name: '카드뉴스' },
];
const STAGE_ORDER = STAGES.map((s) => s.key);
const FB_TAGS = ['구조 좋음', '인용 오류', '톤 부적절', '리드 약함', '사실 정확', '분량 적절'];

// ---------- 데모 모드 (브라우저) ----------
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
    async projectCreate(d) { const id = uid(); db.projects.push({ id, title: d.title, keywords: d.keywords || [], article_type: '', current_stage: 'brainstorm' }); return id; },
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
    async validateCardplan(plan) { return { ok: true, errors: [], warnings: plan.cards?.length > 10 ? ['카드 수 초과'] : [] }; },
    async aiDraft() { await sleep(600); return { text: DEMO_DRAFT, recordId: 'demo-rec' }; },
    async aiCardplan(_pid, draft) {
      await sleep(600);
      return { recordId: 'demo-rec2', plan: { coverTitle: '침체기 딛고\n다시 노를 젓다', category: '사회', cards: [
        { title: '다시 노를 젓는 조정부', body: 'DGIST 조정부가 2026년 ‘기타 학생단체’로 승격되었다.' },
        { title: 'Q1. 자기소개', body: '간단한 자기소개 부탁드립니다.' },
      ] } };
    },
    async cardnewsGenerate() { return { outPath: '(데모 모드 — Electron에서만 생성됩니다)', warnings: [], slideCount: 4 }; },
    async draftExportDocx() { return { outPath: '(데모 모드 — Electron 앱에서 docx가 프로젝트 폴더에 저장됩니다)' }; },
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
    async validateEmail(d) {
      const issues = [];
      if (!d.subject.startsWith('[디지스트신문 DNA]')) issues.push({ type: 'subject-prefix', message: '제목이 [디지스트신문 DNA] 로 시작해야 합니다.' });
      return { ok: !issues.length, issues };
    },
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

const api = window.dnaAPI || makeMockAPI();


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
};
function ic(name) {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}
const STAGE_ICONS = { brainstorm: 'bulb', email: 'mail', collect: 'folder', analyze: 'chart', draft: 'pen', cardnews: 'grid' };

// 버튼 로딩 상태 (텍스트 대신 스피너)
function setBusy(btn, on) {
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
  stage: 'draft',
  currentRecordId: null,
  rating: 0,
  tags: new Set(),
  cardPlan: null,
  skippedStages: new Set(), // 선택 단계(이메일) 건너뛰기 표시
  doc: null,                // 브레인스토밍 기획 문서 (노션식 블록)
  sideOpen: null,           // null = 단계별 자동 (브레인스토밍은 숨김)
};

// 사이드 패널: 브레인스토밍에서는 기본 숨김 — 보드를 넓게 쓴다
function sideVisible() {
  return state.sideOpen ?? (state.stage !== 'brainstorm');
}
function applySideVisibility() {
  document.querySelector('.frame').classList.toggle('no-side', !sideVisible());
  $('#sideToggle').innerHTML = `${ic('panel')} ${sideVisible() ? '패널 접기' : '패널 열기'}`;
}

// 상단 브레드크럼: 프로젝트 › 현재 단계
function renderCrumb() {
  const el = $('#crumb');
  if (!el) return;
  const stageName = STAGES.find((s) => s.key === state.stage)?.name || '';
  const proj = state.project?.title || '프로젝트 없음';
  el.innerHTML = `<span class="cr-dim"></span> › <span></span>`;
  el.children[0].textContent = proj;
  el.children[1].textContent = stageName;
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
  const list = await api.projectList();
  const sel = $('#projectSelect');
  sel.innerHTML = '';
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    sel.appendChild(opt);
  }
  if (!list.length) {
    const opt = document.createElement('option');
    opt.textContent = '프로젝트 없음 — 새 프로젝트를 만드세요';
    opt.value = '';
    sel.appendChild(opt);
  } else {
    if (!state.projectId || !list.some((p) => p.id === state.projectId)) {
      state.projectId = list[0].id;
    }
    sel.value = state.projectId;
    state.project = list.find((p) => p.id === state.projectId);
    state.stage = state.project.current_stage || 'brainstorm';
  }
  renderAll();
}

// ---------- 워크플로우 내비 (레일 세로 목록) ----------
function renderStepper() {
  const el = $('#stepper');
  el.innerHTML = '';
  const curIdx = STAGE_ORDER.indexOf(state.stage);
  STAGES.forEach((s, i) => {
    const div = document.createElement('div');
    const skipped = s.optional && state.skippedStages?.has(s.key) && i < curIdx;
    div.className =
      'nav-item' +
      (i === curIdx ? ' cur' : skipped ? ' skipped' : i < curIdx ? ' done' : '');
    const mark = skipped ? '–' : i < curIdx ? '✓' : ic(STAGE_ICONS[s.key]);
    div.innerHTML = `<span class="nv-st">${mark}</span><span class="nv-name"></span>` +
      (s.optional ? '<span class="opt-tag">선택</span>' : '');
    div.querySelector('.nv-name').textContent = s.name;
    div.title = s.optional ? '선택 단계 — 필요할 때만 진행합니다' : '';
    div.onclick = () => { state.stage = s.key; if (state.projectId) api.projectSetStage(state.projectId, s.key); renderAll(); };
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
  if (!state.projectId) {
    el.innerHTML = `<div class="placeholder"><b>프로젝트가 없습니다.</b><br>상단의 "+ 새 프로젝트"로 시작하세요.</div>`;
    return;
  }
  if (state.stage === 'brainstorm') return renderBrainstormStage(el);
  if (state.stage === 'email') return renderEmailStage(el);
  if (state.stage === 'collect') return renderCollectStage(el);
  if (state.stage === 'analyze') return renderAnalyzeStage(el);
  if (state.stage === 'draft') return renderDraftStage(el);
  if (state.stage === 'cardnews') return renderCardnewsStage(el);
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
    <p class="doc-hint">Enter = 아래에 새 블록 · 빈 블록에서 Backspace = 삭제 · ⋮⋮ 드래그 = 순서/섹션 이동 · 취재 질문은 단계 2 질문지로, 체크리스트는 단계 3 AI 추천 맥락으로 연결됩니다.</p>
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
      <button id="emSaveBtn" class="btn">${ic('save')} 최종본 저장</button>
    </div>
    <div id="emNotes"></div>
    <input id="emSubject" style="width:100%; font-family:inherit; font-size:15px; font-weight:700; border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:8px" placeholder="제목">
    <textarea id="emBody" class="editor" style="min-height:320px" placeholder="본문"></textarea>
  `;
  const prev = await api.outputLatest(state.projectId, 'email');
  if (prev) { try { const e2 = JSON.parse(prev.content); $('#emSubject').value = e2.subject || ''; $('#emBody').value = e2.body || ''; } catch { /* 무시 */ } }

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
      <div class="card-item">
        <h4>파일 업로드 (docx · pdf · txt / hwp는 docx로 변환 후)</h4>
        <input type="file" id="colFile" accept=".docx,.pdf,.txt,.md">
        <input id="colFileSource" placeholder="출처 (필수 — 예: ○○처 제공, 정보공개청구)">
        <button id="colFileBtn" class="btn" style="margin-top:8px">추출 후 저장</button>
      </div>
      <div class="card-item">
        <h4>녹취/메모 붙여넣기</h4>
        <p class="sub" style="margin:0 0 6px">우측 "자료 추가" 패널을 사용하세요. 인터뷰 녹취는 종류를 "인터뷰 녹취"로 선택해야 단계 5 인용 검증에 사용됩니다.</p>
      </div>
    </div>
    <div id="colNotes"></div>
  `;
  $('#colSuggestBtn').onclick = async () => {
    const btn = $('#colSuggestBtn');
    setBusy(btn, true);
    try {
      const { suggestions, recordId } = await api.aiSuggestMaterials(state.projectId);
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      renderFeedback();
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
    } catch (e) { note('#colNotes', 'alert', 'AI 추천 실패', e.message || String(e)); }
    finally { setBusy(btn, false); }
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
  $('#colFileBtn').onclick = async () => {
    const f = $('#colFile').files[0];
    if (!f) return note('#colNotes', 'alert', '파일 없음', '파일을 선택하세요.');
    const source = $('#colFileSource').value.trim();
    if (!source) return note('#colNotes', 'alert', '출처 필수', '출처 없는 자료는 저장할 수 없습니다.');
    try {
      const buf = await f.arrayBuffer();
      const text = await api.extractFile(f.name, buf);
      await api.materialAdd({ projectId: state.projectId, kind: 'file', title: f.name, content: text, source });
      note('#colNotes', 'ok', '저장됨', `${f.name} (${text.length.toLocaleString()}자 추출)`);
      renderMaterials();
    } catch (e) { note('#colNotes', 'alert', '추출 실패', e.message || String(e)); }
  };
}

// ---------- 단계 4: 분석·제언 ----------
async function renderAnalyzeStage(el) {
  el.innerHTML = `
    <h1>자료 분석 및 제언</h1>
    <p class="sub">타임라인 · 상충 주장 · 팩트체크 · 부족한 것 제언</p>
    <div class="toolrow">
      <button id="anGenBtn" class="btn primary">${ic('spark')} AI 분석 실행</button>
      <button id="anSaveBtn" class="btn" disabled>${ic('save')} 리포트 저장</button>
    </div>
    <div id="anNotes"></div>
    <div id="anResult" class="cardplan"></div>
  `;
  const prev = await api.outputLatest(state.projectId, 'analyze');
  if (prev) { try { renderReport(JSON.parse(prev.content)); } catch { /* 무시 */ } }

  let current = null;
  $('#anGenBtn').onclick = async () => {
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
    } catch (e) { note('#anNotes', 'alert', '분석 오류', e.message || String(e)); }
    finally { setBusy(btn, false); }
  };
  $('#anSaveBtn').onclick = async () => {
    if (!current) return;
    const content = JSON.stringify(current, null, 2);
    await api.outputSave({ projectId: state.projectId, stage: 'analyze', content });
    if (state.currentRecordId) await api.recordFinalize(state.currentRecordId, content);
    setSave('분석 리포트 저장됨', true);
  };

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

// HTML 이스케이프 (AI/사용자 텍스트를 innerHTML 조각에 넣을 때 필수)
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renderDraftStage(el) {
  el.innerHTML = `
    <h1>기사 초안</h1>
    <p class="sub">자료 근거 초안 → 인용 검증 → 수정·저장 (저장하면 학습 데이터로 축적)</p>
    <div class="toolrow">
      <button id="genBtn" class="btn primary">${ic('spark')} AI 초안 생성</button>
      <button id="checkBtn" class="btn">인용·따옴표 검사</button>
      <button id="previewBtn" class="btn">${ic('eye')} 미리보기</button>
      <button id="spellBtn" class="btn">${ic('check')} 맞춤법 검사</button>
      <button id="saveDraftBtn" class="btn">${ic('save')} 최종본 저장</button>
      <button id="docxBtn" class="btn">${ic('download')} docx</button>
      <button id="verBtn" class="btn ghost">${ic('clock')} 버전</button>
    </div>
    <div id="draftNotes"></div>
    <div id="spellPanel" class="spell-panel" hidden></div>
    <div id="verPanel" class="ver-panel" hidden></div>
    <textarea id="draftEditor" class="editor" placeholder="AI 초안을 생성하거나 직접 작성하세요. (첫 줄 = 제목)"></textarea>
    <div id="draftPreview" class="draft-preview" hidden></div>
    <div class="editor-foot">
      <span id="charCount" class="char-count"></span>
      <span id="autosaveState" class="autosave-state"></span>
    </div>
  `;
  const prev = await api.outputLatest(state.projectId, 'draft');
  if (prev) $('#draftEditor').value = prev.content;

  const editor = $('#draftEditor');
  updateCharCount();
  editor.addEventListener('input', () => { updateCharCount(); scheduleAutosave(); });

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
      $('#draftEditor').value = text;
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      setSave('초안 생성됨 — 검토 후 수정하세요', true);
      renderFeedback();
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
      const { outPath } = await api.draftExportDocx(state.projectId, text);
      note('#draftNotes', 'ok', 'docx 저장됨', outPath);
      if (api.showFile && !api._demo) api.showFile(outPath);
    } catch (e) { note('#draftNotes', 'alert', 'docx 실패', e.message || String(e)); }
  };
  $('#saveDraftBtn').onclick = async () => {
    const text = $('#draftEditor').value;
    await api.outputSave({ projectId: state.projectId, stage: 'draft', content: text });
    if (state.currentRecordId) {
      const dist = await api.recordFinalize(state.currentRecordId, text);
      setSave(`최종본 저장됨 (수정량 ${dist})`, true);
    } else {
      setSave('최종본 저장됨', true);
    }
  };
  async function runCheck() {
    const res = await api.validateQuotes($('#draftEditor').value, state.projectId);
    renderValidation(res);
  }
}

async function renderCardnewsStage(el) {
  el.innerHTML = `
    <h1>카드뉴스 제작</h1>
    <p class="sub">초안 → 구성안 → 공식 템플릿 pptx (폰트·색·레이아웃 불변)</p>
    <div class="toolrow">
      <button id="planBtn" class="btn primary">${ic('spark')} AI 구성안 생성</button>
      <button id="pptxBtn" class="btn" disabled>${ic('download')} pptx 생성</button>
    </div>
    <div id="cnNotes"></div>
    <div id="planArea" class="cardplan"></div>
  `;
  $('#planBtn').onclick = async () => {
    const draft = await api.outputLatest(state.projectId, 'draft');
    if (!draft || !draft.content) {
      return note('#cnNotes', 'alert', '초안 없음', '먼저 단계 5에서 기사 초안을 저장하세요.');
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
      $('#pptxBtn').disabled = false;
      const v = await api.validateCardplan(plan);
      if (v.warnings?.length) note('#cnNotes', 'warn', '규격 경고', v.warnings.join('\n'));
      if (v.errors?.length) note('#cnNotes', 'alert', '규격 위반', v.errors.join('\n'));
    } catch (e) {
      note('#cnNotes', 'alert', 'AI 오류', e.message || String(e));
    } finally { setBusy(btn, false); }
  };
  $('#pptxBtn').onclick = async () => {
    collectPlanFromEditor();
    try {
      const { outPath, warnings, slideCount } = await api.cardnewsGenerate(state.projectId, state.cardPlan);
      note('#cnNotes', 'ok', `pptx 생성 완료 (${slideCount}장)`, outPath);
      if (warnings?.length) note('#cnNotes', 'warn', '확인 필요', warnings.join('\n'));
      if (state.currentRecordId) {
        await api.recordFinalize(state.currentRecordId, JSON.stringify(state.cardPlan, null, 2));
      }
    } catch (e) {
      note('#cnNotes', 'alert', '생성 실패', e.message || String(e));
    }
  };

  function renderPlanEditor(plan) {
    const area = $('#planArea');
    area.innerHTML = '';
    const noteEl = document.createElement('p');
    noteEl.className = 'prev-note';
    noteEl.textContent = '오른쪽 미리보기는 근사치입니다 — 실제 폰트(나눔스퀘어_ac·Pretendard)·정렬은 생성된 pptx에서 확인하세요. 입력하면 즉시 반영됩니다.';
    area.appendChild(noteEl);

    // 커버: 편집 폼 + 실시간 미리보기
    const cover = document.createElement('div');
    cover.className = 'card-item cn-grid';
    cover.innerHTML = `
      <div><h4>커버</h4>
        <textarea id="cpTitle" rows="2" placeholder="커버 제목 (최대 2줄 — 줄바꿈으로 구분)"></textarea>
        <input id="cpCategory" placeholder="카테고리 (대괄호 금지)">
      </div>
      <div class="cn-prev cover" id="prevCover">
        <span class="photo-hint">📷 사진 영역</span>
        <span class="cat"></span><span class="ttl"></span>
      </div>`;
    area.appendChild(cover);
    $('#cpTitle').value = plan.coverTitle || '';
    $('#cpCategory').value = plan.category || '';

    (plan.cards || []).forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'card-item cn-grid cn-card';
      d.innerHTML = `
        <div><h4>카드 ${i + 1}</h4>
          <input class="cTitle" placeholder="카드 제목">
          <textarea class="cBody" rows="5" placeholder="카드 본문 (최대 380자 권장)"></textarea>
          <input class="cCredit" placeholder="사진 출처 (퍼온 사진만, 예: 대한민국 국회)">
        </div>
        <div class="cn-prev body">
          <span class="h"></span><span class="b"></span>
          <span class="credit"></span><span class="logo">DGIST 로고</span>
        </div>`;
      area.appendChild(d);
      d.querySelector('.cTitle').value = c.title || '';
      d.querySelector('.cBody').value = c.body || '';
      d.querySelector('.cCredit').value = c.photoCredit || '';
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
      prev.querySelector('.b').textContent = body;
      const credit = d.querySelector('.cCredit').value.trim();
      prev.querySelector('.credit').textContent = credit ? `사진 = ${credit} 제공` : '';
      const over = body.replace(/\s+/g, ' ').length > 380;
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
    state.cardPlan.coverTitle = $('#cpTitle').value;
    state.cardPlan.category = $('#cpCategory').value;
    state.cardPlan.cards = [...document.querySelectorAll('#planArea .cn-card')].map((d) => ({
      title: d.querySelector('.cTitle').value,
      body: d.querySelector('.cBody').value,
      photoCredit: d.querySelector('.cCredit').value || undefined,
    }));
  }
}

function note(sel, cls, label, text) {
  const div = document.createElement('div');
  div.className = `note ${cls}`;
  div.innerHTML = `<span class="lab"></span><span style="white-space:pre-wrap"></span>`;
  div.children[0].textContent = label;
  div.children[1].textContent = text;
  $(sel).prepend(div);
}

// ---------- 이벤트 ----------
$('#projectSelect').onchange = (e) => { state.projectId = e.target.value || null; refreshProjects(); };
$('#newProjectBtn').onclick = async () => {
  const title = prompt('프로젝트(기사) 제목:');
  if (!title) return;
  const kw = prompt('키워드 (쉼표 구분, 1~5개):') || '';
  state.projectId = await api.projectCreate({ title, keywords: kw.split(',').map((s) => s.trim()).filter(Boolean) });
  refreshProjects();
};
$('#renameProjectBtn').onclick = async () => {
  if (!state.projectId) return;
  const title = prompt('새 제목:', state.project?.title || '');
  if (!title || !title.trim()) return;
  await api.projectRename(state.projectId, title.trim());
  refreshProjects();
  setSave('제목 변경됨', true);
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

$('#settingsBtn').onclick = async () => {
  $('#setName').value = await api.settingsGet('reporterName');
  $('#setTitle').value = await api.settingsGet('reporterTitle');
  $('#settingsDlg').showModal();
};
$('#setSaveBtn').onclick = async () => {
  await api.settingsSet('reporterName', $('#setName').value);
  await api.settingsSet('reporterTitle', $('#setTitle').value);
  const key = $('#setApiKey').value.trim();
  if (key) await api.settingsSet('apiKey', key);
  $('#setApiKey').value = '';
  $('#settingsDlg').close();
  setSave('설정 저장됨', true);
};
$('#setCloseBtn').onclick = () => $('#settingsDlg').close();

function renderAll() {
  renderStepper();
  renderCrumb();
  renderWork();
  renderMaterials();
  renderFeedback();
  applySideVisibility();
}

// 레일 아이콘
$('#dashBtn').innerHTML = `${ic('gauge')} 지표`;
$('#settingsBtn').innerHTML = `${ic('gear')} 설정`;
$('#sideToggle').innerHTML = `${ic('panel')} 패널`;
if (api._demo) setSave('브라우저 데모 모드 (Electron 아님)');
refreshProjects();
