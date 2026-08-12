/* 내 물가 (My CPI) — 프런트엔드
 *
 * 원칙
 *  - 숫자를 지어내지 않는다. 서버가 {ok:false, reason} 을 주면 그 사유를 그대로
 *    「데이터 없음(사유)」로 표시한다. 빈 화면이나 0으로 채우지 않는다.
 *  - 모든 수치 카드에 출처(기관 · 통계표 · 기준 시점 · 기준연도)를 붙인다.
 *  - 색만으로 정보를 전달하지 않는다. 상승/하락은 색 + 부호(+/−)를 항상 병기하고,
 *    발산 막대에는 빗금까지 더한다.
 *  - 차트는 외부 라이브러리 없이 SVG 로 직접 그린다. 엑셀 파싱만 SheetJS 를 쓴다.
 */

'use strict';

const C = {
  blue: '#5B9BFF', orange: '#FF9151', green: '#3DD68C', purple: '#B18CFA',
  border: '#242E3E', muted: '#8B95A8', dim: '#5B6479', text: '#E7ECF5', card: '#141A24',
};

const state = {
  divisions: [],      // [{code, name, item_count, examples, official_weight}]
  official: {},       // {code: weight}
  weights: {},        // 현재 사용자 가중치
  rules: null,        // 업종 매핑 규칙 (서버와 동일한 표)
  reviewThreshold: 0.8,
  result: null,
  hints: [],
  showTable: false,
};

/* --- 유틸 ----------------------------------------------------------------- */

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
const plain = (x, d = 2) => Number(x).toFixed(d);
const won = (x) => Math.round(x).toLocaleString('ko-KR');

function periodLabel(p) {
  if (!p || p.length !== 6) return p || '';
  return `${p.slice(0, 4)}년 ${parseInt(p.slice(4), 10)}월`;
}

/** 「데이터 없음(사유)」. 절대 값으로 채우지 않는다. */
function noData(reason, what = '데이터 없음') {
  const box = el('div', { class: 'nodata' });
  box.appendChild(el('b', {}, what));
  box.appendChild(document.createTextNode('수치를 표시하지 않습니다. 지어낸 값으로 채우지 않습니다.'));
  box.appendChild(el('div', { class: 'why' }, '사유: ' + reason));
  return box;
}

/** 카드 하단 출처 표기. 출처 없는 수치는 화면에 없다. */
function sourceLine(source, extra) {
  const parts = [];
  if (source) {
    parts.push(`출처: ${source.org}`);
    if (source.table_id) parts.push(`통계표 ${source.table_id}`);
    parts.push(`기준 시점 ${source.period_label || periodLabel(source.period)}`);
    parts.push(`기준연도 ${source.base_year}=100`);
    if (source.retrieved_at) parts.push(`조회 ${source.retrieved_at.slice(0, 16).replace('T', ' ')}`);
    if (source.note) parts.push(`※ ${source.note}`);
  }
  if (extra) parts.push(extra);
  return el('div', { class: 'src' }, parts.join(' · '));
}

async function api(path, body) {
  const opts = body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, opts);
  return response.json();
}

/* --- SVG 헬퍼 ------------------------------------------------------------- */

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** 데이터 쪽 끝만 둥근 막대. 기준선(0) 쪽은 각지게 둔다. */
function barPath(x0, x1, y, h, r) {
  const right = x1 >= x0;
  const radius = Math.min(r, Math.abs(x1 - x0));
  if (radius <= 0.5) return `M${x0},${y}H${x1}V${y + h}H${x0}Z`;
  return right
    ? `M${x0},${y}H${x1 - radius}Q${x1},${y} ${x1},${y + radius}V${y + h - radius}` +
      `Q${x1},${y + h} ${x1 - radius},${y + h}H${x0}Z`
    : `M${x0},${y}H${x1 + radius}Q${x1},${y} ${x1},${y + radius}V${y + h - radius}` +
      `Q${x1},${y + h} ${x1 + radius},${y + h}H${x0}Z`;
}

