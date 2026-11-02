import { Module } from '@nestjs/common';
import { LotteryService } from './lottery.service';
import { DrawSyncService } from './draw-sync.service';
import { VolcengineModule } from '../../integrations/volcengine.module';
import { RedeemModule } from '../redeem/redeem.module';

@Module({
  imports: [VolcengineModule, RedeemModule],
  providers: [LotteryService, DrawSyncService],
  exports: [LotteryService, DrawSyncService],
})
export class LotteryModule {}
