/**
 * Odoo External API client qua JSON-RPC (endpoint /jsonrpc).
 *
 * Vì sao JSON-RPC thay vì XML-RPC?
 *  - Cùng một API (service "common" / "object"), nhưng JSON thì Node xử lý native,
 *    không cần thư viện xmlrpc (vốn đã cũ, không còn maintain).
 *  - Hoạt động từ Odoo 8 → 18. (Odoo 19 có thêm JSON-2 API /json/2/... nhưng /jsonrpc vẫn chạy.)
 *
 * Xác thực: dùng API key (Preferences → Account Security → New API Key) thay cho mật khẩu.
 * API key chỉ dùng được cho RPC, không đăng nhập web được → an toàn hơn khi để trong .env.
 */

export interface OdooConfig {
  url: string; // vd: http://192.168.1.10:8069
  db: string;
  username: string; // login (thường là email)
  apiKey: string;
}

export type Domain = unknown[];
export type OdooRecord = Record<string, any>;

/** Field many2one Odoo trả về dạng [id, display_name] hoặc false */
export type M2O = [number, string] | false;

export class OdooError extends Error {
  data: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.name = 'OdooError';
    this.data = data;
  }
}

export class OdooClient {
  private uid: number | null = null;
  private reqId = 0;
  private fieldsCache = new Map<string, Record<string, any>>();
  private cfg: OdooConfig;

  constructor(cfg: OdooConfig) {
    this.cfg = { ...cfg, url: cfg.url.replace(/\/+$/, '') };
  }

  private async rpc(service: string, method: string, args: unknown[]): Promise<any> {
    const res = await fetch(`${this.cfg.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id: ++this.reqId,
      }),
    });
    if (!res.ok) throw new OdooError(`HTTP ${res.status} ${res.statusText}`);
    const body: any = await res.json();
    if (body.error) {
      // Odoo nhét message thật vào error.data.message; error.message chỉ là "Odoo Server Error"
      const msg = body.error.data?.message ?? body.error.message;
      throw new OdooError(msg, body.error.data);
    }
    return body.result;
  }

  async login(): Promise<number> {
    if (this.uid) return this.uid;
    const uid = await this.rpc('common', 'authenticate', [
      this.cfg.db,
      this.cfg.username,
      this.cfg.apiKey,
      {},
    ]);
    if (!uid) throw new OdooError('Đăng nhập Odoo thất bại: sai db / username / API key');
    this.uid = uid;
    return uid;
  }

  async version(): Promise<{ server_version: string; server_version_info: unknown[] }> {
    return this.rpc('common', 'version', []);
  }

  async call<T = any>(model: string, method: string, args: unknown[] = [], kwargs: object = {}): Promise<T> {
    const uid = await this.login();
    return this.rpc('object', 'execute_kw', [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs]);
  }

  /** Model có tồn tại (module đã cài) không — vd quality.alert chỉ có ở bản Enterprise */
  async hasModel(model: string): Promise<boolean> {
    const n = await this.call<number>('ir.model', 'search_count', [[['model', '=', model]]]);
    return n > 0;
  }

  /** fields_get có cache — dùng để tự thích ứng khác biệt field giữa các version Odoo */
  async fields(model: string): Promise<Record<string, any>> {
    let f = this.fieldsCache.get(model);
    if (!f) {
      f = await this.call<Record<string, any>>(model, 'fields_get', [], {
        attributes: ['string', 'type', 'relation', 'store'],
      });
      this.fieldsCache.set(model, f);
    }
    return f;
  }

  /** Trả về field đầu tiên trong danh sách ứng viên mà model thực sự có */
  async pickField(model: string, candidates: string[]): Promise<string | null> {
    const f = await this.fields(model);
    return candidates.find((c) => c in f) ?? null;
  }

  /** Lọc bỏ field không tồn tại để search_read không bị lỗi "Invalid field" */
  async existingFields(model: string, wanted: string[]): Promise<string[]> {
    const f = await this.fields(model);
    return wanted.filter((w) => w in f);
  }

  /**
   * search_read có phân trang. Không dùng 1 lần lấy hết vì với dữ liệu nhiều tháng
   * response có thể rất lớn → timeout ở reverse proxy (nginx mặc định 60s) hoặc tốn RAM worker Odoo.
   */
  async searchReadAll(
    model: string,
    domain: Domain,
    fields: string[],
    opts: { order?: string; pageSize?: number; context?: object } = {},
  ): Promise<OdooRecord[]> {
    const pageSize = opts.pageSize ?? 1000;
    const out: OdooRecord[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.call<OdooRecord[]>(model, 'search_read', [domain], {
        fields,
        offset,
        limit: pageSize,
        order: opts.order ?? 'id asc',
        context: opts.context ?? {},
      });
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  /** read theo id, chia lô để tránh URL/payload quá lớn */
  async readByIds(model: string, ids: number[], fields: string[], chunk = 500): Promise<OdooRecord[]> {
    const uniq = [...new Set(ids)].filter(Boolean);
    const out: OdooRecord[] = [];
    for (let i = 0; i < uniq.length; i += chunk) {
      out.push(...(await this.call<OdooRecord[]>(model, 'read', [uniq.slice(i, i + chunk)], { fields })));
    }
    return out;
  }
}

export const m2oId = (v: M2O | undefined | null): number | null => (Array.isArray(v) ? v[0] : null);
export const m2oName = (v: M2O | undefined | null): string => (Array.isArray(v) ? v[1] : '');
