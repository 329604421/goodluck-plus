import { Module } from '@nestjs/common';
import { RecommendService } from './recommend.service';
import { VolcengineModule } from '../../integrations/volcengine.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [VolcengineModule, UserModule],
  providers: [RecommendService],
  exports: [RecommendService],
})
export class RecommendModule {}
