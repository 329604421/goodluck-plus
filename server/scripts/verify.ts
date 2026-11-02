/** 核心纯函数快速验证（不依赖数据库）：tsx scripts/verify.ts */
import { LOTTERY_RULES, validateBalls, nextDrawDate, countDrawDatesInMonth, issueOfDate } from '../src/modules/lottery/lottery-rules';
import { calcPrize } from '../src/modules/redeem/prize-rules';
import { fmtMoney, fmtDate, fmtCountdown, fmtDateWithWeek } from '../src/common/format';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}

console.log('== 彩种规则 ==');
check('双色球 6红1蓝', LOTTERY_RULES.ssq.redCount === 6 && LOTTERY_RULES.ssq.blueCount === 1);
check('大乐透 5前2后', LOTTERY_RULES.dlt.redCount === 5 && LOTTERY_RULES.dlt.blueCount === 2);

console.log('== 号码校验 ==');
try {
  const r = validateBalls('ssq', ['31', '01', '15', '8', '22', '27'], ['9']);
  check('规范化+排序', r.red[0] === '01' && r.red.includes('08') && r.blue[0] === '09');
} catch { check('规范化+排序', false); }
try { validateBalls('ssq', ['01', '02', '03'], ['09']); check('红球不足报错', false); }
catch (e) { check('红球不足报错', (e as Error).message.includes('6 个')); }
try { validateBalls('ssq', ['01','02','03','04','05','33'], ['17']); check('蓝球越界报错', false); }
catch (e) { check('蓝球越界报错', (e as Error).message.includes('01-16')); }

console.log('== 开奖日历 ==');
const wed = new Date('2026-08-19T00:00:00'); // 周三
check('2026-08-19 是周三', wed.getDay() === 3);
// nextDrawDate 语义：最近的彩票开奖日（含当日）；周三本身即大乐透开奖日
check('周三当日即大乐透开奖日', fmtDate(nextDrawDate(wed, 'dlt')) === '2026-08-19');
check('周三之后下一个双色球日 = 周四(8-20)', fmtDate(nextDrawDate(wed, 'ssq')) === '2026-08-20');
const aug31 = new Date('2026-08-31T00:00:00');
// 2026-08: 周一(3,10,17,24,31)+周三(5,12,19,26)+周六(1,8,15,22,29) = 14 天大乐透
check('2026年8月大乐透开奖 14 期', countDrawDatesInMonth(2026, 8, 'dlt', aug31) === 14);
// 周二(4,11,18,25)+周四(6,13,20,27)+周日(2,9,16,23,30) = 13 天双色球
check('2026年8月双色球开奖 13 期', countDrawDatesInMonth(2026, 8, 'ssq', aug31) === 13);

console.log('== 期号推算（官方锚点 + 开奖日增量；锚点经官方公告核实）==');
// 官方事实：双色球 2026095=08-18、2026094=08-16、2026093=08-13（cwl.gov.cn）
check('ssq 2026-08-18 = 2026095（锚点）', issueOfDate('ssq', new Date('2026-08-18')) === '2026095');
check('ssq 2026-08-16 = 2026094（官方）', issueOfDate('ssq', new Date('2026-08-16')) === '2026094');
check('ssq 2026-08-13 = 2026093（官方）', issueOfDate('ssq', new Date('2026-08-13')) === '2026093');
check('ssq 2026-08-20 = 2026096（下一期）', issueOfDate('ssq', new Date('2026-08-20')) === '2026096');
// 官方事实：大乐透 2026093=08-17（体彩官方公告）
check('dlt 2026-08-17 = 2026093（锚点）', issueOfDate('dlt', new Date('2026-08-17')) === '2026093');
check('dlt 2026-08-19 = 2026094（今晚）', issueOfDate('dlt', new Date('2026-08-19')) === '2026094');
check('dlt 2026-08-22 = 2026095（下一期）', issueOfDate('dlt', new Date('2026-08-22')) === '2026095');
check('dlt 2026-08-15 = 2026092', issueOfDate('dlt', new Date('2026-08-15')) === '2026092');

console.log('== 兑奖规则 ==');
check('双色球 6+1 = 一等奖(浮动)', calcPrize('ssq', 6, 1)?.level === '一等奖' && calcPrize('ssq', 6, 1)?.isFloatPrize);
check('双色球 5+1 = 三等奖 ¥3000', calcPrize('ssq', 5, 1)?.amountCent === 300000);
check('双色球 4+1 = 四等奖 ¥200', calcPrize('ssq', 4, 1)?.amountCent === 20000);
check('双色球 0+1 = 六等奖 ¥5', calcPrize('ssq', 0, 1)?.amountCent === 500);
check('双色球 2+0 = 未中奖', calcPrize('ssq', 2, 0) === null);
check('大乐透 5+2 = 一等奖', calcPrize('dlt', 5, 2)?.level === '一等奖');
check('大乐透 5+0 = 三等奖 ¥10000', calcPrize('dlt', 5, 0)?.amountCent === 1000000);
check('大乐透 0+2 = 八等奖 ¥15', calcPrize('dlt', 0, 2)?.amountCent === 1500);
check('大乐透 3+3 不存在 = 未中奖', calcPrize('dlt', 3, 3) === null);

console.log('== 格式化 ==');
check('300000分 → ¥3,000.00', fmtMoney(300000) === '¥3,000.00');
check('600分 → ¥6.00', fmtMoney(600) === '¥6.00');
const d = new Date('2026-08-19T00:00:00');
check('日期 → 2026-08-19', fmtDate(d) === '2026-08-19');
check('日期带周 → 2026-08-19 周三', fmtDateWithWeek(d) === '2026-08-19 周三');
const target = new Date(Date.now() + 2 * 86400000 + 4 * 3600000 + 23 * 60000);
check(`倒计时格式 → ${fmtCountdown(target)}`, /^0\d 天 \d{2}:\d{2}:\d{2}$/.test(fmtCountdown(target)));

console.log('== 农历 ==');
const { Solar } = require('lunar-javascript');
const lunar = Solar.fromDate(new Date('2026-08-19T12:00:00')).getLunar();
const text = `${lunar.getYearInGanZhi()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
console.log(`  2026-08-19 → ${text}（${lunar.getYearShengXiao()}年）`);
check('农历文案非空', text.length > 5);
check('干支三元组', !!lunar.getYearInGanZhi() && !!lunar.getMonthInGanZhi() && !!lunar.getDayInGanZhi());

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
