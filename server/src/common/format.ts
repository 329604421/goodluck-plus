/** 金额分 → 展示字符串：300000 → '¥3,000'（2026-08-21：去掉角分，只到元） */
export function fmtMoney(cent: number | null | undefined): string {
  return '¥' + Math.round((cent || 0) / 100).toLocaleString('en-US');
}

/** Date → 'YYYY-MM-DD'（Asia/Shanghai 语义，服务器已设 TZ） */
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Date → 'YYYY-MM-DD 周X'（推荐页 date 字段格式） */
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
export function fmtDateWithWeek(d: Date): string {
  return `${fmtDate(d)} 周${WEEK_CN[d.getDay()]}`;
}

/** 倒计时文案：'02 天 04:23:15'（对齐前端 mock 格式） */
export function fmtCountdown(target: Date, now = new Date()): string {
  let diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  diff -= days * 86400000;
  const hours = Math.floor(diff / 3600000);
  diff -= hours * 3600000;
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff - mins * 60000) / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(days).padStart(2, '0')} 天 ${p(hours)}:${p(mins)}:${p(secs)}`;
}

/** 时长差文案：当天内 'HH:MM:SS'，跨天 'N 天 HH:MM:SS'（停售倒计时用） */
export function fmtDuration(ms: number): string {
  ms = Math.max(0, ms);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return days > 0
    ? `${days} 天 ${p(hours)}:${p(mins)}:${p(secs)}`
    : `${p(hours)}:${p(mins)}:${p(secs)}`;
}

/** 奖池金额（分）→ 展示文案：'¥20.1 亿' / '¥5.45 亿' / '¥6288 万' / '¥100 元' */
export function fmtPool(cent: number): string {
  if (!cent || cent <= 0) return '--';
  const yi = cent / 1e10; // 1 亿 = 1e8 元 = 1e10 分
  if (yi >= 1) return `¥${(Math.round(yi * 10) / 10).toFixed(1).replace(/\.0$/, '')} 亿`;
  const wan = cent / 1e6; // 1 万 = 1e4 元 = 1e6 分
  if (wan >= 1) return `¥${Math.round(wan)} 万`;
  return `¥${Math.round(cent / 100)} 元`;
}

/** '2024-08-13' → Date（本地时区零点） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
