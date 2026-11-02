import assert from 'node:assert/strict';
import { startMock } from './mock-odoo.ts';
import { OdooClient } from '../src/odoo.ts';
import { buildReport } from '../src/report.ts';
import type { AppConfig } from '../src/config.ts';

const { server, url } = await startMock();
const cfg: AppConfig = {
  odoo: { url, db: 'test', username: 'x', apiKey: 'test-key' },
  tz: 'Asia/Ho_Chi_Minh',
  dayCutoffHour: 6,
  norms: {
    default: { pct: 3 },
    byWorkcenter: {
      'Máy in Flexo 01': { pct: 2.5, setupQty: 150 },
      'Máy bế 02': { pct: 1.5, setupQty: 50 },
    },
    material: { pct: 5, uomNames: ['m'] },
  },
};

try {
  const r = await buildReport(new OdooClient(cfg.odoo), cfg, '2026-11-02', '2026-11-02');
  const an = r.summary.find((s) => s.workerName === 'Nguyễn Văn An')!;
  const binh = r.summary.find((s) => s.workerName === 'Trần Thị Bình')!;
  assert.equal(r.summary.length, 2, 'chỉ 2 dòng; log ngày 01/11 của An không được lọt vào');

  // An: WO In tổng 360p chạy (gồm 90p ngày 01/11) → An 02/11 chiếm 180/360 = 50%
  assert.equal(an.runMin, 180);
  assert.equal(an.downMin, 30);
  assert.deepEqual(an.downReasons, { 'Chờ vật tư': 30 });
  assert.equal(an.goodQty, 5000);
  assert.equal(an.scrapQty, 240); // 480 × 50%
  assert.equal(an.allowedScrapQty, 200); // 150×50% + 2.5%×5000
  assert.equal(an.overScrap, true);
  assert.equal(an.overScrapQty, 40);
  assert.deepEqual(an.scrapReasons, { 'Lệch màu': 240 });
  // NVL: MO tổng 540p chạy, An 180p = 1/3. KH 5000m, TT 5200 + 50 phế giấy = 5250 (mực kg bị loại)
  assert.equal(an.matPlanned, 1666.67);
  assert.equal(an.matActual, 1750);
  assert.equal(an.matVariancePct, 5);
  assert.equal(an.overMaterial, false);

  // Bình: In 90p (60 productive + 30 performance) = 25%, Bế 180p (gồm ca đêm 03/11 02:00 → tính 02/11) = 100%
  assert.equal(binh.runMin, 270);
  assert.equal(binh.downMin, 20);
  assert.equal(binh.goodQty, 2500 + 9800);
  assert.equal(binh.scrapQty, 120 + 200);
  assert.equal(binh.allowedScrapQty, 100 + 197);
  assert.equal(binh.overScrapQty, 23);
  assert.deepEqual(binh.scrapReasons, { 'Lệch màu': 120, 'Bế lệch': 200 });
  assert.match(binh.qualityIssues[0], /Bế không đứt \[Dao mòn\]/);
  assert.equal(binh.scrapRatePct, 2.54);
  assert.equal(binh.matPlanned, 2500);
  assert.equal(binh.matActual, 2625);

  assert.equal(r.warnings.length, 0, r.warnings.join('\n'));
  console.log('✓ Tất cả kiểm tra đều đạt');
  console.table(r.details);
} finally {
  server.close();
}
