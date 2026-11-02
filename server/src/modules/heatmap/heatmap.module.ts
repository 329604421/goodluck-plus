import { Module } from '@nestjs/common';
import { HeatmapService } from './heatmap.service';

@Module({
  providers: [HeatmapService],
  exports: [HeatmapService],
})
export class HeatmapModule {}
