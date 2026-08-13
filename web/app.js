/* 내 물가 (My CPI)
 *
 * 원칙
 *  - 숫자를 지어내지 않는다. 서버가 {ok:false, reason} 을 주면 그 사유를 그대로
 *    「데이터 없음(사유)」로 싣는다. 빈칸이나 0으로 채우지 않는다.
 *  - 모든 수치에 출처(기관·통계표·기준 시점·기준연도)를 붙인다.
 *  - 색만으로 정보를 전달하지 않는다. 상승·하락은 색과 부호(+/−)를 함께 쓰고,
 *    발산 막대에는 빗금을 더한다.
 *  - 차트는 외부 라이브러리 없이 SVG로 직접 그린다. 엑셀 파싱만 SheetJS를 쓴다.
 */

'use strict';

const INK = {
  official: '#1F4FD8',
  up: '#C2521C',
  down: '#137A57',
  rule: '#E3E6EB',
  ruleStrong: '#C3C8D1',
  ink2: '#4D5563',
  ink3: '#838B99',
  ink: '#15171C',
  paper: '#FFFFFF',
  wash: '#F7F8FA',
};

const state = {
  divisions: [],
  weights: {},
  weightLabel: '',
  rules: null,
  reviewThreshold: 0.8,
  result: null,
  hints: [],
  basketAmount: 100000,
  showTable: false,
  level: 'L0',
};

/* ── 유틸 ─────────────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);

const el = (tag, attrs = {}, text) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v; else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
};

/** 부호를 항상 붙인다. 색만으로 방향을 알리지 않기 위한 장치. */
const signed = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
const fixed = (x, d = 2) => Number(x).toFixed(d);
const won = (x) => Math.round(x).toLocaleString('ko-KR');

function periodLabel(p) {
  if (!p || p.length !== 6) return p || '';
  return `${p.slice(0, 4)}년 ${parseInt(p.slice(4), 10)}월`;
}

/** 「데이터 없음(사유)」. 값으로 채우지 않는다. */
function absent(reason, heading = '데이터 없음') {
  const box = el('div', { class: 'absent' });
  box.appendChild(el('strong', {}, heading));
  box.appendChild(document.createTextNode(
    '수치를 싣지 않습니다. 그럴듯한 값으로 채우지 않습니다.'));
  box.appendChild(el('div', { class: 'cause' }, '사유 — ' + reason));
  return box;
}

/** 출처 표기. 출처 없는 수치는 지면에 없다. */
function attribution(source, extra) {
  const parts = [];
  if (source) {
    parts.push(source.org);
    if (source.table_id) parts.push(`통계표 ${source.table_id}`);
    parts.push(`기준 시점 ${source.period_label || periodLabel(source.period)}`);
    parts.push(`기준연도 ${source.base_year}=100`);
    if (source.retrieved_at) {
      parts.push(`조회 ${source.retrieved_at.slice(0, 16).replace('T', ' ')}`);
    }
    if (source.note) parts.push(source.note);
  }
  if (extra) parts.push(extra);
  return el('div', { class: 'attribution' }, '출처 — ' + parts.join(' · '));
}

async function api(path, body) {
  const options = body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  return response.json();
}

/* ── SVG ──────────────────────────────────────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** 데이터 쪽 끝만 둥근 막대. 기준선(0) 쪽은 각지게 둔다. */
function barPath(x0, x1, y, h, r) {
  const rightward = x1 >= x0;
  const radius = Math.min(r, Math.abs(x1 - x0));
  if (radius <= 0.5) return `M${x0},${y}H${x1}V${y + h}H${x0}Z`;
  return rightward
    ? `M${x0},${y}H${x1 - radius}Q${x1},${y} ${x1},${y + radius}V${y + h - radius}` +
      `Q${x1},${y + h} ${x1 - radius},${y + h}H${x0}Z`
    : `M${x0},${y}H${x1 + radius}Q${x1},${y} ${x1},${y + radius}V${y + h - radius}` +
      `Q${x1},${y + h} ${x1 + radius},${y + h}H${x0}Z`;
}

/** 상승·하락은 적록색약에서 구분이 약하다(ΔE 7.0). 하락에 빗금을 더한다. */
function hatchDefs() {
  const defs = svgEl('defs');
  const pattern = svgEl('pattern', {
    id: 'hatch-down', width: 6, height: 6,
    patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  });
  pattern.appendChild(svgEl('rect', { width: 6, height: 6, fill: INK.down }));
  pattern.appendChild(svgEl('line', {
    x1: 0, y1: 0, x2: 0, y2: 6, stroke: INK.paper, 'stroke-width': 2.2,
  }));
  defs.appendChild(pattern);
  return defs;
}

