import { Module } from '@nestjs/common';
import { LotteryModule } from '../modules/lottery/lottery.module';
import { RedeemModule } from '../modules/redeem/redeem.module';
import { HeatmapModule } from '../modules/heatmap/heatmap.module';
import { DrawSyncJob } from './draw-sync.job';
import { RedeemComputeJob } from './redeem-compute.job';
import { HeatmapAggregateJob } from './heatmap-aggregate.job';
import { CleanupJob } from './cleanup.job';

@Module({
  imports: [LotteryModule, RedeemModule, HeatmapModule],
  providers: [DrawSyncJob, RedeemComputeJob, HeatmapAggregateJob, CleanupJob],
})
export class JobsModule {}
