import { Controller, Get, Query, Req } from '@nestjs/common';
import { HeatmapService } from '../../modules/heatmap/heatmap.service';

@Controller('api/heatmap')
export class HeatmapController {
  constructor(private readonly heatmap: HeatmapService) {}

  @Get()
  async get(@Req() req: { userId: bigint }, @Query('weeks') weeks?: string) {
    const w = Math.min(24, Math.max(4, Number(weeks) || 12));
    return this.heatmap.getHeatmap(req.userId, w);
  }
}
