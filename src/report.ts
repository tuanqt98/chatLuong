/**
 * Báo cáo hao phí theo CÔNG NHÂN × NGÀY.
 *
 * Nguồn dữ liệu trong Odoo MRP:
 *  - mrp.workcenter.productivity : mỗi lần công nhân bấm Start/Pause/Done trên tablet = 1 log thời gian,
 *                                  có loss_type cho biết đó là thời gian chạy hay dừng máy + lý do.
 *  - mrp.workorder               : sản lượng đạt (qty_produced) của từng công đoạn.
 *  - stock.scrap                 : phế phẩm (thành phẩm hoặc NVL), có lý do (scrap_reason_tag_ids, Odoo 17+).
 *  - stock.move (NVL của MO)     : tiêu hao NVL thực tế so với kế hoạch từ BoM.
 *  - quality.alert (Enterprise)  : cảnh báo chất lượng — mô tả lỗi cụ thể.
 *
 * Vấn đề cốt lõi: Odoo KHÔNG gắn phế phẩm/sản lượng cho từng người. Nó gắn cho work order.
 * Một work order có thể do nhiều công nhân làm qua nhiều ca. Vì vậy ta PHÂN BỔ sản lượng & phế phẩm
 * của work order cho từng người theo tỷ lệ THỜI GIAN CHẠY MÁY của họ trên work order đó.
 */
import { OdooClient, m2oId, m2oName, type OdooRecord } from './odoo.ts';
import type { AppConfig, Norm } from './config.ts';
import { parseOdooDt, toOdooDt, localDayStart, workDay, addDays } from './time.ts';

// Loại thời gian "máy đang chạy". 'performance' = Odoo tự tách phần chạy CHẬM hơn thời gian chuẩn
// thành loss "Reduced Speed" — nhưng thực tế máy vẫn chạy, nên phải cộng vào thời gian chạy máy.
const RUN_TYPES = new Set(['productive', 'performance']);

interface TimeLog {
  woId: number | null;
  prodId: number | null;
  workcenter: string;
  workerKey: string;
  workerName: string;
  lossType: string;
  lossName: string;
  day: string;
  minutes: number;
}

export interface DetailRow {
  day: string;
  workerKey: string;
  workerName: string;
  workorder: string;
  production: string;
  product: string;
  workcenter: string;
  runMin: number;
  sharePct: number; // % thời gian chạy của người này trên tổng WO
  goodQty: number;
  scrapQty: number;
  allowedScrapQty: number;
  normPct: number;
  normSource: string;
}

export interface SummaryRow {
  day: string;
  workerKey: string;
  workerName: string;
  workcenters: string[];
  productions: string[];
  runMin: number;
  downMin: number;
  goodQty: number;
  scrapQty: number;
  scrapRatePct: number | null; // phế / (đạt + phế)
  allowedScrapQty: number;
  overScrap: boolean;
  overScrapQty: number;
  matPlanned: number;
  matActual: number;
  matVariancePct: number | null;
  matNormPct: number;
  overMaterial: boolean;
  scrapReasons: Record<string, number>; // lý do → SL phế phân bổ
  qualityIssues: string[]; // từ quality.alert
  downReasons: Record<string, number>; // lý do dừng → phút
}

