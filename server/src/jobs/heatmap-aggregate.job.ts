import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { HeatmapService } from '../modules/heatmap/heatmap.service';

/**
 * 热力图聚合（每小时）：把按日聚合结果写入 HeatmapDailyStat 缓存表。
 * 当前 API 层为实时聚合，此任务作为缓存预写（数据量小，两者等价）。
 */
@Injectable()
export class HeatmapAggregateJob {
  private readonly logger = new Logger(HeatmapAggregateJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly heatmap: HeatmapService,
  ) {}

  @Cron('0 0 * * * *', { timeZone: 'Asia/Shanghai' })
  async aggregate() {
    try {
      const users = await this.prisma.user.findMany({ select: { id: true } });
      for (const u of users) {
        const grouped = await this.prisma.ticket.groupBy({
          by: ['drawDate'],
          where: { userId: u.id, drawDate: { not: null } },
          _sum: { totalAmountCent: true },
          _count: { id: true },
        });
        for (const g of grouped) {
          if (!g.drawDate) continue;
          const amount = g._sum.totalAmountCent ?? 0;
          const level = this.toLevel(amount);
          await this.prisma.heatmapDailyStat.upsert({
            where: { userId_date: { userId: u.id, date: g.drawDate } },
            create: {
              userId: u.id,
              date: g.drawDate,
              level,
              amountCent: amount,
              ticketCount: g._count.id,
            },
            update: { level, amountCent: amount, ticketCount: g._count.id },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`热力图聚合失败: ${(err as Error).message}`);
    }
  }

  private toLevel(cent: number): number {
    if (cent <= 0) return 0;
    if (cent <= 400) return 1;
    if (cent <= 1000) return 2;
    if (cent <= 3000) return 3;
    return 4;
  }
}
