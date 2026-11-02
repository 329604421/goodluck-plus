import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchInfinityService } from './volcengine/search-infinity.service';
import { VisionService } from './volcengine/vision.service';
import { ArkService } from './volcengine/ark.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SearchInfinityService, VisionService, ArkService],
  exports: [SearchInfinityService, VisionService, ArkService],
})
export class VolcengineModule {}
