/**
 * utils/mock.js - Mock 数据（与设计稿严格一致）
 * 覆盖：初始化配置、首页兑奖、本期开奖信息、购彩统计、录入识别、号码推荐、台账明细、热力图
 */

// 本期开奖信息（双色球 / 大乐透 可切换）
// saleEndAt 为停售时刻毫秒时间戳（前端据此做实时倒计时）
function mockTodayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function mockSaleEndAt(dateStr, time) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}
const mockSsqDate = mockTodayStr(); // 周四=双色球开奖日（演示场景）

const lotteryStatus = {
  ssq: {
    type: 'ssq',
    name: '双色球',
    period: '第 2026096 期',
    drawDate: mockSsqDate,
    drawTime: '21:15',
    saleEndTime: '20:00',
    saleEndAt: mockSaleEndAt(mockSsqDate, '20:00'),
    poolAmount: '¥20.1 亿',
    countdown: '距停售 09:40:02',   // 首帧静态值，saleEndAt 存在时前端接管每秒跳动
    purchased: true,                // 用户已录入本期 → 显示「已购买」
    winningNumbers: ['03', '08', '15', '21', '27', '30', '09']
  },
  dlt: {
    type: 'dlt',
    name: '大乐透',
    period: '第 2026095 期',
    drawDate: '2026-08-22',
    drawTime: '21:25',
    saleEndTime: '21:00',
    saleEndAt: mockSaleEndAt('2026-08-22', '21:00'),
    poolAmount: '¥25.3 亿',
    countdown: '距停售 2 天 11:20:15',
    purchased: false,
    winningNumbers: ['01', '07', '16', '24', '28', '03', '11']
  }
};

// 首页中奖卡（待兑奖：双色球 不自动到账，60 天截止）
const winningCard = {
  lotteryName: '双色球',
  period: '第 2024090 期',
  amount: '¥3,000',
  status: '待兑奖',
  deadlineDate: '2024-10-12',       // 开奖 2024-08-13 + 60 天
  deadlineText: '兑奖截止 2024-10-12 · 剩余 12 天',
  channelText: '单注 ¥1 万以下，彩票店兑付',
  channel: 'shop',                  // 'shop' | 'center'
  hasPendingRedeem: true
};

// 购彩统计（月份化）
const statistics = {
  monthLabel: '2024 年 8 月',
  purchasedPeriods: 12,             // 已购期数
  totalSpent: 24000,                // 总花费 ¥240（分）
  totalWon: 300400,                 // 中奖总额 ¥3,004（分）
  monthCaption: '本月中奖 3 次 · 累计 ¥3,004'
};

// 录入识别结果（5 注双色球，均 2 倍）
const ocrResult = {
  lotteryName: '双色球',
  period: '第 2024091 期',
  drawDate: '2024-08-13',
  ocrStatus: '自动识别',
  betCount: 5,
  multiplier: 2,
  totalAmount: '¥20',
  bets: [
    { id: 1, red: ['03', '08', '15', '21', '27', '30'], blue: ['09'], mult: 2 },
    { id: 2, red: ['05', '11', '17', '23', '29', '32'], blue: ['07'], mult: 2 },
    { id: 3, red: ['02', '09', '14', '18', '26', '33'], blue: ['12'], mult: 2 },
    { id: 4, red: ['06', '12', '19', '22', '25', '31'], blue: ['04'], mult: 2 },
    { id: 5, red: ['01', '07', '16', '24', '28', '32'], blue: ['15'], mult: 2 }
  ]
};

