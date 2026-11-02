/**
 * Odoo giả lập (JSON-RPC /jsonrpc) với dữ liệu mẫu kiểu Odoo 17 — chỉ để kiểm thử logic.
 * Hỗ trợ: common.version/authenticate, object.execute_kw: search_read, read, search_count, fields_get.
 */
import { createServer, type Server } from 'node:http';

type Rec = Record<string, any>;
const m2o = (id: number, name: string) => [id, name];

const EMP = { an: m2o(1, 'Nguyễn Văn An'), binh: m2o(2, 'Trần Thị Bình') };
const WC = { flexo: m2o(1, 'Máy in Flexo 01'), be: m2o(2, 'Máy bế 02') };
const LOSS = {
  prod: m2o(1, 'Productive'), slow: m2o(2, 'Reduced Speed'),
  dao: m2o(3, 'Hỏng dao bế'), vattu: m2o(4, 'Chờ vật tư'),
};
const MO = m2o(100, 'WH/MO/00001');
const WO_IN = m2o(1000, 'In - WH/MO/00001');
const WO_BE = m2o(1001, 'Bế - WH/MO/00001');

let lid = 0;
const log = (emp: any, wo: any, wc: any, loss: any, lossType: string, start: string, end: string | false) => ({
  id: ++lid, employee_id: emp, user_id: m2o(2, 'Tablet xưởng'), workorder_id: wo, production_id: MO,
  workcenter_id: wc, loss_id: loss, loss_type: lossType, date_start: start, date_end: end,
});

