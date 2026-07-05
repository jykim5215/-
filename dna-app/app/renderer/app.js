/* DNA 편집 스튜디오 렌더러.
 * window.dnaAPI(Electron preload)가 없으면 브라우저 데모 모드로 동작한다
 * (인메모리 저장 + 캔드 AI 응답) — UI 검토용. */
'use strict';

const STAGES = [
  { key: 'brainstorm', name: '브레인스토밍' },
  { key: 'email', name: '취재 이메일' },
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
  const DEMO_DRAFT = `침체기 딛고 다시 노를 젓다 — 조정부, 학생단체 승격\n\nDGIST 조정부가 2026년 '기타 학생단체'로 승격되었다. 코로나19로 활동이 중단됐던 조정부는 대회 복귀와 운영 정상화를 거쳐 승격 심의를 통과했다.\n\n조정부 부장 박성현 학생은 "지난 2년간 정기 훈련과 대외 대회 출전 실적을 꾸준히 쌓아 왔다"고 말했다.\n\n---확인 필요---\n- 동아리연합회 심의 일정 확정 여부\n- 승격 이후 예산 규모`;
  return {
    _demo: true,
    async settingsGet(k) { return db.settings[k] || ''; },
    async settingsSet(k, v) { db.settings[k] = v; },
    async hasApiKey() { return false; },
    async projectCreate(d) { const id = uid(); db.projects.push({ id, title: d.title, keywords: d.keywords || [], article_type: '', current_stage: 'brainstorm' }); return id; },
    async projectList() { return [...db.projects]; },
    async projectGet(id) { return db.projects.find((p) => p.id === id) || null; },
    async projectSetStage(id, st) { const p = db.projects.find((x) => x.id === id); if (p) p.current_stage = st; },
    async materialAdd(d) { if (!d.source || !d.source.trim()) throw new Error('출처(source)가 없는 자료는 저장할 수 없습니다.'); const id = uid(); db.materials.push({ id, project_id: d.projectId, ...d }); return id; },
    async materialList(pid) { return db.materials.filter((m) => m.project_id === pid); },
    async outputSave(d) { db.outputs.push(d); return { version: db.outputs.length }; },
    async outputLatest(pid, st) { return [...db.outputs].reverse().find((o) => o.projectId === pid && o.stage === st) || null; },
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
    async showFile() {},
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

// ---------- 상태 ----------
const state = {
  projectId: null,
  project: null,
  stage: 'draft',
  currentRecordId: null,
  rating: 0,
  tags: new Set(),
  cardPlan: null,
};

const $ = (sel) => document.querySelector(sel);

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

// ---------- 스테퍼 ----------
function renderStepper() {
  const el = $('#stepper');
  el.innerHTML = '';
  const curIdx = STAGE_ORDER.indexOf(state.stage);
  STAGES.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'pill' + (i < curIdx ? ' done' : i === curIdx ? ' cur' : '');
    div.innerHTML = `<span class="n">${i < curIdx ? '✓' : i + 1}</span>${s.name}`;
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
    div.innerHTML = `<span class="t"></span><span class="s">출처: <b></b> · ${m.kind}</span>`;
    div.querySelector('.t').textContent = m.title;
    div.querySelector('b').textContent = m.source;
    listEl.appendChild(div);
  }
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
  const el = $('#workArea');
  el.innerHTML = '';
  if (!state.projectId) {
    el.innerHTML = `<div class="placeholder"><b>프로젝트가 없습니다.</b><br>상단의 "+ 새 프로젝트"로 시작하세요.</div>`;
    return;
  }
  if (state.stage === 'draft') return renderDraftStage(el);
  if (state.stage === 'cardnews') return renderCardnewsStage(el);
  el.innerHTML = `<div class="placeholder"><b>${STAGES.find((s) => s.key === state.stage).name}</b> 단계는 마일스톤 4에서 구현됩니다.<br>현재는 단계 5(기사 초안)·6(카드뉴스)이 동작합니다.</div>`;
}

async function renderDraftStage(el) {
  el.innerHTML = `
    <h1>기사 초안</h1>
    <p class="sub">수집 자료를 근거로 초안을 생성하고, 인용 검증 후 수정해 저장하세요. 저장 시 (AI 초안 ↔ 최종본) 쌍이 학습 데이터로 축적됩니다.</p>
    <div class="toolrow">
      <button id="genBtn" class="btn primary">AI 초안 생성</button>
      <button id="checkBtn" class="btn">인용·따옴표 검사</button>
      <button id="spellBtn" class="btn">맞춤법 (바른한글 열기)</button>
      <button id="saveDraftBtn" class="btn">최종본 저장</button>
    </div>
    <div id="draftNotes"></div>
    <textarea id="draftEditor" class="editor" placeholder="AI 초안을 생성하거나 직접 작성하세요."></textarea>
  `;
  const prev = await api.outputLatest(state.projectId, 'draft');
  if (prev) $('#draftEditor').value = prev.content;

  $('#genBtn').onclick = async () => {
    const btn = $('#genBtn');
    btn.disabled = true; btn.textContent = '생성 중…'; setSave('AI 초안 생성 중');
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
    } finally { btn.disabled = false; btn.textContent = 'AI 초안 생성'; }
  };
  $('#checkBtn').onclick = runCheck;
  $('#spellBtn').onclick = () => window.open('https://바른한글.kr', '_blank');
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
    <p class="sub">기사 초안 → 구성안(커버/카드/마무리) → 공식 2025 템플릿 pptx 생성. 폰트·색·레이아웃은 절대 변경되지 않습니다.</p>
    <div class="toolrow">
      <button id="planBtn" class="btn primary">AI 구성안 생성</button>
      <button id="pptxBtn" class="btn" disabled>pptx 생성</button>
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
    btn.disabled = true; btn.textContent = '생성 중…';
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
    } finally { btn.disabled = false; btn.textContent = 'AI 구성안 생성'; }
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
    const cover = document.createElement('div');
    cover.className = 'card-item';
    cover.innerHTML = `<h4>커버</h4>
      <input id="cpTitle" placeholder="커버 제목 (최대 2줄, \\n로 줄 구분)">
      <input id="cpCategory" placeholder="카테고리 (대괄호 금지)">`;
    area.appendChild(cover);
    $('#cpTitle').value = plan.coverTitle || '';
    $('#cpCategory').value = plan.category || '';
    (plan.cards || []).forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'card-item';
      d.innerHTML = `<h4>카드 ${i + 1}</h4>
        <input class="cTitle" placeholder="카드 제목">
        <textarea class="cBody" placeholder="카드 본문"></textarea>
        <input class="cCredit" placeholder="사진 출처 (퍼온 사진만, 예: 대한민국 국회)">`;
      area.appendChild(d);
      d.querySelector('.cTitle').value = c.title || '';
      d.querySelector('.cBody').value = c.body || '';
      d.querySelector('.cCredit').value = c.photoCredit || '';
    });
  }
  function collectPlanFromEditor() {
    if (!state.cardPlan) return;
    state.cardPlan.coverTitle = $('#cpTitle').value;
    state.cardPlan.category = $('#cpCategory').value;
    const items = [...document.querySelectorAll('#planArea .card-item')].slice(1);
    state.cardPlan.cards = items.map((d) => ({
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
  renderWork();
  renderMaterials();
  renderFeedback();
}

if (api._demo) setSave('브라우저 데모 모드 (Electron 아님)');
refreshProjects();