// 号码推荐：彩种(双色球/大乐透) × 体系(星座占星/五行推命) 四套数据
// 双色球：6 红 + 1 蓝；大乐透：5 红(前区) + 2 蓝(后区)
const recommend = {
  date: '2024-08-13 周二',
  userText: '春生 · 2000-01-15 生 · 今日 甲辰年七月廿八',
  disclaimer: '本推荐仅供娱乐，不构成任何购彩建议',

  // 双色球 · 星座占星
  ssqAstrology: {
    systemName: '星座占星',
    redLabel: '红球区 · 6 个',
    blueLabel: '蓝球区 · 1 个',
    redBalls: ['03', '08', '15', '21', '27', '30'],
    blueBalls: ['09'],
    summary: '今日火星入命宫，红球偏向高频区 03/08/15/21/27/30，蓝球取幸运数位 9，祝您好运。'
  },
  // 双色球 · 五行推命
  ssqIching: {
    systemName: '五行推命',
    redLabel: '红球区 · 6 个',
    blueLabel: '蓝球区 · 1 个',
    redBalls: ['05', '11', '17', '23', '29', '32'],
    blueBalls: ['07'],
    summary: '今日卦象雷火丰，红球取旺相之数 05/11/17/23/29/32，蓝球应时位 7，祝您好运。'
  },
  // 大乐透 · 星座占星（前区 5 红 + 后区 2 蓝）
  dltAstrology: {
    systemName: '星座占星',
    redLabel: '前区红球 · 5 个',
    blueLabel: '后区蓝球 · 2 个',
    redBalls: ['04', '12', '19', '23', '31'],
    blueBalls: ['03', '11'],
    summary: '今日火星入前区，前区红球取高频组合 04/12/19/23/31，后区蓝球选 03/11 双数位，祝您好运。'
  },
  // 大乐透 · 五行推命
  dltIching: {
    systemName: '五行推命',
    redLabel: '前区红球 · 5 个',
    blueLabel: '后区蓝球 · 2 个',
    redBalls: ['06', '14', '20', '26', '32'],
    blueBalls: ['05', '09'],
    summary: '今日卦象地风升，前区红球取 06/14/20/26/32 上升之数，后区蓝球 05/09 阴阳调和。'
  }
};

// 台账：购彩日历热力图（GitHub 贡献图式 · 日期范围驱动）
// 后端按「日期 → 金额等级(0~4)」返回，前端按自然周动态分列、月份标签自动定位。
// mock 生成最近 14 周的金额数据（未来日期为 0 = 待开奖，制造"本周待补齐"缺口）。

// 期号推算（官方锚点 + 开奖日增量；与后端 lottery-rules.ts 同款算法）
// 官方锚点：ssq 2026-08-18=2026095（福彩官网）；dlt 2026-08-17=2026093（体彩公告）
// 注意：不能从元旦累计——春节休市会使期号偏少（2026 年 ssq 少 4 期、dlt 少 5 期）
const ISSUE_ANCHORS = {
  ssq: { date: '2026-08-18', no: 95 },
  dlt: { date: '2026-08-17', no: 93 }
};
const MOCK_DRAW_DAYS = { ssq: [0, 2, 4], dlt: [1, 3, 6] };

function mockIssue(lottery, dateStr) {
  const anchor = ISSUE_ANCHORS[lottery] || ISSUE_ANCHORS.ssq;
  const days = MOCK_DRAW_DAYS[lottery] || MOCK_DRAW_DAYS.ssq;
  const a = new Date(anchor.date + 'T00:00:00');
  const t = new Date(dateStr + 'T00:00:00');
  let delta = 0;
  const c = new Date(a);
  if (t >= c) {
    c.setDate(c.getDate() + 1);
    while (c <= t) { if (days.includes(c.getDay())) delta++; c.setDate(c.getDate() + 1); }
  } else {
    while (c > t) { c.setDate(c.getDate() - 1); if (days.includes(c.getDay())) delta--; }
  }
  return `第 2026${String(anchor.no + delta).padStart(3, '0')} 期`;
}

