/**
 * utils/format.js - 格式化工具
 */

// 分 → 元（取整到元，去角分），如 300000 → "3,000"（2026-08-21 调整）
function fenToYuan(fen) {
  const yuan = Math.round((fen || 0) / 100);
  return String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 带 ¥ 符号格式化金额：formatMoney(300000) → "¥3,000"
function formatMoney(fen) {
  return '¥' + fenToYuan(fen);
}

// 分 → 亿/万/元（首页奖池风格）
function formatPool(fen) {
  const yi = 100000000;
  const wan = 10000;
  if (fen >= yi) {
    return '¥' + (fen / yi).toFixed(1).replace('.0', '') + ' 亿';
  }
  if (fen >= wan) {
    return '¥' + (fen / wan).toFixed(1).replace('.0', '') + ' 万';
  }
  return '¥' + fenToYuan(fen);
}

// 倒计时字符串（天 时:分:秒）
function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(days)} 天 ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

// 开奖日期 + 60 天 → 兑奖截止日期（yyyy-MM-dd）
function addDays(dateStr, days) {
  const d = new Date(dateStr.replace(/-/g, '/'));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 计算距某日期剩余天数
function daysLeft(dateStr) {
  const target = new Date(dateStr.replace(/-/g, '/')).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((target - now) / 86400000));
}

module.exports = {
  fenToYuan,
  formatMoney,
  formatPool,
  formatCountdown,
  addDays,
  daysLeft
};
