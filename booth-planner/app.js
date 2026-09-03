/* ===== 부스 배치도 플래너 — 전체 로직 =====
 * 순수 JS. file:// 로 실행. 외부 의존 없음.
 * 내부 단위는 항상 cm. 표시 단위(cm/mm/m)만 전환한다.
 */
(function () {
  'use strict';

  // ---------- 상수 ----------
  const APP_VERSION = '1.0.0';               // version.json 과 동일하게 유지
  const REPO = 'jykim5215/-';                // GitHub 저장소 (공개 API, 무인증)
  const TAG_PREFIX = 'booth-planner-v';      // 릴리즈 태그 접두사
  const STORAGE_KEY = 'boothPlanner.v1';
  const UPDATE_CHECK_KEY = 'boothPlanner.lastUpdateCheck';
  const NS = 'http://www.w3.org/2000/svg';
  const SHAPES = ['rect', 'round', 'ellipse', 'triangle', 'diamond', 'semicircle', 'zone'];
  const SHAPE_NAMES = { rect: '사각형', round: '둥근 사각형', ellipse: '원/타원', triangle: '삼각형', diamond: '마름모', semicircle: '반원', zone: '구역' };
  const UNITS = { cm: { f: 1, dec: 1 }, mm: { f: 10, dec: 0 }, m: { f: 0.01, dec: 3 } };
  const MAX_ITEMS = 5000;
  const MAX_DIM = 100000; // cm

  // 캔버스 색상 (내보내기 시 CSS 를 참조할 수 없으므로 JS 에 둔다)
  const THEMES = {
    blueprint: { canvas: '#0e1e36', grid: 'rgba(77,211,255,0.10)', gridMajor: 'rgba(77,211,255,0.26)', booth: '#4dd3ff', boothFill: 'rgba(77,211,255,0.06)', text: '#e6f0ff', dim: '#9fb6da', itemStroke: 'rgba(255,255,255,0.75)', itemText: '#0b1626', sel: '#ffd166', handle: '#ffffff', zoneText: '#e6f0ff' },
    paper: { canvas: '#f4efe4', grid: 'rgba(80,60,30,0.10)', gridMajor: 'rgba(80,60,30,0.25)', booth: '#c8552c', boothFill: 'rgba(200,85,44,0.05)', text: '#2b2822', dim: '#7d7565', itemStroke: 'rgba(40,30,20,0.6)', itemText: '#1f1c17', sel: '#c8552c', handle: '#ffffff', zoneText: '#2b2822' },
    studio: { canvas: '#fbfbfd', grid: 'rgba(30,40,60,0.07)', gridMajor: 'rgba(30,40,60,0.18)', booth: '#4f46e5', boothFill: 'rgba(79,70,229,0.05)', text: '#1c2230', dim: '#6b7280', itemStroke: 'rgba(20,25,40,0.55)', itemText: '#1c2230', sel: '#4f46e5', handle: '#ffffff', zoneText: '#1c2230' },
  };

  // 집기 프리셋 (이름, 모양, 너비, 깊이, 색)
  const PRESETS = [
    { name: '책상', shape: 'rect', w: 120, d: 60, color: '#8ecae6' },
    { name: '의자', shape: 'round', w: 45, d: 45, color: '#ffb703' },
    { name: '회의 테이블', shape: 'rect', w: 180, d: 80, color: '#a3c4f3' },
    { name: '원형 테이블', shape: 'ellipse', w: 90, d: 90, color: '#b5e48c' },
    { name: '카운터', shape: 'rect', w: 150, d: 60, color: '#f4a261' },
    { name: '쇼케이스', shape: 'rect', w: 90, d: 45, color: '#cdb4db' },
    { name: '수납장', shape: 'rect', w: 80, d: 40, color: '#d4a373' },
    { name: '소파', shape: 'round', w: 160, d: 80, color: '#f28482' },
    { name: '파티션', shape: 'rect', w: 100, d: 5, color: '#adb5bd' },
    { name: 'X배너', shape: 'rect', w: 60, d: 15, color: '#ffafcc' },
    { name: 'TV/모니터', shape: 'rect', w: 120, d: 8, color: '#495057' },
    { name: '화분', shape: 'ellipse', w: 40, d: 40, color: '#52b788' },
    { name: '콘센트', shape: 'rect', w: 10, d: 10, color: '#e63946' },
    { name: '스탠드', shape: 'ellipse', w: 30, d: 30, color: '#ffd166' },
    { name: '통로', shape: 'zone', w: 100, d: 200, color: '#94a3b8' },
  ];
  const SHAPE_DEFAULT_COLORS = { rect: '#8ecae6', round: '#ffb703', ellipse: '#b5e48c', triangle: '#f4a261', diamond: '#cdb4db', semicircle: '#a3c4f3', zone: '#94a3b8' };

  // 첫 실행 시 보여줄 예시 배치 (빈 화면보다 이해가 빠르다)
  function demoState() {
    const st = defaultState();
    st.planName = '예시 · 3m × 3m 부스';
    st.items = [
      { name: '카운터', shape: 'rect', x: 90, y: 40, w: 150, d: 60, color: '#f4a261' },
      { name: '의자', shape: 'round', x: 60, y: 90, w: 45, d: 45, color: '#ffb703' },
      { name: '의자', shape: 'round', x: 120, y: 90, w: 45, d: 45, color: '#ffb703' },
      { name: 'TV/모니터', shape: 'rect', x: 150, y: 296, w: 120, d: 8, color: '#495057' },
      { name: '원형 테이블', shape: 'ellipse', x: 210, y: 200, w: 90, d: 90, color: '#b5e48c' },
      { name: '의자', shape: 'round', x: 210, y: 140, w: 45, d: 45, color: '#ffb703' },
      { name: '의자', shape: 'round', x: 270, y: 200, w: 45, d: 45, color: '#ffb703' },
      { name: 'X배너', shape: 'rect', x: 265, y: 40, w: 60, d: 15, color: '#ffafcc', rot: 0 },
      { name: '쇼케이스', shape: 'rect', x: 45, y: 200, w: 45, d: 90, color: '#cdb4db' },
      { name: '화분', shape: 'ellipse', x: 30, y: 270, w: 40, d: 40, color: '#52b788' },
      { name: '통로', shape: 'zone', x: 150, y: 360, w: 300, d: 100, color: '#94a3b8' },
    ].map((it) => Object.assign({ id: uid(), rot: 0, locked: false, showDim: true, note: '' }, it));
    return st;
  }

  // ---------- 상태 ----------
  function defaultState() {
    return {
      schema: 1, unit: 'cm', grid: 10, snap: true, showDims: true, theme: 'blueprint',
      planName: '',
      booth: { name: '부스', w: 300, d: 300 },
      items: [],
    };
  }
  let state = defaultState();
  const sel = new Set();
  const view = { px: 0, py: 0, s: 1 }; // 화면 오프셋(px) 과 배율(px/cm)
  const history = { undo: [], redo: [] };
  let lastSnap = '';
  let spaceHeld = false;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const wrap = $('canvasWrap');
  const ui = {
    boothName: $('boothName'), boothW: $('boothW'), boothD: $('boothD'), gridSize: $('gridSize'), planName: $('planName'),
    inName: $('inName'), inShape: $('inShape'), inW: $('inW'), inD: $('inD'), inX: $('inX'), inY: $('inY'), inRot: $('inRot'),
    inColor: $('inColor'), inNote: $('inNote'), inShowDim: $('inShowDim'), inLocked: $('inLocked'),
    inspector: $('inspector'), inspectorEmpty: $('inspectorEmpty'), inspSelCount: $('inspSelCount'), itemCount: $('itemCount'),
    itemList: $('itemList'), presetGrid: $('presetGrid'), shapeGrid: $('shapeGrid'),
    chkSnap: $('chkSnap'), chkDims: $('chkDims'), selUnit: $('selUnit'), selTheme: $('selTheme'),
    zoomBadge: $('zoomBadge'), coordBadge: $('coordBadge'), planTitle: $('planTitle'),
    btnUndo: $('btnUndo'), btnRedo: $('btnRedo'),
  };

  // ---------- 유틸 ----------
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const deg2rad = (d) => d * Math.PI / 180;
  function rotVec(x, y, deg) { const r = deg2rad(deg), c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; }
  function toU(cm) { const u = UNITS[state.unit]; return +(cm * u.f).toFixed(u.dec); }
  function fromU(v) { return v / UNITS[state.unit].f; }
  function fmt(cm) { const u = UNITS[state.unit]; return String(+(cm * u.f).toFixed(u.dec)); }
  function snapVal(v, g) { return state.snap && g > 0 ? Math.round(v / g) * g : v; }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function theme() { return THEMES[state.theme] || THEMES.blueprint; }
  function selectedItems() { return state.items.filter((it) => sel.has(it.id)); }
  function itemById(id) { return state.items.find((it) => it.id === id); }
  function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }
  // 제어 문자 제거 + 길이 제한 (사용자 입력 / 불러온 파일 공통)
  function clean(str, max) { return typeof str === 'string' ? str.replace(/[\x00-\x1f\x7f]/g, '').slice(0, max) : ''; }

  // ---------- 검증 (불러온 JSON 은 신뢰하지 않는다) ----------
  function validateState(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('형식 오류');
    const d = defaultState();
    const num = (v, def, min, max) => (typeof v === 'number' && isFinite(v)) ? clamp(v, min, max) : def;
    const out = defaultState();
    out.unit = UNITS[obj.unit] ? obj.unit : d.unit;
    out.grid = num(obj.grid, d.grid, 0.1, 1000);
    out.snap = obj.snap !== false;
    out.showDims = obj.showDims !== false;
    out.theme = THEMES[obj.theme] ? obj.theme : d.theme;
    out.planName = clean(obj.planName, 60);
    const b = obj.booth || {};
    out.booth = { name: clean(b.name, 40) || '부스', w: num(b.w, 300, 10, MAX_DIM), d: num(b.d, 300, 10, MAX_DIM) };
    const items = Array.isArray(obj.items) ? obj.items.slice(0, MAX_ITEMS) : [];
    const seen = new Set();
    out.items = items.filter((it) => it && typeof it === 'object').map((it) => {
      let id = clean(String(it.id || ''), 16) || uid();
      while (seen.has(id)) id = uid();
      seen.add(id);
      return {
        id, name: clean(it.name, 40), shape: SHAPES.includes(it.shape) ? it.shape : 'rect',
        x: num(it.x, 0, -MAX_DIM, MAX_DIM), y: num(it.y, 0, -MAX_DIM, MAX_DIM),
        w: num(it.w, 50, 1, MAX_DIM), d: num(it.d, 50, 1, MAX_DIM), rot: num(it.rot, 0, -360, 360),
        color: isHex(it.color) ? it.color : SHAPE_DEFAULT_COLORS.rect,
        locked: !!it.locked, showDim: it.showDim !== false, note: clean(it.note, 80),
      };
    });
    return out;
  }

  // ---------- 히스토리 / 저장 ----------
  function snapshot() { return JSON.stringify({ booth: state.booth, items: state.items, planName: state.planName }); }
  function commit() {
    const s = snapshot();
    if (s !== lastSnap) {
      history.undo.push(lastSnap);
      if (history.undo.length > 100) history.undo.shift();
      history.redo.length = 0;
      lastSnap = s;
    }
    autosave();
    refreshAll();
  }
  function applySnap(s) {
    const o = JSON.parse(s);
    state.booth = o.booth; state.items = o.items; state.planName = o.planName;
    for (const id of [...sel]) if (!itemById(id)) sel.delete(id);
    autosave(); refreshAll();
  }
  function undo() { if (!history.undo.length) return; history.redo.push(lastSnap); lastSnap = history.undo.pop(); applySnap(lastSnap); }
  function redo() { if (!history.redo.length) return; history.undo.push(lastSnap); lastSnap = history.redo.pop(); applySnap(lastSnap); }
  function autosave() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경은 무시 */ } }
  function loadAutosave() {
    let loaded = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { state = validateState(JSON.parse(raw)); loaded = true; }
    } catch (e) { state = defaultState(); }
    // URL 해시 옵션: #theme=paper (테마 지정), #demo (예시 배치 강제) — 스타일 미리보기용
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!loaded || hash.has('demo')) state = validateState(Object.assign(demoState(), { theme: state.theme }));
    if (THEMES[hash.get('theme')]) state.theme = hash.get('theme');
  }

  // ---------- 좌표 ----------
  function toWorld(cx, cy) {
    const r = stage.getBoundingClientRect();
    return { x: (cx - r.left - view.px) / view.s, y: (cy - r.top - view.py) / view.s };
  }
  function fitView() {
    const r = wrap.getBoundingClientRect();
    const margin = 60; // cm 단위 여백
    const w = state.booth.w + margin * 2, d = state.booth.d + margin * 2;
    view.s = clamp(Math.min((r.width - 40) / w, (r.height - 40) / d), 0.05, 20);
    view.px = (r.width - state.booth.w * view.s) / 2;
    view.py = (r.height - state.booth.d * view.s) / 2;
    render();
  }
  function zoomAt(cx, cy, factor) {
    const before = toWorld(cx, cy);
    view.s = clamp(view.s * factor, 0.05, 20);
    const r = stage.getBoundingClientRect();
    view.px = cx - r.left - before.x * view.s;
    view.py = cy - r.top - before.y * view.s;
    render();
  }

  // ---------- 도형 ----------
  function shapeEl(shape, w, d, attrs, parent) {
    const hw = w / 2, hd = d / 2;
    let e;
    switch (shape) {
      case 'ellipse': e = el('ellipse', Object.assign({ cx: 0, cy: 0, rx: hw, ry: hd }, attrs), parent); break;
      case 'triangle': e = el('path', Object.assign({ d: `M0,${-hd} L${hw},${hd} L${-hw},${hd} Z` }, attrs), parent); break;
      case 'diamond': e = el('path', Object.assign({ d: `M0,${-hd} L${hw},0 L0,${hd} L${-hw},0 Z` }, attrs), parent); break;
      case 'semicircle': e = el('path', Object.assign({ d: `M${-hw},${hd} A${hw},${d} 0 0 1 ${hw},${hd} Z` }, attrs), parent); break;
      case 'round': e = el('rect', Object.assign({ x: -hw, y: -hd, width: w, height: d, rx: Math.min(w, d) * 0.22 }, attrs), parent); break;
      default: e = el('rect', Object.assign({ x: -hw, y: -hd, width: w, height: d }, attrs), parent);
    }
    return e;
  }
  function iconSvg(shape, color) {
    const s = el('svg', { viewBox: '-20 -15 40 30' });
    shapeEl(shape, 32, 22, { fill: shape === 'zone' ? 'none' : color, stroke: shape === 'zone' ? color : 'rgba(0,0,0,.35)', 'stroke-width': 1.5, 'stroke-dasharray': shape === 'zone' ? '4 3' : null }, s);
    return s;
  }

  // ---------- 렌더 ----------
  function render() {
    const r = wrap.getBoundingClientRect();
    stage.setAttribute('width', r.width); stage.setAttribute('height', r.height);
    while (stage.firstChild) stage.removeChild(stage.firstChild);
    const root = el('g', { transform: `translate(${view.px},${view.py}) scale(${view.s})` }, stage);
    const vis = { x0: -view.px / view.s, y0: -view.py / view.s, x1: (r.width - view.px) / view.s, y1: (r.height - view.py) / view.s };
    drawScene(root, { s: view.s, vis, selection: true });
    if (drag && drag.mode === 'marquee') drawMarquee(root, drag);
    ui.zoomBadge.textContent = Math.round(view.s * 100) + '%';
  }

  // 씬 전체를 그린다. 내보내기와 화면 렌더가 공유한다.
  function drawScene(root, opt) {
    const T = theme(); const s = opt.s; const vis = opt.vis;
    const nsw = 'non-scaling-stroke';
    // 격자
    const g = state.grid > 0 ? state.grid : 10;
    const major = g * (g <= 20 ? 10 : 5);
    const gridG = el('g', null, root);
    const nLines = (vis.x1 - vis.x0) / g + (vis.y1 - vis.y0) / g;
    const drawMinor = nLines < 600;
    for (let x = Math.floor(vis.x0 / g) * g; x <= vis.x1; x += g) {
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      if (!isMajor && !drawMinor) continue;
      el('line', { x1: x, y1: vis.y0, x2: x, y2: vis.y1, stroke: isMajor ? T.gridMajor : T.grid, 'stroke-width': 1, 'vector-effect': nsw }, gridG);
    }
    for (let y = Math.floor(vis.y0 / g) * g; y <= vis.y1; y += g) {
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      if (!isMajor && !drawMinor) continue;
      el('line', { x1: vis.x0, y1: y, x2: vis.x1, y2: y, stroke: isMajor ? T.gridMajor : T.grid, 'stroke-width': 1, 'vector-effect': nsw }, gridG);
    }
    // 부스
    const b = state.booth;
    const bg = el('g', null, root);
    el('rect', { x: 0, y: 0, width: b.w, height: b.d, fill: T.boothFill, stroke: T.booth, 'stroke-width': 3, 'vector-effect': nsw }, bg);
    const af = 12 / s; // 주석 글자 크기 (화면 고정)
    const off = 18 / s;
    // 상단 치수선
    el('line', { x1: 0, y1: -off, x2: b.w, y2: -off, stroke: T.dim, 'stroke-width': 1, 'vector-effect': nsw }, bg);
    el('line', { x1: 0, y1: -off - 5 / s, x2: 0, y2: -off + 5 / s, stroke: T.dim, 'stroke-width': 1, 'vector-effect': nsw }, bg);
    el('line', { x1: b.w, y1: -off - 5 / s, x2: b.w, y2: -off + 5 / s, stroke: T.dim, 'stroke-width': 1, 'vector-effect': nsw }, bg);
    text(bg, b.w / 2, -off - 6 / s, `${fmt(b.w)} ${state.unit}`, { size: af, fill: T.dim, anchor: 'middle' });
    // 좌측 치수선
    el('line', { x1: -off, y1: 0, x2: -off, y2: b.d, stroke: T.dim, 'stroke-width': 1, 'vector-effect': nsw }, bg);
    el('line', { x1: -off - 5 / s, y1: 0, x2: -off + 5 / s, y2: 0, stroke: T.dim, 'stroke-width': 1, 'vector-effect': nsw }, bg);
    el('line', { x1: -off - 5 / s, y1: b.d, x2: -off + 5 / s, y2: b.d, stroke: T.dim, 'stroke-width': 1, 'vector-effect': nsw }, bg);
    text(bg, -off - 6 / s, b.d / 2, `${fmt(b.d)} ${state.unit}`, { size: af, fill: T.dim, anchor: 'middle', rotate: -90 });
    text(bg, 6 / s, 6 / s, b.name, { size: 13 / s, fill: T.booth, anchor: 'start', baseline: 'hanging', weight: 700 });
    if (state.planName) text(bg, 0, -off - 12 / s, state.planName, { size: 14 / s, fill: T.text, anchor: 'start', baseline: 'auto', weight: 700 });

    // 항목
    const itemsG = el('g', null, root);
    for (const it of state.items) drawItem(itemsG, it, T, s);

    // 선택 오버레이
    if (opt.selection && sel.size) {
      const ov = el('g', null, root);
      const single = sel.size === 1;
      for (const it of selectedItems()) {
        const grp = el('g', { transform: `translate(${it.x},${it.y}) rotate(${it.rot})` }, ov);
        el('rect', { x: -it.w / 2, y: -it.d / 2, width: it.w, height: it.d, fill: 'none', stroke: T.sel, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'vector-effect': nsw, 'pointer-events': 'none' }, grp);
        if (single && !it.locked) {
          const h = 9 / s, hw = it.w / 2, hd = it.d / 2;
          const handles = { nw: [-hw, -hd], n: [0, -hd], ne: [hw, -hd], e: [hw, 0], se: [hw, hd], s: [0, hd], sw: [-hw, hd], w: [-hw, 0] };
          const cursors = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };
          for (const k in handles) {
            const [hx, hy] = handles[k];
            el('rect', { x: hx - h / 2, y: hy - h / 2, width: h, height: h, fill: T.handle, stroke: T.sel, 'stroke-width': 1.5, 'vector-effect': nsw, 'data-handle': k, 'data-id': it.id, style: `cursor:${cursors[k]}` }, grp);
          }
          const ry = -hd - 26 / s;
          el('line', { x1: 0, y1: -hd, x2: 0, y2: ry, stroke: T.sel, 'stroke-width': 1, 'vector-effect': nsw }, grp);
          el('circle', { cx: 0, cy: ry, r: 6 / s, fill: T.handle, stroke: T.sel, 'stroke-width': 1.5, 'vector-effect': nsw, 'data-rotate': it.id, style: 'cursor:grab' }, grp);
        }
      }
    }
  }

  function text(parent, x, y, str, o) {
    const t = el('text', {
      x, y, 'font-size': o.size, fill: o.fill, 'text-anchor': o.anchor || 'middle',
      'dominant-baseline': o.baseline || 'middle', 'font-family': 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
      'font-weight': o.weight || 400, 'pointer-events': 'none',
      transform: o.rotate ? `rotate(${o.rotate} ${x} ${y})` : null,
    }, parent);
    t.textContent = str; // 사용자 입력은 textContent 로만 삽입
    return t;
  }

  function drawItem(parent, it, T, s) {
    const isZone = it.shape === 'zone';
    const g = el('g', { class: 'item', 'data-id': it.id, transform: `translate(${it.x},${it.y}) rotate(${it.rot})`, style: `cursor:${it.locked ? 'not-allowed' : 'move'}` }, parent);
    if (isZone) {
      el('rect', { x: -it.w / 2, y: -it.d / 2, width: it.w, height: it.d, fill: it.color, 'fill-opacity': 0.10, stroke: it.color, 'stroke-width': 2, 'stroke-dasharray': '8 5', 'vector-effect': 'non-scaling-stroke' }, g);
    } else {
      shapeEl(it.shape, it.w, it.d, { fill: it.color, 'fill-opacity': 0.92, stroke: T.itemStroke, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, g);
    }
    // 라벨: 뒤집혀 보이지 않게 180° 보정
    const norm = ((it.rot % 360) + 360) % 360;
    const flip = norm > 90 && norm < 270;
    const lg = el('g', { transform: flip ? 'rotate(180)' : null }, g);
    const minSide = Math.min(it.w, it.d);
    const base = clamp(minSide * 0.28, 7, 16); // cm 단위 글자 크기 (도면처럼 배율에 따라 커짐)
    const showDim = state.showDims && it.showDim;
    const dimStr = `${fmt(it.w)} × ${fmt(it.d)}`;
    if (isZone) {
      text(lg, -it.w / 2 + 4, -it.d / 2 + 4, it.name, { size: base, fill: T.zoneText, anchor: 'start', baseline: 'hanging', weight: 700 });
      if (showDim) text(lg, -it.w / 2 + 4, -it.d / 2 + 4 + base * 1.2, dimStr, { size: base * 0.8, fill: T.dim, anchor: 'start', baseline: 'hanging' });
    } else {
      const lines = [];
      const outside = minSide < 20; // 얇은 항목은 라벨을 위쪽 바깥에
      if (it.name) lines.push({ str: it.name, size: outside ? 9 : base, weight: 700, fill: outside ? T.text : T.itemText });
      if (showDim) lines.push({ str: dimStr, size: (outside ? 9 : base) * 0.78, weight: 400, fill: outside ? T.dim : T.itemText });
      const total = lines.reduce((a, l) => a + l.size * 1.15, 0);
      let y = outside ? -it.d / 2 - total - 2 : -total / 2;
      for (const l of lines) {
        y += l.size * 1.15 / 2;
        text(lg, 0, y, l.str, { size: l.size, fill: l.fill, weight: l.weight });
        y += l.size * 1.15 / 2;
      }
    }
    return g;
  }

  // ---------- 포인터 입력 ----------
  let drag = null; // { mode, ... }
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('dblclick', (e) => {
    const g = e.target.closest && e.target.closest('.item');
    if (g) { selectOnly(g.getAttribute('data-id')); ui.inName.focus(); ui.inName.select(); }
  });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
  }, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  function onDown(e) {
    stage.focus();
    const p = toWorld(e.clientX, e.clientY);
    const t = e.target;
    if (e.button === 1 || spaceHeld) {
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: view.px, py: view.py };
      stage.classList.add('panning');
    } else if (t.hasAttribute && t.hasAttribute('data-handle')) {
      const it = itemById(t.getAttribute('data-id'));
      drag = { mode: 'resize', handle: t.getAttribute('data-handle'), it, start: Object.assign({}, it), p0: p };
    } else if (t.hasAttribute && t.hasAttribute('data-rotate')) {
      const it = itemById(t.getAttribute('data-rotate'));
      drag = { mode: 'rotate', it, start: Object.assign({}, it) };
    } else {
      const g = t.closest && t.closest('.item');
      if (g) {
        const id = g.getAttribute('data-id');
        if (e.shiftKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
        else if (!sel.has(id)) { sel.clear(); sel.add(id); }
        const targets = selectedItems().filter((it) => !it.locked);
        drag = { mode: 'move', p0: p, starts: targets.map((it) => ({ it, x: it.x, y: it.y })), moved: false };
        refreshAll();
      } else if (e.shiftKey) {
        drag = { mode: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      } else {
        if (sel.size) { sel.clear(); refreshAll(); }
        drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: view.px, py: view.py };
        stage.classList.add('panning');
      }
    }
    if (drag) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 합성 이벤트 등 */ } }
  }

  function onMove(e) {
    const p = toWorld(e.clientX, e.clientY);
    ui.coordBadge.textContent = `x ${fmt(p.x)}  y ${fmt(p.y)} ${state.unit}`;
    if (!drag) return;
    const g = state.grid;
    if (drag.mode === 'pan') {
      view.px = drag.px + (e.clientX - drag.sx); view.py = drag.py + (e.clientY - drag.sy); render();
    } else if (drag.mode === 'move') {
      const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      for (const st of drag.starts) {
        let nx = st.x + dx, ny = st.y + dy;
        if (state.snap) {
          // 90° 단위로 놓인 항목은 좌상단 모서리를 격자에 맞춘다
          if (st.it.rot % 90 === 0) {
            const sw = (st.it.rot % 180 === 0) ? st.it.w : st.it.d, sd = (st.it.rot % 180 === 0) ? st.it.d : st.it.w;
            nx = snapVal(nx - sw / 2, g) + sw / 2; ny = snapVal(ny - sd / 2, g) + sd / 2;
          } else { nx = snapVal(nx, g); ny = snapVal(ny, g); }
        }
        st.it.x = nx; st.it.y = ny;
      }
      drag.moved = true; render();
    } else if (drag.mode === 'resize') {
      const it = drag.it, st = drag.start, h = drag.handle;
      const loc = rotVec(p.x - drag.p0.x, p.y - drag.p0.y, -st.rot); // 로컬(비회전) 좌표의 이동량
      let nw = st.w, nd = st.d;
      const sx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0;
      const sy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
      const centerMode = e.altKey;
      if (sx) nw = st.w + sx * loc.x * (centerMode ? 2 : 1);
      if (sy) nd = st.d + sy * loc.y * (centerMode ? 2 : 1);
      if (e.shiftKey && sx && sy) { const k = Math.max(nw / st.w, nd / st.d); nw = st.w * k; nd = st.d * k; }
      nw = Math.max(1, snapVal(nw, g)); nd = Math.max(1, snapVal(nd, g));
      it.w = nw; it.d = nd;
      if (centerMode) { it.x = st.x; it.y = st.y; }
      else {
        const shift = rotVec(sx * (nw - st.w) / 2, sy * (nd - st.d) / 2, st.rot);
        it.x = st.x + shift.x; it.y = st.y + shift.y;
      }
      render();
    } else if (drag.mode === 'rotate') {
      const it = drag.it;
      let a = Math.atan2(p.y - it.y, p.x - it.x) * 180 / Math.PI + 90;
      if (state.snap || e.shiftKey) a = Math.round(a / 15) * 15;
      a = ((Math.round(a) % 360) + 360) % 360;
      it.rot = a; render();
    } else if (drag.mode === 'marquee') {
      drag.x1 = p.x; drag.y1 = p.y; render();
    }
  }
  function drawMarquee(root, m) {
    el('rect', { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0), fill: 'rgba(128,128,128,0.15)', stroke: theme().sel, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, root);
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    stage.classList.remove('panning');
    try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    if (d.mode === 'marquee') {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      for (const it of state.items) if (it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1) sel.add(it.id);
      refreshAll();
    } else if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'rotate') {
      commit();
    }
  }

  // ---------- 키보드 ----------
  document.addEventListener('keydown', (e) => {
    const inInput = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveJSON(); return; }
    if (inInput) return;
    if (e.code === 'Space') { spaceHeld = true; stage.classList.add('space'); e.preventDefault(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); for (const it of state.items) sel.add(it.id); refreshAll(); return; }
    if (e.key === 'Escape') { sel.clear(); refreshAll(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSel(); return; }
    if (e.key.toLowerCase() === 'r' && sel.size) { rotateSel(e.shiftKey ? -90 : 90); return; }
    if (e.key.startsWith('Arrow') && sel.size) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : (state.grid || 1);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      for (const it of selectedItems()) if (!it.locked) { it.x += dx; it.y += dy; }
      commit();
    }
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceHeld = false; stage.classList.remove('space'); } });

  // ---------- 항목 조작 ----------
  function addItem(preset) {
    if (state.items.length >= MAX_ITEMS) { toast('항목이 너무 많습니다'); return; }
    const n = state.items.length;
    const it = {
      id: uid(), name: preset.name || '', shape: preset.shape || 'rect',
      x: snapVal(state.booth.w / 2 + (n % 5) * 15, state.grid), y: snapVal(state.booth.d / 2 + (n % 5) * 15, state.grid),
      w: preset.w || 50, d: preset.d || 50, rot: 0,
      color: preset.color || SHAPE_DEFAULT_COLORS[preset.shape] || '#8ecae6', locked: false, showDim: true, note: '',
    };
    state.items.push(it);
    sel.clear(); sel.add(it.id);
    commit();
    ui.inName.focus(); ui.inName.select();
  }
  function deleteSel() {
    const ids = new Set(selectedItems().filter((it) => !it.locked).map((it) => it.id));
    if (!ids.size) return;
    state.items = state.items.filter((it) => !ids.has(it.id));
    for (const id of ids) sel.delete(id);
    commit();
  }
  function duplicateSel() {
    const src = selectedItems();
    if (!src.length) return;
    const g = state.grid || 10;
    sel.clear();
    for (const it of src) {
      const c = Object.assign({}, it, { id: uid(), x: it.x + g * 2, y: it.y + g * 2, locked: false });
      state.items.push(c); sel.add(c.id);
    }
    commit();
  }
  function rotateSel(delta, abs) {
    for (const it of selectedItems()) if (!it.locked) it.rot = abs ? delta : (((it.rot + delta) % 360) + 360) % 360;
    commit();
  }
  function reorderSel(toFront) {
    const picked = selectedItems();
    state.items = state.items.filter((it) => !sel.has(it.id));
    state.items = toFront ? state.items.concat(picked) : picked.concat(state.items);
    commit();
  }
  function selectOnly(id) { sel.clear(); sel.add(id); refreshAll(); }

  // ---------- UI 갱신 ----------
  function refreshAll() {
    render(); renderList(); bindInspector();
    ui.btnUndo.disabled = !history.undo.length; ui.btnRedo.disabled = !history.redo.length;
    ui.planTitle.textContent = state.planName || '새 배치도';
    document.title = (state.planName ? state.planName + ' — ' : '') + '부스 배치도 플래너';
  }
  function renderList() {
    ui.itemList.textContent = '';
    const items = state.items.slice().reverse();
    ui.itemCount.textContent = items.length ? `총 ${items.length}개 항목` : '';
    for (const it of items) {
      const li = document.createElement('li');
      li.className = (sel.has(it.id) ? 'sel ' : '') + (it.locked ? 'locked' : '');
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = it.color;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = it.name || `(${SHAPE_NAMES[it.shape]})`;
      const dm = document.createElement('span'); dm.className = 'dm'; dm.textContent = `${fmt(it.w)}×${fmt(it.d)}`;
      li.append(sw, nm, dm);
      li.addEventListener('click', (e) => {
        if (e.shiftKey) { sel.has(it.id) ? sel.delete(it.id) : sel.add(it.id); refreshAll(); }
        else selectOnly(it.id);
      });
      ui.itemList.appendChild(li);
    }
  }
  function bindInspector() {
    const items = selectedItems();
    document.querySelectorAll('.unit-label').forEach((s) => (s.textContent = `(${state.unit})`));
    ui.boothName.value = state.booth.name; ui.boothW.value = toU(state.booth.w); ui.boothD.value = toU(state.booth.d);
    ui.gridSize.value = toU(state.grid); ui.planName.value = state.planName;
    ui.chkSnap.checked = state.snap; ui.chkDims.checked = state.showDims; ui.selUnit.value = state.unit; ui.selTheme.value = state.theme;
    if (!items.length) { ui.inspector.hidden = true; ui.inspectorEmpty.hidden = false; return; }
    ui.inspector.hidden = false; ui.inspectorEmpty.hidden = true;
    const it = items[0];
    ui.inspSelCount.textContent = items.length > 1 ? `(${items.length}개 동시 편집)` : '';
    ui.inName.value = it.name; ui.inShape.value = it.shape;
    ui.inW.value = toU(it.w); ui.inD.value = toU(it.d); ui.inX.value = toU(it.x); ui.inY.value = toU(it.y);
    ui.inRot.value = Math.round(it.rot); ui.inColor.value = it.color; ui.inNote.value = it.note;
    ui.inShowDim.checked = it.showDim; ui.inLocked.checked = it.locked;
  }

  // 속성 패널 입력 → 즉시 반영(live), change 시 commit
  function liveApply(fn) { return () => { fn(); render(); }; }
  function onChangeCommit() { commit(); }
  const numIn = (elm, apply) => { elm.addEventListener('input', () => { const v = parseFloat(elm.value); if (isFinite(v)) { apply(v); render(); } }); elm.addEventListener('change', onChangeCommit); };
  ui.inName.addEventListener('input', liveApply(() => selectedItems().forEach((it) => (it.name = clean(ui.inName.value, 40)))));
  ui.inName.addEventListener('change', onChangeCommit);
  ui.inNote.addEventListener('input', liveApply(() => selectedItems().forEach((it) => (it.note = clean(ui.inNote.value, 80)))));
  ui.inNote.addEventListener('change', onChangeCommit);
  ui.inShape.addEventListener('change', () => { selectedItems().forEach((it) => (it.shape = ui.inShape.value)); commit(); });
  numIn(ui.inW, (v) => selectedItems().forEach((it) => (it.w = clamp(fromU(v), 1, MAX_DIM))));
  numIn(ui.inD, (v) => selectedItems().forEach((it) => (it.d = clamp(fromU(v), 1, MAX_DIM))));
  numIn(ui.inX, (v) => selectedItems().forEach((it) => (it.x = clamp(fromU(v), -MAX_DIM, MAX_DIM))));
  numIn(ui.inY, (v) => selectedItems().forEach((it) => (it.y = clamp(fromU(v), -MAX_DIM, MAX_DIM))));
  numIn(ui.inRot, (v) => selectedItems().forEach((it) => (it.rot = ((v % 360) + 360) % 360)));
  ui.inColor.addEventListener('input', liveApply(() => selectedItems().forEach((it) => (it.color = ui.inColor.value))));
  ui.inColor.addEventListener('change', onChangeCommit);
  ui.inShowDim.addEventListener('change', () => { selectedItems().forEach((it) => (it.showDim = ui.inShowDim.checked)); commit(); });
  ui.inLocked.addEventListener('change', () => { selectedItems().forEach((it) => (it.locked = ui.inLocked.checked)); commit(); });
  document.querySelectorAll('.rot-quick button').forEach((b) => b.addEventListener('click', () => rotateSel(parseFloat(b.dataset.rot), !!b.dataset.abs)));
  $('btnDup').addEventListener('click', duplicateSel);
  $('btnDelete').addEventListener('click', deleteSel);
  $('btnFront').addEventListener('click', () => reorderSel(true));
  $('btnBack').addEventListener('click', () => reorderSel(false));

  // 부스 설정
  ui.boothName.addEventListener('input', liveApply(() => (state.booth.name = clean(ui.boothName.value, 40))));
  ui.boothName.addEventListener('change', onChangeCommit);
  numIn(ui.boothW, (v) => (state.booth.w = clamp(fromU(v), 10, MAX_DIM)));
  numIn(ui.boothD, (v) => (state.booth.d = clamp(fromU(v), 10, MAX_DIM)));
  ui.gridSize.addEventListener('change', () => { const v = parseFloat(ui.gridSize.value); if (isFinite(v) && v > 0) state.grid = clamp(fromU(v), 0.1, 1000); autosave(); refreshAll(); });
  ui.planName.addEventListener('input', liveApply(() => (state.planName = clean(ui.planName.value, 60))));
  ui.planName.addEventListener('change', onChangeCommit);

  // 보기 설정
  ui.chkSnap.addEventListener('change', () => { state.snap = ui.chkSnap.checked; autosave(); });
  ui.chkDims.addEventListener('change', () => { state.showDims = ui.chkDims.checked; autosave(); render(); });
  ui.selUnit.addEventListener('change', () => { state.unit = ui.selUnit.value; autosave(); refreshAll(); });
  ui.selTheme.addEventListener('change', () => { setTheme(ui.selTheme.value); autosave(); render(); });
  function setTheme(t) { state.theme = THEMES[t] ? t : 'blueprint'; document.body.setAttribute('data-theme', state.theme); }
  $('btnFit').addEventListener('click', fitView);
  ui.btnUndo.addEventListener('click', undo); ui.btnRedo.addEventListener('click', redo);

  // 라이브러리 / 도형 버튼
  for (const p of PRESETS) {
    const b = document.createElement('button'); b.className = 'preset-btn'; b.type = 'button';
    b.appendChild(iconSvg(p.shape, p.color));
    const n = document.createElement('span'); n.textContent = p.name;
    const s = document.createElement('small'); s.textContent = `${p.w}×${p.d}`;
    b.append(n, s); b.addEventListener('click', () => addItem(p));
    ui.presetGrid.appendChild(b);
  }
  for (const sh of SHAPES) {
    const b = document.createElement('button'); b.className = 'shape-btn'; b.type = 'button';
    b.appendChild(iconSvg(sh, SHAPE_DEFAULT_COLORS[sh]));
    const n = document.createElement('span'); n.textContent = SHAPE_NAMES[sh];
    b.appendChild(n);
    b.addEventListener('click', () => addItem({ name: '', shape: sh, w: sh === 'zone' ? 100 : 60, d: sh === 'zone' ? 100 : 60, color: SHAPE_DEFAULT_COLORS[sh] }));
    ui.shapeGrid.appendChild(b);
  }

  // ---------- 파일: 저장 / 열기 / 내보내기 ----------
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function safeName() { return (state.planName || '부스배치도').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 50); }
  function saveJSON() {
    const data = Object.assign({}, state, { app: 'booth-planner', appVersion: APP_VERSION, savedAt: new Date().toISOString() });
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), safeName() + '.json');
    toast('JSON 으로 저장했습니다');
  }
  $('btnSave').addEventListener('click', saveJSON);
  $('btnOpen').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('파일이 너무 큽니다 (5MB 초과)'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      try {
        state = validateState(JSON.parse(rd.result));
        sel.clear(); history.undo.length = 0; history.redo.length = 0; lastSnap = snapshot();
        setTheme(state.theme); autosave(); refreshAll(); fitView();
        toast('불러왔습니다');
      } catch (err) { toast('불러오기 실패: 올바른 배치도 파일이 아닙니다'); }
    };
    rd.readAsText(f);
  });
  $('btnNew').addEventListener('click', () => {
    showModal('새 배치도', '현재 배치도의 모든 항목을 지우고 새로 시작합니다.\n저장하지 않은 내용은 사라집니다. (실행 취소 가능)', [
      { label: '취소' },
      { label: '새로 만들기', primary: true, onClick: () => { const keep = { unit: state.unit, grid: state.grid, snap: state.snap, showDims: state.showDims, theme: state.theme }; state = Object.assign(defaultState(), keep); sel.clear(); commit(); fitView(); } },
    ]);
  });

  // 씬 경계 (부스 + 모든 항목)
  function sceneBounds() {
    let x0 = 0, y0 = 0, x1 = state.booth.w, y1 = state.booth.d;
    for (const it of state.items) {
      const r = Math.hypot(it.w, it.d) / 2;
      x0 = Math.min(x0, it.x - r); y0 = Math.min(y0, it.y - r); x1 = Math.max(x1, it.x + r); y1 = Math.max(y1, it.y + r);
    }
    const m = 50;
    return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  }
  function buildExportSVG(pxWidth) {
    const b = sceneBounds();
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const s = pxWidth / w;
    const svg = el('svg', { xmlns: NS, viewBox: `${b.x0} ${b.y0} ${w} ${h}`, width: Math.round(w * s), height: Math.round(h * s) });
    el('rect', { x: b.x0, y: b.y0, width: w, height: h, fill: theme().canvas }, svg);
    drawScene(svg, { s, vis: b, selection: false });
    return { svg, w: Math.round(w * s), h: Math.round(h * s) };
  }
  function exportSVG() {
    const { svg } = buildExportSVG(1600);
    const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    download(new Blob([str], { type: 'image/svg+xml' }), safeName() + '.svg');
    toast('SVG 로 내보냈습니다');
  }
  function exportPNG() {
    const { svg, w, h } = buildExportSVG(2400);
    const str = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => { if (blob) { download(blob, safeName() + '.png'); toast('PNG 로 내보냈습니다'); } else toast('PNG 생성 실패'); }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('PNG 생성 실패'); };
    img.src = url;
  }
  $('btnPNG').addEventListener('click', exportPNG);
  $('btnSVG').addEventListener('click', exportSVG);
  $('btnPrint').addEventListener('click', () => window.print());
  let savedView = null;
  window.addEventListener('beforeprint', () => { savedView = Object.assign({}, view); sel.clear(); fitView(); });
  window.addEventListener('afterprint', () => { if (savedView) Object.assign(view, savedView); render(); });

  // ---------- 모달 / 토스트 ----------
  const modal = $('modal');
  function showModal(title, body, actions) {
    $('modalTitle').textContent = title;
    const mb = $('modalBody'); mb.textContent = '';
    if (typeof body === 'string') mb.textContent = body; else mb.appendChild(body);
    const ma = $('modalActions'); ma.textContent = '';
    for (const a of actions || [{ label: '닫기' }]) {
      const b = document.createElement('button'); b.textContent = a.label; if (a.primary) b.className = 'primary';
      b.addEventListener('click', () => { modal.hidden = true; if (a.onClick) a.onClick(); });
      ma.appendChild(b);
    }
    modal.hidden = false;
  }
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  $('btnHelp').addEventListener('click', () => {
    const tbl = document.createElement('table');
    const rows = [
      ['드래그', '항목 이동'], ['모서리 핸들', '크기 조절 (Shift: 비율 유지, Alt: 중심 고정)'], ['위쪽 원 핸들', '회전 (15° 단위 스냅)'],
      ['Shift + 클릭', '여러 개 선택'], ['Shift + 빈 곳 드래그', '영역 선택'], ['빈 곳 드래그 / 스페이스+드래그', '화면 이동'],
      ['마우스 휠', '확대 / 축소'], ['더블클릭', '이름 편집'], ['방향키', '격자 한 칸 이동 (Shift: 1cm)'],
      ['R / Shift+R', '90° 회전'], ['Delete', '삭제'], ['Ctrl+D', '복제'], ['Ctrl+A', '모두 선택'], ['Ctrl+Z / Ctrl+Y', '실행 취소 / 다시 실행'], ['Ctrl+S', 'JSON 저장'], ['Esc', '선택 해제'],
    ];
    for (const [k, v] of rows) {
      const tr = document.createElement('tr'); const td1 = document.createElement('td'); const kbd = document.createElement('kbd'); kbd.textContent = k; td1.appendChild(kbd);
      const td2 = document.createElement('td'); td2.textContent = v; tr.append(td1, td2); tbl.appendChild(tr);
    }
    const foot = document.createElement('p'); foot.className = 'muted'; foot.textContent = `부스 배치도 플래너 v${APP_VERSION} · 데이터는 이 브라우저에 자동 저장됩니다. 다른 PC 로 옮기려면 '저장' 으로 JSON 파일을 만드세요.`;
    const box = document.createElement('div'); box.append(tbl, foot);
    showModal('도움말', box);
  });

  // ---------- 업데이트 확인 (GitHub Releases 공개 API, 무인증) ----------
  function parseVer(v) { const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v)); return m ? [+m[1], +m[2], +m[3]] : null; }
  function cmpVer(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
  function isGithubUrl(u) { try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'github.com' || x.hostname.endsWith('.github.com') || x.hostname.endsWith('.githubusercontent.com')); } catch (e) { return false; } }
  async function checkUpdate(silent) {
    if (!silent) toast('업데이트 확인 중…');
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rels = await res.json();
      const mine = (Array.isArray(rels) ? rels : []).filter((r) => r && !r.draft && !r.prerelease && typeof r.tag_name === 'string' && r.tag_name.startsWith(TAG_PREFIX) && parseVer(r.tag_name));
      try { localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now())); } catch (e) { /* 무시 */ }
      if (!mine.length) { if (!silent) showModal('업데이트 확인', `아직 게시된 릴리즈가 없습니다.\n현재 버전: v${APP_VERSION}`); return; }
      mine.sort((a, b) => cmpVer(parseVer(b.tag_name), parseVer(a.tag_name)));
      const latest = mine[0]; const lv = parseVer(latest.tag_name);
      if (cmpVer(lv, parseVer(APP_VERSION)) <= 0) { if (!silent) showModal('업데이트 확인', `최신 버전을 사용 중입니다. (v${APP_VERSION})`); return; }
      const zip = (latest.assets || []).find((a) => a && /\.zip$/i.test(a.name || '') && isGithubUrl(a.browser_download_url));
      const url = zip ? zip.browser_download_url : (isGithubUrl(latest.html_url) ? latest.html_url : null);
      const box = document.createElement('div');
      const p1 = document.createElement('p'); p1.textContent = `새 버전 v${lv.join('.')} 이(가) 있습니다. (현재 v${APP_VERSION})`; p1.style.fontWeight = '700';
      const pre = document.createElement('div'); pre.className = 'muted'; pre.textContent = (latest.body || '(변경 사항 설명 없음)').slice(0, 2000);
      const p2 = document.createElement('p'); p2.textContent = '적용 방법: 다운로드한 압축을 풀어 지금 이 앱이 있는 폴더에 덮어쓰면 됩니다. 저장된 배치도(브라우저 자동 저장)는 유지됩니다.';
      box.append(p1, pre, p2);
      showModal('업데이트 있음', box, [
        { label: '나중에' },
        { label: '다운로드', primary: true, onClick: () => { if (url) window.open(url, '_blank', 'noopener'); else toast('다운로드 주소를 찾지 못했습니다'); } },
      ]);
    } catch (err) {
      if (!silent) showModal('업데이트 확인 실패', '네트워크에 연결할 수 없거나 GitHub 에 접근할 수 없습니다.\n지금 버전을 그대로 계속 사용할 수 있습니다.');
    }
  }
  $('btnUpdate').addEventListener('click', () => checkUpdate(false));
  function autoUpdateCheck() {
    // 하루 한 번만 조용히 확인 (실패해도 아무 것도 표시하지 않음)
    try {
      const last = +localStorage.getItem(UPDATE_CHECK_KEY) || 0;
      if (Date.now() - last > 24 * 3600 * 1000 && navigator.onLine !== false) checkUpdate(true);
    } catch (e) { /* 무시 */ }
  }

  // ---------- 시작 ----------
  loadAutosave();
  setTheme(state.theme);
  lastSnap = snapshot();
  refreshAll();
  fitView();
  window.addEventListener('resize', render);
  autoUpdateCheck();
})();