function buildMockHeatmap() {
  const map = {};
  const now = new Date();
  // 从 14 周前的周一开始，覆盖到本周日
  const start = new Date(now);
  start.setDate(start.getDate() - 14 * 7);
  // 找周一
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));

  let seed = 20260818;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let i = 0; i < 14 * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d > now) break; // 未来日期不入 map（渲染时按 isFuture 置 0）
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = rnd();
    let level = 0;
    if (r < 0.06) level = 0;      // 漏买
    else if (r < 0.56) level = 1; // 小额 1~2 注
    else if (r < 0.81) level = 2; // 中额
    else if (r < 0.93) level = 3; // 较大
    else level = 4;               // ≥¥50 最深
    map[dateStr] = level;
  }
  return map;
}

const heatmap = {
  weeks: 12,                        // 可视 12 周（列数按自然周动态浮动 11~13）
  amounts: buildMockHeatmap(),      // { 'YYYY-MM-DD': 0~4 }
  draws: buildMockDraws(),          // { 'YYYY-MM-DD': { lotteryType, period, red, blue } } 按开奖日期反查
  legend: { min: '¥0', max: '¥50+' }
};

// 过去 8 个开奖日的开奖信息（期号+号码，与后端 /api/heatmap 的 draws 字段同构）
function buildMockDraws() {
  const draws = {};
  const ssqNums = { red: ['03', '08', '15', '21', '27', '30'], blue: ['09'] };
  const dltNums = { red: ['01', '07', '16', '24', '28'], blue: ['03', '11'] };
  const now = new Date();
  let count = 0;
  for (let i = 1; i <= 60 && count < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const day = d.getDay();
    let type = null;
    if (day === 0 || day === 2 || day === 4) type = 'ssq';
    else if (day === 1 || day === 3 || day === 6) type = 'dlt';
    if (!type) continue;
    count++;
    const nums = type === 'ssq' ? ssqNums : dltNums;
    draws[formatDate(d)] = {
      lotteryType: type,
      period: mockIssue(type, formatDate(d)),
      red: nums.red,
      blue: nums.blue
    };
  }
  return draws;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getRecentWeekdayDate(targetDay, weeksBack = 0) {
  const now = new Date();
  const currentDay = now.getDay();
  const diff = currentDay >= targetDay ? currentDay - targetDay : currentDay + 7 - targetDay;
  const date = new Date(now);
  date.setDate(now.getDate() - diff - weeksBack * 7);
  return formatDate(date);
}

function getNextWeekdayDate(targetDay) {
  const now = new Date();
  const currentDay = now.getDay();
  const diff = currentDay < targetDay ? targetDay - currentDay : 7 - currentDay + targetDay;
  const date = new Date(now);
  date.setDate(now.getDate() + diff);
  return formatDate(date);
}

// 购彩明细（5 条倒序，最近开奖在最上；4 种状态覆盖；期号由日期按官方锚点推算）
const tickets = [
  {
    period: mockIssue('dlt', getNextWeekdayDate(6)),
    lottery: 'dlt',
    lotteryName: '大乐透',
    status: '待开奖',               // 灰
    drawDate: getNextWeekdayDate(6),
    betAmount: '¥6',
    winAmount: '',
    bets: [
      { id: 1, red: '01 07 16 24 28', blue: '03 11', mult: '*2' },
      { id: 2, red: '05 12 19 23 30', blue: '07 09', mult: '*1' }
    ]
  },
  {
    period: mockIssue('ssq', getRecentWeekdayDate(0, 0)),
    lottery: 'ssq',
    lotteryName: '双色球',
    status: '已兑奖',               // 绿
    drawDate: getRecentWeekdayDate(0, 0),
    betAmount: '¥4',
    winAmount: '¥3,000',
    bets: [
      { id: 1, red: '03 08 15 21 27 30', blue: '09', mult: '*2' }
    ]
  },
  {
    period: mockIssue('dlt', getRecentWeekdayDate(3, 0)),
    lottery: 'dlt',
    lotteryName: '大乐透',
    status: '待兑奖',               // 黄
    drawDate: getRecentWeekdayDate(3, 0),
    betAmount: '¥6',
    winAmount: '¥240',
    bets: [
      { id: 1, red: '02 09 14 18 26', blue: '05 12', mult: '*2' },
      { id: 2, red: '06 11 17 22 29', blue: '04 10', mult: '*1' }
    ]
  },
  {
    period: mockIssue('ssq', getRecentWeekdayDate(4, 0)),
    lottery: 'ssq',
    lotteryName: '双色球',
    status: '未中奖',               // 灰
    drawDate: getRecentWeekdayDate(4, 0),
    betAmount: '¥4',
    winAmount: '',
    bets: [
      { id: 1, red: '06 12 19 22 25 31', blue: '04', mult: '*1' },
      { id: 2, red: '01 07 16 24 28 32', blue: '15', mult: '*1' }
    ]
  },
  {
    period: mockIssue('dlt', getRecentWeekdayDate(1, 1)),
    lottery: 'dlt',
    lotteryName: '大乐透',
    status: '未中奖',
    drawDate: getRecentWeekdayDate(1, 1),
    betAmount: '¥2',
    winAmount: '',
    bets: [
      { id: 1, red: '10 13 20 26 33', blue: '02 08', mult: '*1' }
    ]
  }
];

// ============ 「附近」功能（2026-09-15）============
// USE_MOCK=true 时替代腾讯地点搜索接口，保证无 Key / 无网络也能调试页面布局与交互。
// 字段与腾讯 LBS 原始 POI 同构（title / address / category / location / _distance），
// 由 utils/nearby.js 的 toStation() 统一转成页面模型 —— mock 与真实链路走同一套转换。
// 样本特意覆盖 4 种类型判定分支 + 实测抓到的「名称自相矛盾」坑样本（需求 §3.4）：
//   中国体育福利彩票  → 前缀「中国体育」判为体彩（若按包含关键词会误判成福彩）
//   中国体育彩票(福利彩票) → 同上，前缀优先
//   福彩体彩竞猜大乐透… → 兼营，双标签
//   彩票销售点        → 未识别，灰色
const nearbyStations = [
  {
    id: 'MOCK_POI_01',
    title: '中国福利彩票（朝阳门南小街店）',
    address: '北京市东城区朝阳门南小街 12 号',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.90923, lng: 116.42491 },
    _distance: 320.4
  },
  {
    id: 'MOCK_POI_02',
    title: '中国体育彩票销售网点',
    address: '北京市东城区东四十条 3 号院',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.90712, lng: 116.42633 },
    _distance: 480.9
  },
  {
    id: 'MOCK_POI_03',
    title: '中国体育福利彩票',
    address: '北京市东城区朝阳门内大街 8 号',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.91088, lng: 116.42017 },
    _distance: 610.2
  },
  {
    id: 'MOCK_POI_04',
    title: '福彩体彩竞猜大乐透（朝阳门店）',
    address: '北京市东城区朝阳门南小街甲 1 号',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.90556, lng: 116.42885 },
    _distance: 890.7
  },
  {
    id: 'MOCK_POI_05',
    title: '中国福利彩票（东四店）',
    address: '北京市东城区东四北大街 216 号',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.91334, lng: 116.41762 },
    _distance: 1150.3
  },
  {
    id: 'MOCK_POI_06',
    title: '中国体育彩票(福利彩票)',
    address: '北京市东城区建国门内大街 18 号',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.90411, lng: 116.43102 },
    _distance: 1324.6
  },
  {
    id: 'MOCK_POI_07',
    title: '中国福利彩票双色球销售点',
    address: '北京市东城区南竹竿胡同 6 号',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.91245, lng: 116.43218 },
    _distance: 1586.1
  },
  {
    id: 'MOCK_POI_08',
    title: '彩票销售点',
    address: '北京市东城区朝内大街 99 号',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.90178, lng: 116.41554 },
    _distance: 1750.8
  }
];

module.exports = {
  lotteryStatus,
  winningCard,
  statistics,
  ocrResult,
  recommend,
  heatmap,
  tickets,
  nearbyStations
};
