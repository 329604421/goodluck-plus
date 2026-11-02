import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 腾讯位置服务（LBS）· 地点搜索集成 —— 「附近」功能二期后端代理（2026-09-15）
 *
 * 依据《小程序附近功能迭代说明_V1.0.md》§4.2（检索接口调用契约）与 §4.6.7（二期接后端代理）：
 *   GET https://apis.map.qq.com/ws/place/v1/search
 *   boundary=nearby(lat,lng,1000,1)    纬度在前；radius 上限 1000m；auto_extend=1
 *   keyword=彩票                        接口只允许 1 个关键词，单词已实测覆盖福彩+体彩
 *   page_size=20&page_index=1&orderby=_distance&added_fields=category_code
 *   坐标体系 GCJ-02 —— 与 wx.getLocation({type:'gcj02'}) 同源，**全链路不做坐标转换**
 *
 * 本类的职责边界（保持单一）：
 *   只负责「拼参数 → 发请求 → 把上游返回体整形成稳定结构」。
 *   缓存、配额、日志台账、去重等业务编排都在 PoiService（modules/poi），不塞进来。
 *
 * 关于错误处理：**上游失败不抛异常**，而是把结果折叠成腾讯自己的 status 语义返回，
 * 这样 PoiService / 前端只认一套 status 分流规则（前端 utils/nearby.js 的 QUOTA_STATUS /
 * KEY_STATUS 分组即为此设计）。本服务只在自己的 Logger 里留痕。
 */

/** 腾讯错误码分组（与前端 `utils/nearby.js` 顶部常量逐一对应，改一处必须同步另一处） */
export const LBS_QUOTA_STATUS = [120, 121, 122, 123]; // 配额类：日上限 / 并发 / 未分配额度
export const LBS_KEY_STATUS = [110, 111, 112, 113]; // Key 类：来源未授权 / 签名 / IP / 功能未授权

/**
 * 服务端自定义状态码：未配置 Key / 上游不可达 / 超时 / 返回体异常。
 * 取 199 是刻意避开腾讯已占用的码段（0 与 110-123），且前端对「其它非 0」统一走
 * 「加载失败 + 重试」浮层 —— 语义正好吻合（详见需求 §3.5 异常态分流表）。
 */
export const LBS_STATUS_UNAVAILABLE = 199;

/** 外部调用台账的 provider 标识（external_call_logs.provider，≤32 字符） */
export const LBS_PROVIDER = 'tencent_lbs';
/** 外部调用台账的 endpoint 标识（external_call_logs.endpoint，≤128 字符） */
export const LBS_ENDPOINT = 'place/v1/search';

/** 单个 POI（字段名沿用腾讯原始命名，前端 `toStation()` 直接消费，无需适配层） */
export interface LbsPoi {
  id: string;
  title: string;
  address: string;
  category: string;
  category_code: number | null;
  location: { lat: number; lng: number };
  /** 直线距离（米，浮点）—— 前端 formatDistance() 做米/公里自适应 */
  _distance: number;
  tel: string;
}

/** 检索结果：**与腾讯响应体同构**（status / message / count / data），只额外补 costMs */
export interface LbsSearchResult {
  status: number;
  message: string;
  count: number;
  data: LbsPoi[];
  costMs: number;
}

export interface LbsSearchOptions {
  latitude: number;
  longitude: number;
  /** 覆盖 config 默认半径（米）；接口上限 1000 */
  radius?: number;
  /** 覆盖 config 默认关键词；一期固定「彩票」，留参数只为将来换数据源时少改一处 */
  keyword?: string;
}

@Injectable()
export class TencentLbsService {
  private readonly logger = new Logger(TencentLbsService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return !!this.config.get<string>('tencentLbsKey');
  }

  /** 供 PoiService 回显参数（诊断用），避免它自己去读一堆 config 键 */
  defaults(): { keyword: string; radius: number; limitRadius: number } {
    return {
      keyword: this.config.get<string>('poiKeyword') ?? '彩票',
      radius: this.config.get<number>('poiRadius') ?? 1000,
      limitRadius: 1000,
    };
  }

