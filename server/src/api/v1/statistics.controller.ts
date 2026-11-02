import { Controller, Get, Req } from '@nestjs/common';
import { StatisticsService } from '../../modules/statistics/statistics.service';

@Controller('api/statistics')
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get()
  async get(@Req() req: { userId: bigint }) {
    return this.statistics.getStatistics(req.userId);
  }
}
