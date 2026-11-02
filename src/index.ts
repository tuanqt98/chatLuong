/**
 * node src/index.ts --from 2026-11-01 --to 2026-11-02 [--out bao-cao]
 * Mặc định: hôm nay.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { OdooClient } from './odoo.ts';
import { buildReport } from './report.ts';
import { writeCsv } from './export.ts';
import { workDay } from './time.ts';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    out: { type: 'string', default: 'hao-phi' },
  },
});

const cfg = loadConfig();
const today = workDay(new Date(), cfg.tz, cfg.dayCutoffHour);
const from = values.from ?? today;
const to = values.to ?? from;
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
  console.error('Ngày không hợp lệ. Dùng --from YYYY-MM-DD --to YYYY-MM-DD');
  process.exit(1);
}

const odoo = new OdooClient(cfg.odoo);
const r = await buildReport(odoo, cfg, from, to);

for (const w of r.warnings) console.warn('⚠ ' + w);
console.log(`\nBáo cáo hao phí ${from} → ${to}: ${r.summary.length} dòng (công nhân × ngày)\n`);
console.table(r.summary.map((s) => ({
  Ngày: s.day,
  'Công nhân': s.workerName,
  'Giờ chạy': +(s.runMin / 60).toFixed(2),
  'Giờ dừng': +(s.downMin / 60).toFixed(2),
  'SL đạt': s.goodQty,
  'SL phế': s.scrapQty,
  'Phế %': s.scrapRatePct,
  'Cho phép': s.allowedScrapQty,
  'Vượt ĐM': s.overScrap ? `VƯỢT +${s.overScrapQty}` : '',
  'Hao hụt NVL %': s.matVariancePct,
  'Vượt NVL': s.overMaterial ? 'VƯỢT' : '',
})));

const over = r.summary.filter((s) => s.overScrap || s.overMaterial);
if (over.length) {
  console.log('\nCác trường hợp VƯỢT định mức và nguyên nhân:');
  for (const s of over) {
    console.log(`• ${s.day} — ${s.workerName}`);
    if (s.overScrap) console.log(`   Phế vượt ${s.overScrapQty} (phế ${s.scrapQty}/ cho phép ${s.allowedScrapQty})`);
    if (s.overMaterial) console.log(`   NVL hao hụt ${s.matVariancePct}% > ĐM ${s.matNormPct}%`);
    const reasons = Object.entries(s.scrapReasons).sort((a, b) => b[1] - a[1]);
    if (reasons.length) console.log(`   Nguyên nhân phế: ${reasons.map(([k, v]) => `${k} (${v})`).join(', ')}`);
    if (s.qualityIssues.length) console.log(`   Lỗi chất lượng: ${s.qualityIssues.join(' | ')}`);
    const downs = Object.entries(s.downReasons).sort((a, b) => b[1] - a[1]);
    if (downs.length) console.log(`   Dừng máy: ${downs.map(([k, v]) => `${k} ${v}p`).join(', ')}`);
  }
}

const files = writeCsv(r, `${values.out}_${from}_${to}`);
console.log('\nĐã xuất: ' + files.join(', '));