/** 적록색약에서 초록/주황 구분이 약해(ΔE 7.2) 하락 막대에 빗금을 더한다. */
function hatchDefs() {
  const defs = svgEl('defs');
  const pattern = svgEl('pattern', {
    id: 'hatch-down', width: 6, height: 6,
    patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  });
  pattern.appendChild(svgEl('rect', { width: 6, height: 6, fill: C.green, opacity: 0.9 }));
  pattern.appendChild(svgEl('line', {
    x1: 0, y1: 0, x2: 0, y2: 6, stroke: C.card, 'stroke-width': 2,
  }));
  defs.appendChild(pattern);
  return defs;
}

function tooltip() {
  let node = document.querySelector('.tip');
  if (!node) {
    node = el('div', { class: 'tip' });
    Object.assign(node.style, {
      position: 'fixed', pointerEvents: 'none', background: '#0B0E14',
      border: `1px solid ${C.border}`, borderRadius: '9px', padding: '9px 11px',
      fontSize: '12.5px', color: C.text, maxWidth: '320px', zIndex: 60,
      display: 'none', lineHeight: '1.55', boxShadow: '0 8px 24px rgba(0,0,0,.5)',
    });
    document.body.appendChild(node);
  }
  return node;
}

function bindTip(target, html) {
  const tip = tooltip();
  target.style.cursor = 'default';
  target.addEventListener('mouseenter', (event) => {
    tip.innerHTML = html;
    tip.style.display = 'block';
    moveTip(event);
  });
  target.addEventListener('mousemove', moveTip);
  target.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  function moveTip(event) {
    const pad = 14;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + 330 > window.innerWidth) x = event.clientX - 330;
    if (y + 120 > window.innerHeight) y = event.clientY - 120;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
}

/* --- ① 내 물가 ------------------------------------------------------------ */

function renderHeadline(data) {
  const body = $('s1body');
  body.textContent = '';

  if (!data.ok) { body.appendChild(noData(data.reason)); return; }

  const hero = el('div', { class: 'hero' });

  const mine = el('div');
  mine.appendChild(el('div', { class: 'label' }, `내 물가 · ${periodLabel(data.period)} 전년동월비`));
  const big = el('div', { class: 'big num' + (data.my_rate < 0 ? ' neg' : '') }, signed(data.my_rate, 1) + '%');
  mine.appendChild(big);
  hero.appendChild(mine);

  const side = el('div', { class: 'side' });

  const official = el('div', { class: 'official' });
  official.appendChild(el('div', { class: 'label' }, '공식 소비자물가'));
  official.appendChild(el('div', { class: 'val num' }, signed(data.official_rate, 1) + '%'));
  side.appendChild(official);

  const gapCls = data.negligible ? 'same' : (data.gap >= 0 ? 'up' : 'down');
  const gap = el('div', { class: 'gap' });
  gap.appendChild(el('div', { class: 'label' }, '격차'));
  gap.appendChild(el('div', { class: `val num ${gapCls}` }, signed(data.gap, 2) + '%p'));
  side.appendChild(gap);

  const idx = el('div');
  idx.appendChild(el('div', { class: 'label' }, `지수 (${data.base_year}=100)`));
  idx.appendChild(el('div', { class: 'val num' }, plain(data.my_index, 2)));
  side.appendChild(idx);

  hero.appendChild(side);
  body.appendChild(hero);

  body.appendChild(el('p', { class: 'narrative' }, data.narrative));
  body.appendChild(sourceLine(data.source,
    `가중치: ${state.weightLabel || '내 가중치'} · 공식 지수를 재가중한 참고값`));
}

/* --- ② 왜 (발산 막대) ------------------------------------------------------ */

