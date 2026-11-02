import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PoiService } from './poi.service';
import { TencentLbsModule } from '../../integrations/tencent-lbs/tencent-lbs.module';

/**
 * 「附近」POI 业务模块（二期后端代理）。
 * PrismaModule 是 @Global()，PoiService 直接注入 PrismaService 即可（与其它模块一致）。
 */
@Module({
  imports: [ConfigModule, TencentLbsModule],
  providers: [PoiService],
  exports: [PoiService],
})
export class PoiModule {}
