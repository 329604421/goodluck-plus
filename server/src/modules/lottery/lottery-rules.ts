/**
 * 彩种规则 + 开奖日历 + 状态映射（对齐前端 config/index.js 与 pages/record/record.js）
 * 注意：返回的日期对象一律用 UTC 零点（Prisma DATE 列按 UTC 日期存取，见 common/date-utc.ts）
 */
import { utcDate } from '../../common/date-utc';
import { ApiException } from '../../common/api-exception';

export type LotteryType = 'ssq' | 'dlt';

export interface LotteryRule {
  code: LotteryType;
  name: string;
  redLabel: string; // 红球 / 前区
  blueLabel: string; // 蓝球 / 后区
  redCount: number;
  redMax: number;
  blueCount: number;
  blueMax: number;
  priceCent: number; // 每注单价（分）
  /** 开奖时刻（本地时区 HH:mm） */
  drawTime: string;
  /** 当期停售时刻（本地时区 HH:mm，开奖日当天截止售票） */
  saleEndTime: string;
}

export const LOTTERY_RULES: Record<LotteryType, LotteryRule> = {
  ssq: {
    code: 'ssq',
    name: '双色球',
    redLabel: '红球',
    blueLabel: '蓝球',
    redCount: 6,
    redMax: 33,
    blueCount: 1,
    blueMax: 16,
    priceCent: 200,
    drawTime: '21:15',
    saleEndTime: '20:00', // 开奖日 20:00 截止售票
  },
  dlt: {
    code: 'dlt',
    name: '大乐透',
    redLabel: '前区',
    blueLabel: '后区',
    redCount: 5,
    redMax: 35,
    blueCount: 2,
    blueMax: 12,
    priceCent: 200,
    drawTime: '21:25',
    saleEndTime: '21:00', // 开奖日 21:00 截止售票
  },
};

/**
 * 开奖日历（对齐前端 config/index.js drawDays）：
 * 周一/三/六 = 大乐透；周二/四/日 = 双色球；周五不开奖
 */
const DRAW_DAYS: Record<number, LotteryType | null> = {
  0: 'ssq', // 周日
  1: 'dlt',
  2: 'ssq',
  3: 'dlt',
  4: 'ssq',
  5: null, // 周五不开奖
  6: 'dlt',
};

/**
 * 彩票市场休市日历（2026-10-07 新增，事故修复）
 *
 * 依据：财政部公告 2025 年第 14 号《关于 2026 年彩票市场休市安排的公告》
 *   春节 10 天：2026-02-14 0:00 ~ 2026-02-23 24:00
 *   国庆  4 天：2026-10-01 0:00 ~ 2026-10-04 24:00
 * 休市期间除即开型彩票外，停止全国其他类型彩票游戏的**销售、开奖和兑奖**。
 *
 * ⚠️ 为什么必须内建：期号推算（issueOfDate）是「官方锚点 + 开奖日增量」，
 * 而"开奖日"原先只看星期几。休市期间原本是开奖日的那天并不开奖，不扣除就会
 * 把期号整体算多 —— 实测 2026 国庆休市（10-01~10-04）吞掉了大乐透 10-03 一期、
 * 双色球 10-01 与 10-04 两期，导致期号分别领先官方 1 期 / 2 期：
 *   系统认定 2026-10-07 = 大乐透第 2026115 期，官方实为第 2026114 期。
 * 事故后果（2026-10-07）：
 *   ① 用户当日晚开奖的 2026114 期票，期号撞上"错位后被认为已开奖"的记录 → 保存即被判未中奖；
 *   ② 定时同步按错误期号去搜尚未开奖的期 → 抓到站点首页，把号码矩阵表头写进 draw_results。
 * 二者叠加正是"提前兑奖 + 首页奖池错乱"的根因。
 *
 * 维护：财政部每年 12 月公告次年休市安排，届时应追加对应区间（区间为闭区间，按本地日期比较）。
 */
const MARKET_CLOSED_RANGES: Array<[string, string]> = [
  ['2026-02-14', '2026-02-23'], // 春节 10 天
  ['2026-10-01', '2026-10-04'], // 国庆 4 天
];

/** 本地日期 → 'YYYY-MM-DD' */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** 该日是否处于彩票市场休市期（休市期间不开奖） */
export function isMarketClosed(date: Date): boolean {
  const k = ymd(date);
  return MARKET_CLOSED_RANGES.some(([s, e]) => k >= s && k <= e);
}

