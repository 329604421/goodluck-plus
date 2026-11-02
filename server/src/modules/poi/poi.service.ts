import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import {
  LBS_ENDPOINT,
  LBS_PROVIDER,
  LBS_STATUS_UNAVAILABLE,
  LbsPoi,
  TencentLbsService,
} from '../../integrations/tencent-lbs/tencent-lbs.service';
import { NearbyQueryDto } from './poi.dto';

/**
 * 「附近」后端代理（方案 B，需求 §4.1 / §4.6.7）
 *
 * 解决的问题：一期方案 A 把腾讯位置服务 Key 明文放在小程序代码包里，且缓存只存在于
 * 单台设备的 Storage。二期改为小程序 → `lottery.memorymap.cn/api/poi/nearby` → 腾讯 LBS：
 *   · Key 只存在于服务端 .env（不再随代码包可被反编译）；
 *   · 服务端进程内缓存对**所有设备**生效，换手机 / 清缓存后依然免配额；
 *   · 配额闸门收到服务端，客户端改不了。
 *
 * ⚠️ **兼容契约（最重要的一条）**：返回体必须保持与腾讯响应体同构 ——
 * `status` / `message` / `count` / `data[]`（字段名沿用腾讯原始命名）。
 * 这样前端 `utils/nearby.js` 的 `toStation()`、类型判定、marker 构建、页面层与缓存层
 * **一行都不用改**，只换一个 request 目标（需求 §4.6.7 的预留设计）。
 *
 * 三层保护在二期的分工：
 *   L1 进程内缓存（本文件）  —— 跨设备、跨请求复用，命中即 0 配额
 *   L2 前端 Storage 缓存     —— 仍在（首屏更快，连后端都不用打扰）
 *   L3 日配额闸门（本文件）  —— 服务端权威计数，客户端那层 30 次上限在代理模式下降级为兜底
 */

/** 暴露给前端的完整契约（前端 utils/nearby.js 只认这几个字段） */
export interface NearbyResult {
  /** 0 = 正常；腾讯错误码原样透传；199 = 服务端不可用；120 = 服务端日配额触顶 */
  status: number;
  message: string;
  /** 上游命中的总条数（不是 data.length —— 一页最多 20 条） */
  count: number;
  data: LbsPoi[];
  /** 当日已用 / 上限（与前端自计数无关，服务端权威） */
  used: number;
  limit: number;
  fromCache: 'memory' | false;
  source: 'cache' | 'lbs';
  gridKey: string;
  radius: number;
  keyword: string;
  costMs: number;
}

/** 缓存网格 key：经纬度各保留 precision 位小数（3 位 ≈ 100 米），避免坐标抖动导致永不命中 */
export function gridKeyOf(latitude: number, longitude: number, precision = 3): string {
  return `${Number(latitude).toFixed(precision)}_${Number(longitude).toFixed(precision)}`;
}

/**
 * 缓存 key = 网格 + 半径。
 *
 * ⚠️ **radius 必须进 key**（2026-09-15 V1.10 起）：检索半径现在跟随小程序端的地图视野，
 *    同一网格在不同缩放级别下半径不同。共用 key 会让「放大到 300 米」拿到「1 公里那次」
 *    的结果 —— 前端表现就是本功能最典型的 bug：提示搜到了 N 个网点，屏幕里一个标记都没有。
 *
 * 与前端 `utils/nearby.js` 的 `cacheKeyOf()` 是**同一套拼法**，改一处必须同步改另一处。
 */
export function cacheKeyOf(gridKey: string, radius: number): string {
  return `${gridKey}@${radius}`;
}

/** 当日零点（服务器本地时区 = Asia/Shanghai，与 @Cron 的 timeZone 一致）
 *
 *  注意：这里**不用** common/date-utc.ts —— 那套是给 Prisma 的 DATE 列（日期键）用的。
 *  external_call_logs.created_at 是 TIMESTAMP，按本地零点切分才符合「今日用量」的直觉。
 */
