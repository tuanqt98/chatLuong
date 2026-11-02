// Báo cáo hao phí — frontend thuần (không build, chạy offline trong LAN)

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const fmt = (n, f = nf) => (n === null || n === undefined || Number.isNaN(n) ? '—' : f.format(n));
const hrs = (min) => nf1.format(min / 60);
const pct = (n) => (n === null || n === undefined ? '—' : nf2.format(n) + '%');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dmy = (ymd) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };
const dm = (ymd) => { const [, m, d] = ymd.split('-'); return `${d}/${m}`; };
const sumBy = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

const state = {
  today: null,
  from: null,
  to: null,
  data: null,
  q: '',
  wc: '',
  overOnly: false,
  group: 'day',
  sort: { key: 'overScrapQty', dir: -1 },
};

// ═════════════ API ═════════════
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error ?? `Lỗi ${res.status}`);
  return body;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}

// ═════════════ Router ═════════════
function route() {
  const view = location.hash.startsWith('#/settings') ? 'settings' : 'report';
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  if (view === 'settings') loadSettingsForm();
  else if (!state.data) loadReport();
}

// ═════════════ Ngày ═════════════
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
function presetRange(p) {
  const t = state.today;
  const [y, m] = t.split('-').map(Number);
  const first = (yy, mm) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  switch (p) {
    case 'today': return [t, t];
    case 'yesterday': return [addDays(t, -1), addDays(t, -1)];
    case '7d': return [addDays(t, -6), t];
    case 'month': return [first(y, m), t];
    case 'lastmonth': return [first(y, m - 1), addDays(first(y, m), -1)];
  }
}
function syncPresetButtons() {
  $$('#presets button').forEach((b) => {
    const [f, t] = presetRange(b.dataset.preset);
    b.classList.toggle('on', f === state.from && t === state.to);
  });
  $('#from').value = state.from;
  $('#to').value = state.to;
}
function setRange(from, to) {
  if (from > to) [from, to] = [to, from];
  state.from = from;
  state.to = to;
  const u = new URLSearchParams({ from, to });
  history.replaceState(null, '', `?${u}${location.hash}`);
  syncPresetButtons();
  loadReport();
}

// ═════════════ Tải báo cáo ═════════════
let reqSeq = 0;
async function loadReport(refresh = false) {
  const seq = ++reqSeq; // bỏ kết quả của request cũ nếu người dùng đổi ngày liên tục
  $('#loading').hidden = false;
  $('#report-body').classList.add('dim');
  $('#btn-refresh').disabled = true;
  try {
    const q = new URLSearchParams({ from: state.from, to: state.to });
    if (refresh) q.set('refresh', '1');
    const data = await api(`/api/report?${q}`);
    if (seq !== reqSeq) return;
    state.data = data;
    renderAlerts(data.warnings);
    fillWorkcenterFilter();
    renderAll();
    const at = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
    $('#sub').textContent = `Dữ liệu Odoo · ${dmy(state.from)}${state.from !== state.to ? ' – ' + dmy(state.to) : ''}${at ? ' · cập nhật ' + at : ''}`;
  } catch (e) {
    if (seq !== reqSeq) return;
    state.data = null;
    renderAlerts([], e.message);
    renderAll();
  } finally {
    if (seq === reqSeq) {
      $('#loading').hidden = true;
      $('#report-body').classList.remove('dim');
      $('#btn-refresh').disabled = false;
    }
  }
}

function renderAlerts(warnings = [], error) {
  const box = $('#alerts');
  let html = '';
  if (error) {
    const needsSetup = /cấu hình|Cài đặt/.test(error);
    html += `<div class="alert error"><span class="ic">✕</span><div><b>Không lấy được dữ liệu.</b> ${esc(error)}
      ${needsSetup ? ' <a href="#/settings">Mở Cài đặt →</a>' : ''}</div></div>`;
  }
  if (warnings.length) {
    html += `<div class="alert"><span class="ic">⚠</span><div><b>Lưu ý về độ chính xác</b><ul>${warnings
      .slice(0, 6).map((w) => `<li>${esc(w)}</li>`).join('')}${warnings.length > 6 ? `<li>… và ${warnings.length - 6} cảnh báo khác</li>` : ''}</ul></div></div>`;
  }
  box.innerHTML = html;
}

