import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { RedeemService } from '../../modules/redeem/redeem.service';
import { RedeemConfirmDto } from '../../modules/ticket/ticket.dto';

@Controller('api/redeem')
export class RedeemController {
  constructor(private readonly redeem: RedeemService) {}

  @Get('pending')
  async pending(@Req() req: { userId: bigint }) {
    return this.redeem.getPendingList(req.userId);
  }

  /** POST /api/redeem/confirm：待兑奖 → 已兑奖（body 传 id 或 ticketId） */
  @Post('confirm')
  async confirm(@Req() req: { userId: bigint }, @Body() dto: RedeemConfirmDto) {
    return this.redeem.confirm(req.userId, dto);
  }
}
