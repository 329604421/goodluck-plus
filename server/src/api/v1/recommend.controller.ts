import { Body, Controller, Post, Req } from '@nestjs/common';
import { RecommendService } from '../../modules/recommend/recommend.service';
import { RecommendDto } from '../../modules/ticket/ticket.dto';

@Controller('api/recommend')
export class RecommendController {
  constructor(private readonly recommendService: RecommendService) {}

  /** POST /api/recommend：body { system, lottery, refresh? } */
  @Post()
  async recommend(@Req() req: { userId: bigint }, @Body() dto: RecommendDto) {
    return this.recommendService.recommend(req.userId, dto.system, dto.lottery, dto.refresh);
  }
}
