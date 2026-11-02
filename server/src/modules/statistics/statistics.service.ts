import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { fmtMoney } from '../../common/format';
import { utcDate } from '../../common/date-utc';
import { normalizeIssue } from '../../common/issue';
import { countDrawDatesInMonth, LotteryType } from '../lottery/lottery-rules';

/**
 * 首页购彩统计（文档 §8.3.12）：按用户默认彩种统计本月数据。
 */
@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly user: UserService,
  ) {}

  async getStatistics(userId: bigint) {
    const now = new Date();
    const cfg = await this.user.getRawConfig(userId);
    const lotteryType = (cfg?.lotteryType as LotteryType) ?? 'ssq';

    // 本月该彩种开奖期数（截至今天）
    const monthTotalPeriods = countDrawDatesInMonth(
      now.getFullYear(),
      now.getMonth() + 1,
      lotteryType,
      now,
    );

    // 本月用户参与期数（drawDate 落在本月，period 去重；日期边界用 UTC 零点对齐 DATE 列）。
    // 2026-08-25 修复：统计范围改为用户**全部彩种**（原只统计默认彩种，用户录了大乐透票
    // 但默认配置双色球时，大乐透中奖不计入首页统计，误以为"要兑奖才更新"）。
    const monthStart = utcDate(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEnd = utcDate(now.getFullYear(), now.getMonth() + 2, 1);
    const tickets = await this.prisma.ticket.findMany({
      where: {
        userId,
        drawDate: { gte: monthStart, lt: monthEnd },
      },
      select: {
        lotteryType: true,
        period: true,
        winAmountCent: true,
        prizeLevel: true,
        status: true,
        totalAmountCent: true,
      },
    });
    // 2026-08-28 修复：按「彩种 + 期号」去重——双色球与大乐透期号体系独立，
    // 同期号数值（如 ssq 2026096 与 dlt 2026096）是两个不同开奖，仅按 period 去重会少算。
    const purchasedPeriods = new Set(
      tickets.map((t) => `${t.lotteryType}:${normalizeIssue(t.period)}`),
    ).size;

    // 本月总花费（投入金额，分）
    const totalSpent = tickets.reduce((s, t) => s + (t.totalAmountCent || 0), 0);

    // 本月中奖汇总：中奖次数含浮动奖（一/二等，winAmountCent=0 但 prizeLevel 非空）；
    // 金额仅累计固定奖（浮动奖金额未定，记 0 合理）
    const winTickets = tickets.filter((t) => t.winAmountCent > 0 || t.prizeLevel);
    const winCount = winTickets.length;
    const winTotal = winTickets.reduce((s, t) => s + (t.winAmountCent || 0), 0);
    const monthCaption =
      winCount > 0
        ? `本月中奖 ${winCount} 次 · 累计 ${fmtMoney(winTotal)}`
        : '本月暂无中奖';

    return {
      monthLabel: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`,
      monthTotalPeriods, // 兼容保留（前端已不再展示，2026-08-21 改为三项：已购/花费/中奖）
      purchasedPeriods,
      totalSpent, // 新增：本月总花费（分）
      totalWon: winTotal, // 新增：本月中奖总额（分）
      monthCaption,
    };
  }
}