function renderContributions(data) {
  const body = $('s2body');
  body.textContent = '';

  if (!data.ok) { body.appendChild(noData(data.reason)); return; }

  const rows = data.contributions;
  const max = Math.max(...rows.map((r) => Math.abs(r.gap_contribution)), 0.01);

  const rowH = 30, barH = 18, padL = 132, padR = 74, padT = 26, padB = 8;
  const width = Math.max(560, body.clientWidth || 640);
  const plotW = width - padL - padR;
  const height = padT + rows.length * rowH + padB;
  const mid = padL + plotW / 2;
  const scale = (value) => (value / max) * (plotW / 2 - 6);

  const svg = svgEl('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': '분류별 격차 기여도 발산 막대',
  });
  svg.appendChild(hatchDefs());

  // 0 기준선 — 실선 hairline
  svg.appendChild(svgEl('line', {
    x1: mid, y1: padT - 8, x2: mid, y2: height - padB, stroke: C.border, 'stroke-width': 1,
  }));
  const capL = svgEl('text', { x: mid - 8, y: padT - 13, 'text-anchor': 'end', class: 'axis-text' });
  capL.textContent = '← 내 물가를 낮춤';
  svg.appendChild(capL);
  const capR = svgEl('text', { x: mid + 8, y: padT - 13, 'text-anchor': 'start', class: 'axis-text' });
  capR.textContent = '내 물가를 높임 →';
  svg.appendChild(capR);

  rows.forEach((row, i) => {
    const y = padT + i * rowH + (rowH - barH) / 2;
    const value = row.gap_contribution;
    const x1 = mid + scale(value);
    const up = value >= 0;

    const label = svgEl('text', {
      x: padL - 12, y: y + barH / 2 + 4, 'text-anchor': 'end', class: 'bar-label',
    });
    label.textContent = row.name.length > 15 ? row.name.slice(0, 14) + '…' : row.name;
    const full = svgEl('title');
    full.textContent = row.name;
    label.appendChild(full);
    svg.appendChild(label);

    const bar = svgEl('path', {
      d: barPath(mid, x1, y, barH, 4),
      fill: up ? C.orange : 'url(#hatch-down)',
    });
    svg.appendChild(bar);

    // 부호를 반드시 병기한다 — 색만으로 방향을 알리지 않는다
    const value_label = svgEl('text', {
      x: up ? x1 + 7 : x1 - 7, y: y + barH / 2 + 4,
      'text-anchor': up ? 'start' : 'end',
      class: 'bar-val', fill: up ? C.orange : C.green,
    });
    value_label.textContent = signed(value, 2);
    svg.appendChild(value_label);

    const hit = svgEl('rect', {
      x: padL, y: padT + i * rowH, width: plotW, height: rowH, fill: 'transparent',
    });
    bindTip(hit, `<b>${row.name}</b><br>${row.explanation}`);
    svg.appendChild(hit);
  });

  const chart = el('div', { class: 'chart' });
  chart.appendChild(svg);
  body.appendChild(chart);

  const legend = el('div', { class: 'legend' });
  legend.appendChild(key(C.orange, '내 물가를 높인 항목 (+)'));
  legend.appendChild(key(C.green, '내 물가를 낮춘 항목 (−, 빗금)'));
  body.appendChild(legend);

  const warn = el('div', { class: 'hint' });
  warn.innerHTML = '<b>읽는 법.</b> 막대가 왼쪽(−)이라고 해서 그 분류의 <b>가격이 내린 것은 아닙니다.</b> ' +
    '가격은 올랐지만 내 비중이 평균보다 낮아 덜 반영된 경우가 대부분입니다. ' +
    '막대에 마우스를 올리면 그 분류의 실제 등락률을 함께 보여줍니다.';
  body.appendChild(warn);

  const toggle = el('button', { class: 'toggle' }, state.showTable ? '표 숨기기' : '표로 보기');
  toggle.onclick = () => { state.showTable = !state.showTable; renderContributions(data); };
  body.appendChild(toggle);

  if (state.showTable) body.appendChild(contributionTable(rows));
  body.appendChild(sourceLine(data.source, '기여도 합계 = 격차 (정확히 일치)'));
}

function key(color, text) {
  const wrap = el('span', { class: 'k' });
  const swatch = el('span', { class: 'sw' });
  swatch.style.background = color;
  wrap.appendChild(swatch);
  wrap.appendChild(document.createTextNode(text));
  return wrap;
}

