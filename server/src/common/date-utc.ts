/**
 * UTC 日期工具（Prisma + MySQL 时区陷阱修复）
 *
 * 背景：Prisma 对 MySQL 的 DATE 列按「UTC 日期」存取。
 * 若用本地零点 new Date(y,m,d)（如 2026-08-19T00:00+08:00 = UTC 08-18T16:00Z），
 * 存库会偏移为 08-18，导致日期键查询/去重错位。
 * 统一规则：作为「日期键」的 Date 一律用 UTC 构造（Date.UTC 零点）。
 */
export function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

/** 今天（UTC 零点），作为缓存键/日期键 */
export function utcToday(): Date {
  const n = new Date();
  return utcDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/** 在 UTC 日期上加减天数（返回 UTC 零点） */
export function addDaysUtc(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

/** 本地 Date → UTC 零点日期（用本地日历字段构造 UTC 日期） */
export function toUtcDate(d: Date): Date {
  return utcDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
