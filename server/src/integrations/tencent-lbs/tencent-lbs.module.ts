import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TencentLbsService } from './tencent-lbs.service';

/**
 * 腾讯位置服务（LBS）集成模块。
 * 与 VolcengineModule 同级；后续若接入腾讯系其它能力（逆地址解析等），在此模块内扩展。
 */
@Module({
  imports: [ConfigModule],
  providers: [TencentLbsService],
  exports: [TencentLbsService],
})
export class TencentLbsModule {}
