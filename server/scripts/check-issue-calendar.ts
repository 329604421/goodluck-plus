/**
 * 期号推算回归用例（2026-10-07 休市日历事故修复时建立）。
 *
 * 为什么必须有这份用例：期号推算一旦偏一期，会同时引发
 * ① 未开奖的票被旧开奖记录提前结算；② 定时同步去抓尚未开奖的期而写入脏号码。
 * 事故正是如此发生的（2026 国庆休市 10-01~10-04 未被扣除 → 期号领先 1~2 期）。
 *
 * 运行：cd backend && ./node_modules/.bin/tsx scripts/check-issue-calendar.ts
 * 每年财政部公告次年休市安排后，更新 lottery-rules.ts 的 MARKET_CLOSED_RANGES
 * 并在此补充该年度的对照用例。
 */
import {
  issueOfDate,
  isDrawDayOfType,
  isMarketClosed,
  nextDrawDate,
} from '../src/modules/lottery/lottery-rules';
import type { LotteryType } from '../src/modules/lottery/lottery-rules';

function d(s: string): Date {
  const [y, m, dd] = s.split('-').map(Number);
  return new Date(y, m - 1, dd);
}

let pass = 0;
let fail = 0;

function check(desc: string, actual: unknown, expect: unknown): void {
  const ok = String(actual) === String(expect);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${desc}  实际=${actual}  期望=${expect}`);
}

console.log('=== 1. 锚点自校验 ===');
check('ssq 锚点 2026-08-18', issueOfDate('ssq', d('2026-08-18')), '2026095');
check('dlt 锚点 2026-08-17', issueOfDate('dlt', d('2026-08-17')), '2026093');

console.log('\n=== 2. 休市日期识别 (2026 国庆 10-01~10-04 / 春节 02-14~02-23) ===');
check('10-03 休市', isMarketClosed(d('2026-10-03')), true);
check('10-05 非休市', isMarketClosed(d('2026-10-05')), false);
check('02-20 休市', isMarketClosed(d('2026-02-20')), true);
check('02-24 非休市', isMarketClosed(d('2026-02-24')), false);

console.log('\n=== 3. 休市日不算开奖日 ===');
check('10-03(六) 大乐透', isDrawDayOfType(d('2026-10-03'), 'dlt'), false);
check('10-01(四) 双色球', isDrawDayOfType(d('2026-10-01'), 'ssq'), false);
check('10-04(日) 双色球', isDrawDayOfType(d('2026-10-04'), 'ssq'), false);
check('10-05(一) 大乐透', isDrawDayOfType(d('2026-10-05'), 'dlt'), true);

console.log('\n=== 4. 期号推算 vs 官方期号（关键回归）===');
const official: Array<[string, LotteryType, string]> = [
  ['2026-09-30', 'dlt', '2026112'],
  ['2026-10-05', 'dlt', '2026113'],
  ['2026-10-07', 'dlt', '2026114'],
  ['2026-10-10', 'dlt', '2026115'],
  ['2026-09-29', 'ssq', '2026113'],
  ['2026-10-06', 'ssq', '2026114'],
  ['2026-10-08', 'ssq', '2026115'],
];
for (const [date, type, expect] of official) {
  check(`${type} ${date}`, issueOfDate(type, d(date)), expect);
}

console.log('\n=== 5. nextDrawDate（含当日）===');
const now = d('2026-10-07');
const nd = nextDrawDate(now, 'dlt');
check(
  '从 10-07 起下一个大乐透开奖日',
  `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`,
  '2026-10-07',
);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail > 0 ? 1 : 0;
