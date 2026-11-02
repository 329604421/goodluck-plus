import { Module } from '@nestjs/common';
import { RedeemService } from './redeem.service';

@Module({
  providers: [RedeemService],
  exports: [RedeemService],
})
export class RedeemModule {}