function tipNode() {
  let node = document.querySelector('.hovercard');
  if (!node) {
    node = el('div', { class: 'hovercard' });
    Object.assign(node.style, {
      position: 'fixed', pointerEvents: 'none', background: INK.paper,
      border: `1px solid ${INK.ruleStrong}`, padding: '9px 12px', fontSize: '12.5px',
      color: INK.ink, maxWidth: '330px', zIndex: 60, display: 'none', lineHeight: '1.55',
      boxShadow: '0 3px 14px rgba(21,23,28,.14)',
    });
    document.body.appendChild(node);
  }
  return node;
}

function bindTip(target, html) {
  const tip = tipNode();
  target.addEventListener('mouseenter', (event) => {
    tip.innerHTML = html;
    tip.style.display = 'block';
    place(event);
  });
  target.addEventListener('mousemove', place);
  target.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  function place(event) {
    let x = event.clientX + 14;
    let y = event.clientY + 14;
    if (x + 340 > window.innerWidth) x = event.clientX - 340;
    if (y + 130 > window.innerHeight) y = event.clientY - 130;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
}

/* ── 1 내 물가 ────────────────────────────────────────────────────────── */

function renderHeadline(data) {
  const body = $('s1body');
  body.textContent = '';
  if (!data.ok) { body.appendChild(absent(data.reason)); return; }

  const figures = el('div', { class: 'headline-figures' });

  const primary = el('div');
  primary.appendChild(el('div', { class: 'figure-caption' },
    `내 물가 · ${periodLabel(data.period)} 전년동월비`));
  primary.appendChild(el('div',
    { class: 'display' + (data.my_rate < 0 ? ' is-down' : '') },
    signed(data.my_rate, 1) + '%'));
  figures.appendChild(primary);

  const secondary = el('div', { class: 'secondary-figures' });
  secondary.appendChild(stat('공식 소비자물가', signed(data.official_rate, 1) + '%', 'official'));
  secondary.appendChild(stat('격차',
    signed(data.gap, 2) + '%p',
    data.negligible ? 'flat' : (data.gap >= 0 ? 'up' : 'down')));
  secondary.appendChild(stat(`지수 (${data.base_year}=100)`, fixed(data.my_index, 2), ''));
  figures.appendChild(secondary);

  body.appendChild(figures);
  body.appendChild(el('p', { class: 'reading' }, data.narrative));

  // 이 장만 잘라내도 뜻이 통해야 하므로 고지를 본문 안에도 둔다.
  const notice = el('div', { class: 'inline-notice' });
  notice.appendChild(el('strong', {}, '공식 물가가 아닙니다. '));
  notice.appendChild(document.createTextNode(
    '국가데이터처가 공표한 공식 지수를 사용자 가중치로 재가중한 참고값입니다.'));
  body.appendChild(notice);

  body.appendChild(attribution(data.source, `가중치 ${state.weightLabel || '내 가중치'}`));
}

function stat(caption, value, tone) {
  const box = el('div');
  box.appendChild(el('div', { class: 'figure-caption' }, caption));
  box.appendChild(el('div', { class: 'stat-value ' + tone }, value));
  return box;
}

/* ── 2 체감 ───────────────────────────────────────────────────────────── */

function renderFelt(data) {
  const body = $('s2body');
  body.textContent = '';
  if (!data.ok) { body.appendChild(absent(data.reason)); return; }

  // 장바구니 환산 — 지수의 정의를 그대로 옮긴 것이라 가격이 필요 없다
  const basket = el('div', { class: 'basket-line' });
  basket.appendChild(el('p', {}, data.basket.mine));
  basket.appendChild(el('p', { class: 'against' }, '공식 물가 기준으로는 ' + data.basket.official));

  const field = el('div', { class: 'amount-field' });
  field.appendChild(document.createTextNode('기준 금액 '));
  const amount = el('input', {
    type: 'number', min: '1000', step: '10000', value: String(state.basketAmount), id: 'basketAmount',
  });
  amount.oninput = () => {
    const value = parseFloat(amount.value);
    if (!isFinite(value) || value <= 0) return;
    state.basketAmount = value;
    scheduleFelt();
  };
  field.appendChild(amount);
  field.appendChild(document.createTextNode('원 — 직접 바꿔 보세요'));
  basket.appendChild(field);
  body.appendChild(basket);

  // 품목별 개수 환산
  const grid = el('div', { class: 'felt-grid' });
  data.items.forEach((item) => {
    const cell = el('div', { class: 'felt-cell' });
    cell.appendChild(el('div', { class: 'item-name', title: item.item_name }, item.item_name));

    const big = el('div', { class: 'unit-big' });
    big.appendChild(document.createTextNode(item.units_for_same_money.toFixed(0)));
    big.appendChild(el('span', { class: 'suffix' }, item.unit));
    cell.appendChild(big);

    cell.appendChild(el('div', { class: 'against-last-year' },
      `작년 ${item.base_units}${item.unit} 사던 돈으로`));

    const tone = Math.abs(item.rate) < 0.05 ? 'flat' : (item.rate > 0 ? 'up' : 'down');
    cell.appendChild(el('div', { class: 'rate ' + tone }, signed(item.rate, 1) + '%'));

    bindTip(cell, `<b>${item.item_name}</b><br>${item.sentence}`);
    grid.appendChild(cell);
  });
  body.appendChild(grid);

  if (data.missing && data.missing.length) {
    body.appendChild(el('div', { class: 'aside' },
      `찾지 못한 품목 — ${data.missing.join(', ')}. ` +
      '공표 통계표에 같은 이름의 품목이 없어 비워 둡니다. 비슷한 값으로 대신하지 않습니다.'));
  }

  body.appendChild(attribution(data.source,
    '개수 환산은 공표 지수의 등락률만으로 계산했습니다. 가격을 가정하지 않았습니다.'));
}

/* ── 3 왜 ─────────────────────────────────────────────────────────────── */

function renderContributions(data) {
  const body = $('s3body');
  body.textContent = '';
  if (!data.ok) { body.appendChild(absent(data.reason)); return; }

  const rows = data.contributions;
  const largest = Math.max(...rows.map((r) => Math.abs(r.gap_contribution)), 0.01);

  const rowH = 29, barH = 17, padL = 150, padR = 78, padT = 26, padB = 6;
  const width = Math.max(600, body.clientWidth || 660);
  const plotW = width - padL - padR;
  const height = padT + rows.length * rowH + padB;
  const zero = padL + plotW / 2;
  const scale = (v) => (v / largest) * (plotW / 2 - 8);

  const svg = svgEl('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': '분류별 격차 기여도',
  });
  svg.appendChild(hatchDefs());

  svg.appendChild(svgEl('line', {
    x1: zero, y1: padT - 6, x2: zero, y2: height - padB,
    stroke: INK.ruleStrong, 'stroke-width': 1,
  }));

  const capLeft = svgEl('text', { x: zero - 9, y: padT - 12, 'text-anchor': 'end', class: 'axis-label' });
  capLeft.textContent = '내 물가를 낮춤';
  svg.appendChild(capLeft);
  const capRight = svgEl('text', { x: zero + 9, y: padT - 12, 'text-anchor': 'start', class: 'axis-label' });
  capRight.textContent = '내 물가를 높임';
  svg.appendChild(capRight);

  rows.forEach((row, i) => {
    const y = padT + i * rowH + (rowH - barH) / 2;
    const value = row.gap_contribution;
    const tip = zero + scale(value);
    const rose = value >= 0;

    const name = svgEl('text', {
      x: padL - 14, y: y + barH / 2 + 4, 'text-anchor': 'end', class: 'series-label',
    });
    name.textContent = row.name.length > 16 ? row.name.slice(0, 15) + '…' : row.name;
    const full = svgEl('title');
    full.textContent = row.name;
    name.appendChild(full);
    svg.appendChild(name);

    svg.appendChild(svgEl('path', {
      d: barPath(zero, tip, y, barH, 4),
      fill: rose ? INK.up : 'url(#hatch-down)',
    }));

    const label = svgEl('text', {
      x: rose ? tip + 8 : tip - 8, y: y + barH / 2 + 4,
      'text-anchor': rose ? 'start' : 'end',
      class: 'value-label', fill: rose ? INK.up : INK.down,
    });
    label.textContent = signed(value, 2);
    svg.appendChild(label);

    const hit = svgEl('rect', {
      x: padL, y: padT + i * rowH, width: plotW, height: rowH, fill: 'transparent',
    });
    bindTip(hit, `<b>${row.name}</b><br>${row.explanation}`);
    svg.appendChild(hit);
  });

  const plot = el('div', { class: 'plot' });
  plot.appendChild(svg);
  body.appendChild(plot);

  const key = el('div', { class: 'key' });
  key.appendChild(keyEntry(INK.up, '내 물가를 높인 항목 (+)'));
  key.appendChild(keyEntry(INK.down, '내 물가를 낮춘 항목 (−, 빗금)'));
  body.appendChild(key);

  const caution = el('div', { class: 'aside caution' });
  caution.innerHTML =
    '<strong>읽는 법.</strong> 막대가 왼쪽이라고 해서 그 분류의 가격이 내린 것은 ' +
    '아닙니다. 가격은 올랐지만 내 비중이 평균보다 낮아 덜 반영된 경우가 대부분입니다. ' +
    '막대에 마우스를 올리면 그 분류의 실제 등락률을 함께 보여줍니다.';
  body.appendChild(caution);

  const toggle = el('button', { class: 'quiet' }, state.showTable ? '표 접기' : '표로 보기');
  toggle.style.marginTop = '14px';
  toggle.onclick = () => { state.showTable = !state.showTable; renderContributions(data); };
  body.appendChild(toggle);
  if (state.showTable) body.appendChild(contributionTable(rows));

  body.appendChild(attribution(data.source, '기여도 합계는 격차와 정확히 일치합니다'));
}

