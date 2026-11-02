import { Module } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  providers: [StatisticsService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