function contributionTable(rows) {
  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  ['분류', '내 비중', '평균 비중', '비중 배수', '분류 등락률', '격차 기여'].forEach((h, i) => {
    const th = el('th', i === 0 ? {} : { style: 'text-align:right' }, h);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr');
    tr.appendChild(el('td', {}, row.name));
    tr.appendChild(el('td', { class: 'n' }, (row.my_share * 1000).toFixed(1)));
    tr.appendChild(el('td', { class: 'n' }, (row.official_share * 1000).toFixed(1)));
    tr.appendChild(el('td', { class: 'n' }, row.share_ratio.toFixed(2) + '배'));
    tr.appendChild(el('td', {
      class: 'n ' + (row.division_rate >= 0 ? 'up' : 'down'),
    }, signed(row.division_rate, 1) + '%'));
    tr.appendChild(el('td', {
      class: 'n ' + (row.gap_contribution >= 0 ? 'up' : 'down'),
    }, signed(row.gap_contribution, 2) + '%p'));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/* --- ③ 궤적 (라인) --------------------------------------------------------- */

function renderTrajectory(data) {
  const body = $('s3body');
  body.textContent = '';

  if (!data.ok) { body.appendChild(noData(data.reason)); return; }

  const points = data.points;
  if (points.length < 2) {
    body.appendChild(noData(`시점이 ${points.length}개뿐이라 궤적을 그릴 수 없습니다.`));
    return;
  }

  // padR 은 끝점 직접 라벨('내 물가 +2.0%')이 잘리지 않을 만큼 확보한다.
  const padL = 44, padR = 108, padT = 18, padB = 34;
  const width = Math.max(560, body.clientWidth || 640);
  const height = 260;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const values = points.flatMap((p) => [p.my_rate, p.official_rate]);
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.18, 0.35);
  lo -= pad; hi += pad;

  const X = (i) => padL + (i / (points.length - 1)) * plotW;
  const Y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

  const svg = svgEl('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': '공식 소비자물가와 내 물가 24개월 궤적',
  });

  // 가로 그리드 — 실선 hairline, 눈금은 깔끔한 숫자로
  const step = niceStep(hi - lo);
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
    const y = Y(t);
    svg.appendChild(svgEl('line', {
      x1: padL, y1: y, x2: padL + plotW, y2: y, stroke: C.border, 'stroke-width': 1,
    }));
    const tick = svgEl('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-text' });
    tick.textContent = signed(t, 1);
    svg.appendChild(tick);
  }

  // 0선은 한 단계 진하게
  if (lo < 0 && hi > 0) {
    svg.appendChild(svgEl('line', {
      x1: padL, y1: Y(0), x2: padL + plotW, y2: Y(0), stroke: C.dim, 'stroke-width': 1,
    }));
  }

  const line = (accessor, color) => {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(accessor(p)).toFixed(1)}`).join('');
    svg.appendChild(svgEl('path', {
      d, fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
  };
  line((p) => p.official_rate, C.blue);
  line((p) => p.my_rate, C.orange);

  // 끝점 마커 + 표면색 링, 직접 라벨.
  // 두 선의 끝값이 가까우면 라벨이 겹치므로 위아래로 벌린다.
  const last = points[points.length - 1];
  const cx = X(points.length - 1);
  const ends = [
    { field: 'official_rate', color: C.blue, name: '공식', cy: Y(last.official_rate) },
    { field: 'my_rate', color: C.orange, name: '내 물가', cy: Y(last.my_rate) },
  ].sort((a, b) => a.cy - b.cy);

  const MIN_GAP = 15;
  let labelY = [ends[0].cy, ends[1].cy];
  if (labelY[1] - labelY[0] < MIN_GAP) {
    const middle = (labelY[0] + labelY[1]) / 2;
    labelY = [middle - MIN_GAP / 2, middle + MIN_GAP / 2];
  }

  ends.forEach((end, i) => {
    svg.appendChild(svgEl('circle', {
      cx, cy: end.cy, r: 4, fill: end.color, stroke: C.card, 'stroke-width': 2,
    }));
    const y = Math.max(padT + 6, Math.min(padT + plotH - 2, labelY[i] + 4));
    const label = svgEl('text', { x: cx + 10, y, class: 'bar-val', fill: end.color });
    label.textContent = `${end.name} ${signed(last[end.field], 1)}%`;
    svg.appendChild(label);
  });

  // x축 라벨 — 처음/중간/끝만
  [0, Math.floor(points.length / 2), points.length - 1].forEach((i) => {
    const tick = svgEl('text', {
      x: X(i), y: height - 10, 'text-anchor': i === 0 ? 'start' : (i === points.length - 1 ? 'end' : 'middle'),
      class: 'axis-text',
    });
    tick.textContent = periodLabel(points[i].period);
    svg.appendChild(tick);
  });

  // 크로스헤어 + 툴팁
  const crosshair = svgEl('line', {
    y1: padT, y2: padT + plotH, stroke: C.dim, 'stroke-width': 1, opacity: 0,
  });
  svg.appendChild(crosshair);
  const overlay = svgEl('rect', {
    x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent',
  });
  const tip = tooltip();
  overlay.addEventListener('mousemove', (event) => {
    const box = svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left - padL) / plotW;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    const p = points[i];
    crosshair.setAttribute('x1', X(i)); crosshair.setAttribute('x2', X(i));
    crosshair.setAttribute('opacity', 1);
    tip.innerHTML = `<b>${periodLabel(p.period)}</b><br>` +
      `공식 ${signed(p.official_rate, 1)}% · 지수 ${plain(p.official_index, 2)}<br>` +
      `내 물가 ${signed(p.my_rate, 1)}% · 지수 ${plain(p.my_index, 2)}<br>` +
      `격차 ${signed(p.my_rate - p.official_rate, 2)}%p (${p.base_year}=100)`;
    tip.style.display = 'block';
    tip.style.left = Math.min(event.clientX + 14, window.innerWidth - 300) + 'px';
    tip.style.top = (event.clientY + 14) + 'px';
  });
  overlay.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', 0);
    tip.style.display = 'none';
  });
  svg.appendChild(overlay);

  const chart = el('div', { class: 'chart' });
  chart.appendChild(svg);
  body.appendChild(chart);

  const legend = el('div', { class: 'legend' });
  legend.appendChild(key(C.blue, '공식 소비자물가 (전년동월비 %)'));
  legend.appendChild(key(C.orange, '내 물가 (전년동월비 %)'));
  body.appendChild(legend);

  const base_years = [...new Set(points.map((p) => p.base_year))];
  body.appendChild(sourceLine(state.result && state.result.source,
    `기준연도 ${base_years.join(', ')}=100 · ${points.length}개 시점`));
}

function niceStep(range) {
  const raw = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/* --- ④ 장바구니 ------------------------------------------------------------ */

function renderBasket(data) {
  const body = $('s4body');
  body.textContent = '';

  if (!data.ok) { body.appendChild(noData(data.reason)); return; }

  const list = el('div');
  data.top_divisions.forEach((d) => {
    const row = el('div', { class: 'review-item' });
    row.appendChild(el('div', { class: 'q' }, d.name));
    row.appendChild(el('span', { class: 'num', style: `color:${C.muted}` }, `가중치 ${d.weight.toFixed(1)}`));
    list.appendChild(row);
  });
  body.appendChild(list);

  [data.kamis, data.opinet].forEach((feed) => {
    (feed.prices || []).forEach((price) => {
      const row = el('div', { class: 'review-item' });
      row.appendChild(el('div', { class: 'q' }, price.name + (price.unit ? ` (${price.unit})` : '')));
      row.appendChild(el('span', { class: 'num' }, won(price.price) + '원'));
      list.appendChild(row);
    });
    if (feed.prices && feed.prices.length) {
      body.appendChild(sourceLine(feed.prices[0].source));
    }
  });

  const off = [];
  if (!data.kamis.available) off.push(data.kamis.reason);
  if (!data.opinet.available) off.push(data.opinet.reason);

  if (off.length) {
    body.appendChild(noData(off.join(' / '), '가격 데이터 없음 — 이 화면만 비활성화'));
    body.appendChild(el('div', { class: 'hint' },
      '인증키가 없어도 ①②③ 화면은 정상 동작합니다.'));
  }
}

/* --- 슬라이더 (L1) --------------------------------------------------------- */

function renderSliders() {
  const host = $('sliders');
  host.textContent = '';

  state.divisions.forEach((d) => {
    const row = el('div', { class: 'slider-row' });

    const name = el('div', { class: 'nm' });
    name.appendChild(document.createTextNode(d.name));
    name.appendChild(el('small', {}, `공식 ${d.official_weight.toFixed(1)} · 품목 ${d.item_count}개`));
    row.appendChild(name);

    const input = el('input', {
      type: 'range', min: '0', max: '400', step: '0.5',
      value: String(state.weights[d.code]),
    });
    input.oninput = () => {
      state.weights[d.code] = parseFloat(input.value);
      updateSliderOutput(d.code);
      updateTotal();
      scheduleRecompute();
    };
    row.appendChild(input);

    const out = el('output', { id: 'out-' + d.code });
    row.appendChild(out);

    host.appendChild(row);
  });

  state.divisions.forEach((d) => updateSliderOutput(d.code));
  updateTotal();
  renderHints();
}

function updateSliderOutput(code) {
  const out = $('out-' + code);
  if (!out) return;
  const division = state.divisions.find((d) => d.code === code);
  const value = state.weights[code];
  const delta = value - division.official_weight;
  out.textContent = value.toFixed(1);
  if (Math.abs(delta) >= 0.05) {
    const span = el('span', { class: 'delta ' + (delta > 0 ? 'up' : 'down') }, signed(delta, 1));
    out.appendChild(span);
  }
}

function updateTotal() {
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0);
  $('sliderTotal').textContent = total.toLocaleString('ko-KR', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
}

function renderHints() {
  document.querySelectorAll('.slider-hint').forEach((n) => n.remove());
  const host = $('sliders');
  state.hints.forEach((hint) => {
    const box = el('div', { class: 'hint slider-hint' }, hint.message);
    host.appendChild(box);
  });
}

/* --- L2 업로드 ------------------------------------------------------------- */

const COLUMN_HINTS = {
  merchant: ['가맹점', '이용하신곳', '이용기관', '가맹점명', '내용', '적요', '상호'],
  category: ['업종', '분류', '카테고리'],
  amount: ['금액', '이용금액', '승인금액', '결제금액', '합계'],
  date: ['일자', '날짜', '이용일', '승인일', '거래일'],
};

function findColumn(headers, hints) {
  for (const hint of hints) {
    const i = headers.findIndex((h) => String(h || '').replace(/\s/g, '').includes(hint));
    if (i >= 0) return i;
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
          reason: rule.note || `'${keyword}' 로 판단했습니다.`,
        };
      }
    }
  }
  return {
    merchant, amount, division_code: null, division_name: null, confidence: 0,
    reason: '맞는 규칙이 없습니다. 추측하지 않고 직접 물어봅니다.',
  };
}

async function handleUpload(file) {
  const out = $('l2out');
  out.textContent = '';
  out.appendChild(el('div', { class: 'loading' }, '브라우저에서 읽는 중… (파일은 전송되지 않습니다)'));

  if (!state.rules) {
    const payload = await api('/api/mapping/rules');
    state.rules = payload.rules;
    state.reviewThreshold = payload.review_threshold;
  }

  if (typeof XLSX === 'undefined') {
    out.textContent = '';
    out.appendChild(noData(
      '엑셀 파서(SheetJS)를 불러오지 못했습니다. 네트워크에서 cdn.sheetjs.com 접근이 막혀 있는지 확인하세요.',
      '엑셀 업로드를 쓸 수 없음'));
    return;
  }

  let rows;
  try {
    const buffer = await file.arrayBuffer();
    const book = XLSX.read(buffer, { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  } catch (error) {
    out.textContent = '';
    out.appendChild(noData('엑셀을 읽지 못했습니다: ' + error.message, '파일을 읽을 수 없음'));
    return;
  }

  // 머리글 행 찾기 — 카드사마다 위쪽에 안내 문구가 몇 줄 붙는다
  let headerRow = -1, columns = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const headers = rows[i].map((c) => String(c || ''));
    const merchant = findColumn(headers, COLUMN_HINTS.merchant);
    const amount = findColumn(headers, COLUMN_HINTS.amount);
    if (merchant >= 0 && amount >= 0) {
      headerRow = i;
      columns = {
        merchant, amount,
        category: findColumn(headers, COLUMN_HINTS.category),
        date: findColumn(headers, COLUMN_HINTS.date),
      };
      break;
    }
  }

  out.textContent = '';
  if (headerRow < 0) {
    out.appendChild(noData(
      '가맹점명과 금액 열을 찾지 못했습니다. 카드사 원본 양식 그대로 올려 주세요.',
      '표 형식을 인식하지 못함'));
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
    out.appendChild(noData('금액이 있는 거래 행을 찾지 못했습니다.', '읽을 거래가 없음'));
    return;
  }

  renderReview(items, out);
}

function renderReview(items, out) {
  const summary = el('div', { class: 'sub' });
  const unknown = items.filter((i) => !i.division_code).length;
  const total = items.reduce((a, b) => a + b.amount, 0);
  summary.textContent =
    `${items.length}건 · 합계 ${won(total)}원 · 분류 못 한 ${unknown}건은 계산에서 제외됩니다.`;
  out.appendChild(summary);

  // 신뢰도가 낮은 것만 확인을 받는다 (금액 큰 순)
  const review = items
    .filter((i) => i.confidence < state.reviewThreshold)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 25);

  if (review.length) {
    out.appendChild(el('div', { class: 'notice' },
      `업종과 물가 분류의 대응에는 공개 표준이 없습니다. 아래 ${review.length}건은 ` +
      `확신이 낮아 직접 확인이 필요합니다. 고치면 그 이력을 저장해 매핑을 개선합니다.`));

    review.forEach((item) => {
      const row = el('div', { class: 'review-item' });
      const level = item.confidence >= 0.6 ? 'mid' : 'low';
      row.appendChild(el('span', { class: 'conf ' + level },
        item.division_code ? `확신 ${Math.round(item.confidence * 100)}%` : '분류 불가'));

      const question = item.division_code
        ? `${item.merchant} ${won(item.amount)}원 → ${item.division_name}(으)로 분류했습니다. 맞나요?`
        : `${item.merchant} ${won(item.amount)}원 — 어떤 분류인지 고르세요.`;
      row.appendChild(el('div', { class: 'q' }, question));

      const select = el('select');
      select.appendChild(el('option', { value: '' }, '— 제외 —'));
      state.divisions.forEach((d) => {
        const option = el('option', { value: d.code }, d.name);
        if (d.code === item.division_code) option.setAttribute('selected', 'selected');
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
        recomputeFromItems(items);
      };
      row.appendChild(select);
      out.appendChild(row);
    });
  }

  const apply = el('button', { class: 'primary' }, '이 지출 구성으로 계산');
  apply.onclick = () => recomputeFromItems(items, true);
  out.appendChild(apply);

  recomputeFromItems(items);
}

function recomputeFromItems(items, apply) {
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

  if (apply) {
    state.weights = weights;
    state.weightLabel = '카드 이용내역 기반';
    renderSliders();
    recompute();
  }
}

/* --- 계산 파이프라인 -------------------------------------------------------- */

let recomputeTimer = null;
function scheduleRecompute() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, 220);
}

async function recompute() {
  const payload = { weights: state.weights, label: state.weightLabel || '내 가중치' };

  const result = await api('/api/compute', payload);
  state.result = result;
  renderHeadline(result);
  renderContributions(result);

  renderTrajectory(await api('/api/trajectory', payload));
  renderBasket(await api('/api/basket', payload));

  // 사용자 가중치(입력)만 저장한다. 계산 결과는 저장하지 않는다.
  api('/api/weights', { weights: state.weights, level: state.level || 'L1' });
}

/* --- 자체 업데이트 확인 ------------------------------------------------------ */

/** semver 비교. a > b 이면 양수. */
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
  message.textContent = ' 확인 중…';

  const local = state.version || { version: '0.0.0' };
  const repository = local.repository;

  if (!repository) {
    message.textContent = ' version.json 에 repository 가 없어 확인할 수 없습니다.';
    button.disabled = false;
    return;
  }

  try {
    // 공개 저장소의 공개 API만 쓴다. 토큰이나 자격 증명을 담지 않는다.
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub 응답 ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');

    if (compareVersions(latest, local.version) > 0) {
      message.textContent = '';
      const box = el('div', { class: 'notice' });
      box.appendChild(el('b', {}, `새 버전 ${latest} 이 있습니다. (현재 ${local.version})`));
      box.appendChild(el('div', {}, release.body || release.name || ''));
      const link = el('a', { href: release.html_url, target: '_blank', rel: 'noopener' },
        '릴리스 페이지에서 내려받기');
      link.style.color = C.blue;
      box.appendChild(link);
      message.parentElement.appendChild(box);
    } else {
      message.textContent = ` 최신 버전입니다 (v${local.version}).`;
    }
  } catch (error) {
    // 확인 실패가 앱 사용 자체를 막으면 안 된다.
    message.textContent = ` 업데이트를 확인하지 못했습니다: ${error.message}. 기존 버전으로 계속 사용할 수 있습니다.`;
  }
  button.disabled = false;
}

/* --- 초기화 ----------------------------------------------------------------- */

async function init() {
  const [status, divisions] = await Promise.all([api('/api/status'), api('/api/divisions')]);

  state.version = status.version;
  $('ver').textContent =
    `v${status.version.version} · ${status.version.changelog || ''}`;
  $('checkUpdate').onclick = checkUpdate;

  state.divisions = divisions.divisions;
  divisions.divisions.forEach((d) => {
    state.official[d.code] = d.official_weight;
    state.weights[d.code] = d.official_weight;
  });
  state.weightLabel = '공식 가중치(2022년 기준)';

  $('limits').innerHTML =
    '이 서비스가 말할 수 없는 것 — 공식 물가가 아니라 재가중한 참고값입니다 · ' +
    '카드 내역은 가맹점 단위라 458개 품목으로 쪼개지지 않습니다 · ' +
    '2026년 12월 기준개편(2020=100 → 2025=100)으로 과거 계산값이 바뀔 수 있습니다 · ' +
    '자가주거비는 헤드라인 소비자물가지수에서 제외돼 있습니다.';

  renderSliders();

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      ['L0', 'L1', 'L2'].forEach((id) => $(id).classList.toggle('hidden', id !== tab.dataset.level));
      state.level = tab.dataset.level;
    };
  });

  $('applySeg').onclick = applySegment;
  $('resetW').onclick = () => {
    state.divisions.forEach((d) => { state.weights[d.code] = d.official_weight; });
    state.weightLabel = '공식 가중치(2022년 기준)';
    state.hints = [];
    renderSliders();
    recompute();
  };
  $('xls').onchange = (event) => {
    if (event.target.files[0]) handleUpload(event.target.files[0]);
  };

  recompute();
}

async function applySegment() {
  const button = $('applySeg');
  button.disabled = true;
  const message = $('segMsg');
  message.textContent = '';

  const payload = {
    household_size: parseInt($('hh').value, 10),
    income_decile: parseInt($('dec').value, 10),
    housing_type: $('house').value,
    has_car: $('car').value === '1',
  };

  const response = await api('/api/segment', payload);
  button.disabled = false;

  if (!response.ok) {
    message.appendChild(noData(response.reason));
    return;
  }

  state.weights = { ...response.weights };
  state.weightLabel = response.personalized
    ? `${response.label} · ${response.source}`
    : '공식 평균 가중치 (개인화 안 됨)';
  state.hints = response.review_hints || [];
  state.level = 'L0';

  if (response.notice) {
    message.appendChild(el('div', { class: 'notice' }, response.notice));
  }

  renderSliders();
  recompute();
}

/* 렌더 함수는 브라우저 콘솔·개발 검증에서 직접 호출할 수 있게 열어 둔다.
 * 실제 데이터는 언제나 서버 응답에서만 들어온다. */
window.__renderHeadline = renderHeadline;
window.__renderContributions = renderContributions;
window.__renderTrajectory = renderTrajectory;

init();