export function startOfLocalDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 按 POI id 去重（auto_extend 扩大范围时边界会重叠）—— 保留先到的（更近的）那条 */
export function dedupeById(list: LbsPoi[]): LbsPoi[] {
  const seen = new Set<string>();
  const out: LbsPoi[] = [];
  for (const item of list) {
    const key = item.id || `${item.location.lat}_${item.location.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

@Injectable()
export class PoiService {
  private readonly logger = new Logger(PoiService.name);

  /** L1 进程内缓存：cacheKey（网格@半径）→ 结果。容量与 TTL 都走 config */
  private readonly cache = new Map<string, { ts: number; count: number; data: LbsPoi[] }>();

  constructor(
    private readonly config: ConfigService,
    private readonly lbs: TencentLbsService,
    private readonly prisma: PrismaService,
  ) {}

  /** 附近彩票网点检索 —— 本功能唯一的业务入口 */
  async getNearby(query: NearbyQueryDto): Promise<NearbyResult> {
    const latitude = Number(query.lat);
    const longitude = Number(query.lng);
    const precision = this.config.get<number>('poiGridPrecision') ?? 3;
    const gridKey = gridKeyOf(latitude, longitude, precision);
    const limit = this.config.get<number>('poiDailyLimit') ?? 100;
    const radius = query.radius ?? this.lbs.defaults().radius;
    const keyword = this.lbs.defaults().keyword;
    const cacheKey = cacheKeyOf(gridKey, radius);

    // ---- L1 进程内缓存（跨设备生效，命中即 0 配额）----
    const cached = this.readCache(cacheKey);
    if (cached) {
      return {
        status: 0,
        message: 'cache hit',
        count: cached.count,
        data: cached.data,
        used: await this.usedToday(),
        limit,
        fromCache: 'memory',
        source: 'cache',
        gridKey,
        radius,
        keyword,
        costMs: 0,
      };
    }

    // 未配置 Key：明确报错，且**不记账**（根本没发请求，不该占用日配额计数）
    if (!this.lbs.enabled) {
      return {
        status: LBS_STATUS_UNAVAILABLE,
        message: '服务端未配置 TENCENT_LBS_KEY，无法检索附近网点',
        count: 0,
        data: [],
        used: await this.usedToday(),
        limit,
        fromCache: false,
        source: 'lbs',
        gridKey,
        radius,
        keyword,
        costMs: 0,
      };
    }

    // ---- L3 服务端日配额闸门（客户端绕不过）----
    const usedBefore = await this.usedToday();
    if (usedBefore >= limit) {
      this.logger.warn(`当日地点检索已达上限 ${limit} 次，拒绝向腾讯发起请求`);
      return {
        // 复用腾讯的配额错误码 120：前端 QUOTA_STATUS 已把它分流到「今日查询次数已用完」浮层
        status: 120,
        message: '今日查询次数已用完',
        count: 0,
        data: [],
        used: usedBefore,
        limit,
        fromCache: false,
        source: 'lbs',
        gridKey,
        radius,
        keyword,
        costMs: 0,
      };
    }

    // ---- 真实请求（消耗 1 次配额）----
    const res = await this.lbs.searchNearby({ latitude, longitude, radius, keyword });

    // 台账（同时是配额计数器）：**只有真的发出请求才记账**，成功与失败都记
    await this.logCall({
      status: res.status,
      costMs: res.costMs,
      request: { latitude, longitude, radius, keyword, gridKey },
      response: { status: res.status, count: res.count, message: res.message, costMs: res.costMs },
    });

    // 记账后重新取真实值：并发请求下 usedBefore + 1 会偏小
    const used = await this.usedToday();

    if (res.status === 0) {
      const data = dedupeById(res.data);
      const count = res.count || data.length;
      this.writeCache(cacheKey, count, data);
      return {
        status: 0,
        message: res.message || 'ok',
        count,
        data,
        used,
        limit,
        fromCache: false,
        source: 'lbs',
        gridKey,
        radius,
        keyword,
        costMs: res.costMs,
      };
    }

    // 失败**不写缓存**：否则一次 Key/配额错误会被固化 24 小时，越查越糟
    return {
      status: res.status,
      message: res.message,
      count: 0,
      data: [],
      used,
      limit,
      fromCache: false,
      source: 'lbs',
      gridKey,
      radius,
      keyword,
      costMs: res.costMs,
    };
  }

  /* ==================== 缓存 ==================== */

  private cacheTtlMs(): number {
    return (this.config.get<number>('poiCacheTtlHours') ?? 24) * 3600 * 1000;
  }

  private readCache(cacheKey: string): { ts: number; count: number; data: LbsPoi[] } | null {
    const rec = this.cache.get(cacheKey);
    if (!rec) return null;
    if (Date.now() - rec.ts > this.cacheTtlMs()) {
      this.cache.delete(cacheKey);
      return null;
    }
    // 命中即移到 Map 末尾 → Map 的插入顺序近似 LRU，淘汰时删的确实是最冷的那个
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, rec);
    return rec;
  }

  private writeCache(cacheKey: string, count: number, data: LbsPoi[]): void {
    const max = this.config.get<number>('poiCacheMaxEntries') ?? 200;
    if (!this.cache.has(cacheKey) && this.cache.size >= max) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, { ts: Date.now(), count, data });
  }

  /** 仅供自检脚本断言缓存行为 */
  cacheSize(): number {
    return this.cache.size;
  }

  /* ==================== 配额台账 ==================== */

  /**
   * 当日已发起的地点检索次数（服务端权威计数）。
   * 用 external_call_logs 行数代替新建计数表 —— 该表已有 (provider, createdAt) 索引，
   * 且本来就要写调用台账，**无需为此加一张表、跑一次线上迁移**。
   *
   * 记账表不可用时返回 0（放行）而不是抛错：这是个人自用应用，
   * 「日志表故障导致附近功能整体不可用」比「少数请求没被计数」更糟。
   */
  private async usedToday(): Promise<number> {
    try {
      return await this.prisma.externalCallLog.count({
        where: { provider: LBS_PROVIDER, createdAt: { gte: startOfLocalDay() } },
      });
    } catch (err) {
      this.logger.warn(`读取当日检索用量失败（本次放行）: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }

  private async logCall(entry: {
    status: number;
    costMs: number;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.externalCallLog.create({
        data: {
          provider: LBS_PROVIDER,
          endpoint: LBS_ENDPOINT,
          status: entry.status === 0 ? 'ok' : 'error',
          costMs: entry.costMs,
          // Json 列：本项目既有约定用 `as object`（见 user.service.ts / recommend.service.ts）
          request: entry.request as object,
          response: entry.response as object,
        },
      });
    } catch (err) {
      // 记台账失败不能影响主流程（此时本次调用已发生，配额靠 count 兜底会少算一次，
      // 属可接受偏差：宁可少算也不让用户看到「功能坏了」）
      this.logger.warn(`写入外部调用台账失败: ${err instanceof Error ? err.message : err}`);
    }
  }
}