function fillWorkcenterFilter() {
  const all = [...new Set((state.data?.summary ?? []).flatMap((s) => s.workcenters))].sort((a, b) => a.localeCompare(b, 'vi'));
  const sel = $('#wc');
  const cur = sel.value;
  sel.innerHTML = `<option value="">Tất cả máy</option>` + all.map((w) => `<option>${esc(w)}</option>`).join('');
  sel.value = all.includes(cur) ? cur : '';
  state.wc = sel.value;
}

// ═════════════ Lọc & gộp ═════════════
function filteredRows() {
  let rows = state.data?.summary ?? [];
  const q = state.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => (r.workerName + ' ' + r.productions.join(' ') + ' ' + r.workerKey).toLowerCase().includes(q));
  if (state.wc) rows = rows.filter((r) => r.workcenters.includes(state.wc));
  return rows;
}

/** Gộp nhiều ngày của 1 người. Tỷ lệ phải TÍNH LẠI từ tổng, không lấy trung bình các tỷ lệ ngày. */
function groupByWorker(rows) {
  const m = new Map();
  for (const r of rows) {
    let g = m.get(r.workerKey);
    if (!g) {
      g = { ...r, day: null, days: 0, overDays: 0, workcenters: [], productions: [], scrapReasons: {}, downReasons: {}, qualityIssues: [],
        runMin: 0, downMin: 0, goodQty: 0, scrapQty: 0, allowedScrapQty: 0, overScrapQty: 0, matPlanned: 0, matActual: 0, _rows: [] };
      m.set(r.workerKey, g);
    }
    g._rows.push(r);
    g.days++;
    if (r.overScrap) g.overDays++;
    for (const k of ['runMin', 'downMin', 'goodQty', 'scrapQty', 'allowedScrapQty', 'overScrapQty', 'matPlanned', 'matActual']) g[k] += r[k];
    for (const w of r.workcenters) if (!g.workcenters.includes(w)) g.workcenters.push(w);
    for (const p of r.productions) if (!g.productions.includes(p)) g.productions.push(p);
    for (const [k, v] of Object.entries(r.scrapReasons)) g.scrapReasons[k] = (g.scrapReasons[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.downReasons)) g.downReasons[k] = (g.downReasons[k] ?? 0) + v;
    for (const q of r.qualityIssues) if (!g.qualityIssues.includes(q)) g.qualityIssues.push(q);
  }
  return [...m.values()].map((g) => {
    const d = g.goodQty + g.scrapQty;
    g.scrapRatePct = d ? (g.scrapQty / d) * 100 : null;
    g.overScrap = g.overScrapQty > 0.005;
    g.matVariancePct = g.matPlanned ? ((g.matActual - g.matPlanned) / g.matPlanned) * 100 : null;
    g.overMaterial = g.matVariancePct !== null && g.matVariancePct > g.matNormPct;
    return g;
  });
}

function currentRows() {
  let rows = filteredRows();
  if (state.group === 'worker') rows = groupByWorker(rows);
  if (state.overOnly) rows = rows.filter((r) => r.overScrap || r.overMaterial);
  const { key, dir } = state.sort;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === y) return (a.day ?? '').localeCompare(b.day ?? '') || a.workerName.localeCompare(b.workerName, 'vi');
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === 'string' ? x.localeCompare(y, 'vi') : x - y) * dir;
  });
}

// ═════════════ Render ═════════════
function renderAll() {
  const base = filteredRows(); // KPI & biểu đồ theo bộ lọc tìm kiếm / máy (không theo "chỉ vượt")
  renderKpis(base);
  renderWorkerChart(base);
  renderReasonChart(base);
  renderDownChart(base);
  renderTrend(base);
  renderTable();
}

