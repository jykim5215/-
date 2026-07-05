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
  if (state.stage === 'brainstorm') return renderBrainstormStage(el);
  if (state.stage === 'email') return renderEmailStage(el);
  if (state.stage === 'collect') return renderCollectStage(el);
  if (state.stage === 'analyze') return renderAnalyzeStage(el);
  if (state.stage === 'draft') return renderDraftStage(el);
  if (state.stage === 'cardnews') return renderCardnewsStage(el);
}

// ---------- 단계 1: 브레인스토밍 ----------
async function renderBrainstormStage(el) {
  el.innerHTML = `
    <h1>키워드 브레인스토밍</h1>
    <p class="sub">키워드(프로젝트 생성 시 입력)로 기사 각도·제목 후보·취재 질문·자료 체크리스트를 제안받고, 과거 DNA 기사와의 중복을 검사합니다.</p>
    <div class="note ai"><span class="lab">키워드</span><span id="bsKeywords"></span></div>
    <div class="toolrow">
      <button id="bsGenBtn" class="btn primary">AI 기획안 생성</button>
      <button id="bsSaveBtn" class="btn" disabled>기획안 저장</button>
    </div>
    <div id="bsNotes"></div>
    <div id="bsResult" class="cardplan"></div>
  `;
  $('#bsKeywords').textContent = (state.project?.keywords || []).join(', ') || '(키워드 없음)';
  const prev = await api.outputLatest(state.projectId, 'brainstorm');
  if (prev) { try { renderPlanCards(JSON.parse(prev.content)); } catch { /* 무시 */ } }

  let currentPlan = null;
  $('#bsGenBtn').onclick = async () => {
    const btn = $('#bsGenBtn');
    btn.disabled = true; btn.textContent = '생성 중…';
    try {
      const { plan, recordId, duplicates } = await api.aiBrainstorm(state.projectId);
      currentPlan = plan;
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      renderPlanCards(plan);
      renderFeedback();
      $('#bsSaveBtn').disabled = false;
      if (duplicates?.length) {
        note('#bsNotes', 'warn', `과거 기사 중복 가능성 ${duplicates.length}건`,
          duplicates.map((d) => `· ${d.title} (${d.published_at || '날짜 미상'})`).join('\n'));
      } else {
        const n = await api.archiveCount();
        note('#bsNotes', 'ok', '중복 검사', n > 0 ? `아카이브 ${n}건과 겹치는 기사 없음` : '아카이브가 비어 있습니다 — scripts/import-archive.mjs로 과거 기사를 임포트하면 중복 검사가 활성화됩니다.');
      }
    } catch (e) { note('#bsNotes', 'alert', 'AI 오류', e.message || String(e)); }
    finally { btn.disabled = false; btn.textContent = 'AI 기획안 생성'; }
  };
  $('#bsSaveBtn').onclick = async () => {
    if (!currentPlan) return;
    await api.outputSave({ projectId: state.projectId, stage: 'brainstorm', content: JSON.stringify(currentPlan, null, 2) });
    if (state.currentRecordId) await api.recordFinalize(state.currentRecordId, JSON.stringify(currentPlan, null, 2));
    setSave('기획안 저장됨 — 취재 질문이 단계 2 이메일에 자동 첨부됩니다', true);
  };

  function renderPlanCards(plan) {
    const area = $('#bsResult');
    area.innerHTML = '';
    const card = (title, html) => {
      const d = document.createElement('div');
      d.className = 'card-item';
      d.innerHTML = `<h4>${title}</h4>${html}`;
      area.appendChild(d);
      return d;
    };
    card('기사 각도 제안', '<div>' + (plan.angles || []).map((a) =>
      `<p><b>[${esc(a.type)}]</b> ${esc(a.summary)} · 예상 관심도 <b>${esc(a.readerInterest)}</b> — ${esc(a.reason)}</p>`).join('') + '</div>');
    card('제목 후보 3', '<p>' + (plan.titleCandidates || []).map(esc).join('<br>') + '</p>');
    card('필요한 취재원', '<p>' + (plan.sources || []).map(esc).join(' · ') + '</p>');
    card('취재 질문 초안', '<p>' + (plan.questions || []).map((q, i) => `${i + 1}. ${esc(q)}`).join('<br>') + '</p>');
    card('필요 자료 체크리스트', '<p>' + (plan.checklist || []).map((c) => `☐ ${esc(c)}`).join('<br>') + '</p>');
  }
}