export const DATA: Record<string, Rec[]> = {
  'mrp.workcenter.productivity': [
    // Thời gian UTC (VN = UTC+7)
    log(EMP.an, WO_IN, WC.flexo, LOSS.prod, 'productive', '2026-11-01 09:00:00', '2026-11-01 10:30:00'), // VN 01/11 16:00 – 90p
    log(EMP.an, WO_IN, WC.flexo, LOSS.prod, 'productive', '2026-11-02 00:00:00', '2026-11-02 03:00:00'), // VN 02/11 07:00 – 180p
    log(EMP.an, WO_IN, WC.flexo, LOSS.vattu, 'availability', '2026-11-02 03:00:00', '2026-11-02 03:30:00'), // 30p dừng
    log(EMP.binh, WO_IN, WC.flexo, LOSS.prod, 'productive', '2026-11-02 06:00:00', '2026-11-02 07:00:00'), // 60p
    log(EMP.binh, WO_IN, WC.flexo, LOSS.slow, 'performance', '2026-11-02 07:00:00', '2026-11-02 07:30:00'), // 30p chạy chậm
    log(EMP.binh, WO_BE, WC.be, LOSS.prod, 'productive', '2026-11-02 08:00:00', '2026-11-02 10:00:00'), // 120p
    log(EMP.binh, WO_BE, WC.be, LOSS.dao, 'availability', '2026-11-02 10:00:00', '2026-11-02 10:20:00'), // 20p dừng
    log(EMP.binh, WO_BE, WC.be, LOSS.prod, 'productive', '2026-11-02 19:00:00', '2026-11-02 20:00:00'), // VN 03/11 02:00 ca đêm – 60p
  ],
  'mrp.workorder': [
    { id: 1000, name: 'In', production_id: MO, workcenter_id: WC.flexo, product_id: m2o(10, 'Tem nhãn A'), qty_produced: 10000 },
    { id: 1001, name: 'Bế', production_id: MO, workcenter_id: WC.be, product_id: m2o(10, 'Tem nhãn A'), qty_produced: 9800 },
  ],
  'mrp.production': [
    { id: 100, name: 'WH/MO/00001', product_id: m2o(10, 'Tem nhãn A'), product_qty: 10000, qty_produced: 10000, state: 'done' },
  ],
  'product.product': [
    { id: 10, default_code: 'TEM-A', display_name: 'Tem nhãn A' },
    { id: 20, default_code: 'DECAL-80', display_name: 'Giấy decal 80mm' },
  ],
  'stock.scrap': [
    { id: 1, product_id: m2o(10, 'Tem nhãn A'), scrap_qty: 480, product_uom_id: m2o(1, 'Units'), production_id: MO, workorder_id: WO_IN, scrap_reason_tag_ids: [1], origin: 'WH/MO/00001', state: 'done' },
    { id: 2, product_id: m2o(10, 'Tem nhãn A'), scrap_qty: 200, product_uom_id: m2o(1, 'Units'), production_id: MO, workorder_id: WO_BE, scrap_reason_tag_ids: [2], origin: 'WH/MO/00001', state: 'done' },
    { id: 3, product_id: m2o(20, 'Giấy decal 80mm'), scrap_qty: 50, product_uom_id: m2o(5, 'm'), production_id: MO, workorder_id: false, scrap_reason_tag_ids: [3], origin: 'WH/MO/00001', state: 'done' },
  ],
  'stock.scrap.reason.tag': [
    { id: 1, name: 'Lệch màu' }, { id: 2, name: 'Bế lệch' }, { id: 3, name: 'Rách giấy' },
  ],
  'stock.move': [
    { id: 1, raw_material_production_id: MO, product_id: m2o(20, 'Giấy decal 80mm'), product_uom_qty: 5000, quantity: 5200, product_uom: m2o(5, 'm'), state: 'done' },
    { id: 2, raw_material_production_id: MO, product_id: m2o(30, 'Mực in'), product_uom_qty: 10, quantity: 12, product_uom: m2o(6, 'kg'), state: 'done' },
  ],
  'quality.alert': [
    { id: 1, name: 'QA/0001', title: 'Bế không đứt', workorder_id: WO_BE, production_id: MO, reason_id: m2o(1, 'Dao mòn'), description: '<p>Bế không đứt mép phải</p>' },
  ],
  'mrp.workcenter.productivity.loss': [
    { id: 1, name: 'Productive', loss_type: 'productive' }, { id: 2, name: 'Reduced Speed', loss_type: 'performance' },
    { id: 3, name: 'Hỏng dao bế', loss_type: 'availability' }, { id: 4, name: 'Chờ vật tư', loss_type: 'availability' },
  ],
  'mrp.workcenter': [{ id: 1, name: 'Máy in Flexo 01' }, { id: 2, name: 'Máy bế 02' }],
  'mrp.bom': [], 'mrp.bom.line': [], 'product.template': [], 'hr.employee': [], 'quality.check': [],
};
/**
 * Dữ liệu demo nhiều ngày (MOCK_DEMO=1): 6 công nhân, 4 máy, 14 ngày gần nhất, random có seed → lần nào chạy cũng giống nhau.
 */
