/**
 * 兑奖规则（2026-08-28 全面升级）
 *
 * 【双色球】六等奖制（无浮动）：一等奖 6+1 / 二等奖 6+0（浮动）；
 *   三等 5+1 ¥3000 / 四等 5+0·4+1 ¥200 / 五等 4+0·3+1 ¥10 / 六等 2+1·1+1·0+1 ¥5。
 *
 * 【大乐透】⚠️ 2026-02-02 起（26014 期）执行新规则（官方公告，500 彩票网/中国体彩网核实）：
 *   - 奖级 9 → 7（原八、九等奖合并降级，中奖条件 13 个不变）；
 *   - 固定奖（三至七等）按开奖时奖池分两档浮动（阈值 8 亿元）；
 *   - 一二等奖仍为浮动奖；0+1、1+1、2+0、1+0 等组合不中奖。
 *   档位判定：该期摇奖前奖池 = 上一期开奖后滚存奖池 ≥ 8 亿 → 'high' 档，否则 'base' 档。
 */

export interface PrizeRule {
  red: number; // 命中红球/前区数
  blue: number; // 命中蓝球/后区数
  amountCent: number | null; // null = 浮动奖金（一/二等奖）
  level: string;
}

/** 大乐透固定奖档位：开奖时奖池 <8 亿 → base；≥8 亿 → high */
export type PoolTier = 'base' | 'high';

/** 大乐透奖池浮动阈值：8 亿元（分） */
export const DLT_POOL_THRESHOLD_CENT = 80_000_000_000;

export const SSQ_PRIZES: PrizeRule[] = [
  { red: 6, blue: 1, amountCent: null, level: '一等奖' },
  { red: 6, blue: 0, amountCent: null, level: '二等奖' },
  { red: 5, blue: 1, amountCent: 300000, level: '三等奖' }, // ¥3,000
  { red: 5, blue: 0, amountCent: 20000, level: '四等奖' }, // ¥200
  { red: 4, blue: 1, amountCent: 20000, level: '四等奖' },
  { red: 4, blue: 0, amountCent: 1000, level: '五等奖' }, // ¥10
  { red: 3, blue: 1, amountCent: 1000, level: '五等奖' },
  { red: 2, blue: 1, amountCent: 500, level: '六等奖' }, // ¥5
  { red: 1, blue: 1, amountCent: 500, level: '六等奖' },
  { red: 0, blue: 1, amountCent: 500, level: '六等奖' },
];

/** 大乐透新规则（2026-02-02 起，26014 期执行）：7 个奖级 + 固定奖奖池浮动两档 */
export const DLT_PRIZES: Record<PoolTier, PrizeRule[]> = {
  // 奖池 <8 亿（基础档）
  base: [
    { red: 5, blue: 2, amountCent: null, level: '一等奖' },
    { red: 5, blue: 1, amountCent: null, level: '二等奖' },
    { red: 5, blue: 0, amountCent: 500000, level: '三等奖' }, // ¥5,000
    { red: 4, blue: 2, amountCent: 500000, level: '三等奖' },
    { red: 4, blue: 1, amountCent: 30000, level: '四等奖' }, // ¥300
    { red: 4, blue: 0, amountCent: 15000, level: '五等奖' }, // ¥150
    { red: 3, blue: 2, amountCent: 15000, level: '五等奖' },
    { red: 3, blue: 1, amountCent: 1500, level: '六等奖' }, // ¥15
    { red: 2, blue: 2, amountCent: 1500, level: '六等奖' },
    { red: 3, blue: 0, amountCent: 500, level: '七等奖' }, // ¥5
    { red: 2, blue: 1, amountCent: 500, level: '七等奖' },
    { red: 1, blue: 2, amountCent: 500, level: '七等奖' },
    { red: 0, blue: 2, amountCent: 500, level: '七等奖' },
  ],
  // 奖池 ≥8 亿（上浮档）
  high: [
    { red: 5, blue: 2, amountCent: null, level: '一等奖' },
    { red: 5, blue: 1, amountCent: null, level: '二等奖' },
    { red: 5, blue: 0, amountCent: 666600, level: '三等奖' }, // ¥6,666
    { red: 4, blue: 2, amountCent: 666600, level: '三等奖' },
    { red: 4, blue: 1, amountCent: 38000, level: '四等奖' }, // ¥380
    { red: 4, blue: 0, amountCent: 20000, level: '五等奖' }, // ¥200
    { red: 3, blue: 2, amountCent: 20000, level: '五等奖' },
    { red: 3, blue: 1, amountCent: 1800, level: '六等奖' }, // ¥18
    { red: 2, blue: 2, amountCent: 1800, level: '六等奖' },
    { red: 3, blue: 0, amountCent: 700, level: '七等奖' }, // ¥7
    { red: 2, blue: 1, amountCent: 700, level: '七等奖' },
    { red: 1, blue: 2, amountCent: 700, level: '七等奖' },
    { red: 0, blue: 2, amountCent: 700, level: '七等奖' },
  ],
};

/** 旧版九等奖制兼容导出（历史数据核对用，不再用于判决） */
export const DLT_PRIZES_LEGACY_2019 = DLT_PRIZES.base;

/**
 * 计算单注中奖结果。
 * 返回 null 表示未中奖；amountCent=0 + level 表示浮动奖金（一/二等奖）。
 * @param poolTier 大乐透固定奖档位（开奖时奖池 ≥8 亿 → 'high'），默认 'base'；双色球忽略
 */
export function calcPrize(
  lotteryType: 'ssq' | 'dlt',
  matchedRed: number,
  matchedBlue: number,
  poolTier: PoolTier = 'base',
): { amountCent: number; level: string; isFloatPrize: boolean } | null {
  const rules = lotteryType === 'ssq' ? SSQ_PRIZES : DLT_PRIZES[poolTier];
  for (const r of rules) {
    if (r.red === matchedRed && r.blue === matchedBlue) {
      return {
        amountCent: r.amountCent ?? 0,
        level: r.level,
        isFloatPrize: r.amountCent === null,
      };
    }
  }
  return null;
}
