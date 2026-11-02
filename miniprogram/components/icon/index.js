/**
 * components/icon/index.js
 * IconPark 官方几何图标（48×48 viewBox，stroke-width=4，圆角端点）
 * type: home | camera | record | magic | lightning | grid | bill | back | history | refresh | download
 *       | timer | timerFill | check | checkCircle | shop | user | sparkle
 *       | chevron | down | left | right | scan | scanning
 *       | local | aiming | search | navigation | settingTwo | list | close
 *         ↑ 2026-09-15「附近」功能新增（见《小程序附近功能迭代说明》§3.1 / 规范板区块 03）
 *           copy 图标曾为「地址复制」引入，该功能已下线并于同日移除
 * color: 显式色值（写死时用；会**丢失深色适配**，新代码优先用 tone）
 * tone: 语义色名（默认 primary），按当前主题解析 —— 见 utils/theme.js
 *       常用值：primary / secondary / muted / on-action / selection / red / blue
 * 主题：组件订阅系统主题变化，切换时按 tone 重新生成 SVG，无需页面干预。
 */
const theme = require('../../utils/theme');

const SVG = {
  home: '<path d="M9 18V42H39V18L24 6L9 18Z" fill="none" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 29V42H29V29H19Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/><path d="M9 42H39" stroke="{C}" stroke-width="4" stroke-linecap="round"/>',
  camera: '<path d="M15 12L18 6H30L33 12H15Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/><rect x="4" y="12" width="40" height="30" rx="3" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/><path d="M24 35C28.4183 35 32 31.4183 32 27C32 22.5817 28.4183 19 24 19C19.5817 19 16 22.5817 16 27C16 31.4183 19.5817 35 24 35Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/>',
  record: '<rect x="5" y="18" width="38" height="24" rx="2" fill="none" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 12H40" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6L33 6" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 24V30" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 32.7491C18 31.2308 19.2894 30 20.88 30H26V33.2509C26 34.7692 24.7106 36 23.12 36H20.88C19.2894 36 18 34.7692 18 33.2509V32.7491Z" stroke="{C}" stroke-width="4" stroke-linejoin="round"/><path d="M31 25L26 24" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  magic: '<path d="M20.1005 8.1005L24.3431 12.3431M30 4V10M39.8995 8.1005L35.6569 12.3431M44 18H38M39.8995 27.8995L35.6569 23.6569M30 32V26M20.1005 27.8995L24.3431 23.6569M16 18H22" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M29.5856 18.4143L5.54395 42.4559" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  lightning: '<path d="M19 4H37L26 18H41L17 44L22 25H8L19 4Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/>',
  grid: '<rect x="5" y="5" width="38" height="38" rx="2" fill="none" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 5V43" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 24H43" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  bill: '<path d="M10 6C10 4.89543 10.8954 4 12 4H36C37.1046 4 38 4.89543 38 6V44L31 39L24 44L17 39L10 44V6Z" fill="none" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 22L30 22" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 30L30 30" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 14L30 14" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<circle cx="24" cy="24" r="22" fill="#F7F8FA"/><path d="M31 36L19 24L31 12" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  history: '<path d="M5.81836 6.72729V14H13.0911" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 24C4 35.0457 12.9543 44 24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C16.598 4 10.1351 8.02111 6.67677 13.9981" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24.005 12L24.0038 24.0088L32.4832 32.4882" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  refresh: '<path d="M42 8V24" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 24L6 40" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M42 24C42 14.0589 33.9411 6 24 6C18.9145 6 14.3216 8.10896 11.0481 11.5M6 24C6 33.9411 14.0589 42 24 42C28.8556 42 33.2622 40.0774 36.5 36.9519" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  download: '<path d="M6 24.0083V42H42V24" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 23L24 32L15 23" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.9917 6V32" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  timer: '<circle cx="24" cy="28" r="16" fill="none" stroke="{C}" stroke-width="4"/><path d="M28 4L20 4" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 4V12" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M35 16L38 13" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 28V22" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 28H18" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  timerFill: '<circle cx="24" cy="28" r="16" fill="#FCB900" stroke="#FCB900" stroke-width="4"/><path d="M28 4L20 4" stroke="#FCB900" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 4V12" stroke="#FCB900" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M35 16L38 13" stroke="#FCB900" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 28V22" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 28H18" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path fill-rule="evenodd" clip-rule="evenodd" d="M4 24L9 19L19 29L39 9L44 14L19 39L4 24Z" fill="{C}" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  checkCircle: '<path d="M24 44C29.5228 44 34.5228 41.7614 38.1421 38.1421C41.7614 34.5228 44 29.5228 44 24C44 18.4772 41.7614 13.4772 38.1421 9.85786C34.5228 6.23858 29.5228 4 24 4C18.4772 4 13.4772 6.23858 9.85786 9.85786C6.23858 13.4772 4 18.4772 4 24C4 29.5228 6.23858 34.5228 9.85786 38.1421C13.4772 41.7614 18.4772 44 24 44Z" fill="#00B473" stroke="#00B473" stroke-width="4" stroke-linejoin="round"/><path d="M16 24L22 30L34 18" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  shop: '<path d="M4 12H44V20L42.6015 20.8391C40.3847 22.1692 37.6153 22.1692 35.3985 20.8391L34 20L32.6015 20.8391C30.3847 22.1692 27.6153 22.1692 25.3985 20.8391L24 20L22.6015 20.8391C20.3847 22.1692 17.6153 22.1692 15.3985 20.8391L14 20L12.6015 20.8391C10.3847 22.1692 7.61531 22.1692 5.39853 20.8391L4 20V12Z" fill="none" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 22.4889V44H40V22" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11.8222V4H40V12" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="19" y="32" width="10" height="12" fill="none" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  user: '<circle cx="24" cy="12" r="8" fill="none" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M42 44C42 34.0589 33.9411 26 24 26C14.0589 26 6 34.0589 6 44" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  sparkle: '<path d="M23.9986 5L17.8856 17.4776L4 19.4911L14.0589 29.3251L11.6544 43L23.9986 36.4192L36.3454 43L33.9586 29.3251L44 19.4911L30.1913 17.4776L23.9986 5Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/>',
  chevron: '<path d="M19 12L31 24L19 36" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M24 42V6" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M36 30L24 42L12 30" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  left: '<path d="M31 36L19 24L31 12" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  scan: '<path d="M7 24L41 24" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 7L24 41" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="5" width="4" height="4" fill="{C}"/><rect x="14" y="5" width="4" height="4" fill="{C}"/><rect x="30" y="5" width="4" height="4" fill="{C}"/><rect x="39" y="5" width="4" height="4" fill="{C}"/><rect x="39" y="14" width="4" height="4" fill="{C}"/><rect x="5" y="14" width="4" height="4" fill="{C}"/><rect x="5" y="39" width="4" height="4" fill="{C}"/><rect x="14" y="39" width="4" height="4" fill="{C}"/><rect x="30" y="39" width="4" height="4" fill="{C}"/><rect x="39" y="39" width="4" height="4" fill="{C}"/><rect x="39" y="30" width="4" height="4" fill="{C}"/><rect x="5" y="30" width="4" height="4" fill="{C}"/>',
  scanning: '<path d="M16 6H8C6.89543 6 6 6.89543 6 8V16" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 42H8C6.89543 42 6 41.1046 6 40V32" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 42H40C41.1046 42 42 41.1046 42 40V32" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 6H40C41.1046 6 42 6.89543 42 8V16" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 24L14 24" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 16H21" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 32H21" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',

  /* ---------- 「附近」功能图标（IconPark 原版路径，抓取于 2026-09-15） ---------- */
  // 水滴光标：tabBar「附近」入口 + 地图左上搜索结果气泡 + 定位被拒卡片
  local: '<path d="M9.85786 32.7574C6.23858 33.8432 4 35.3432 4 37C4 40.3137 12.9543 43 24 43C35.0457 43 44 40.3137 44 37C44 35.3432 41.7614 33.8432 38.1421 32.7574" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 35C24 35 37 26.504 37 16.6818C37 9.67784 31.1797 4 24 4C16.8203 4 11 9.67784 11 16.6818C11 26.504 24 35 24 35Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/><path d="M24 22C26.7614 22 29 19.7614 29 17C29 14.2386 26.7614 12 24 12C21.2386 12 19 14.2386 19 17C19 19.7614 21.2386 22 24 22Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/>',
  // 准心：右下「回到我的位置」悬浮按钮（不要与 local 混用，二者语义不同）
  aiming: '<circle cx="24" cy="24" r="20" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 37V44" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M36 24H44" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 24H11" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 11V4" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<path d="M21 38C30.3888 38 38 30.3888 38 21C38 11.6112 30.3888 4 21 4C11.6112 4 4 11.6112 4 21C4 30.3888 11.6112 38 21 38Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/><path d="M26.657 14.3431C25.2093 12.8954 23.2093 12 21.0001 12C18.791 12 16.791 12.8954 15.3433 14.3431" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33.2216 33.2217L41.7069 41.707" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  navigation: '<path d="M24.5 4L9 44L24.5 34.9091L40 44L24.5 4Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/>',
  settingTwo: '<path d="M18.2838 43.1713C14.9327 42.1736 11.9498 40.3213 9.58787 37.867C10.469 36.8227 11 35.4734 11 34.0001C11 30.6864 8.31371 28.0001 5 28.0001C4.79955 28.0001 4.60139 28.01 4.40599 28.0292C4.13979 26.7277 4 25.3803 4 24.0001C4 21.9095 4.32077 19.8938 4.91579 17.9995C4.94381 17.9999 4.97188 18.0001 5 18.0001C8.31371 18.0001 11 15.3138 11 12.0001C11 11.0488 10.7786 10.1493 10.3846 9.35011C12.6975 7.1995 15.5205 5.59002 18.6521 4.72314C19.6444 6.66819 21.6667 8.00013 24 8.00013C26.3333 8.00013 28.3556 6.66819 29.3479 4.72314C32.4795 5.59002 35.3025 7.1995 37.6154 9.35011C37.2214 10.1493 37 11.0488 37 12.0001C37 15.3138 39.6863 18.0001 43 18.0001C43.0281 18.0001 43.0562 17.9999 43.0842 17.9995C43.6792 19.8938 44 21.9095 44 24.0001C44 25.3803 43.8602 26.7277 43.594 28.0292C43.3986 28.01 43.2005 28.0001 43 28.0001C39.6863 28.0001 37 30.6864 37 34.0001C37 35.4734 37.531 36.8227 38.4121 37.867C36.0502 40.3213 33.0673 42.1736 29.7162 43.1713C28.9428 40.752 26.676 39.0001 24 39.0001C21.324 39.0001 19.0572 40.752 18.2838 43.1713Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/><path d="M24 31C27.866 31 31 27.866 31 24C31 20.134 27.866 17 24 17C20.134 17 17 20.134 17 24C17 27.866 20.134 31 24 31Z" fill="none" stroke="{C}" stroke-width="4" stroke-linejoin="round"/>',
  list: '<path d="M5 10L8 13L14 7" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 24L8 27L14 21" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 38L8 41L14 35" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 24H43" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 38H43" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 10H43" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M8 8L40 40" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 40L40 8" stroke="{C}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
};

Component({
  properties: {
    type: { type: String, value: 'home' },
    // 注意：默认值改为空串。原来是 '#1C1C1E'，会让「没传 color」的调用在深色下
    // 拿到深色描边（深底上几乎看不见）；空串表示「未指定，走 tone」。
    color: { type: String, value: '' },
    tone: { type: String, value: 'primary' },
    size: { type: Number, value: 22 }
  },
  data: {
    uri: ''
  },
  observers: {
    'type, color, tone, size': function () {
      this.renderIcon();
    }
  },
  lifetimes: {
    attached() {
      this._unsubscribeTheme = theme.subscribe(() => this.renderIcon());
      this.renderIcon();
    },
    detached() {
      if (this._unsubscribeTheme) this._unsubscribeTheme();
      this._unsubscribeTheme = null;
    }
  },
  methods: {
    renderIcon() {
      const type = this.data.type;
      // 显式 color 优先（向后兼容）；否则按语义名从当前主题解析
      const resolved = this.data.color || theme.color(this.data.tone);
      const body = (SVG[type] || SVG.home).replace(/\{C\}/g, resolved);
      const svg = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
      this.setData({ uri: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) });
    }
  }
});
