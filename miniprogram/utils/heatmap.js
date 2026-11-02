/**
 * utils/heatmap.js - 购彩日历热力图（GitHub 贡献图式动态算法）
 *
 * 标准写法：输入日期范围（endDate=今天，往前 N 周），按「自然周」动态分列，
 * 列数随日期浮动（约 12±1），月份标签自动定位到每月起始列。
 *
 * 业务语义：
 * - 行 = 开奖日（周一/二/三/四/六/日，6 行；周五不开奖跳过）
 * - 列 = 周；每格 = 一期开奖
 * - 本周尚未开奖的期数自动为 L0（待开奖，制造"待补齐"缺口）
 */

// 开奖日 getDay() 值 → 行序（固定 6 行）
const DRAW_DAYS = [1, 2, 3, 4, 6, 0];

// 行标签（与 config.drawDays 保持一致）
const ROW_LABELS = [
  { day: '一', type: 'dlt' },
  { day: '二', type: 'ssq' },
  { day: '三', type: 'dlt' },
  { day: '四', type: 'ssq' },
  { day: '六', type: 'dlt' },
  { day: '日', type: 'ssq' }
];

// 取某日期所在周的周一（周一为一周起点）
function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=周日 ... 6=周六
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// 格式化 YYYY-MM-DD
function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 构建热力图
// @param {Object} opts
//   weeks   - 可视周数（默认 12）
//   end     - 结束日期（默认今天）
//   getLevel- (dateStr) => 0~4 金额等级（后端按日期返回）
// @returns { cols, rows, rowLabels, cells, monthLabels, gridWidth }
//   cells       - 行主序平铺（每行 cols 个，6 行）
//   monthLabels - [{ col, text, left }] 每月起始列（left 为 rpx 偏移，含跨年格式）
//   gridWidth   - 网格总宽（rpx，随列数浮动）
function buildHeatmap({ weeks = 12, end = new Date(), getLevel = () => 0 } = {}) {
  const endDate = new Date(end);
  const endSunday = mondayOf(endDate);
  endSunday.setDate(endSunday.getDate() + 6);

  // 起点：end 往前 (weeks-1) 周，再对齐到所在周周一
  const start = new Date(endDate);
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const startMonday = mondayOf(start);

  // 动态列数：从 startMonday 到 endSunday 覆盖的自然周数（11~13 浮动）
  const spanDays = Math.round((endSunday - startMonday) / 86400000);
  const cols = Math.floor(spanDays / 7) + 1;

  const cellsByRow = Array.from({ length: ROW_LABELS.length }, () => []);
  const monthLabels = [];
  let prevMonth = null;
  let prevYear = null;

  for (let c = 0; c < cols; c++) {
    const weekStart = new Date(startMonday);
    weekStart.setDate(startMonday.getDate() + c * 7);

    // 6 个开奖日格子，先按行暂存，最后再按“行主序”平铺
    for (let r = 0; r < 6; r++) {
      const d = new Date(weekStart);
      const offset = DRAW_DAYS[r] === 0 ? 6 : DRAW_DAYS[r] - 1;
      d.setDate(weekStart.getDate() + offset);
      const dateStr = fmt(d);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;

      // 月份标签：按时间顺序找到“该月第一个开奖日”所在列
      if (year !== prevYear || month !== prevMonth) {
        const text = (prevMonth !== null && month === 1 && year !== prevYear)
          ? `${String(year).slice(2)}年1月`
          : `${month}月`;
        monthLabels.push({ col: c, text });
        prevMonth = month;
        prevYear = year;
      }

      // 未来日期格子（本周未开奖）：有购彩数据则正常着色（用户常买明天/后天开奖的票），
      // 无购彩数据才保持 L0 待开奖（制造"本周还差 N 期"缺口）。2026-08-24 修复。
      const isFuture = d > endDate;
      cellsByRow[r].push({
        id: `r${r}c${c}`,
        date: dateStr,
        level: getLevel(dateStr) || 0,
        isFuture
      });
    }
  }

  const cells = cellsByRow.reduce((result, rowCells) => result.concat(rowCells), []);

  // 网格总宽：cols × 19px + (cols-1) × 4px 间隙 → rpx（格子间距保持 8rpx 不变）
  const CELL = 38;   // 19px = 38rpx
  const GAP = 8;     // 4px = 8rpx
  const gridWidth = cols * CELL + (cols - 1) * GAP;

  return { cols, rows: ROW_LABELS.length, rowLabels: ROW_LABELS, cells, monthLabels, gridWidth };
}

module.exports = { buildHeatmap, mondayOf, fmt, DRAW_DAYS, ROW_LABELS };