// ---------- 단계 2: 취재 이메일 ----------
async function renderEmailStage(el) {
  el.innerHTML = `
    <h1>취재 이메일 작성</h1>
    <p class="sub">DNA 공식 형식(제목 [디지스트신문 DNA] + 용건, 직함→이름 자기소개, 서명)이 자동 적용되고 규칙 검사기가 확인합니다. 단계 1의 취재 질문이 질문지로 자동 첨부됩니다.</p>
    <div class="cardplan">
      <div class="card-item">
        <input id="emRecipient" placeholder="수신자 (예: 동아리연합회 회장)">
        <input id="emPurpose" placeholder="용건 (예: 조정부 승격 심의 관련 서면 인터뷰)">
        <label style="font-size:13px; margin-top:6px; display:block"><input type="checkbox" id="emExternal"> 학외 인사 (매체 소개 포함)</label>
      </div>
    </div>
    <div class="toolrow">
      <button id="emGenBtn" class="btn primary">AI 이메일 생성</button>
      <button id="emCheckBtn" class="btn">형식 검사</button>
      <button id="emSaveBtn" class="btn">최종본 저장</button>
    </div>
    <div id="emNotes"></div>
    <input id="emSubject" style="width:100%; font-family:inherit; font-size:15px; font-weight:700; border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:8px" placeholder="제목">
    <textarea id="emBody" class="editor" style="min-height:320px" placeholder="본문"></textarea>
  `;
  const prev = await api.outputLatest(state.projectId, 'email');
  if (prev) { try { const e2 = JSON.parse(prev.content); $('#emSubject').value = e2.subject || ''; $('#emBody').value = e2.body || ''; } catch { /* 무시 */ } }

  $('#emGenBtn').onclick = async () => {
    const btn = $('#emGenBtn');
    btn.disabled = true; btn.textContent = '생성 중…';
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
    finally { btn.disabled = false; btn.textContent = 'AI 이메일 생성'; }
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
    <p class="sub">URL은 본문·메타데이터가 자동 추출되고, 파일(docx/pdf/txt)은 텍스트가 추출되어 프로젝트에 저장됩니다. 모든 자료는 출처가 필수입니다.</p>
    <div class="cardplan">
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
  $('#colUrlBtn').onclick = async () => {
    const url = $('#colUrl').value.trim();
    if (!url) return;
    const btn = $('#colUrlBtn');
    btn.disabled = true; btn.textContent = '추출 중…';
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
    finally { btn.disabled = false; btn.textContent = '추출 후 저장'; }
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
    <p class="sub">수집 자료를 종합해 타임라인·상충 주장·팩트체크 리스트·부족한 것 제언을 만듭니다.</p>
    <div class="toolrow">
      <button id="anGenBtn" class="btn primary">AI 분석 실행</button>
      <button id="anSaveBtn" class="btn" disabled>리포트 저장</button>
    </div>
    <div id="anNotes"></div>
    <div id="anResult" class="cardplan"></div>
  `;
  const prev = await api.outputLatest(state.projectId, 'analyze');
  if (prev) { try { renderReport(JSON.parse(prev.content)); } catch { /* 무시 */ } }

  let current = null;
  $('#anGenBtn').onclick = async () => {
    const btn = $('#anGenBtn');
    btn.disabled = true; btn.textContent = '분석 중…';
    try {
      const { report, recordId } = await api.aiAnalyze(state.projectId);
      current = report;
      state.currentRecordId = recordId;
      state.rating = 0; state.tags = new Set();
      renderReport(report);
      renderFeedback();
      $('#anSaveBtn').disabled = false;
    } catch (e) { note('#anNotes', 'alert', '분석 오류', e.message || String(e)); }
    finally { btn.disabled = false; btn.textContent = 'AI 분석 실행'; }
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

// HTML 이스케이프 (AI/사용자 텍스트를 innerHTML 조각에 넣을 때 필수)
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  renderWork();
  renderMaterials();
  renderFeedback();
}

if (api._demo) setSave('브라우저 데모 모드 (Electron 아님)');
refreshProjects();