export function seedDemo(days = 14) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pickR = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const workers = [
    m2o(11, 'Lê Văn Cường'), m2o(12, 'Phạm Thị Dung'), m2o(13, 'Hoàng Minh Đức'),
    m2o(14, 'Vũ Thị Hà'), m2o(15, 'Đỗ Quang Huy'), m2o(16, 'Bùi Thị Lan'),
  ];
  const skill = new Map(workers.map((w, i) => [w[0], [0.7, 1.0, 1.6, 0.9, 1.3, 0.8][i]])); // hệ số phế mỗi người
  const wcs = [m2o(1, 'Máy in Flexo 01'), m2o(3, 'Máy in Offset 03'), m2o(2, 'Máy bế 02'), m2o(4, 'Máy cắt cuộn 04')];
  DATA['mrp.workcenter'] = wcs.map(([id, name]) => ({ id, name }));
  const reasons = ['Lệch màu', 'Bế lệch', 'Lem mực', 'Nhăn decal', 'Sai kích thước', 'Rách giấy'];
  DATA['stock.scrap.reason.tag'] = reasons.map((name, i) => ({ id: i + 1, name }));
  const losses = [m2o(3, 'Hỏng dao bế'), m2o(4, 'Chờ vật tư'), m2o(5, 'Căn chỉnh màu'), m2o(6, 'Bảo trì máy'), m2o(7, 'Mất điện')];
  DATA['mrp.workcenter.productivity.loss'].push({ id: 5, name: 'Căn chỉnh màu', loss_type: 'availability' },
    { id: 6, name: 'Bảo trì máy', loss_type: 'availability' }, { id: 7, name: 'Mất điện', loss_type: 'availability' });
  const products = [m2o(40, 'Tem nhãn Samsung A01'), m2o(41, 'Tem bảo hành Canon'), m2o(42, 'Nhãn thùng LG'), m2o(43, 'Tem QR Foxconn')];
  DATA['product.product'].push(...products.map(([id, n], i) => ({ id, display_name: n, default_code: ['TEM-SAMSUNG-A01', 'TEM-CANON-BH', 'NHAN-LG-01', 'TEM-FXC-QR'][i] })));

  const now = new Date();
  const vnToday = new Date(now.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  let moId = 500, woId = 5000, scrapId = 100, moveId = 100, qaId = 10;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  for (let d = days - 1; d >= 0; d--) {
    const dayStartUtc = Date.parse(vnToday + 'T00:00:00Z') - d * 86400e3 - 7 * 3600e3; // 00:00 VN
    for (let k = 0; k < 3; k++) {
      const prod = pickR(products);
      const qty = 5000 + Math.round(rnd() * 15) * 1000;
      const mo = m2o(++moId, `WH/MO/${String(moId).padStart(5, '0')}`);
      DATA['mrp.production'].push({ id: moId, name: mo[1], product_id: prod, product_qty: qty, qty_produced: qty, state: 'done' });
      const route = k === 2 ? [wcs[1], wcs[3]] : [wcs[0], wcs[2]];
      let t = dayStartUtc + (6 + k * 5) * 3600e3; // ca bắt đầu 6h, 11h, 16h VN
      route.forEach((wc, step) => {
        const wo = m2o(++woId, `${step ? 'Bế/Cắt' : 'In'} - ${mo[1]}`);
        const good = Math.round(qty * (step ? 0.98 : 1));
        DATA['mrp.workorder'].push({ id: woId, name: step ? 'Bế/Cắt' : 'In', production_id: mo, workcenter_id: wc, product_id: prod, qty_produced: good });
        const crew = [pickR(workers), pickR(workers)];
        let woScrapFactor = 0;
        for (const w of crew) {
          const run = 60 + Math.round(rnd() * 120);
          DATA['mrp.workcenter.productivity'].push(log(w, wo, wc, LOSS.prod, 'productive', iso(t), iso(t + run * 60e3)));
          (DATA['mrp.workcenter.productivity'].at(-1) as Rec).production_id = mo;
          t += run * 60e3;
          if (rnd() < 0.45) {
            const down = 10 + Math.round(rnd() * 40);
            DATA['mrp.workcenter.productivity'].push({ ...log(w, wo, wc, pickR(losses), 'availability', iso(t), iso(t + down * 60e3)), production_id: mo });
            t += down * 60e3;
          }
          woScrapFactor += skill.get(w[0] as number)! / crew.length;
        }
        const scrapQty = Math.round(good * (0.012 + rnd() * 0.022) * woScrapFactor + (step ? 30 : 120));
        const nReasons = 1 + Math.floor(rnd() * 2);
        for (let r = 0; r < nReasons; r++) {
          DATA['stock.scrap'].push({ id: ++scrapId, product_id: prod, scrap_qty: Math.round(scrapQty / nReasons), product_uom_id: m2o(1, 'Units'),
            production_id: mo, workorder_id: wo, scrap_reason_tag_ids: [1 + Math.floor(rnd() * reasons.length)], origin: mo[1], state: 'done' });
        }
        if (woScrapFactor > 1.3 && rnd() < 0.5) {
          DATA['quality.alert'].push({ id: ++qaId, name: `QA/${qaId}`, title: pickR(['Màu không đạt chuẩn', 'Bế không đứt', 'Lệch vị trí in']),
            workorder_id: wo, production_id: mo, reason_id: m2o(2, pickR(['Thao tác', 'Máy móc', 'Nguyên liệu'])), description: '<p>Khách hàng phản hồi</p>' });
        }
      });
      const plan = qty * 0.05;
      DATA['stock.move'].push({ id: ++moveId, raw_material_production_id: mo, product_id: m2o(20, 'Giấy decal 80mm'),
        product_uom_qty: plan, quantity: Math.round(plan * (1.01 + rnd() * 0.07)), product_uom: m2o(5, 'm'), state: 'done' });
    }
  }
}

