import { loadSettings, isConfigured } from './settings.ts';
import type { OdooConfig } from './odoo.ts';

/**
 * Định mức hao phí.
 *
 * Odoo chuẩn KHÔNG có khái niệm "định mức hao phí" cho phế phẩm, nên ta hỗ trợ 3 nguồn,
 * ưu tiên từ trên xuống:
 *   1. Field tuỳ chỉnh trên sản phẩm trong Odoo (vd x_dinh_muc_hao_phi do Studio tạo)
 *   2. norms.json → byProduct (theo mã nội bộ default_code)
 *   3. norms.json → byWorkcenter (theo tên máy / work center)
 *   4. norms.json → default
 *
 * Mỗi định mức gồm:
 *   pct      : % phế phẩm cho phép TÍNH TRÊN SẢN LƯỢNG ĐẠT (vd 3 = 3%)
 *   setupQty : hao phí lên máy cố định cho MỖI lệnh công việc (căn màu, căn bế...), cùng đơn vị sản phẩm
 *   → SL phế cho phép của 1 work order = setupQty + pct% × SL đạt
 */
export interface Norm {
  pct: number;
  setupQty?: number;
}

export interface NormsFile {
  default: Norm;
  byWorkcenter?: Record<string, Norm>;
  byProduct?: Record<string, Norm>;
  /** Field tuỳ chỉnh trên product.product chứa % định mức. Bỏ trống nếu không có. */
  odooProductNormField?: string;
  /** Định mức hao hụt nguyên vật liệu so với BoM (%) */
  material?: {
    pct: number;
    /** Chỉ tính NVL có đơn vị trong danh sách này, tránh cộng lẫn mét giấy với kg mực */
    uomNames: string[];
  };
}

export interface AppConfig {
  odoo: OdooConfig;
  tz: string;
  /** Giờ "chốt ngày": log bắt đầu trước giờ này tính cho ngày hôm trước (phục vụ ca đêm). 0 = theo lịch. */
  dayCutoffHour: number;
  norms: NormsFile;
}

/** Dùng chung cài đặt với web app (data/settings.json), fallback .env + norms.json */
export function loadConfig(): AppConfig {
  const s = loadSettings();
  if (!isConfigured(s)) throw new Error('Chưa cấu hình kết nối Odoo: điền .env hoặc vào trang Cài đặt của web app');
  return s;
}
