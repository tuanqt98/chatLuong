/**
 * Odoo lưu datetime ở UTC dạng "YYYY-MM-DD HH:MM:SS" (không có 'Z').
 * Báo cáo theo ngày phải quy về giờ địa phương, nếu không ca sáng 6h-7h VN (= 23h-24h UTC hôm trước)
 * sẽ bị tính nhầm sang ngày hôm trước.
 */

export const parseOdooDt = (s: string): Date => new Date(s.replace(' ', 'T') + 'Z');

export const toOdooDt = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

/** Offset (phút) của timezone tại thời điểm d — dùng Intl để đúng cả với múi giờ có DST */
function tzOffsetMinutes(d: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** 00:00 ngày `ymd` giờ địa phương (+ cutoffHour) → Date (UTC instant) */
export function localDayStart(ymd: string, tz: string, cutoffHour = 0): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, cutoffHour));
  return new Date(guess.getTime() - tzOffsetMinutes(guess, tz) * 60000);
}

/** Instant → "ngày làm việc" (YYYY-MM-DD) theo giờ địa phương, có tính giờ chốt ngày */
export function workDay(d: Date, tz: string, cutoffHour = 0): string {
  const shifted = new Date(d.getTime() - cutoffHour * 3600000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