function renderKpis(rows) {
  const run = sumBy(rows, (r) => r.runMin);
  const down = sumBy(rows, (r) => r.downMin);
  const good = sumBy(rows, (r) => r.goodQty);
  const scrap = sumBy(rows, (r) => r.scrapQty);
  const allowed = sumBy(rows, (r) => r.allowedScrapQty);
  const over = rows.filter((r) => r.overScrap);
  const workers = new Set(rows.map((r) => r.workerKey)).size;
  const rate = good + scrap ? (scrap / (good + scrap)) * 100 : null;
  const allowedRate = good + allowed ? (allowed / (good + allowed)) * 100 : null;
  const avail = run + down ? (run / (run + down)) * 100 : null;
  const badRate = rate !== null && allowedRate !== null && rate > allowedRate;

  $('#kpis').innerHTML = `
    <div class="kpi"><div class="label">Giờ chạy máy</div>
      <div class="value">${hrs(run)}<small>giờ</small></div>
      <div class="foot">${workers} công nhân · máy chạy ${pct(avail)} thời gian</div></div>
    <div class="kpi"><div class="label">Giờ dừng máy</div>
      <div class="value">${hrs(down)}<small>giờ</small></div>
      <div class="foot">${topKey(rows, 'downReasons') ? 'Nhiều nhất: ' + esc(topKey(rows, 'downReasons')) : 'Không có'}</div></div>
    <div class="kpi"><div class="label">Sản lượng đạt</div>
      <div class="value">${fmt(good)}</div>
      <div class="foot">Phế ${fmt(scrap)} · cho phép ${fmt(allowed)}</div></div>
    <div class="kpi ${badRate ? 'bad' : ''}"><div class="label">Tỷ lệ phế</div>
      <div class="value">${pct(rate)}</div>
      <div class="foot">${badRate
        ? `<span class="status bad">▲ Vượt</span> định mức ${pct(allowedRate)}`
        : rate !== null ? `<span class="status ok">✓ Trong</span> định mức ${pct(allowedRate)}` : '—'}</div></div>
    <div class="kpi ${over.length ? 'bad' : ''}"><div class="label">Lượt vượt định mức phế</div>
      <div class="value">${over.length}<small>/ ${rows.length}</small></div>
      <div class="foot">${over.length ? `Tổng phế vượt ${fmt(sumBy(over, (r) => r.overScrapQty))}` : 'Không ai vượt'}</div></div>`;
}

function topKey(rows, field) {
  const m = {};
  for (const r of rows) for (const [k, v] of Object.entries(r[field])) m[k] = (m[k] ?? 0) + v;
  return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Bar ngang: thanh = phế thực tế, vạch đen = mức cho phép. Vượt → nhãn ▲ đỏ (icon + chữ, không chỉ màu). */
function renderWorkerChart(rows) {
  const g = groupByWorker(rows).filter((w) => w.scrapQty > 0 || w.allowedScrapQty > 0);
  g.sort((a, b) => b.overScrapQty - a.overScrapQty || b.scrapQty - a.scrapQty);
  const top = g.slice(0, 12);
  const max = Math.max(1, ...top.map((w) => Math.max(w.scrapQty, w.allowedScrapQty)));
  $('#chart-workers').innerHTML = top.length ? top.map((w) => {
    const over = w.overScrapQty > 0.005;
    const tip = `<b>${esc(w.workerName)}</b><br>Phế thực tế: ${fmt(w.scrapQty)} (${pct(w.scrapRatePct)})<br>Cho phép: ${fmt(w.allowedScrapQty)}<br>` +
      (over ? `Vượt: <b>+${fmt(w.overScrapQty)}</b> (${w.overDays}/${w.days} ngày)` : 'Trong định mức') +
      `<br>SL đạt: ${fmt(w.goodQty)} · chạy máy ${hrs(w.runMin)} giờ`;
    return `<div class="hbar clickable" data-worker="${esc(w.workerKey)}" data-tip="${esc(tip)}">
      <span class="name">${esc(w.workerName)}</span>
      <span class="track"><span class="fill" style="width:${(w.scrapQty / max) * 100}%"></span>
        <span class="marker" style="left:calc(${(w.allowedScrapQty / max) * 100}% - 1px)"></span></span>
      <span class="val">${fmt(w.scrapQty)} / ${fmt(w.allowedScrapQty)} ${over ? `<span class="status bad">▲ +${fmt(w.overScrapQty)}</span>` : `<span class="status ok">✓</span>`}</span>
    </div>`;
  }).join('') + (g.length > 12 ? `<div class="none">… và ${g.length - 12} người khác (xem bảng bên dưới)</div>` : '')
    : `<div class="none">Không có phế phẩm trong khoảng này.</div>`;
}

function barList(el, entries, fmtVal, unit) {
  const top = entries.sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1e-9, ...top.map((e) => e[1]));
  const total = sumBy(entries, (e) => e[1]);
  el.innerHTML = top.length ? top.map(([k, v]) => `
    <div class="hbar" data-tip="${esc(`<b>${esc(k)}</b><br>${fmtVal(v)} ${unit} · ${nf1.format((v / total) * 100)}% tổng`)}">
      <span class="name" title="${esc(k)}">${esc(k)}</span>
      <span class="track"><span class="fill" style="width:${(v / max) * 100}%"></span></span>
      <span class="val">${fmtVal(v)}</span>
    </div>`).join('') : `<div class="none">Không có dữ liệu.</div>`;
}
function aggregate(rows, field) {
  const m = {};
  for (const r of rows) for (const [k, v] of Object.entries(r[field])) m[k] = (m[k] ?? 0) + v;
  return Object.entries(m);
}
const renderReasonChart = (rows) => barList($('#chart-reasons'), aggregate(rows, 'scrapReasons'), (v) => fmt(v), '');
const renderDownChart = (rows) => barList($('#chart-down'), aggregate(rows, 'downReasons').map(([k, v]) => [k, v / 60]), (v) => nf1.format(v), 'giờ');

