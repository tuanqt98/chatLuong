/**
 * Chạy TRƯỚC TIÊN: dò xem Odoo của công ty có những model/field nào.
 * Mỗi công ty cấu hình Odoo khác nhau (Community/Enterprise, version, field Studio tự thêm),
 * nên cần biết chắc dữ liệu nằm ở đâu trước khi tin vào báo cáo.
 *
 *   node src/discover.ts      → in ra màn hình + ghi discover-report.json
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { OdooClient } from './odoo.ts';

const MODELS: Record<string, string[]> = {
  'mrp.production': ['name', 'product_id', 'product_qty', 'qty_produced', 'user_id', 'bom_id', 'state', 'date_start', 'date_finished'],
  'mrp.workorder': ['name', 'production_id', 'workcenter_id', 'product_id', 'qty_produced', 'qty_production', 'duration', 'duration_expected', 'employee_ids', 'state'],
  'mrp.workcenter.productivity': ['workcenter_id', 'workorder_id', 'production_id', 'employee_id', 'user_id', 'loss_id', 'loss_type', 'description', 'date_start', 'date_end', 'duration'],
  'mrp.workcenter.productivity.loss': ['name', 'loss_type', 'manual'],
  'stock.scrap': ['product_id', 'scrap_qty', 'product_uom_id', 'production_id', 'workorder_id', 'scrap_reason_tag_ids', 'origin', 'date_done', 'state', 'create_uid'],
  'stock.move': ['raw_material_production_id', 'product_id', 'product_uom_qty', 'quantity', 'quantity_done', 'product_uom', 'state'],
  'quality.alert': ['name', 'workorder_id', 'production_id', 'reason_id', 'description', 'stage_id', 'user_id'],
  'quality.check': ['workorder_id', 'production_id', 'quality_state', 'test_type', 'note', 'user_id'],
  'hr.employee': ['name', 'barcode', 'department_id', 'job_title'],
};

const cfg = loadConfig();
const odoo = new OdooClient(cfg.odoo);
const report: Record<string, any> = {};

const ver = await odoo.version();
console.log(`Odoo ${ver.server_version} @ ${cfg.odoo.url} / db=${cfg.odoo.db}`);
await odoo.login();
report.version = ver.server_version;
report.models = {};

for (const [model, wanted] of Object.entries(MODELS)) {
  if (!(await odoo.hasModel(model))) {
    console.log(`\n✗ ${model}: KHÔNG có (module chưa cài hoặc bản Community)`);
    report.models[model] = null;
    continue;
  }
  const f = await odoo.fields(model);
  const present = wanted.filter((w) => w in f);
  const missing = wanted.filter((w) => !(w in f));
  // Field tuỳ chỉnh (Studio tạo ra luôn có tiền tố x_) — thường là nơi chứa định mức hao phí
  const custom = Object.entries(f)
    .filter(([k]) => k.startsWith('x_'))
    .map(([k, v]: [string, any]) => `${k} (${v.type}: ${v.string})`);
  const count = await odoo.call<number>(model, 'search_count', [[]]);
  console.log(`\n✓ ${model}  [${count} bản ghi]`);
  console.log(`  có     : ${present.join(', ')}`);
  if (missing.length) console.log(`  thiếu  : ${missing.join(', ')}`);
  if (custom.length) console.log(`  custom : ${custom.join('; ')}`);
  report.models[model] = { count, present, missing, custom };
}

// Field tuỳ chỉnh trên sản phẩm / máy — ứng viên cho "định mức hao phí"
for (const model of ['product.product', 'product.template', 'mrp.workcenter', 'mrp.bom', 'mrp.bom.line']) {
  const f = await odoo.fields(model);
  const custom = Object.entries(f)
    .filter(([k]) => k.startsWith('x_'))
    .map(([k, v]: [string, any]) => `${k} (${v.type}: ${v.string})`);
  console.log(`\n${model} custom fields: ${custom.length ? custom.join('; ') : '(không có)'}`);
  report[`custom_${model}`] = custom;
}

// Danh mục lý do dừng máy & lý do phế — để biết công nhân có đang ghi nhận đúng không
const losses = await odoo.searchReadAll('mrp.workcenter.productivity.loss', [], ['name', 'loss_type']);
console.log('\nLý do dừng máy / loại thời gian:');
for (const l of losses) console.log(`  - [${l.loss_type}] ${l.name}`);
report.losses = losses;

if (await odoo.hasModel('stock.scrap.reason.tag')) {
  const tags = await odoo.searchReadAll('stock.scrap.reason.tag', [], ['name']);
  console.log('\nLý do phế phẩm (scrap reason tags): ' + tags.map((t) => t.name).join(', '));
  report.scrapReasons = tags;
}

// Thống kê nhanh: bao nhiêu log thời gian có gắn nhân viên → quyết định báo cáo "theo người" có khả thi không
const prodFields = await odoo.fields('mrp.workcenter.productivity');
const total = await odoo.call<number>('mrp.workcenter.productivity', 'search_count', [[]]);
const withEmp = 'employee_id' in prodFields
  ? await odoo.call<number>('mrp.workcenter.productivity', 'search_count', [[['employee_id', '!=', false]]])
  : 0;
console.log(`\nLog thời gian máy: ${total}, có gắn employee_id: ${withEmp}` +
  ('employee_id' in prodFields ? '' : ' (model không có employee_id → sẽ dùng user_id)'));
report.productivityLogs = { total, withEmployee: withEmp };

writeFileSync('discover-report.json', JSON.stringify(report, null, 2));
console.log('\n→ Đã ghi discover-report.json');