export interface ReportResult {
  from: string;
  to: string;
  summary: SummaryRow[];
  details: DetailRow[];
  warnings: string[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const addTo = (m: Record<string, number>, k: string, v: number) => (m[k] = (m[k] ?? 0) + v);

export async function buildReport(odoo: OdooClient, cfg: AppConfig, from: string, to: string): Promise<ReportResult> {
  const { tz, dayCutoffHour: cut, norms } = cfg;
  const warnings: string[] = [];
  const now = new Date();

  // ── 1. Log thời gian trong khoảng ngày ────────────────────────────────────────────
  const P = 'mrp.workcenter.productivity';
  const workerField = await odoo.pickField(P, ['employee_id', 'user_id']);
  if (workerField !== 'employee_id') {
    warnings.push('mrp.workcenter.productivity không có employee_id → thống kê theo USER Odoo đăng nhập trên máy, không phải theo công nhân. ' +
      'Nếu nhiều công nhân dùng chung 1 tài khoản tablet, số liệu theo người sẽ sai — xem README.');
  }
  const logFields = await odoo.existingFields(P, [
    'workcenter_id', 'workorder_id', 'production_id', 'employee_id', 'user_id',
    'loss_id', 'loss_type', 'date_start', 'date_end',
  ]);
  const fromUtc = toOdooDt(localDayStart(from, tz, cut));
  const toUtcEx = toOdooDt(localDayStart(addDays(to, 1), tz, cut));
  const inRange = await odoo.searchReadAll(P, [['date_start', '>=', fromUtc], ['date_start', '<', toUtcEx]], logFields);

  const woIds = [...new Set(inRange.map((l) => m2oId(l.workorder_id)).filter((x): x is number => !!x))];
  const prodIdsFromLogs = inRange.map((l) => m2oId(l.production_id)).filter((x): x is number => !!x);

  // ── 2. Work orders + lệnh sản xuất liên quan ─────────────────────────────────────
  const woFields = await odoo.existingFields('mrp.workorder', ['name', 'production_id', 'workcenter_id', 'product_id', 'qty_produced']);
  const wos = await odoo.readByIds('mrp.workorder', woIds, woFields);
  const woById = new Map(wos.map((w) => [w.id, w]));
  const prodIds = [...new Set([...prodIdsFromLogs, ...wos.map((w) => m2oId(w.production_id)).filter((x): x is number => !!x)])];

  // ── 3. Lấy TOÀN BỘ log của các WO/MO này (kể cả ngoài khoảng ngày) ──────────────────
  // Lý do: nếu WO chạy 3 ngày mà ta chỉ lấy log 1 ngày thì tổng thời gian WO bị thiếu
  // → tỷ lệ phân bổ cho người làm ngày đó bị thổi phồng (có thể lên 100%).
  const allLogsRaw = woIds.length || prodIds.length
    ? await odoo.searchReadAll(P, ['|', ['workorder_id', 'in', woIds], ['production_id', 'in', prodIds]], logFields)
    : [];
  const seen = new Set<number>();
  const allLogs: TimeLog[] = [];
  for (const l of [...allLogsRaw, ...inRange]) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    const start = parseOdooDt(l.date_start);
    // Log đang mở (máy đang chạy, chưa bấm dừng) → tính tới hiện tại thay vì 0
    const end = l.date_end ? parseOdooDt(l.date_end) : now;
    const worker = (workerField && l[workerField]) || l.user_id || false;
    const woId = m2oId(l.workorder_id);
    allLogs.push({
      woId,
      prodId: m2oId(l.production_id) ?? (woId ? m2oId(woById.get(woId)?.production_id) : null),
      workcenter: m2oName(l.workcenter_id),
      workerKey: worker ? String(worker[0]) : '0',
      workerName: worker ? worker[1] : '(không xác định)',
      lossType: l.loss_type || 'productive',
      lossName: m2oName(l.loss_id) || l.loss_type || '',
      day: workDay(start, tz, cut),
      minutes: Math.max(0, (end.getTime() - start.getTime()) / 60000),
    });
  }

  const prodFields = await odoo.existingFields('mrp.production', ['name', 'product_id', 'product_qty', 'qty_produced', 'state']);
  const prods = await odoo.readByIds('mrp.production', prodIds, prodFields);
  const prodById = new Map(prods.map((p) => [p.id, p]));

  // Sản phẩm → mã + định mức (field Odoo nếu có)
  const productIds = prods.map((p) => m2oId(p.product_id)).filter((x): x is number => !!x);
  const normField = norms.odooProductNormField;
  const prodProductFields = ['default_code', 'display_name'];
  if (normField) {
    if (await odoo.pickField('product.product', [normField])) prodProductFields.push(normField);
    else warnings.push(`Field định mức "${normField}" không tồn tại trên product.product — bỏ qua, dùng norms.json.`);
  }
  const products = await odoo.readByIds('product.product', productIds, prodProductFields);
  const productById = new Map(products.map((p) => [p.id, p]));

  const normFor = (wo: OdooRecord): { norm: Norm; source: string } => {
    const prod = prodById.get(m2oId(wo.production_id) ?? -1);
    const product = productById.get(m2oId(prod?.product_id) ?? -1);
    if (normField && product && Number(product[normField]) > 0) {
      return { norm: { pct: Number(product[normField]), setupQty: 0 }, source: `Odoo:${normField}` };
    }
    const code = product?.default_code;
    if (code && norms.byProduct?.[code]) return { norm: norms.byProduct[code], source: `SP:${code}` };
    const wc = m2oName(wo.workcenter_id);
    if (norms.byWorkcenter?.[wc]) return { norm: norms.byWorkcenter[wc], source: `Máy:${wc}` };
    return { norm: norms.default, source: 'Mặc định' };
  };

  // ── 4. Phế phẩm ─────────────────────────────────────────────────────────────────
  const scrapFields = await odoo.existingFields('stock.scrap', [
    'product_id', 'scrap_qty', 'product_uom_id', 'production_id', 'workorder_id', 'scrap_reason_tag_ids', 'origin',
  ]);
  const scraps = prodIds.length
    ? await odoo.searchReadAll('stock.scrap', [['state', '=', 'done'], ['production_id', 'in', prodIds]], scrapFields)
    : [];
  const tagIds = scraps.flatMap((s) => s.scrap_reason_tag_ids ?? []);
  const tagName = new Map<number, string>();
  if (tagIds.length) {
    for (const t of await odoo.readByIds('stock.scrap.reason.tag', tagIds, ['name'])) tagName.set(t.id, t.name);
  }
  const reasonOf = (s: OdooRecord): string => {
    const tags = (s.scrap_reason_tag_ids ?? []).map((id: number) => tagName.get(id)).filter(Boolean);
    return tags.length ? tags.join(' + ') : s.origin ? `(không lý do) ${s.origin}` : '(không ghi lý do)';
  };

  // ── 5. Quality alerts (Enterprise) ──────────────────────────────────────────────
  const qaByWo = new Map<number, string[]>();
  const qaByProd = new Map<number, string[]>();
  if (await odoo.hasModel('quality.alert')) {
    const qaFields = await odoo.existingFields('quality.alert', ['name', 'title', 'workorder_id', 'production_id', 'reason_id', 'description']);
    const qas = prodIds.length
      ? await odoo.searchReadAll('quality.alert', ['|', ['workorder_id', 'in', woIds], ['production_id', 'in', prodIds]], qaFields)
      : [];
    for (const q of qas) {
      const desc = String(q.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      const text = [q.title || q.name, m2oName(q.reason_id) && `[${m2oName(q.reason_id)}]`, desc].filter(Boolean).join(' ');
      const w = m2oId(q.workorder_id), p = m2oId(q.production_id);
      if (w) (qaByWo.get(w) ?? qaByWo.set(w, []).get(w)!).push(text);
      else if (p) (qaByProd.get(p) ?? qaByProd.set(p, []).get(p)!).push(text);
    }
  }

  // ── 6. NVL: kế hoạch (BoM) vs thực tế, chỉ MO đã hoàn tất ──────────────────────────
  const matPlanByProd = new Map<number, number>();
  const matActByProd = new Map<number, number>();
  const mat = norms.material;
  if (mat && prodIds.length) {
    const qtyField = await odoo.pickField('stock.move', ['quantity', 'quantity_done']); // 17+ : quantity, ≤16 : quantity_done
    const moves = await odoo.searchReadAll(
      'stock.move',
      [['raw_material_production_id', 'in', prodIds], ['state', '=', 'done']],
      ['raw_material_production_id', 'product_id', 'product_uom_qty', qtyField!, 'product_uom'],
    );
    const okUom = (u: unknown) => mat.uomNames.includes(m2oName(u as any));
    for (const mv of moves) {
      const pid = m2oId(mv.raw_material_production_id)!;
      const p = prodById.get(pid);
      if (!p || p.state !== 'done' || !okUom(mv.product_uom)) continue;
      // BoM tính theo SL kế hoạch; nếu MO hoàn tất với SL khác thì quy đổi tỷ lệ cho công bằng
      const ratio = p.product_qty ? (p.qty_produced ?? p.product_qty) / p.product_qty : 1;
      addToMap(matPlanByProd, pid, mv.product_uom_qty * ratio);
      addToMap(matActByProd, pid, mv[qtyField!]);
    }
    // Phế NVL (scrap component) là tiêu hao thêm, không nằm trong stock.move của MO
    for (const s of scraps) {
      const pid = m2oId(s.production_id)!;
      const p = prodById.get(pid);
      if (p?.state === 'done' && m2oId(s.product_id) !== m2oId(p.product_id) && okUom(s.product_uom_id)) {
        addToMap(matActByProd, pid, s.scrap_qty);
      }
    }
  }

  // ── 7. Thời gian chạy: theo ô (WO × người × ngày) và tổng theo WO / MO ────────────────
  const runCell = new Map<string, number>(); // `${woId}|${worker}|${day}`
  const runProdCell = new Map<string, number>(); // `${prodId}|${worker}|${day}`
  const woRun = new Map<number, number>();
  const prodRun = new Map<number, number>();
  const workerName = new Map<string, string>();
  for (const l of allLogs) {
    workerName.set(l.workerKey, l.workerName);
    if (!RUN_TYPES.has(l.lossType)) continue;
    if (l.woId) {
      addToMap(runCell, `${l.woId}|${l.workerKey}|${l.day}`, l.minutes);
      addToMap(woRun, l.woId, l.minutes);
    }
    if (l.prodId) {
      addToMap(runProdCell, `${l.prodId}|${l.workerKey}|${l.day}`, l.minutes);
      addToMap(prodRun, l.prodId, l.minutes);
    }
  }

  // ── 8. Tổng hợp ────────────────────────────────────────────────────────────────
  const sum = new Map<string, SummaryRow>();
  const inDays = (d: string) => d >= from && d <= to;
  const cell = (day: string, wk: string): SummaryRow => {
    const k = `${day}|${wk}`;
    let r = sum.get(k);
    if (!r) {
      r = {
        day, workerKey: wk, workerName: workerName.get(wk) ?? wk, workcenters: [], productions: [],
        runMin: 0, downMin: 0, goodQty: 0, scrapQty: 0, scrapRatePct: null, allowedScrapQty: 0,
        overScrap: false, overScrapQty: 0, matPlanned: 0, matActual: 0, matVariancePct: null,
        matNormPct: mat?.pct ?? 0, overMaterial: false, scrapReasons: {}, qualityIssues: [], downReasons: {},
      };
      sum.set(k, r);
    }
    return r;
  };
  const pushUniq = (arr: string[], v: string) => v && !arr.includes(v) && arr.push(v);

  // 8a. thời gian chạy / dừng (chỉ ngày trong khoảng)
  for (const l of allLogs) {
    if (!inDays(l.day)) continue;
    const r = cell(l.day, l.workerKey);
    pushUniq(r.workcenters, l.workcenter);
    if (RUN_TYPES.has(l.lossType)) r.runMin += l.minutes;
    else {
      r.downMin += l.minutes;
      addTo(r.downReasons, l.lossName || '(không lý do)', l.minutes);
    }
  }

  // Phế phẩm thành phẩm theo WO, và theo MO (khi scrap không gắn WO)
  const fgScrapByWo = new Map<number, OdooRecord[]>();
  const fgScrapByProd = new Map<number, OdooRecord[]>();
  for (const s of scraps) {
    const p = prodById.get(m2oId(s.production_id)!);
    if (!p || m2oId(s.product_id) !== m2oId(p.product_id)) continue; // NVL đã xử lý ở bước 6
    const w = m2oId(s.workorder_id);
    if (w && woRun.get(w)) (fgScrapByWo.get(w) ?? fgScrapByWo.set(w, []).get(w)!).push(s);
    else (fgScrapByProd.get(p.id) ?? fgScrapByProd.set(p.id, []).get(p.id)!).push(s);
  }

  // 8b. phân bổ theo WO
  const details: DetailRow[] = [];
  for (const [k, minutes] of runCell) {
    const [woIdS, wk, day] = k.split('|');
    const woId = Number(woIdS);
    const wo = woById.get(woId);
    const total = woRun.get(woId) ?? 0;
    if (!wo || !total) continue;
    const share = minutes / total;
    const { norm, source } = normFor(wo);
    const good = (wo.qty_produced ?? 0) * share;
    let scrap = 0;
    const reasons: Record<string, number> = {};
    for (const s of fgScrapByWo.get(woId) ?? []) {
      scrap += s.scrap_qty * share;
      addTo(reasons, reasonOf(s), s.scrap_qty * share);
    }
    const allowed = (norm.setupQty ?? 0) * share + (norm.pct / 100) * good;
    const prod = prodById.get(m2oId(wo.production_id) ?? -1);

    if (inDays(day)) {
      const r = cell(day, wk);
      pushUniq(r.productions, prod?.name ?? m2oName(wo.production_id));
      r.goodQty += good;
      r.scrapQty += scrap;
      r.allowedScrapQty += allowed;
      for (const [rk, rv] of Object.entries(reasons)) addTo(r.scrapReasons, rk, rv);
      for (const q of qaByWo.get(woId) ?? []) pushUniq(r.qualityIssues, q);
      details.push({
        day, workerKey: wk, workerName: workerName.get(wk) ?? wk,
        workorder: wo.name ?? `WO#${woId}`, production: prod?.name ?? '', product: m2oName(prod?.product_id),
        workcenter: m2oName(wo.workcenter_id), runMin: round(minutes, 1), sharePct: round(share * 100, 1),
        goodQty: round(good), scrapQty: round(scrap), allowedScrapQty: round(allowed),
        normPct: norm.pct, normSource: source,
      });
    }
  }

  // 8c. phân bổ theo MO: phế không gắn WO, NVL, quality alert cấp MO
  for (const [k, minutes] of runProdCell) {
    const [pidS, wk, day] = k.split('|');
    if (!inDays(day)) continue;
    const pid = Number(pidS);
    const total = prodRun.get(pid) ?? 0;
    if (!total) continue;
    const share = minutes / total;
    const r = cell(day, wk);
    for (const s of fgScrapByProd.get(pid) ?? []) {
      r.scrapQty += s.scrap_qty * share;
      addTo(r.scrapReasons, reasonOf(s), s.scrap_qty * share);
    }
    r.matPlanned += (matPlanByProd.get(pid) ?? 0) * share;
    r.matActual += (matActByProd.get(pid) ?? 0) * share;
    for (const q of qaByProd.get(pid) ?? []) pushUniq(r.qualityIssues, q);
  }

  // Cảnh báo: phế phẩm không phân bổ được cho ai (MO không có log chạy máy nào)
  for (const s of scraps) {
    const pid = m2oId(s.production_id)!;
    if (!prodRun.get(pid)) warnings.push(`Phế ${s.scrap_qty} ${m2oName(s.product_id)} của ${m2oName(s.production_id)} không phân bổ được (MO không có log chạy máy).`);
  }

  // 8d. chỉ số cuối
  const summary = [...sum.values()].map((r) => {
    const denom = r.goodQty + r.scrapQty;
    r.scrapRatePct = denom > 0 ? round((r.scrapQty / denom) * 100) : null;
    r.overScrapQty = round(Math.max(0, r.scrapQty - r.allowedScrapQty));
    r.overScrap = r.overScrapQty > 0.005;
    r.matVariancePct = r.matPlanned > 0 ? round(((r.matActual - r.matPlanned) / r.matPlanned) * 100) : null;
    r.overMaterial = r.matVariancePct !== null && r.matVariancePct > r.matNormPct;
    r.runMin = round(r.runMin, 1);
    r.downMin = round(r.downMin, 1);
    r.goodQty = round(r.goodQty);
    r.scrapQty = round(r.scrapQty);
    r.allowedScrapQty = round(r.allowedScrapQty);
    r.matPlanned = round(r.matPlanned);
    r.matActual = round(r.matActual);
    for (const m of [r.scrapReasons, r.downReasons]) for (const key in m) m[key] = round(m[key], 1);
    return r;
  });
  summary.sort((a, b) => a.day.localeCompare(b.day) || a.workerName.localeCompare(b.workerName, 'vi'));
  details.sort((a, b) => a.day.localeCompare(b.day) || a.workerName.localeCompare(b.workerName, 'vi'));

  return { from, to, summary, details, warnings };
}

function addToMap<K>(m: Map<K, number>, k: K, v: number) {
  m.set(k, (m.get(k) ?? 0) + (Number(v) || 0));
}
