import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DrawSyncService } from '../modules/lottery/draw-sync.service';

/**
 * 开奖同步任务（文档 §10.2）：
 * 每天凌晨 1 点同步"前一日及之前"最近一期已开奖（含开奖号码 + 奖池 + 期号推进）。
 * 开奖在晚上（21:15/21:25），次日凌晨同步最保险——所有期都开完了，绝无竞态。
 * timeZone 为代码层兜底（文档 §10.1 时区三层保障）。
 */
@Injectable()
export class DrawSyncJob {
  private readonly logger = new Logger(DrawSyncJob.name);

  constructor(private readonly drawSync: DrawSyncService) {}

  /** 每天凌晨 1 点：双色球 */
  @Cron('0 0 1 * * *', { timeZone: 'Asia/Shanghai' })
  async syncSsq() {
    try {
      await this.drawSync.syncLatestDraw('ssq');
    } catch (err) {
      this.logger.warn(`双色球开奖同步失败: ${(err as Error).message}`);
    }
  }

  /** 每天凌晨 1 点：大乐透 */
  @Cron('0 0 1 * * *', { timeZone: 'Asia/Shanghai' })
  async syncDlt() {
    try {
      await this.drawSync.syncLatestDraw('dlt');
    } catch (err) {
      this.logger.warn(`大乐透开奖同步失败: ${(err as Error).message}`);
    }
  }

  /** 每 5 分钟：期号推进检查 */
  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: 'Asia/Shanghai' })
  async refreshStatus() {
    try {
      await this.drawSync.refreshStatus();
    } catch (err) {
      this.logger.warn(`状态刷新失败: ${(err as Error).message}`);
    }
  }
}
