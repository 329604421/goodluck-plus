import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { VolcengineModule } from './integrations/volcengine.module';
import { TencentLbsModule } from './integrations/tencent-lbs/tencent-lbs.module';
import { LunarModule } from './modules/lunar/lunar.module';
import { DeviceTokenGuard } from './common/device-token.guard';
import { TransformInterceptor } from './common/transform.interceptor';
import { HttpExceptionFilter } from './common/http-exception.filter';

// 业务模块
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { TicketModule } from './modules/ticket/ticket.module';
import { LotteryModule } from './modules/lottery/lottery.module';
import { RedeemModule } from './modules/redeem/redeem.module';
import { RecommendModule } from './modules/recommend/recommend.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { HeatmapModule } from './modules/heatmap/heatmap.module';
import { PoiModule } from './modules/poi/poi.module';
import { JobsModule } from './jobs/jobs.module';

// 控制器
import { HealthController } from './api/v1/health.controller';
import { AuthController } from './api/v1/auth.controller';
import { UserController } from './api/v1/user.controller';
import { TicketController } from './api/v1/ticket.controller';
import { LotteryController } from './api/v1/lottery.controller';
import { RedeemController } from './api/v1/redeem.controller';
import { RecommendController } from './api/v1/recommend.controller';
import { StatisticsController } from './api/v1/statistics.controller';
import { HeatmapController } from './api/v1/heatmap.controller';
import { LunarController } from './api/v1/lunar.controller';
import { PoiController } from './api/v1/poi.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    VolcengineModule,
    TencentLbsModule,
    LunarModule,
    AuthModule,
    UserModule,
    TicketModule,
    LotteryModule,
    RedeemModule,
    RecommendModule,
    StatisticsModule,
    HeatmapModule,
    PoiModule,
    JobsModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    UserController,
    TicketController,
    LotteryController,
    RedeemController,
    RecommendController,
    StatisticsController,
    HeatmapController,
    LunarController,
    PoiController,
  ],
  providers: [
    // 全局设备 Token 鉴权（@Public() 装饰器可跳过）
    { provide: APP_GUARD, useClass: DeviceTokenGuard },
    // 统一响应包装 { code, message, data }
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // 统一异常 → 业务错误码
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
