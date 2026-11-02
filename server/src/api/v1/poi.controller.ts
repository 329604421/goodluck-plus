import { Controller, Get, Query } from '@nestjs/common';
import { PoiService } from '../../modules/poi/poi.service';
import { NearbyQueryDto } from '../../modules/poi/poi.dto';

@Controller('api/poi')
export class PoiController {
  constructor(private readonly poi: PoiService) {}

  /**
   * GET /api/poi/nearby?lat=39.908491&lng=116.423545&radius=1000
   *
   * 「附近彩站」页的检索入口（需求 §4.6.7 方案 B）。鉴权走全局 DeviceTokenGuard ——
   * 本接口每次调用都可能消耗腾讯位置服务的计费配额，**不做成 @Public()**。
   *
   * 入参经纬度必须为 GCJ-02（与 wx.getLocation({type:'gcj02'}) 同源），服务端不做坐标转换。
   * 返回体与腾讯地点搜索同构，外层再被 TransformInterceptor 包一层 { code, message, data }。
   */
  @Get('nearby')
  async nearby(@Query() query: NearbyQueryDto) {
    return this.poi.getNearby(query);
  }
}