  /**
   * 周边检索（本项目唯一使用的地点搜索接口）。
   * 注意：无论成功失败都 resolve，**不 reject** —— 上游异常不是本层的控制流。
   * 调用方（PoiService）据 `status` 决定是否写缓存、是否计入配额。
   */
  async searchNearby(opts: LbsSearchOptions): Promise<LbsSearchResult> {
    const started = Date.now();
    const key = this.config.get<string>('tencentLbsKey') ?? '';
    if (!key) {
      // 不抛错：本地无 Key 也要能让前端拿到「网络失败 + 重试」而不是 50000
      this.logger.warn('未配置 TENCENT_LBS_KEY，跳过地点检索（本地联调可忽略）');
      return this.fail('服务端未配置 TENCENT_LBS_KEY', started);
    }

    const url = this.buildSearchUrl({ ...opts, keyword: opts.keyword });

    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
      if (!res.ok) {
        this.logger.warn(`地点检索 HTTP ${res.status}`);
        return this.fail(`上游 HTTP ${res.status}`, started);
      }
      const body = (await res.json()) as {
        status?: number;
        message?: string;
        count?: number;
        data?: unknown[];
      };
      const status = Number(body?.status);
      const rawList = Array.isArray(body?.data) ? body.data : [];
      const result: LbsSearchResult = {
        status: Number.isFinite(status) ? status : LBS_STATUS_UNAVAILABLE,
        message: String(body?.message ?? ''),
        count: Number(body?.count ?? rawList.length) || 0,
        // 即使 status 非 0 也整形（上游偶发带 data 返回），是否可用由调用方按 status 判
        data: rawList.map((item) => this.normalizePoi(item as Record<string, unknown>)),
        costMs: Date.now() - started,
      };
      if (result.status === 0) {
        this.logger.log(
          `地点检索 ok: (${opts.latitude},${opts.longitude}) 命中 ${result.count} 条 / 返回 ${result.data.length} 条 / ${result.costMs}ms`,
        );
      } else {
        this.logger.warn(
          `地点检索失败: status=${result.status} message=${result.message} (${result.costMs}ms)`,
        );
      }
      return result;
    } catch (err) {
      // 超时 / DNS / 连接被拒等：AbortSignal.timeout 抛 TimeoutError
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`地点检索异常: ${message}`);
      return this.fail(message, started);
    }
  }

  /**
   * 拼装检索 URL —— 与前端 `utils/nearby.js` 的 `buildSearchUrl()` 逐字一致。
   * 改动这里必须同步前端，否则两端行为会漂移（联调时最难查的一类问题）。
   */
  buildSearchUrl(opts: LbsSearchOptions): string {
    const keyword = opts.keyword ?? this.defaults().keyword;
    const radius = Math.min(
      Math.max(Number(opts.radius) || this.defaults().radius, 1),
      this.defaults().limitRadius, // 接口硬上限 1000m，写死在 URL 里比写死在文档里可靠
    );
    const autoExtend = this.config.get<number>('poiAutoExtend') ?? 1;
    const pageSize = Math.min(this.config.get<number>('poiPageSize') ?? 20, 20);
    const base =
      this.config.get<string>('tencentLbsSearchUrl') ??
      'https://apis.map.qq.com/ws/place/v1/search';
    return (
      base +
      `?boundary=nearby(${Number(opts.latitude).toFixed(6)},${Number(opts.longitude).toFixed(6)},${radius},${autoExtend})` +
      `&keyword=${encodeURIComponent(keyword)}` +
      `&page_size=${pageSize}&page_index=1&orderby=_distance&added_fields=category_code` +
      `&key=${this.config.get<string>('tencentLbsKey') ?? ''}`
    );
  }

  private timeoutMs(): number {
    return this.config.get<number>('poiTimeoutMs') ?? 8000;
  }

  private fail(message: string, started: number): LbsSearchResult {
    return {
      status: LBS_STATUS_UNAVAILABLE,
      message,
      count: 0,
      data: [],
      costMs: Date.now() - started,
    };
  }

  /**
   * 原始 POI → 稳定字段集。
   * 只保留前端真正消费的字段（需求 §4.2「响应字段」表），顺手把类型收干净：
   * 上游把 lat/lng 给成 string 的情况真实存在，落到 marker 上会变成字符串坐标。
   * ⚠️ `id` 必须保持**字符串**（32 位 POI id，强转 Number 会丢精度且可能重复）。
   */
  private normalizePoi(raw: Record<string, unknown>): LbsPoi {
    const location = (raw['location'] ?? {}) as Record<string, unknown>;
    const categoryCode = Number(raw['category_code']);
    return {
      id: String(raw['id'] ?? ''),
      title: String(raw['title'] ?? ''),
      address: String(raw['address'] ?? ''),
      category: String(raw['category'] ?? ''),
      category_code: Number.isFinite(categoryCode) ? categoryCode : null,
      location: {
        lat: Number(location['lat']) || 0,
        lng: Number(location['lng']) || 0,
      },
      _distance: Number(raw['_distance']) || 0,
      tel: String(raw['tel'] ?? ''),
    };
  }
}
