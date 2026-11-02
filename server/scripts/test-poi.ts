/**
 * scripts/test-poi.ts —— 「附近」后端代理的自检（开发自检，非交付物）
 *
 * 覆盖需求《小程序附近功能迭代说明_V1.0.md》§4.7 的契约：
 *   · 拼 URL：boundary 纬度在前 / auto_extend / keyword 编码 / radius 夹到 1000 / page_size 上限 20
 *   · 响应整形：字段名与腾讯同构（前端 toStation() 直接消费）、id 保持字符串、坐标转数字
 *   · 上游异常：HTTP 非 2xx / fetch 抛错 / 无 Key → 一律折叠成 status=199，不抛异常
 *   · 缓存：同网格二次请求 0 网络、0 记账；fromCache='memory'
 *   · 缓存键含半径（V1.10）：检索半径跟随地图视野，同网格换半径必须重新检索、不得串数据
 *   · 配额闸门：当日已用 ≥ 上限 → status=120，且**不再向上游发请求**
 *   · 失败不写缓存（否则一次 Key/配额错误会被固化 24 小时）
 *
 * 运行：cd backend && npx tsx scripts/test-poi.ts
 * 说明：全程用桩替代 ConfigService / PrismaService / 全局 fetch —— 不连数据库、不消耗真实配额。
 */
import { ConfigService } from '@nestjs/config';

import {
  LBS_STATUS_UNAVAILABLE,
  TencentLbsService,
} from '../src/integrations/tencent-lbs/tencent-lbs.service';
import { PoiService, cacheKeyOf, dedupeById, gridKeyOf, startOfLocalDay } from '../src/modules/poi/poi.service';

let failed = 0;
let passed = 0;

function eq(actual: unknown, expected: unknown, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${label} → ${JSON.stringify(actual)}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

/* ==================== 桩 ==================== */

function configStub(over: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    tencentLbsKey: 'TEST-KEY-XXXXX',
    tencentLbsSearchUrl: 'https://apis.map.qq.com/ws/place/v1/search',
    poiKeyword: '彩票',
    poiRadius: 1000,
    poiAutoExtend: 1,
    poiPageSize: 20,
    poiTimeoutMs: 8000,
    poiDailyLimit: 100,
    poiCacheTtlHours: 24,
    poiCacheMaxEntries: 200,
    poiGridPrecision: 3,
    ...over,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

/** 记录每次 create 的入参，count 由外部变量控制（模拟「当日已发起 N 次」） */
function prismaStub(state: { used: number }): {
  service: any;
  logs: Array<Record<string, unknown>>;
} {
  const logs: Array<Record<string, unknown>> = [];
  const service = {
    externalCallLog: {
      count: async () => state.used,
      create: async (args: Record<string, unknown>) => {
        logs.push(args);
        state.used++;
        return { id: BigInt(logs.length) };
      },
    },
  };
  return { service, logs };
}

/** 一条腾讯原始 POI（字段名照抄真实返回体） */
function poi(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'P1A2B3C4D5E6F708192A3B4C5D6E7F809',
    title: '中国福利彩票（朝阳门南小街店）',
    address: '北京市东城区朝阳门南小街 12 号',
    category: '生活服务:彩票:彩票彩券销售点',
    category_code: 142410,
    location: { lat: 39.908491, lng: 116.423545 },
    _distance: 320.4,
    tel: '010-12345678',
    ...over,
  };
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

/** 用桩替换全局 fetch，返回每次调用的 URL 供断言 */
function stubFetch(handler: (url: string) => { ok?: boolean; status?: number; body?: unknown; throw?: string }) {
  const calls: FetchCall[] = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url);
    if (r.throw) throw new Error(r.throw);
    const status = r.status ?? 200;
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      json: async () => r.body ?? {},
    };
  };
  return calls;
}

/* ==================== 用例 ==================== */

const CENTER = { lat: 39.908491, lng: 116.423545 };