/** Line: tỷ lệ phế thực tế theo ngày + đường cho phép (nét đứt). Chỉ hiện khi > 1 ngày. */
function renderTrend(rows) {
  const card = $('#card-trend');
  const byDay = new Map();
  for (const r of rows) {
    const d = byDay.get(r.day) ?? { good: 0, scrap: 0, allowed: 0 };
    d.good += r.goodQty; d.scrap += r.scrapQty; d.allowed += r.allowedScrapQty;
    byDay.set(r.day, d);
  }
  const days = [...byDay.keys()].sort();
  card.hidden = days.length < 2;
  if (card.hidden) return;
  const pts = days.map((day) => {
    const d = byDay.get(day);
    // Lưu ý: KHÔNG spread `d` sau cùng — d.allowed (số lượng) sẽ ghi đè allowedRate (%)
    return { day, good: d.good, scrap: d.scrap,
      rate: d.good + d.scrap ? (d.scrap / (d.good + d.scrap)) * 100 : 0,
      allowedRate: d.good + d.allowed ? (d.allowed / (d.good + d.allowed)) * 100 : 0 };
  });

  const el = $('#chart-trend');
  const W = el.clientWidth || 600, H = 220, L = 40, R = 12, T = 10, B = 26;
  const maxY = Math.max(1, ...pts.flatMap((p) => [p.rate, p.allowedRate])) * 1.15;
  const step = niceStep(maxY / 4);
  const top = Math.ceil(maxY / step) * step;
  const x = (i) => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const path = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const every = Math.ceil(pts.length / Math.max(2, Math.floor((W - L - R) / 56)));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tỷ lệ phế theo ngày">`;
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${nf1.format(v)}%</text>`;
  }
  pts.forEach((p, i) => {
    if (i % every === 0 || i === pts.length - 1) svg += `<text class="axis-label" x="${x(i)}" y="${H - 6}" text-anchor="middle">${dm(p.day)}</text>`;
  });
  svg += `<path class="ln-ref" d="${path('allowedRate')}"/><path class="ln" d="${path('rate')}"/>`;
  svg += `<line class="xhair" id="xhair" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
  pts.forEach((p, i) => (svg += `<circle class="dot ${p.rate > p.allowedRate ? 'over' : ''}" cx="${x(i)}" cy="${y(p.rate)}" r="${pts.length > 40 ? 2.5 : 4}"/>`));
  svg += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="trend-hit"/></svg>`;
  el.innerHTML = svg;

  // Hover crosshair: bắt điểm gần nhất theo trục X (vùng bắt rộng hơn điểm)
  const hit = $('#trend-hit', el), xh = $('#xhair', el), svgEl = $('svg', el);
  hit.addEventListener('mousemove', (ev) => {
    const r = svgEl.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) / r.width) * W;
    let i = Math.round(((mx - L) / (W - L - R)) * (pts.length - 1));
    i = Math.max(0, Math.min(pts.length - 1, i));
    const p = pts[i];
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
    showTip(ev, `<b>${dmy(p.day)}</b><br>Tỷ lệ phế: ${pct(p.rate)}<br>Cho phép: ${pct(p.allowedRate)}<br>Phế ${fmt(p.scrap)} / đạt ${fmt(p.good)}` +
      (p.rate > p.allowedRate ? `<br><b>▲ Vượt định mức</b>` : ''));
  });
  hit.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); hideTip(); });
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// ── Bảng ──
const COLS = [
  { key: 'day', label: 'Ngày', day: true, fmt: (r) => dmy(r.day) },
  { key: 'days', label: 'Số ngày', worker: true, r: true, fmt: (r) => r.days },
  { key: 'workerName', label: 'Công nhân', fmt: (r) => `<b>${esc(r.workerName)}</b>` },
  { key: 'workcenters', label: 'Máy', nosort: true, cls: 'wrap wc', fmt: (r) => esc(r.workcenters.join(', ')) },
  { key: 'runMin', label: 'Giờ chạy', r: true, fmt: (r) => hrs(r.runMin) },
  { key: 'downMin', label: 'Giờ dừng', r: true, fmt: (r) => (r.downMin ? hrs(r.downMin) : '<span class="muted">0</span>') },
  { key: 'goodQty', label: 'SL đạt', r: true, fmt: (r) => fmt(r.goodQty) },
  { key: 'scrapQty', label: 'SL phế', r: true, fmt: (r) => fmt(r.scrapQty) },
  { key: 'scrapRatePct', label: 'Phế %', r: true, fmt: (r) => pct(r.scrapRatePct) },
  { key: 'allowedScrapQty', label: 'Cho phép', r: true, fmt: (r) => fmt(r.allowedScrapQty) },
  { key: 'overScrapQty', label: 'Định mức phế', fmt: (r) => r.overScrap
      ? `<span class="status bad">▲ Vượt +${fmt(r.overScrapQty)}</span>${r.overDays !== undefined ? ` <span class="muted">(${r.overDays} ngày)</span>` : ''}`
      : r.scrapQty || r.goodQty ? '<span class="status ok">✓ Đạt</span>' : '<span class="muted">—</span>' },
  { key: 'matVariancePct', label: 'Hao hụt NVL', r: true, fmt: (r) => r.matVariancePct === null ? '<span class="muted">—</span>'
      : r.overMaterial ? `<span class="status bad">▲ ${pct(r.matVariancePct)}</span>` : pct(r.matVariancePct) },
  { key: 'reasons', label: 'Nguyên nhân phế / dừng máy', nosort: true, cls: 'wrap', fmt: (r) => {
      const s = Object.entries(r.scrapReasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${esc(k)} (${fmt(v)})`);
      const d = Object.entries(r.downReasons).sort((a, b) => b[1] - a[1]).slice(0, 1).map(([k, v]) => `<span class="muted">Dừng:</span> ${esc(k)} ${nf.format(v)}p`);
      return [...s, ...d].join(' · ') || '<span class="muted">—</span>';
    } },
];

