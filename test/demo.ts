/**
 * Chạy thử app với Odoo giả lập — không cần Odoo thật:  npm run demo  → http://localhost:3100
 */
import { mkdirSync, writeFileSync } from 'node:fs';
process.env.MOCK_DEMO = '1';
process.env.SETTINGS_PATH = 'data/demo-settings.json';
const { startMock } = await import('./mock-odoo.ts');
const { url } = await startMock(0);
mkdirSync('data', { recursive: true });
writeFileSync(process.env.SETTINGS_PATH, JSON.stringify({
  odoo: { url, db: 'demo', username: 'demo', apiKey: 'test-key' },
  tz: 'Asia/Ho_Chi_Minh',
  dayCutoffHour: 6,
  norms: {
    default: { pct: 3, setupQty: 0 },
    byWorkcenter: {
      'Máy in Flexo 01': { pct: 2.5, setupQty: 150 },
      'Máy in Offset 03': { pct: 2, setupQty: 200 },
      'Máy bế 02': { pct: 1.5, setupQty: 50 },
      'Máy cắt cuộn 04': { pct: 1, setupQty: 30 },
    },
    byProduct: {},
    odooProductNormField: '',
    material: { pct: 5, uomNames: ['m'] },
  },
}, null, 2));
console.log(`Odoo giả lập: ${url}`);
await import('../src/server.ts');
