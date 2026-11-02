import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * GET /api/poi/nearby —— 附近彩票网点查询入参
 *
 * 参数名与需求文档 §4.6.7 预留的写法一致（`?lat=&lng=`），前端只改一个 request 目标即可切过来。
 * 校验要点：
 *   - lat/lng 必须显式转 Number（query 全是字符串，不转的话 @Min/@Max 会拿字符串比较）；
 *   - 经纬度范围卡死，避免把明显错误的坐标透给上游（上游也会报错，但那样会白耗一次配额）；
 *   - `radius` 上限 1000 —— 接口硬约束，超了腾讯直接报错，此处提前拦掉；
 *   - **不允许客户端传 keyword**：关键词固定「彩票」（实测单词覆盖福彩+体彩），
 *     放开就等于把「任意 POI 检索」的口子开在我们的配额上。
 */
export class NearbyQueryDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'lat 必须为数字' })
  @Min(-90, { message: 'lat 超出有效范围（-90 ~ 90）' })
  @Max(90, { message: 'lat 超出有效范围（-90 ~ 90）' })
  lat: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'lng 必须为数字' })
  @Min(-180, { message: 'lng 超出有效范围（-180 ~ 180）' })
  @Max(180, { message: 'lng 超出有效范围（-180 ~ 180）' })
  lng: number;

  /** 检索半径（米），缺省取 config.poiRadius（1000）；上限 1000 为腾讯接口硬约束 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'radius 必须为整数' })
  @Min(1, { message: 'radius 至少为 1 米' })
  @Max(1000, { message: 'radius 上限 1000 米（腾讯地点搜索接口硬约束）' })
  radius?: number;
}