/** 某天是否为某彩种开奖日（休市期一律不算开奖日） */
export function isDrawDayOfType(date: Date, type: LotteryType): boolean {
  if (isMarketClosed(date)) return false;
  return DRAW_DAYS[date.getDay()] === type;
}

/** 从某日起（含当日）下一个某彩种开奖日；当日即开奖日则返回当日（UTC 零点） */
export function nextDrawDate(from: Date, type: LotteryType): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 7; i++) {
    if (isDrawDayOfType(d, type)) return utcDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    d.setDate(d.getDate() + 1);
  }
  return utcDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * 期号推算（官方锚点 + 局部开奖日增量）。
 *
 * ⚠️ 不能从元旦累计推算——彩票市场每年春节休市约 10 天、国庆休市 4 天，
 * 两彩种被扣减的期数不同。正确做法：以官方公告的真实 (日期, 期号) 为锚点，
 * 目标日期与锚点之间的**开奖日**数量做增量；「开奖日」已内建休市日历
 * （见 MARKET_CLOSED_RANGES），因此跨春节/国庆也无需换锚点。
 * 若某期同步到与推算不符的官方期号，仍以真实同步数据为准更新锚点。
 *
 * 官方锚点（2026-08 经多源核实）：
 * - ssq：2026-08-18 = 2026095（福彩官网 cwl.gov.cn）
 * - dlt：2026-08-17 = 2026093（体彩官方公告）
 */
const ISSUE_ANCHORS: Record<LotteryType, { date: string; period: string }> = {
  ssq: { date: '2026-08-18', period: '2026095' },
  dlt: { date: '2026-08-17', period: '2026093' },
};

/** 由开奖日期推算期号（锚点 + 开奖日增量，可前推可后推） */
export function issueOfDate(type: LotteryType, date: Date): string {
  const anchor = ISSUE_ANCHORS[type];
  const [ay, am, ad] = anchor.date.split('-').map(Number);
  const cursor = new Date(ay, am - 1, ad); // 锚点日期（本地零点）
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const baseIssueNo = Number(anchor.period.slice(4)); // 期数部分（095 / 093）

  let delta = 0;
  if (target >= cursor) {
    cursor.setDate(cursor.getDate() + 1);
    while (cursor <= target) {
      if (isDrawDayOfType(cursor, type)) delta++;
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    while (cursor > target) {
      cursor.setDate(cursor.getDate() - 1);
      if (isDrawDayOfType(cursor, type)) delta--;
    }
  }
  return `${target.getFullYear()}${String(baseIssueNo + delta).padStart(3, '0')}`;
}

/** 某月（含今日截断）某彩种的开奖期数（statistics.monthTotalPeriods 用） */
export function countDrawDatesInMonth(
  year: number,
  month: number, // 1-12
  type: LotteryType,
  until: Date,
): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month - 1, day);
    if (d > until) break; // 只统计到今天（本月尚未开奖的期不计入已购/总数口径按需求）
    if (isDrawDayOfType(d, type)) count++;
  }
  return count;
}

/** 票据状态 → 前端中文展示态（对齐 pages/ledger/ledger.js STATUS_CLASS） */
export const TICKET_STATUS_CN: Record<string, string> = {
  pending: '待开奖',
  drawn: '待兑奖',
  redeemed: '已兑奖',
  not_win: '未中奖',
};

/** 校验一注号码是否符合彩种规则；返回规范化后的两位字符串数组，不合法抛错 */
export function validateBalls(
  type: LotteryType,
  red: string[] | number[],
  blue: string[] | number[],
): { red: string[]; blue: string[] } {
  const rule = LOTTERY_RULES[type];
  const norm = (list: string[] | number[], max: number) =>
    [...new Set(list.map((x) => String(Number(x)).padStart(2, '0')))].sort();

  const normRed = norm(red, rule.redMax);
  const normBlue = norm(blue, rule.blueMax);

  if (normRed.length !== rule.redCount) {
    throw new ApiException(40001, `${rule.redLabel}需为 ${rule.redCount} 个不重复号码`);
  }
  if (normBlue.length !== rule.blueCount) {
    throw new ApiException(40001, `${rule.blueLabel}需为 ${rule.blueCount} 个不重复号码`);
  }
  const inRange = (v: string, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= max;
  };
  if (!normRed.every((v) => inRange(v, rule.redMax))) {
    throw new ApiException(40001, `${rule.redLabel}号码范围 01-${rule.redMax}`);
  }
  if (!normBlue.every((v) => inRange(v, rule.blueMax))) {
    throw new ApiException(40001, `${rule.blueLabel}号码范围 01-${rule.blueMax}`);
  }
  return { red: normRed, blue: normBlue };
}
