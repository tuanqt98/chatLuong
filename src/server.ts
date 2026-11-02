/**
 * Web app báo cáo hao phí — chạy trên 1 máy trong LAN, các máy khác mở trình duyệt vào http://<IP>:3100
 *
 *   node src/server.ts            (PORT=3100, HOST=0.0.0.0 mặc định)
 *
 * Không dùng framework: node:http đủ cho vài endpoint, và không phải npm install trên máy chủ
 * (máy trong xưởng thường không có internet ổn định).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { OdooClient, OdooError } from './odoo.ts';
import { buildReport, type ReportResult } from './report.ts';
import { summaryCsv, detailCsv } from './export.ts';
import { loadSettings, saveSettings, publicSettings, validateSettings, isConfigured } from './settings.ts';
import { workDay } from './time.ts';
import type { AppConfig } from './config.ts';

const PORT = Number(process.env.PORT ?? 3100);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_DIR = resolve(import.meta.dirname, '../public');
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_SEC ?? 300) * 1000;
const MAX_RANGE_DAYS = 93;
// Đặt APP_PASSWORD để bắt đăng nhập (Basic Auth). Nên đặt: trang Cài đặt chứa thông tin kết nối Odoo.
const APP_USER = process.env.APP_USER ?? 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';

let settings: AppConfig = loadSettings();
let odoo = new OdooClient(settings.odoo);

// ── Cache báo cáo ────────────────────────────────────────────────────────────────
// Lưu PROMISE chứ không lưu kết quả: 10 người cùng mở trang lúc 8h sáng thì chỉ 1 request xuống Odoo,
// 9 người còn lại chờ cùng promise đó (request coalescing). Lỗi thì xoá khỏi cache để lần sau thử lại.
const cache = new Map<string, { at: number; p: Promise<ReportResult> }>();
function getReport(from: string, to: string, refresh: boolean): Promise<ReportResult> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < CACHE_TTL_MS) return hit.p;
  const p = buildReport(odoo, settings, from, to);
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  if (cache.size > 50) cache.delete(cache.keys().next().value!); // giới hạn RAM
  return p;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'JSON không hợp lệ'); }
}

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseRange(u: URL): { from: string; to: string } {
  const today = workDay(new Date(), settings.tz, settings.dayCutoffHour);
  const from = u.searchParams.get('from') || today;
  const to = u.searchParams.get('to') || from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new HttpError(400, 'Khoảng ngày không hợp lệ');
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) throw new HttpError(400, `Tối đa ${MAX_RANGE_DAYS} ngày mỗi lần để tránh làm chậm Odoo`);
  return { from, to };
}

function checkAuth(req: IncomingMessage): boolean {
  if (!APP_PASSWORD) return true;
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  const a = Buffer.from(`${u}:${rest.join(':')}`);
  const b = Buffer.from(`${APP_USER}:${APP_PASSWORD}`);
  return a.length === b.length && timingSafeEqual(a, b); // so sánh thời gian hằng → chống dò mật khẩu theo timing
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

async function serveStatic(pathname: string, res: ServerResponse) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(403, 'Forbidden'); // chặn ../../etc/passwd
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    throw new HttpError(404, 'Không tìm thấy');
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────────
async function handle(req: IncomingMessage, res: ServerResponse) {
  const u = new URL(req.url ?? '/', 'http://x');
  const route = `${req.method} ${u.pathname}`;

  if (!checkAuth(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Bao cao hao phi", charset="UTF-8"' });
    return res.end('Cần đăng nhập');
  }

  if (!u.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    return serveStatic(u.pathname, res);
  }

  switch (route) {
    case 'GET /api/status':
      return json(res, 200, {
        configured: isConfigured(settings),
        today: workDay(new Date(), settings.tz, settings.dayCutoffHour),
        tz: settings.tz,
      });

    case 'GET /api/report': {
      if (!isConfigured(settings)) throw new HttpError(409, 'Chưa cấu hình kết nối Odoo — vào trang Cài đặt');
      const { from, to } = parseRange(u);
      const t0 = Date.now();
      const r = await getReport(from, to, u.searchParams.get('refresh') === '1');
      return json(res, 200, { ...r, generatedAt: cache.get(`${from}|${to}`)?.at, tookMs: Date.now() - t0 });
    }

    case 'GET /api/export': {
      const { from, to } = parseRange(u);
      const type = u.searchParams.get('type') === 'detail' ? 'detail' : 'summary';
      const r = await getReport(from, to, false);
      const name = `hao-phi_${type === 'detail' ? 'chi-tiet' : 'tong-hop'}_${from}_${to}.csv`;
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
      });
      return res.end(type === 'detail' ? detailCsv(r) : summaryCsv(r));
    }

    case 'GET /api/settings':
      return json(res, 200, publicSettings(settings));

    case 'PUT /api/settings': {
      let next: AppConfig;
      try { next = validateSettings(await readJson(req), settings); }
      catch (e: any) { throw e instanceof HttpError ? e : new HttpError(400, e.message); }
      saveSettings(next);
      settings = next;
      odoo = new OdooClient(next.odoo); // đăng nhập lại với thông tin mới
      cache.clear(); // định mức đổi → mọi báo cáo cũ không còn đúng
      return json(res, 200, publicSettings(settings));
    }

    case 'POST /api/test-connection': {
      // Thử với dữ liệu trên form (chưa lưu), để người dùng kiểm tra trước khi bấm Lưu
      const body = await readJson(req);
      let cfg: AppConfig;
      try { cfg = validateSettings({ ...publicSettings(settings), ...body, norms: settings.norms }, settings); }
      catch (e: any) { throw new HttpError(400, e.message); }
      const c = new OdooClient(cfg.odoo);
      const ver = await c.version();
      await c.login();
      const P = 'mrp.workcenter.productivity';
      const hasEmployee = !!(await c.pickField(P, ['employee_id']));
      const total = await c.call<number>(P, 'search_count', [[]]);
      const withEmp = hasEmployee ? await c.call<number>(P, 'search_count', [[['employee_id', '!=', false]]]) : 0;
      return json(res, 200, {
        ok: true, version: ver.server_version,
        hasQuality: await c.hasModel('quality.alert'),
        hasScrapReasons: await c.hasModel('stock.scrap.reason.tag'),
        productivityLogs: total, withEmployee: withEmp, hasEmployee,
      });
    }

    case 'GET /api/workcenters': {
      if (!isConfigured(settings)) return json(res, 200, []);
      const rows = await odoo.searchReadAll('mrp.workcenter', [], ['name'], { order: 'name asc' });
      return json(res, 200, rows.map((r) => r.name));
    }

    default:
      throw new HttpError(404, 'API không tồn tại');
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((e: any) => {
    // fetch() của Node ném TypeError('fetch failed') cho MỌI lỗi mạng; lý do thật nằm ở e.cause
    const netErr = e instanceof TypeError && e.message === 'fetch failed';
    const status = e instanceof HttpError ? e.status : e instanceof OdooError || netErr ? 502 : 500;
    const msg = e instanceof OdooError ? `Lỗi từ Odoo: ${e.message}`
      : netErr ? `Không kết nối được tới Odoo (${(e as any).cause?.code ?? (e as any).cause?.message ?? 'lỗi mạng'}) — kiểm tra địa chỉ, cổng, mạng LAN`
        : e.message ?? 'Lỗi không xác định';
    if (status >= 500) console.error(new Date().toISOString(), req.method, req.url, e);
    if (!res.headersSent) json(res, status, { error: msg });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Báo cáo hao phí đang chạy:`);
  console.log(`  Máy này : http://localhost:${PORT}`);
  for (const ifs of Object.values(networkInterfaces())) {
    for (const i of ifs ?? []) if (i.family === 'IPv4' && !i.internal) console.log(`  Mạng LAN: http://${i.address}:${PORT}`);
  }
  if (!APP_PASSWORD) console.warn('  ⚠ Chưa đặt APP_PASSWORD — ai trong mạng LAN cũng vào được trang Cài đặt.');
  if (!isConfigured(settings)) console.warn('  ⚠ Chưa cấu hình Odoo — mở trình duyệt, vào trang Cài đặt.');
});