function keyEntry(color, text) {
  const entry = el('span', { class: 'entry' });
  const swatch = el('i');
  swatch.style.background = color;
  entry.appendChild(swatch);
  entry.appendChild(document.createTextNode(text));
  return entry;
}

function contributionTable(rows) {
  const table = el('table');
  table.appendChild(el('caption', {}, '분류별 기여도 — 색을 쓰지 않는 표'));

  const thead = el('thead');
  const headRow = el('tr');
  ['분류', '내 비중', '평균 비중', '비중 배수', '분류 등락률', '격차 기여'].forEach((h, i) => {
    headRow.appendChild(el('th', i === 0 ? {} : { class: 'n' }, h));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr');
    tr.appendChild(el('td', {}, row.name));
    tr.appendChild(el('td', { class: 'n' }, (row.my_share * 1000).toFixed(1)));
    tr.appendChild(el('td', { class: 'n' }, (row.official_share * 1000).toFixed(1)));
    tr.appendChild(el('td', { class: 'n' }, row.share_ratio.toFixed(2) + '배'));
    tr.appendChild(el('td', { class: 'n ' + (row.division_rate >= 0 ? 'up' : 'down') },
      signed(row.division_rate, 1) + '%'));
    tr.appendChild(el('td', { class: 'n ' + (row.gap_contribution >= 0 ? 'up' : 'down') },
      signed(row.gap_contribution, 2) + '%p'));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/* ── 4 궤적 ───────────────────────────────────────────────────────────── */

function renderTrajectory(data) {
  const body = $('s4body');
  body.textContent = '';
  if (!data.ok) { body.appendChild(absent(data.reason)); return; }

  const points = data.points;
  if (points.length < 2) {
    body.appendChild(absent(`시점이 ${points.length}개뿐이라 그릴 수 없습니다.`));
    return;
  }

  // padR 은 끝점 직접 라벨('내 물가 +2.0%')이 잘리지 않을 만큼 확보한다.
  const padL = 46, padR = 112, padT = 16, padB = 34;
  const width = Math.max(600, body.clientWidth || 660);
  const height = 264;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const values = points.flatMap((p) => [p.my_rate, p.official_rate]);
  let lo = Math.min(...values), hi = Math.max(...values);
  const margin = Math.max((hi - lo) * 0.18, 0.35);
  lo -= margin; hi += margin;

  const X = (i) => padL + (i / (points.length - 1)) * plotW;
  const Y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

  const svg = svgEl('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': '공식 소비자물가와 내 물가의 24개월 추이',
  });

  const step = niceStep(hi - lo);
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
    const y = Y(t);
    svg.appendChild(svgEl('line', {
      x1: padL, y1: y, x2: padL + plotW, y2: y, stroke: INK.rule, 'stroke-width': 1,
    }));
    const tick = svgEl('text', { x: padL - 9, y: y + 4, 'text-anchor': 'end', class: 'axis-label' });
    tick.textContent = signed(t, 1);
    svg.appendChild(tick);
  }

  if (lo < 0 && hi > 0) {
    svg.appendChild(svgEl('line', {
      x1: padL, y1: Y(0), x2: padL + plotW, y2: Y(0),
      stroke: INK.ruleStrong, 'stroke-width': 1,
    }));
  }

  const drawLine = (accessor, color) => {
    const d = points
      .map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(accessor(p)).toFixed(1)}`)
      .join('');
    svg.appendChild(svgEl('path', {
      d, fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
  };
  drawLine((p) => p.official_rate, INK.official);
  drawLine((p) => p.my_rate, INK.up);

  // 끝점 표식과 직접 라벨. 두 값이 가까우면 라벨을 위아래로 벌린다.
  const last = points[points.length - 1];
  const cx = X(points.length - 1);
  const ends = [
    { field: 'official_rate', color: INK.official, name: '공식', cy: Y(last.official_rate) },
    { field: 'my_rate', color: INK.up, name: '내 물가', cy: Y(last.my_rate) },
  ].sort((a, b) => a.cy - b.cy);

  const MIN_GAP = 15;
  let labelY = [ends[0].cy, ends[1].cy];
  if (labelY[1] - labelY[0] < MIN_GAP) {
    const middle = (labelY[0] + labelY[1]) / 2;
    labelY = [middle - MIN_GAP / 2, middle + MIN_GAP / 2];
  }

  ends.forEach((end, i) => {
    svg.appendChild(svgEl('circle', {
      cx, cy: end.cy, r: 4, fill: end.color, stroke: INK.paper, 'stroke-width': 2,
    }));
    const y = Math.max(padT + 6, Math.min(padT + plotH - 2, labelY[i] + 4));
    const label = svgEl('text', { x: cx + 10, y, class: 'value-label', fill: end.color });
    label.textContent = `${end.name} ${signed(last[end.field], 1)}%`;
    svg.appendChild(label);
  });

  [0, Math.floor(points.length / 2), points.length - 1].forEach((i) => {
    const tick = svgEl('text', {
      x: X(i), y: height - 10, class: 'axis-label',
      'text-anchor': i === 0 ? 'start' : (i === points.length - 1 ? 'end' : 'middle'),
    });
    tick.textContent = periodLabel(points[i].period);
    svg.appendChild(tick);
  });

  const crosshair = svgEl('line', {
    y1: padT, y2: padT + plotH, stroke: INK.ruleStrong, 'stroke-width': 1, opacity: 0,
  });
  svg.appendChild(crosshair);

  const overlay = svgEl('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' });
  const tip = tipNode();
  overlay.addEventListener('mousemove', (event) => {
    const box = svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left - padL) / plotW;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    const p = points[i];
    crosshair.setAttribute('x1', X(i));
    crosshair.setAttribute('x2', X(i));
    crosshair.setAttribute('opacity', 1);
    tip.innerHTML = `<b>${periodLabel(p.period)}</b><br>` +
      `공식 ${signed(p.official_rate, 1)}% · 지수 ${fixed(p.official_index, 2)}<br>` +
      `내 물가 ${signed(p.my_rate, 1)}% · 지수 ${fixed(p.my_index, 2)}<br>` +
      `격차 ${signed(p.my_rate - p.official_rate, 2)}%p (${p.base_year}=100)`;
    tip.style.display = 'block';
    tip.style.left = Math.min(event.clientX + 14, window.innerWidth - 310) + 'px';
    tip.style.top = (event.clientY + 14) + 'px';
  });
  overlay.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', 0);
    tip.style.display = 'none';
  });
  svg.appendChild(overlay);

  const plot = el('div', { class: 'plot' });
  plot.appendChild(svg);
  body.appendChild(plot);

  const key = el('div', { class: 'key' });
  key.appendChild(keyEntry(INK.official, '공식 소비자물가 (전년동월비 %)'));
  key.appendChild(keyEntry(INK.up, '내 물가 (전년동월비 %)'));
  body.appendChild(key);

  const baseYears = [...new Set(points.map((p) => p.base_year))];
  body.appendChild(attribution(state.result && state.result.source,
    `기준연도 ${baseYears.join(', ')}=100 · ${points.length}개 시점`));
}

function niceStep(range) {
  const raw = range / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  return (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * magnitude;
}

/* ── 5 실제 가격 ──────────────────────────────────────────────────────── */

function renderPrices(data) {
  const body = $('s5body');
  body.textContent = '';
  if (!data.ok) { body.appendChild(absent(data.reason)); return; }

  const table = el('table');
  table.appendChild(el('caption', {}, '내 가중치 상위 분류'));
  const tbody = el('tbody');
  data.top_divisions.forEach((division) => {
    const tr = el('tr');
    tr.appendChild(el('td', {}, division.name));
    tr.appendChild(el('td', { class: 'n' }, '가중치 ' + division.weight.toFixed(1)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);

  [data.kamis, data.opinet].forEach((feed) => {
    if (!feed.prices || !feed.prices.length) return;
    const priceTable = el('table');
    const tb = el('tbody');
    feed.prices.forEach((price) => {
      const tr = el('tr');
      tr.appendChild(el('td', {}, price.name + (price.unit ? ` (${price.unit})` : '')));
      tr.appendChild(el('td', { class: 'n' }, won(price.price) + '원'));
      tb.appendChild(tr);
    });
    priceTable.appendChild(tb);
    body.appendChild(priceTable);
    body.appendChild(attribution(feed.prices[0].source));
  });

  const unavailable = [];
  if (!data.kamis.available) unavailable.push(data.kamis.reason);
  if (!data.opinet.available) unavailable.push(data.opinet.reason);
  if (unavailable.length) {
    body.appendChild(absent(unavailable.join(' / '), '가격 데이터 없음 — 이 장만 비활성화'));
    body.appendChild(el('div', { class: 'aside' }, '인증키가 없어도 1~4장은 정상 동작합니다.'));
  }
}

/* ── 가중치 조정 ──────────────────────────────────────────────────────── */

function renderWeights() {
  const host = $('weights');
  host.textContent = '';

  state.divisions.forEach((division) => {
    const row = el('div', { class: 'weight-row' });

    const name = el('div', { class: 'name' });
    name.appendChild(document.createTextNode(division.name));
    name.appendChild(el('small', {},
      `공식 ${division.official_weight.toFixed(1)} · 품목 ${division.item_count}개`));
    row.appendChild(name);

    const slider = el('input', {
      type: 'range', min: '0', max: '400', step: '0.5',
      value: String(state.weights[division.code]),
      'aria-label': division.name + ' 가중치',
    });
    slider.oninput = () => {
      state.weights[division.code] = parseFloat(slider.value);
      updateWeightOutput(division.code);
      updateTally();
      scheduleRecompute();
    };
    row.appendChild(slider);
    row.appendChild(el('output', { id: 'out-' + division.code }));
    host.appendChild(row);
  });

  state.divisions.forEach((d) => updateWeightOutput(d.code));
  updateTally();

  state.hints.forEach((hint) => {
    host.appendChild(el('div', { class: 'aside' }, hint.message));
  });
}

function updateWeightOutput(code) {
  const out = $('out-' + code);
  if (!out) return;
  const division = state.divisions.find((d) => d.code === code);
  const value = state.weights[code];
  const delta = value - division.official_weight;
  out.textContent = value.toFixed(1);
  if (Math.abs(delta) >= 0.05) {
    out.appendChild(el('em', { class: delta > 0 ? 'up' : 'down' }, signed(delta, 1)));
  }
}

function updateTally() {
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0);
  $('weightTally').textContent =
    total.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/* ── 카드내역 불러오기 ────────────────────────────────────────────────── */

const COLUMN_HINTS = {
  merchant: ['가맹점', '이용하신곳', '이용기관', '가맹점명', '내용', '적요', '상호'],
  category: ['업종', '분류', '카테고리'],
  amount: ['금액', '이용금액', '승인금액', '결제금액', '합계'],
};

function findColumn(headers, hints) {
  for (const hint of hints) {
    const index = headers.findIndex((h) => String(h || '').replace(/\s/g, '').includes(hint));
    if (index >= 0) return index;
  }
  return -1;
}

/** 서버(app/mapping/mcc.py)와 같은 표를 같은 순서로 적용한다. */
function classify(merchant, amount, category) {
  const haystack = `${merchant} ${category || ''}`.toLowerCase();
  for (const rule of state.rules) {
    for (const keyword of rule.keywords) {
      const needle = keyword.toLowerCase().trim();
      if (needle && haystack.includes(needle)) {
        return {
          merchant, amount,
          division_code: rule.division_code,
          division_name: rule.division_name,
          confidence: rule.confidence,
        };
      }
    }
  }
  return { merchant, amount, division_code: null, division_name: null, confidence: 0 };
}

async function handleUpload(file) {
  const out = $('l2out');
  out.textContent = '';
  out.appendChild(el('p', { class: 'awaiting' }, '브라우저에서 읽는 중 — 파일은 전송되지 않습니다'));

  if (typeof XLSX === 'undefined') {
    out.textContent = '';
    out.appendChild(absent(
      '엑셀 파서(SheetJS)를 불러오지 못했습니다. cdn.sheetjs.com 접근이 막혀 있는지 확인하세요.',
      '카드내역을 읽을 수 없음'));
    return;
  }

  if (!state.rules) {
    const payload = await api('/api/mapping/rules');
    state.rules = payload.rules;
    state.reviewThreshold = payload.review_threshold;
  }

  let rows;
  try {
    const buffer = await file.arrayBuffer();
    const book = XLSX.read(buffer, { type: 'array' });
    rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
      header: 1, blankrows: false,
    });
  } catch (error) {
    out.textContent = '';
    out.appendChild(absent('파일을 읽지 못했습니다: ' + error.message, '읽을 수 없는 파일'));
    return;
  }

  let headerRow = -1, columns = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const headers = rows[i].map((c) => String(c || ''));
    const merchant = findColumn(headers, COLUMN_HINTS.merchant);
    const amount = findColumn(headers, COLUMN_HINTS.amount);
    if (merchant >= 0 && amount >= 0) {
      headerRow = i;
      columns = { merchant, amount, category: findColumn(headers, COLUMN_HINTS.category) };
      break;
    }
  }

  out.textContent = '';
  if (headerRow < 0) {
    out.appendChild(absent(
      '가맹점명과 금액 열을 찾지 못했습니다. 카드사 원본 양식 그대로 올려 주세요.',
      '표 형식을 알아보지 못함'));
    return;
  }

  const items = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const merchant = String(row[columns.merchant] || '').trim();
    const amount = parseFloat(String(row[columns.amount] || '').replace(/[^0-9.-]/g, ''));
    if (!merchant || !isFinite(amount) || amount <= 0) continue;
    const category = columns.category >= 0 ? String(row[columns.category] || '') : '';
    items.push(classify(merchant, amount, category));
  }

  if (!items.length) {
    out.appendChild(absent('금액이 있는 거래 행을 찾지 못했습니다.', '읽을 거래가 없음'));
    return;
  }
  renderReview(items, out);
}

function renderReview(items, out) {
  const unknown = items.filter((i) => !i.division_code).length;
  const total = items.reduce((a, b) => a + b.amount, 0);
  out.appendChild(el('p', { style: 'font-size:13.5px;color:var(--ink-2)' },
    `${items.length}건 · 합계 ${won(total)}원 · 분류하지 못한 ${unknown}건은 계산에서 제외됩니다.`));

  const review = items
    .filter((i) => i.confidence < state.reviewThreshold)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 25);

  if (review.length) {
    out.appendChild(el('div', { class: 'aside caution' },
      `업종과 물가 분류의 대응에는 공개 표준이 없습니다. 아래 ${review.length}건은 ` +
      '확신이 낮아 직접 확인이 필요합니다. 고치면 그 이력을 저장해 매핑을 개선합니다.'));

    review.forEach((item) => {
      const row = el('div', { class: 'entry-row' });
      row.appendChild(el('span',
        { class: 'certainty' + (item.confidence < 0.6 ? ' weak' : '') },
        item.division_code ? `확신 ${Math.round(item.confidence * 100)}%` : '분류 불가'));

      row.appendChild(el('div', { class: 'prompt' }, item.division_code
        ? `${item.merchant} ${won(item.amount)}원 → ${item.division_name}(으)로 분류했습니다. 맞나요?`
        : `${item.merchant} ${won(item.amount)}원 — 어떤 분류인지 골라 주세요.`));

      const select = el('select');
      select.appendChild(el('option', { value: '' }, '— 제외 —'));
      state.divisions.forEach((division) => {
        const option = el('option', { value: division.code }, division.name);
        if (division.code === item.division_code) option.setAttribute('selected', 'selected');
        select.appendChild(option);
      });
      select.onchange = () => {
        const previous = item.division_code;
        item.division_code = select.value || null;
        item.division_name = select.value
          ? state.divisions.find((d) => d.code === select.value).name : null;
        item.confidence = 1.0;
        api('/api/mapping/correct', {
          merchant: item.merchant,
          suggested_division: previous,
          corrected_division: select.value || 'EXCLUDED',
        });
      };
      row.appendChild(select);
      out.appendChild(row);
    });
  }

  const apply = el('button', { class: 'action' }, '이 지출 구성으로 계산');
  apply.onclick = () => applyItems(items);
  out.appendChild(apply);
}

function applyItems(items) {
  const totals = {};
  items.forEach((item) => {
    if (!item.division_code) return;
    totals[item.division_code] = (totals[item.division_code] || 0) + item.amount;
  });
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  if (grand <= 0) return;

  // 서버로는 집계된 12개 숫자만 나간다. 가맹점명·금액·일자는 전송되지 않는다.
  const weights = {};
  state.divisions.forEach((d) => { weights[d.code] = (totals[d.code] || 0) / grand * 1000; });

  state.weights = weights;
  state.weightLabel = '카드 이용내역 기반';
  state.level = 'L2';
  renderWeights();
  recompute();
}

/* ── 계산 ─────────────────────────────────────────────────────────────── */

let recomputeTimer = null;
function scheduleRecompute() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, 220);
}

let feltTimer = null;
function scheduleFelt() {
  clearTimeout(feltTimer);
  feltTimer = setTimeout(async () => {
    renderFelt(await api('/api/felt', payload()));
  }, 350);
}

function payload() {
  return {
    weights: state.weights,
    label: state.weightLabel || '내 가중치',
    basket_amount: state.basketAmount,
  };
}

async function recompute() {
  const body = payload();

  const result = await api('/api/compute', body);
  state.result = result;
  renderHeadline(result);
  renderContributions(result);

  renderFelt(await api('/api/felt', body));
  renderTrajectory(await api('/api/trajectory', body));
  renderPrices(await api('/api/basket', body));

  // 사용자 가중치(입력)만 저장한다. 계산 결과는 저장하지 않는다.
  api('/api/weights', { weights: state.weights, level: state.level });
}

/* ── 자체 업데이트 ────────────────────────────────────────────────────── */

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

async function checkUpdate() {
  const message = $('updateMsg');
  const button = $('checkUpdate');
  button.disabled = true;
  message.textContent = ' 확인 중';

  const local = state.version || { version: '0.0.0' };
  if (!local.repository) {
    message.textContent = ' version.json 에 repository 가 없어 확인할 수 없습니다.';
    button.disabled = false;
    return;
  }

  try {
    // 공개 저장소의 공개 API만 쓴다. 토큰이나 자격 증명을 담지 않는다.
    const response = await fetch(
      `https://api.github.com/repos/${local.repository}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub 응답 ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');

    message.textContent = compareVersions(latest, local.version) > 0
      ? ` 새 버전 ${latest} 이 있습니다 (현재 ${local.version}).`
      : ` 최신 버전입니다 (v${local.version}).`;
  } catch (error) {
    // 확인 실패가 앱 사용을 막으면 안 된다.
    message.textContent = ` 확인하지 못했습니다: ${error.message}. 계속 사용할 수 있습니다.`;
  }
  button.disabled = false;
}

