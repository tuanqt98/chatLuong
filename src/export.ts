import { writeFileSync } from 'node:fs';
import type { ReportResult } from './report.ts';

/**
 * CSV có BOM UTF-8 + dấu phân cách ';' để Excel tiếng Việt (locale vi-VN dùng ',' làm dấu thập phân)
 * mở ra không bị lỗi font và không bị dồn cột.
 */
const SEP = ';';
const esc = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fmtMap = (m: Record<string, number>, unit = '') =>
  Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}${unit}`).join(' | ');
const h = (min: number) => Math.round((min / 60) * 100) / 100;

function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(SEP)).join('\r\n');
}

export function summaryCsv(r: ReportResult): string {
  return toCsv(
    ['Ngày', 'Mã CN', 'Công nhân', 'Máy', 'Lệnh SX', 'Giờ chạy máy', 'Giờ dừng máy', 'Lý do dừng (phút)',
      'SL đạt', 'SL phế', 'Tỷ lệ phế %', 'SL phế cho phép', 'Vượt ĐM phế', 'SL phế vượt', 'Nguyên nhân phế (SL)', 'Lỗi chất lượng',
      'NVL kế hoạch', 'NVL thực tế', 'Hao hụt NVL %', 'ĐM NVL %', 'Vượt ĐM NVL'],
    r.summary.map((s) => [
      s.day, s.workerKey, s.workerName, s.workcenters.join(', '), s.productions.join(', '),
      h(s.runMin), h(s.downMin), fmtMap(s.downReasons, 'p'),
      s.goodQty, s.scrapQty, s.scrapRatePct, s.allowedScrapQty, s.overScrap ? 'VƯỢT' : '', s.overScrapQty,
      fmtMap(s.scrapReasons), s.qualityIssues.join(' | '),
      s.matPlanned || '', s.matActual || '', s.matVariancePct, s.matNormPct, s.overMaterial ? 'VƯỢT' : '',
    ]),
  );
}

export function detailCsv(r: ReportResult): string {
  return toCsv(
    ['Ngày', 'Mã CN', 'Công nhân', 'Lệnh SX', 'Công đoạn (WO)', 'Sản phẩm', 'Máy', 'Phút chạy', '% thời gian WO',
      'SL đạt (phân bổ)', 'SL phế (phân bổ)', 'SL phế cho phép', 'ĐM %', 'Nguồn ĐM'],
    r.details.map((d) => [
      d.day, d.workerKey, d.workerName, d.production, d.workorder, d.product, d.workcenter, d.runMin, d.sharePct,
      d.goodQty, d.scrapQty, d.allowedScrapQty, d.normPct, d.normSource,
    ]),
  );
}

export function writeCsv(r: ReportResult, prefix: string): string[] {
  const sumFile = `${prefix}_tong-hop.csv`;
  const detFile = `${prefix}_chi-tiet.csv`;
  writeFileSync(sumFile, summaryCsv(r));
  writeFileSync(detFile, detailCsv(r));
  const jsonFile = `${prefix}.json`;
  writeFileSync(jsonFile, JSON.stringify(r, null, 2));
  return [sumFile, detFile, jsonFile];
}