function renderTable() {
  const rows = currentRows();
  const cols = COLS.filter((c) => (state.group === 'worker' ? !c.day : !c.worker));
  const { key, dir } = state.sort;
  $('#tbl thead').innerHTML = `<tr>${cols.map((c) => `<th class="${c.r ? 'r' : ''}" data-key="${c.nosort ? '' : c.key}">${c.label}${
    key === c.key ? ` <span class="arr">${dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr>`;
  $('#tbl tbody').innerHTML = rows.map((r, i) => `<tr data-i="${i}" class="${r.overScrap || r.overMaterial ? 'over' : ''}">${
    cols.map((c) => `<td class="${c.r ? 'r' : ''} ${c.cls ?? ''}">${c.fmt(r)}</td>`).join('')}</tr>`).join('');
  state.rows = rows;

  const good = sumBy(rows, (r) => r.goodQty), scrap = sumBy(rows, (r) => r.scrapQty);
  const totals = {
    workerName: `Tổng ${rows.length} dòng`, runMin: hrs(sumBy(rows, (r) => r.runMin)), downMin: hrs(sumBy(rows, (r) => r.downMin)),
    goodQty: fmt(good), scrapQty: fmt(scrap), scrapRatePct: pct(good + scrap ? (scrap / (good + scrap)) * 100 : null),
    allowedScrapQty: fmt(sumBy(rows, (r) => r.allowedScrapQty)),
    overScrapQty: `${rows.filter((r) => r.overScrap).length} lượt vượt`,
  };
  $('#tbl tfoot').innerHTML = rows.length ? `<tr>${cols.map((c) => `<td class="${c.r ? 'r' : ''}">${totals[c.key] ?? ''}</td>`).join('')}</tr>` : '';
  $('#empty').hidden = rows.length > 0 || !state.data;
}

// ── Ngăn kéo chi tiết ──
function openDrawer(row) {
  const isGroup = state.group === 'worker' || !row.day;
  const days = isGroup ? (row._rows ?? [row]).map((r) => r.day) : [row.day];
  const det = (state.data?.details ?? []).filter((d) => d.workerKey === row.workerKey && days.includes(d.day));
  const over = row.overScrap;

  const reasonRows = Object.entries(row.scrapReasons).sort((a, b) => b[1] - a[1]);
  const downRows = Object.entries(row.downReasons).sort((a, b) => b[1] - a[1]);

  $('#drawer-body').innerHTML = `
    <h2>${esc(row.workerName)}</h2>
    <div class="meta">${isGroup ? `${dmy(state.from)} – ${dmy(state.to)} · ${row.days ?? 1} ngày làm` : dmy(row.day)} · ${esc(row.workcenters.join(', ') || '—')}</div>

    <div class="verdict ${over || row.overMaterial ? 'bad' : 'ok'}">
      ${over ? `<span class="status bad">▲ Vượt định mức phế</span> — phế ${fmt(row.scrapQty)}, cho phép ${fmt(row.allowedScrapQty)}, <b>vượt ${fmt(row.overScrapQty)}</b>.`
             : `<span class="status ok">✓ Trong định mức phế</span> — phế ${fmt(row.scrapQty)} / cho phép ${fmt(row.allowedScrapQty)}.`}
      ${row.overMaterial ? `<br><span class="status bad">▲ Hao hụt NVL ${pct(row.matVariancePct)}</span> vượt định mức ${pct(row.matNormPct)}.` : ''}
      ${over && reasonRows.length ? `<br>Nguyên nhân chính: <b>${esc(reasonRows[0][0])}</b> (${fmt(reasonRows[0][1])}).` : ''}
    </div>

    <div class="stats">
      <div class="stat"><b>${hrs(row.runMin)} giờ</b><span>Chạy máy</span></div>
      <div class="stat"><b>${hrs(row.downMin)} giờ</b><span>Dừng máy</span></div>
      <div class="stat"><b>${pct(row.scrapRatePct)}</b><span>Tỷ lệ phế</span></div>
      <div class="stat"><b>${fmt(row.goodQty)}</b><span>SL đạt</span></div>
      <div class="stat"><b>${fmt(row.scrapQty)}</b><span>SL phế</span></div>
      <div class="stat"><b>${row.matVariancePct === null ? '—' : pct(row.matVariancePct)}</b><span>Hao hụt NVL (ĐM ${pct(row.matNormPct)})</span></div>
    </div>

    <section><h3>Nguyên nhân phế</h3>${reasonRows.length ? `<table><tbody>${reasonRows.map(([k, v]) =>
      `<tr><td>${esc(k)}</td><td class="r">${fmt(v)}</td><td class="r muted">${nf1.format((v / row.scrapQty) * 100)}%</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Không có phế phẩm.</p>'}</section>

    ${row.qualityIssues.length ? `<section><h3>Lỗi chất lượng (Quality Alert)</h3><ul class="issues">${row.qualityIssues.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>` : ''}

    <section><h3>Lý do dừng máy</h3>${downRows.length ? `<table><tbody>${downRows.map(([k, v]) =>
      `<tr><td>${esc(k)}</td><td class="r">${nf.format(v)} phút</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Không dừng máy.</p>'}</section>

    <section><h3>Theo công đoạn (work order)</h3>${det.length ? `<table>
      <thead><tr>${isGroup ? '<th>Ngày</th>' : ''}<th>Lệnh SX / Công đoạn</th><th>Máy</th><th class="r">Phút</th><th class="r">% WO</th>
        <th class="r">Đạt</th><th class="r">Phế</th><th class="r">Cho phép</th><th>ĐM</th></tr></thead>
      <tbody>${det.map((d) => `<tr>${isGroup ? `<td>${dm(d.day)}</td>` : ''}
        <td>${esc(d.production)}<br><span class="muted">${esc(d.workorder)} · ${esc(d.product)}</span></td>
        <td>${esc(d.workcenter)}</td><td class="r">${nf.format(d.runMin)}</td><td class="r">${nf1.format(d.sharePct)}%</td>
        <td class="r">${fmt(d.goodQty)}</td><td class="r">${d.scrapQty > d.allowedScrapQty ? `<span class="status bad">▲ ${fmt(d.scrapQty)}</span>` : fmt(d.scrapQty)}</td>
        <td class="r">${fmt(d.allowedScrapQty)}</td><td class="muted" title="Nguồn định mức: ${esc(d.normSource)}">${nf2.format(d.normPct)}%</td></tr>`).join('')}</tbody></table>
      <p class="muted" style="font-size:12px">"% WO" = phần thời gian chạy máy của người này trên tổng thời gian của công đoạn. SL đạt/phế được chia theo tỷ lệ này.</p>`
      : '<p class="muted">Không có.</p>'}</section>`;
  $('#drawer').hidden = false;
  $('#drawer-close').focus();
}
const closeDrawer = () => ($('#drawer').hidden = true);

// ── Tooltip ──
function showTip(ev, html) {
  const t = $('#tip');
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14, r = t.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}
const hideTip = () => ($('#tip').hidden = true);

// ═════════════ Cài đặt ═════════════
let settingsCache = null;
async function loadSettingsForm() {
  const f = $('#settings-form');
  try {
    settingsCache = await api('/api/settings');
  } catch (e) {
    $('#save-result').textContent = e.message;
    return;
  }
  const s = settingsCache;
  const set = (name, v) => { const el = f.elements[name]; if (el) el.value = v ?? ''; };
  set('odoo.url', s.odoo.url); set('odoo.db', s.odoo.db); set('odoo.username', s.odoo.username); set('odoo.apiKey', s.odoo.apiKey);
  set('tz', s.tz); set('dayCutoffHour', s.dayCutoffHour);
  set('norms.default.pct', s.norms.default.pct); set('norms.default.setupQty', s.norms.default.setupQty ?? 0);
  set('norms.odooProductNormField', s.norms.odooProductNormField);
  set('norms.material.pct', s.norms.material?.pct); set('norms.material.uomNames', (s.norms.material?.uomNames ?? []).join(', '));
  for (const map of ['byWorkcenter', 'byProduct']) {
    const tb = $(`table[data-map=${map}] tbody`);
    tb.innerHTML = '';
    for (const [k, v] of Object.entries(s.norms[map] ?? {})) addNormRow(map, k, v);
  }
  api('/api/workcenters').then((list) => {
    $('#wc-list').innerHTML = list.map((n) => `<option value="${esc(n)}">`).join('');
  }).catch(() => {});
}

function addNormRow(map, name = '', v = { pct: '', setupQty: 0 }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="k" value="${esc(name)}" ${map === 'byWorkcenter' ? 'list="wc-list"' : ''} placeholder="${map === 'byWorkcenter' ? 'Chọn hoặc gõ tên máy' : 'VD: TEM-SAMSUNG-A01'}"></td>
    <td><input class="p" type="number" step="0.01" min="0" max="100" value="${v.pct}"></td>
    <td><input class="s" type="number" step="any" min="0" value="${v.setupQty ?? 0}"></td>
    <td><button type="button" class="del" title="Xoá">×</button></td>`;
  $(`table[data-map=${map}] tbody`).append(tr);
  return tr;
}

function readForm() {
  const f = $('#settings-form').elements;
  const v = (n) => f[n].value;
  const map = (m) => Object.fromEntries($$(`table[data-map=${m}] tbody tr`).map((tr) => [
    $('.k', tr).value.trim(), { pct: Number($('.p', tr).value), setupQty: Number($('.s', tr).value || 0) },
  ]).filter(([k]) => k));
  return {
    odoo: { url: v('odoo.url'), db: v('odoo.db'), username: v('odoo.username'), apiKey: v('odoo.apiKey') },
    tz: v('tz'),
    dayCutoffHour: Number(v('dayCutoffHour') || 0),
    norms: {
      default: { pct: Number(v('norms.default.pct')), setupQty: Number(v('norms.default.setupQty') || 0) },
      byWorkcenter: map('byWorkcenter'),
      byProduct: map('byProduct'),
      odooProductNormField: v('norms.odooProductNormField'),
      material: { pct: Number(v('norms.material.pct') || 0), uomNames: v('norms.material.uomNames') },
    },
  };
}

// ═════════════ Sự kiện ═════════════
function bind() {
  addEventListener('hashchange', route);
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setRange(...presetRange(b.dataset.preset));
  });
  $('#from').addEventListener('change', (e) => e.target.value && setRange(e.target.value, state.to < e.target.value ? e.target.value : state.to));
  $('#to').addEventListener('change', (e) => e.target.value && setRange(state.from, e.target.value));
  $('#btn-refresh').addEventListener('click', () => loadReport(true));

  $('#btn-export').addEventListener('click', (e) => { e.stopPropagation(); $('#export-menu').hidden = !$('#export-menu').hidden; });
  $('#export-menu').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    location.href = `/api/export?${new URLSearchParams({ from: state.from, to: state.to, type: a.dataset.type })}`;
    $('#export-menu').hidden = true;
  });
  document.addEventListener('click', () => ($('#export-menu').hidden = true));

  let qt;
  $('#q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value; renderAll(); }, 150); });
  $('#wc').addEventListener('change', (e) => { state.wc = e.target.value; renderAll(); });
  $('#over-only').addEventListener('change', (e) => { state.overOnly = e.target.checked; renderTable(); });
  $('#group').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.group = b.dataset.group;
    $$('#group button').forEach((x) => x.classList.toggle('on', x === b));
    if (state.group === 'worker' && state.sort.key === 'day') state.sort = { key: 'overScrapQty', dir: -1 };
    renderTable();
  });
  $('#tbl thead').addEventListener('click', (e) => {
    const k = e.target.closest('th')?.dataset.key;
    if (!k) return;
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: typeof state.rows?.[0]?.[k] === 'string' ? 1 : -1 };
    renderTable();
  });
  $('#tbl tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (tr) openDrawer(state.rows[+tr.dataset.i]);
  });
  $('#chart-workers').addEventListener('click', (e) => {
    const el = e.target.closest('[data-worker]');
    if (!el) return;
    const g = groupByWorker(filteredRows()).find((w) => w.workerKey === el.dataset.worker);
    if (g) { hideTip(); openDrawer(g); }
  });
  $('#drawer').addEventListener('click', (e) => e.target.id === 'drawer' && closeDrawer());
  $('#drawer-close').addEventListener('click', closeDrawer);
  addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

  // Tooltip chung cho mọi phần tử có data-tip
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) showTip(e, el.dataset.tip);
    else if (!e.target.closest?.('#trend-hit')) hideTip();
  });

  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => state.data && renderTrend(filteredRows()), 150); });

  // Cài đặt
  $$('[data-add]').forEach((b) => b.addEventListener('click', () => $('.k', addNormRow(b.dataset.add)).focus()));
  $('#settings-form').addEventListener('click', (e) => e.target.classList.contains('del') && e.target.closest('tr').remove());
  $('#btn-test').addEventListener('click', async () => {
    const out = $('#test-result');
    out.className = 'hint';
    out.textContent = 'Đang kết nối…';
    try {
      const r = await api('/api/test-connection', { method: 'POST', body: JSON.stringify(readForm()) });
      out.className = 'hint ok';
      const empPct = r.productivityLogs ? Math.round((r.withEmployee / r.productivityLogs) * 100) : 0;
      out.innerHTML = `✓ Kết nối được Odoo ${esc(r.version)}. ${r.productivityLogs} log thời gian máy` +
        (r.hasEmployee ? `, ${empPct}% có gắn nhân viên.` : ' — <b>không có employee_id</b>, sẽ thống kê theo user Odoo.') +
        (r.hasScrapReasons ? '' : ' Không có lý do phế (Odoo < 17).') + (r.hasQuality ? ' Có module Quality.' : '');
      if (r.hasEmployee && empPct < 80) out.className = 'hint bad';
    } catch (e) {
      out.className = 'hint bad';
      out.textContent = '✕ ' + e.message;
    }
  });
  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#save-result');
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(readForm()) });
      out.className = 'hint ok';
      out.textContent = '✓ Đã lưu';
      toast('Đã lưu cài đặt — báo cáo sẽ tính lại theo định mức mới');
      state.data = null;
      const st = await api('/api/status');
      state.today = st.today;
    } catch (err) {
      out.className = 'hint bad';
      out.textContent = '✕ ' + err.message;
    }
  });
}

// ═════════════ Khởi động ═════════════
(async function init() {
  bind();
  let st;
  try { st = await api('/api/status'); } catch (e) { renderAlerts([], 'Không kết nối được máy chủ báo cáo: ' + e.message); return; }
  state.today = st.today;
  const p = new URLSearchParams(location.search);
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
  state.from = ok(p.get('from')) ? p.get('from') : st.today;
  state.to = ok(p.get('to')) ? p.get('to') : state.from;
  syncPresetButtons();
  if (!st.configured && !location.hash.startsWith('#/settings')) location.hash = '#/settings';
  route();
})();
