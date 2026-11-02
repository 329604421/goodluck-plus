import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { fmtDate, fmtDuration } from '../../common/format';
import { LOTTERY_RULES, LotteryType } from './lottery-rules';
import { DrawSyncService } from './draw-sync.service';

/**
 * 彩种状态与开奖结果查询（文档 §8.3.9 / §8.3.10）：
 * - countdown 响应时实时计算
 * - purchased 按当前用户票据动态计算（不落库）
 */
@Injectable()
export class LotteryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drawSync: DrawSyncService,
  ) {}

  async getStatus(userId: bigint, type: string): Promise<Record<string, unknown>> {
    const t = this.normalizeType(type);
    const rule = LOTTERY_RULES[t];
    const status = await this.prisma.lotteryStatus.findUnique({ where: { lotteryType: t } });

    if (!status) {
      throw new ApiException(40401, `${rule.name}状态未初始化`);
    }

    // purchased：当前用户是否已录入当前期。
    // 2026-08-24 修复：票据 period 可能是 5 位（"26096"，OCR 清洗后）或 7 位（"2026096"），
    // 原精确等值匹配会漏判（大乐透不显示"已购买"）；统一归一化为 7 位后比较。
    const normIssue = (p: string | null | undefined) => String(p ?? '').padStart(7, '20');
    let purchased = 0;
    if (status.currentIssue) {
      const target = normIssue(status.currentIssue);
      const userPending = await this.prisma.ticket.findMany({
        where: { userId, lotteryType: t, status: 'pending' },
        select: { period: true },
      });
      purchased = userPending.some((x) => normIssue(x.period) === target) ? 1 : 0;
    }

    // 当期停售时刻 = 开奖日（本地日期） + 规则停售时间；倒计时以"能否购买"为语义
    const now = new Date();
    const [sh, sm] = rule.saleEndTime.split(':').map(Number);
    const saleEnd = status.drawDate
      ? new Date(
          status.drawDate.getFullYear(),
          status.drawDate.getMonth(),
          status.drawDate.getDate(),
          sh,
          sm,
        )
      : null;
    const isSaleEndToday =
      saleEnd && fmtDate(status.drawDate) === fmtDate(now);

    let countdown = '--';
    if (saleEnd && now < saleEnd) {
      countdown = `距停售 ${fmtDuration(saleEnd.getTime() - now.getTime())}`;
    } else if (saleEnd && isSaleEndToday) {
      countdown = `已停售 · 今晚 ${rule.drawTime} 开奖`;
    } else if (saleEnd) {
      countdown = '已开奖';
    }

    return {
      type: t,
      name: rule.name,
      period: status.periodText ?? (status.currentIssue ? `第 ${status.currentIssue} 期` : ''),
      drawDate: fmtDate(status.drawDate),
      drawTime: rule.drawTime,
      saleEndTime: rule.saleEndTime,
      saleEndAt: saleEnd ? saleEnd.getTime() : null, // 停售时刻毫秒时间戳，前端实时倒计时
      poolAmount: status.prizePoolAmount ?? '--',
      countdown,
      purchased: purchased > 0,
      winningNumbers: (status.winningNumbers as string[] | null) ?? [],
    };
  }

  /** GET /api/lottery/draw：issue 可选，缺省取最新一期 */
  async getDraw(type: string, issue?: string) {
    const t = this.normalizeType(type);
    const rule = LOTTERY_RULES[t];

    const draw = issue
      ? await this.prisma.drawResult.findUnique({
          where: { lotteryType_period: { lotteryType: t, period: issue.replace(/\D/g, '') } },
        })
      : await this.prisma.drawResult.findFirst({
          where: { lotteryType: t },
          orderBy: { period: 'desc' },
        });

    if (!draw) {
      throw new ApiException(40401, issue ? '该期暂未开奖' : '暂无开奖数据');
    }

    return {
      type: t,
      name: rule.name,
      period: `第 ${draw.period} 期`,
      drawDate: fmtDate(draw.drawDate),
      winningNumbers: [
        ...(draw.redBalls as string[]),
        ...(draw.blueBalls as string[]),
      ],
    };
  }

  /** POST /api/lottery/sync：用户端按开奖日期补差同步某一期（转发给 DrawSyncService） */
  async syncDrawByDate(type: LotteryType, date: string) {
    return this.drawSync.syncDrawByDate(type, date);
  }

  private normalizeType(v: string): LotteryType {
    if (v === 'ssq' || v === 'dlt') return v;
    throw new ApiException(40001, 'type 仅支持 ssq/dlt');
  }
}
