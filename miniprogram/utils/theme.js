/**
 * utils/theme.js - 主题能力（跟随微信/系统）
 *
 * 配色方案 V2.0「暖纸 · 暖炭」（2026-10-16 实施）
 *   品牌：炭黑 #242320 · 杏橙 #ED945F · 暖白 #FAF7F0
 *   浅色：画布 #F1ECE2 / 卡片 #FAF7F0 / 浮层 #FFFFFF / 凹陷 #EAE3D4
 *   深色：画布 #14110D / 卡片 #211D17 / 浮层 #2B2620 / 凹陷 #1A1712
 *
 * 为什么 JS 里还要有一份颜色表：
 *   WXSS 的 var(--xxx) 只在样式里生效。`components/icon` 把图标渲染成 SVG 的
 *   data:image URI —— **CSS 变量进不了那个字符串**（{C} 必须替换成解析后的实际色值）。
 *   所以 JS 侧必须能拿到「当前主题下某个语义色是多少」，并在主题变化时重新生成 URI。
 *
 * 单一数据源：
 *   这里的值必须与 styles/tokens.wxss 的浅色基准 / 深色覆盖逐项对应。改色时两边一起改，
 *   否则会出现「图标变了、背景没变」这类半截适配。
 *
 * 命名（tone）以职责为单位，与 WXSS 令牌一一对应：
 *   primary / secondary / muted / placeholder / on-action / action /
 *   selection / selection-bg / red / blue / success / danger / attention / reward /
 *   accent-strong / surface / raised / sunken / border
 */
const THEMES = {
  light: {
    primary: '#242320',
    secondary: '#575046',
    muted: '#6B6355',
    placeholder: '#7A7264',
    'accent-strong': '#A94D16',
    'on-action': '#FAF7F0',
    action: '#242320',
    selection: '#FAF7F0',
    'selection-bg': '#242320',
    red: '#B32B26',
    blue: '#2A4795',
    success: '#3D6A38',
    danger: '#A23124',
    attention: '#8A5A12',
    reward: '#8F5A07',
    surface: '#FAF7F0',
    raised: '#FFFFFF',
    sunken: '#EAE3D4',
    border: '#8A7F69'
  },
  dark: {
    primary: '#F5F1E7',
    secondary: '#BCB3A4',
    muted: '#948B7D',
    placeholder: '#948B7D',
    'accent-strong': '#ED945F',
    'on-action': '#241A12',
    action: '#ED945F',
    selection: '#F0A97E',
    'selection-bg': '#523A22',
    red: '#F08A80',
    blue: '#93AEE8',
    success: '#8CCF86',
    danger: '#F0998A',
    attention: '#E8C27A',
    reward: '#E8C27A',
    surface: '#211D17',
    raised: '#2B2620',
    sunken: '#1A1712',
    border: '#736A58'
  }
};

/**
 * 读当前系统主题。
 * 只认 'dark' 为深色，其余（含 'light' / undefined / API 缺失）一律按浅色兜底 ——
 * 浅色是设计基准，兜底到浅色能保证「读不到主题」时页面仍可读。
 */
function readSystemTheme() {
  try {
    // 基础库 2.20.1+ 推荐 getAppBaseInfo；老版本回退 getSystemInfoSync
    if (typeof wx.getAppBaseInfo === 'function') {
      const info = wx.getAppBaseInfo();
      if (info && info.theme) return info.theme === 'dark' ? 'dark' : 'light';
    }
    const sys = wx.getSystemInfoSync();
    return sys && sys.theme === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
}

let _theme = readSystemTheme();
let _bound = false;
const _listeners = [];

function ensureBound() {
  if (_bound) return;
  _bound = true;
  if (typeof wx.onThemeChange === 'function') {
    wx.onThemeChange((res) => {
      const next = res && res.theme === 'dark' ? 'dark' : 'light';
      if (next === _theme) return;
      _theme = next;
      notify();
    });
  }
}

function notify() {
  _listeners.slice().forEach((fn) => {
    try {
      fn(_theme);
    } catch (e) {
      // 单个订阅者出错不能影响其他页面
    }
  });
}

/** 当前主题：'light' | 'dark' */
function current() {
  return _theme;
}

/** 取某语义色在当前主题下的色值；未知 tone 回退到主文字色 */
function color(tone) {
  const table = THEMES[_theme] || THEMES.light;
  return table[tone] || table.primary;
}

/**
 * 重新读取系统主题并（必要时）通知。
 * 用途：`onThemeChange` 在部分平台回到前台时不一定补发事件，
 * 页面 onShow / App.onShow 里调一次可避免「留在后台的页面下次显示仍是旧色」。
 */
function refresh() {
  const next = readSystemTheme();
  if (next === _theme) return _theme;
  _theme = next;
  notify();
  return _theme;
}

/** 订阅主题变化；返回值即取消订阅函数，组件 detached / 页面 onUnload 里务必调用 */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  ensureBound();
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i > -1) _listeners.splice(i, 1);
  };
}

module.exports = {
  THEMES,
  current,
  color,
  refresh,
  subscribe
};
