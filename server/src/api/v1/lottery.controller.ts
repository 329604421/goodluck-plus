import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { LotteryService } from '../../modules/lottery/lottery.service';
import { SyncDrawDto } from '../../modules/lottery/lottery.dto';

@Controller('api/lottery')
export class LotteryController {
  constructor(private readonly lottery: LotteryService) {}

  /** GET /api/lottery/status?type=ssq */
  @Get('status')
  async status(@Req() req: { userId: bigint }, @Query('type') type: string) {
    return this.lottery.getStatus(req.userId, type);
  }

  /** GET /api/lottery/draw?type=ssq&issue=2024091（issue 可选，缺省最新一期） */
  @Get('draw')
  async draw(@Query('type') type: string, @Query('issue') issue?: string) {
    return this.lottery.getDraw(type, issue);
  }

  /** POST /api/lottery/sync：用户端补差——按开奖日期同步该期开奖结果（幂等） */
  @Post('sync')
  async syncDraw(@Body() dto: SyncDrawDto) {
    return this.lottery.syncDrawByDate(dto.type, dto.date);
  }
}
