/**
 * Cài đặt của app được lưu ở data/settings.json để chỉnh từ giao diện web.
 * Lần chạy đầu tiên: nếu chưa có file thì lấy từ .env + norms.json (tương thích bản CLI).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AppConfig, NormsFile } from './config.ts';

export const SETTINGS_PATH = resolve(process.env.SETTINGS_PATH ?? 'data/settings.json');
export const MASK = '••••••••';

const DEFAULT_NORMS: NormsFile = {
  default: { pct: 3, setupQty: 0 },
  byWorkcenter: {},
  byProduct: {},
  odooProductNormField: '',
  material: { pct: 5, uomNames: ['m', 'm²', 'm2'] },
};

function fromEnv(): AppConfig {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const norms = existsSync('norms.json')
    ? { ...DEFAULT_NORMS, ...JSON.parse(readFileSync('norms.json', 'utf8')) }
    : DEFAULT_NORMS;
  return {
    odoo: {
      url: process.env.ODOO_URL ?? '',
      db: process.env.ODOO_DB ?? '',
      username: process.env.ODOO_USER ?? '',
      apiKey: process.env.ODOO_API_KEY ?? '',
    },
    tz: process.env.TZ_REPORT ?? 'Asia/Ho_Chi_Minh',
    dayCutoffHour: Number(process.env.DAY_CUTOFF_HOUR ?? 0),
    norms,
  };
}

export function loadSettings(): AppConfig {
  if (existsSync(SETTINGS_PATH)) {
    const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as AppConfig;
    return { ...s, norms: { ...DEFAULT_NORMS, ...s.norms } };
  }
  return fromEnv();
}

/** Ghi ra file tạm rồi rename → không bao giờ để lại file settings bị ghi dở nếu tắt máy giữa chừng */
export function saveSettings(s: AppConfig): void {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  const tmp = SETTINGS_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, SETTINGS_PATH);
}

/** Không bao giờ trả API key thật về trình duyệt */
export function publicSettings(s: AppConfig) {
  return { ...s, odoo: { ...s.odoo, apiKey: s.odoo.apiKey ? MASK : '' } };
}

const num = (v: unknown, name: string, min = 0, max = 1e9): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`"${name}" phải là số từ ${min} đến ${max}`);
  return n;
};

/** Kiểm tra & chuẩn hoá dữ liệu gửi lên từ form. Giữ API key cũ nếu client gửi lại chuỗi mask. */
export function validateSettings(input: any, current: AppConfig): AppConfig {
  const o = input?.odoo ?? {};
  const url = String(o.url ?? '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\/[^\s]+$/.test(url)) throw new Error('URL Odoo phải bắt đầu bằng http:// hoặc https://');
  const apiKey = o.apiKey === MASK ? current.odoo.apiKey : String(o.apiKey ?? '').trim();

  const tz = String(input?.tz ?? 'Asia/Ho_Chi_Minh');
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new Error(`Múi giờ "${tz}" không hợp lệ`); }

  const n = input?.norms ?? {};
  const normMap = (m: any, label: string) =>
    Object.fromEntries(
      Object.entries(m ?? {})
        .filter(([k]) => k.trim())
        .map(([k, v]: [string, any]) => [k.trim(), {
          pct: num(v?.pct, `${label} ${k} – %`, 0, 100),
          setupQty: num(v?.setupQty ?? 0, `${label} ${k} – hao phí lên máy`),
        }]),
    );

  return {
    odoo: { url, db: String(o.db ?? '').trim(), username: String(o.username ?? '').trim(), apiKey },
    tz,
    dayCutoffHour: num(input?.dayCutoffHour ?? 0, 'Giờ chốt ngày', 0, 12),
    norms: {
      default: { pct: num(n.default?.pct, 'Định mức mặc định %', 0, 100), setupQty: num(n.default?.setupQty ?? 0, 'Hao phí lên máy mặc định') },
      byWorkcenter: normMap(n.byWorkcenter, 'Máy'),
      byProduct: normMap(n.byProduct, 'Sản phẩm'),
      odooProductNormField: String(n.odooProductNormField ?? '').trim(),
      material: {
        pct: num(n.material?.pct ?? 5, 'Định mức NVL %', 0, 100),
        uomNames: (Array.isArray(n.material?.uomNames) ? n.material.uomNames : String(n.material?.uomNames ?? '').split(','))
          .map((x: string) => x.trim()).filter(Boolean),
      },
    },
  };
}

export const isConfigured = (s: AppConfig) => !!(s.odoo.url && s.odoo.db && s.odoo.username && s.odoo.apiKey);
