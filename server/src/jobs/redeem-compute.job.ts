import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RedeemService } from '../modules/redeem/redeem.service';

/** 兑奖预计算兜底：每 15 分钟对已开奖未计算的 pending 票据重算（幂等） */
@Injectable()
export class RedeemComputeJob {
  private readonly logger = new Logger(RedeemComputeJob.name);

  constructor(private readonly redeem: RedeemService) {}

  @Cron('0 */15 * * * *', { timeZone: 'Asia/Shanghai' })
  async compute() {
    try {
      await this.redeem.computeAllPending();
    } catch (err) {
      this.logger.warn(`兑奖计算失败: ${(err as Error).message}`);
    }
  }
}