/* ── 초기화 ───────────────────────────────────────────────────────────── */

async function init() {
  const [status, divisions] = await Promise.all([api('/api/status'), api('/api/divisions')]);

  state.version = status.version;
  $('edition').textContent =
    `버전 ${status.version.version} · 국가데이터처 소비자물가조사(승인번호 101007) 기준`;
  $('checkUpdate').onclick = checkUpdate;

  state.divisions = divisions.divisions;
  divisions.divisions.forEach((d) => { state.weights[d.code] = d.official_weight; });
  state.weightLabel = '공식 가중치(2022년 기준)';

  renderWeights();

  document.querySelectorAll('.control-strip button').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.control-strip button')
        .forEach((t) => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      ['L0', 'L1', 'L2'].forEach((id) => {
        $(id).classList.toggle('is-hidden', id !== tab.dataset.level);
      });
      state.level = tab.dataset.level;
    };
  });

  $('applySeg').onclick = applySegment;
  $('resetW').onclick = () => {
    state.divisions.forEach((d) => { state.weights[d.code] = d.official_weight; });
    state.weightLabel = '공식 가중치(2022년 기준)';
    state.hints = [];
    renderWeights();
    recompute();
  };
  $('xls').onchange = (event) => {
    if (event.target.files[0]) handleUpload(event.target.files[0]);
  };

  recompute();
}

async function applySegment() {
  const button = $('applySeg');
  const message = $('segMsg');
  button.disabled = true;
  message.textContent = '';

  const response = await api('/api/segment', {
    household_size: parseInt($('hh').value, 10),
    income_decile: parseInt($('dec').value, 10),
    housing_type: $('house').value,
    has_car: $('car').value === '1',
  });
  button.disabled = false;

  if (!response.ok) { message.appendChild(absent(response.reason)); return; }

  state.weights = { ...response.weights };
  state.weightLabel = response.personalized
    ? `${response.label} · ${response.source}`
    : '공식 평균 가중치 (개인화 안 됨)';
  state.hints = response.review_hints || [];
  state.level = 'L0';

  if (response.notice) {
    message.appendChild(el('div', { class: 'aside caution' }, response.notice));
  }
  renderWeights();
  recompute();
}

/* 개발 검증에서 렌더 함수를 직접 호출할 수 있게 열어 둔다.
 * 실제 데이터는 언제나 서버 응답에서만 들어온다. */
window.__renderHeadline = renderHeadline;
window.__renderFelt = renderFelt;
window.__renderContributions = renderContributions;
window.__renderTrajectory = renderTrajectory;

init();