async function main(): Promise<void> {
  const config = configStub();

  console.log('\n[1] 检索 URL 拼装（需求 §4.2「本项目固定写法」）');
  {
    const lbs = new TencentLbsService(config);
    const url = lbs.buildSearchUrl({ latitude: CENTER.lat, longitude: CENTER.lng });
    eq(url.indexOf('boundary=nearby(39.908491,116.423545,1000,1)') > 0, true, 'boundary 纬度在前 + auto_extend=1');
    eq(url.indexOf('keyword=%E5%BD%A9%E7%A5%A8') > 0, true, 'keyword=彩票 已 URL 编码');
    eq(url.indexOf('page_size=20&page_index=1&orderby=_distance') > 0, true, '分页 / 排序（最近优先）');
    eq(url.indexOf('added_fields=category_code') > 0, true, 'added_fields=category_code');
    eq(url.indexOf('&key=TEST-KEY-XXXXX') > 0, true, 'key 来自服务端 config');
    // radius 夹到接口硬上限 1000（客户端传来超大值也不能透给上游）
    const big = lbs.buildSearchUrl({ latitude: CENTER.lat, longitude: CENTER.lng, radius: 50000 });
    eq(big.indexOf(',1000,1)') > 0, true, 'radius 超上限被夹到 1000');
    eq(big.indexOf(',50000,') < 0, true, '超大 radius 未透传');
    eq(lbs.enabled, true, '配置了 Key → enabled');
  }

  console.log('\n[2] 上游正常：响应整形为「与腾讯同构」的稳定结构');
  {
    const calls = stubFetch(() => ({
      body: { status: 0, message: 'query ok', count: 71, data: [poi(), poi({ id: 'P2', title: '中国体育彩票销售网点', location: { lat: '39.91', lng: '116.42' } })] },
    }));
    const lbs = new TencentLbsService(config);
    const res = await lbs.searchNearby({ latitude: CENTER.lat, longitude: CENTER.lng });
    eq(calls.length, 1, '只发 1 次请求（单次调用完成，配额不翻倍）');
    eq(res.status, 0, 'status 透传 0');
    eq(res.count, 71, 'count 取上游总数（不是 data.length）');
    eq(res.data.length, 2, 'data 全部整形');
    eq(typeof res.data[0].id, 'string', '⚠️ id 保持字符串（32 位 POI id 禁止强转 Number）');
    eq(res.data[0].title, '中国福利彩票（朝阳门南小街店）', 'title 保留原文（前端做前缀优先判定）');
    eq(res.data[0]._distance, 320.4, '_distance 透传（米，浮点）');
    eq(res.data[0].location, { lat: 39.908491, lng: 116.423545 }, 'location 为 { lat, lng } 数字');
    eq(res.data[1].location, { lat: 39.91, lng: 116.42 }, '上游给字符串坐标也被转成数字');
    eq(res.data[0].category_code, 142410, 'category_code 保留（仅诊断用）');
    eq(typeof res.costMs, 'number', 'costMs 带出（便于排查慢请求）');
  }

  console.log('\n[3] 上游异常一律折叠为 status=199（不抛异常，前端走「加载失败 + 重试」）');
  {
    stubFetch(() => ({ status: 502, ok: false }));
    const lbs = new TencentLbsService(config);
    const res = await lbs.searchNearby({ latitude: CENTER.lat, longitude: CENTER.lng });
    eq(res.status, LBS_STATUS_UNAVAILABLE, 'HTTP 502 → 199');
    eq(res.data, [], '异常时 data 为空数组');
  }
  {
    stubFetch(() => ({ throw: 'The operation was aborted due to timeout' }));
    const lbs = new TencentLbsService(config);
    const res = await lbs.searchNearby({ latitude: CENTER.lat, longitude: CENTER.lng });
    eq(res.status, LBS_STATUS_UNAVAILABLE, '超时 / 网络异常 → 199');
    eq(res.message.indexOf('timeout') >= 0, true, '保留原始错误信息便于排查');
  }
  {
    const lbs = new TencentLbsService(configStub({ tencentLbsKey: '' }));
    const res = await lbs.searchNearby({ latitude: CENTER.lat, longitude: CENTER.lng });
    eq(lbs.enabled, false, '未配置 Key → enabled=false');
    eq(res.status, LBS_STATUS_UNAVAILABLE, '无 Key → 199（不抛错）');
  }

  console.log('\n[4] 腾讯业务错误码原样透传（前端按 QUOTA_STATUS / KEY_STATUS 分流）');
  {
    stubFetch(() => ({ body: { status: 120, message: '此 key 今日配额已用完' } }));
    const lbs = new TencentLbsService(config);
    const res = await lbs.searchNearby({ latitude: CENTER.lat, longitude: CENTER.lng });
    eq(res.status, 120, '配额类 120 原样透传 → 前端走「今日查询次数已用完」');
    eq(res.message, '此 key 今日配额已用完', 'message 透传');
  }

  console.log('\n[5] 服务端流程：命中 L1 缓存 / 写台账 / 二次请求 0 网络 0 记账');
  {
    const calls = stubFetch(() => ({ body: { status: 0, message: 'query ok', count: 2, data: [poi(), poi({ id: 'P2' })] } }));
    const state = { used: 0 };
    const { service: prisma, logs } = prismaStub(state);
    const poiService = new PoiService(config, new TencentLbsService(config), prisma);

    const first = await poiService.getNearby({ lat: CENTER.lat, lng: CENTER.lng });
    eq(first.status, 0, '首次请求成功');
    eq(first.source, 'lbs', 'source=lbs');
    eq(first.fromCache, false, 'fromCache=false');
    eq(calls.length, 1, '发出 1 次上游请求');
    eq(logs.length, 1, '写入 1 条外部调用台账');
    eq(first.used, 1, 'used=1（服务端权威计数）');

    const second = await poiService.getNearby({ lat: CENTER.lat, lng: CENTER.lng });
    eq(second.fromCache, 'memory', '二次同网格 fromCache=memory');
    eq(calls.length, 1, '⚠️ 缓存命中 → 未再发上游请求（省配额）');
    eq(logs.length, 1, '⚠️ 缓存命中 → 未再记账');
    eq(second.data.length, first.data.length, '缓存内容与首次一致');
  }

  console.log('\n[6] 配额闸门：当日已用 ≥ 上限 → status=120 且不打上游');
  {
    const calls = stubFetch(() => ({ body: { status: 0, count: 1, data: [poi()] } }));
    const { service: prisma } = prismaStub({ used: 100 }); // 已达 poiDailyLimit=100
    const poiService = new PoiService(config, new TencentLbsService(config), prisma);
    const res = await poiService.getNearby({ lat: 30.659, lng: 104.065 }); // 换个网格，避开缓存
    eq(res.status, 120, '触顶 → status=120（前端已把它分流到配额浮层）');
    eq(res.message, '今日查询次数已用完', '文案与前端兜底一致');
    eq(calls.length, 0, '⚠️ 触顶后不再向上游发请求（配额保护的关键）');
    eq(res.data, [], '无数据');
  }

  console.log('\n[7] 失败不写缓存：一次 Key/配额错误不得被固化 24 小时');
  {
    const calls = stubFetch(() => ({ body: { status: 112, message: '请求来源未被授权' } }));
    const { service: prisma } = prismaStub({ used: 0 });
    const poiService = new PoiService(config, new TencentLbsService(config), prisma);
    const q = { lat: 31.2304, lng: 121.4737 };
    const a = await poiService.getNearby(q);
    eq(a.status, 112, 'Key 类错误码透传（前端走加载失败浮层）');
    eq(poiService.cacheSize(), 0, '失败结果未进缓存');
    const b = await poiService.getNearby(q);
    eq(b.status, 112, '第二次仍是真实请求的结果（未被缓存冒充成功）');
    eq(calls.length, 2, '两次都真的打了上游');
  }

  console.log('\n[8] 纯净函数：网格 key / 去重 / 当日零点');
  {
    eq(gridKeyOf(39.908491, 116.423545), '39.908_116.424', '四舍五入到 3 位小数（≈100 米）');
    eq(
      gridKeyOf(39.90849, 116.42354) === gridKeyOf(39.908491, 116.423545),
      true,
      '坐标微小抖动命中同一网格（否则缓存永不命中）',
    );
    const a = { ...(poi() as any) };
    const b = { ...(poi() as any), address: '重复 id 的另一条' };
    eq(dedupeById([a, b, a]).length, 1, 'auto_extend 边界重叠按 id 去重');
    const midnight = startOfLocalDay(new Date('2026-09-15T13:53:00'));
    eq([midnight.getHours(), midnight.getMinutes(), midnight.getSeconds(), midnight.getMilliseconds()], [0, 0, 0, 0], '当日零点（本地时区）');
    eq(midnight.getDate(), 15, '日期未被 UTC 偏移（跨零点查询不会漏算/多算）');
  }

  console.log('\n[9] 缓存键含半径（V1.10）：同网格不同半径不得串数据');
  {
    eq(cacheKeyOf('39.908_116.424', 300), '39.908_116.424@300', 'cacheKey = 网格@半径（与前端同拼法）');
    eq(
      cacheKeyOf('39.908_116.424', 300) === cacheKeyOf('39.908_116.424', 1000),
      false,
      '⚠️ 同网格不同半径 → key 不同（否则放大后会拿到 1km 那次的结果）',
    );

    const calls = stubFetch(() => ({ body: { status: 0, message: 'query ok', count: 1, data: [poi()] } }));
    const { service: prisma } = prismaStub({ used: 0 });
    const poiService = new PoiService(config, new TencentLbsService(config), prisma);
    const base = { lat: 39.908491, lng: 116.423545 };

    // 不传 radius → 取 config.poiRadius(1000)
    const byDefault = await poiService.getNearby({ ...base });
    eq(byDefault.radius, 1000, '缺省 radius 回落到 config.poiRadius');
    eq(byDefault.source, 'lbs', '首次：真实请求');
    eq(calls.length, 1, '发出 1 次上游请求');

    // 显式传 1000 → 与缺省是同一个 cacheKey，应当命中缓存（兜底一致性）
    const same = await poiService.getNearby({ ...base, radius: 1000 });
    eq(same.fromCache, 'memory', '显式 1000 与缺省 1000 共用同一份缓存');
    eq(calls.length, 1, '未新增上游请求');

    // 同一网格换半径 —— 必须重新打上游，不得复用 1km 那份
    const narrow = await poiService.getNearby({ ...base, radius: 300 });
    eq(narrow.source, 'lbs', '⚠️ 换半径 → 未命中 1km 的缓存');
    eq(calls.length, 2, '⚠️ 换半径 → 真的打了上游（否则前端会拿到范围外的点）');
    eq(calls[1].url.indexOf(',300,') > 0, true, '上游收到的是 300 而不是 1000');

    const narrowAgain = await poiService.getNearby({ ...base, radius: 300 });
    eq(narrowAgain.fromCache, 'memory', '同半径二次请求命中自己那份缓存');
    eq(calls.length, 2, '未新增上游请求');
    eq(poiService.cacheSize(), 2, '两个半径各占一条缓存（LRU 容量按条计）');
  }

  console.log('\n' + (failed ? `❌ ${failed} 个断言失败（通过 ${passed} 个）` : `✅ 全部断言通过（${passed} 个）`));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('自检脚本自身异常:', err);
  process.exit(1);
});
