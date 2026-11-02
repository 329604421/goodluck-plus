import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fmtDate } from '../../common/format';
import { utcDate } from '../../common/date-utc';

/**
 * 热力图服务（文档 §9.7）：个人数据量级小，直接实时聚合 tickets
 * （HeatmapDailyStat 表保留作缓存扩展，聚合 job 默认不启用）。
 * 等级阈值：L1 ≤¥4 / L2 ≤¥10 / L3 ≤¥30 / L4 >¥30（对齐前端 5 阶色板，¥50+ 文案不变）。
 *
 * draws 字段（2026-08-19 新增）：按开奖日期反查 draw_results，
 * 修复日历格子期号/号码与日期错位（此前前端取的是"当前期"lottery_status）。
 */
@Injectable()
export class HeatmapService {
  constructor(private readonly prisma: PrismaService) {}

  async getHeatmap(userId: bigint, weeks = 12) {
    const now = new Date();
    // UTC 日期边界（DATE 列按 UTC 日期存取）
    const start = utcDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    start.setUTCDate(start.getUTCDate() - weeks * 7 - 6);

    // 日历可视终点 = 本周日（与前端 buildHeatmap 的 endSunday 口径一致）。
    // 2026-08-24 修复：原 lte:now 排除"开奖日 > 今天"的票据（用户常买后天才开奖的票），
    // 导致未来期在日历上不着色；现在本周内开奖的票正常着色。
    // 2026-08-28 修复：原公式 (6 - getUTCDay()) 实际算出的是"本周六"（周五+1/周六+0），
    // 本周日（如 8/30）的票被排除不着色；改为 ((7 - day) % 7) 精确对齐本周日。
    const todayUtc = utcDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const endSunday = utcDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    endSunday.setUTCDate(endSunday.getUTCDate() + ((7 - todayUtc.getUTCDay()) % 7));

    // 1. 购彩金额聚合（个人数据量级小，实时聚合）
    const tickets = await this.prisma.ticket.groupBy({
      by: ['drawDate'],
      where: { userId, drawDate: { gte: start, lte: endSunday } },
      _sum: { totalAmountCent: true },
      _count: { id: true },
    });

    // 2. 开奖信息：按开奖日期反查 draw_results（期号与开奖日期一一对应，无歧义）
    const draws = await this.prisma.drawResult.findMany({
      where: { drawDate: { gte: start, lte: endSunday } },
      select: {
        lotteryType: true,
        period: true,
        drawDate: true,
        redBalls: true,
        blueBalls: true,
      },
      orderBy: { drawDate: 'asc' },
    });

    const amounts: Record<string, number> = {};
    for (const row of tickets) {
      if (!row.drawDate) continue;
      const cent = row._sum.totalAmountCent ?? 0;
      // Prisma 读回 UTC 零点（本地化 +08 后仍在当日），直接格式化
      amounts[fmtDate(row.drawDate)] = this.toLevel(cent);
    }

    const drawMap: Record<string, { lotteryType: string; period: string; red: string[]; blue: string[] }> = {};
    for (const d of draws) {
      if (!d.drawDate) continue;
      const periodText = /^第/.test(d.period) ? d.period : `第 ${d.period} 期`;
      drawMap[fmtDate(d.drawDate)] = {
        lotteryType: d.lotteryType,
        period: periodText,
        red: (d.redBalls as string[]) ?? [],
        blue: (d.blueBalls as string[]) ?? [],
      };
    }

    return {
      weeks,
      amounts,
      draws: drawMap,
      legend: { min: '¥0', max: '¥50+' },
    };
  }

  /** 分 → 热力等级 0-4 */
  private toLevel(cent: number): number {
    if (cent <= 0) return 0;
    if (cent <= 400) return 1; // 1~2 注（¥2-4）
    if (cent <= 1000) return 2; // 中额（¥6-10）
    if (cent <= 3000) return 3; // 较大（¥12-30）
    return 4; // ≥¥50 文案档，实际 ¥30+ 归最深层（超过仍为 L4）
  }
}