if (process.env.MOCK_DEMO) seedDemo();
DATA['ir.model'] = Object.keys(DATA).map((model, i) => ({ id: i + 1, model }));

// ── Domain evaluator (ký pháp Ba Lan: '|', '&', '!') ──
const val = (v: any) => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string' ? v[0] : v);
function leaf(r: Rec, [f, op, v]: any[]): boolean {
  const x = val(r[f]);
  switch (op) {
    case '=': return v === false ? !x : x === v;
    case '!=': return v === false ? !!x : x !== v;
    case 'in': return v.includes(x);
    case '>=': return x >= v;
    case '<': return x < v;
    default: throw new Error('op not supported: ' + op);
  }
}
function evalDomain(r: Rec, dom: any[]): boolean {
  let i = 0;
  const next = (): boolean => {
    const t = dom[i++];
    if (t === '|') { const a = next(); const b = next(); return a || b; }
    if (t === '&') { const a = next(); const b = next(); return a && b; }
    if (t === '!') return !next();
    return leaf(r, t);
  };
  let ok = true;
  while (i < dom.length) ok = next() && ok;
  return ok;
}
const pick = (r: Rec, fields?: string[]) =>
  fields?.length ? Object.fromEntries([['id', r.id], ...fields.map((f) => [f, r[f] ?? false])]) : r;

function execute(model: string, method: string, args: any[], kw: any): any {
  const rows = DATA[model];
  if (!rows) throw new Error(`Object ${model} doesn't exist`);
  switch (method) {
    case 'fields_get': {
      const keys = new Set(rows.flatMap((r) => Object.keys(r)));
      return Object.fromEntries([...keys].map((k) => [k, { string: k, type: 'char' }]));
    }
    case 'search_count': return rows.filter((r) => evalDomain(r, args[0] ?? [])).length;
    case 'search_read': {
      for (const f of kw.fields ?? []) if (rows.length && !rows.some((r) => f in r)) throw new Error(`Invalid field '${f}' on model '${model}'`);
      const res = rows.filter((r) => evalDomain(r, args[0] ?? []));
      return res.slice(kw.offset ?? 0, (kw.offset ?? 0) + (kw.limit ?? 1e9)).map((r) => pick(r, kw.fields));
    }
    case 'read': return rows.filter((r) => args[0].includes(r.id)).map((r) => pick(r, kw.fields));
    default: throw new Error('method not supported: ' + method);
  }
}

export function startMock(port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { id, params } = JSON.parse(body);
      const reply = (o: object) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, ...o })); };
      try {
        const { service, method, args } = params;
        if (service === 'common' && method === 'version') return reply({ result: { server_version: '17.0-mock', server_version_info: [17, 0] } });
        if (service === 'common' && method === 'authenticate') return reply({ result: args[2] === 'test-key' ? 2 : false });
        if (service === 'object' && method === 'execute_kw') {
          const [, , key, model, m, a, kw] = args;
          if (key !== 'test-key') throw new Error('Access Denied');
          return reply({ result: execute(model, m, a, kw ?? {}) });
        }
        throw new Error('unknown');
      } catch (e: any) {
        reply({ error: { code: 200, message: 'Odoo Server Error', data: { message: e.message } } });
      }
    });
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => {
    const a = server.address() as any;
    ok({ server, url: `http://127.0.0.1:${a.port}` });
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startMock(8069);
  console.log('Mock Odoo tại ' + url);
}
