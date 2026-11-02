import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/** 每日清理：过旧推荐缓存（默认 7 天）与外部调用日志（30 天） */
@Injectable()
export class CleanupJob {
  private readonly logger = new Logger(CleanupJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 0 3 * * *', { timeZone: 'Asia/Shanghai' })
  async cleanRecommendCache() {
    const days = this.config.get<number>('recommendCacheDays') ?? 7;
    const before = new Date(Date.now() - days * 86400000);
    const r = await this.prisma.recommendationCache.deleteMany({
      where: { recommendDate: { lt: before } },
    });
    this.logger.log(`清理 ${r.count} 条过期推荐缓存`);
  }

  @Cron('0 0 4 * * *', { timeZone: 'Asia/Shanghai' })
  async cleanCallLogs() {
    const before = new Date(Date.now() - 30 * 86400000);
    const r = await this.prisma.externalCallLog.deleteMany({
      where: { createdAt: { lt: before } },
    });
    this.logger.log(`清理 ${r.count} 条外部调用日志`);
  }
}
