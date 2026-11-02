import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { VolcengineModule } from '../../integrations/volcengine.module';
import { LotteryModule } from '../lottery/lottery.module';
import { RedeemModule } from '../redeem/redeem.module';

@Module({
  // LotteryModule 提供 DrawSyncService（录入后按开奖日补同步）、RedeemModule 提供 RedeemService（兑奖比对）
  imports: [VolcengineModule, LotteryModule, RedeemModule],
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketModule {}
