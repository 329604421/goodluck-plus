/**
 * utils/nearby.js - 「附近」功能 LBS 封装（腾讯位置服务 · 地点搜索）
 *
 * 职责边界（重要，改动前先读《小程序附近功能迭代说明_V1.0.md》§4）：
 *   本文件是「附近」功能**唯一**的网络出口。页面只消费本文件返回的结果，
 *   不直接调 wx.request / wx.getLocation。审批 / 换 Key / 换数据源时只改这里。
 *
 * 两个模式（由 config.nearby.useBackendProxy 切换，见需求 §4.7）：
 *   一期 直连：wx.request → apis.map.qq.com（Key 在小程序包内，缓存只在本机）
 *   二期 代理：api.request → {apiBaseUrl}/poi/nearby（Key 在服务端，缓存跨设备共享）
 *   两条路径返回的都是**同构的腾讯响应体**，因此下面的分流/缓存/模型转换逻辑完全共用。
 *
 * 三层配额保护（需求 §4.4，任一层命中即可避免触顶）：
 *   L1 内存缓存（模块级，页面会话内存活）
 *   L2 本地缓存（wx.setStorageSync，key = 经纬度 3 位小数网格 + 半径档位，TTL 24h）
 *   L3 当日调用计数（日上限 30 次，远低于个人开发者 200 次/日）
 *
 * ⚠️ **radius 是变量，不是常量**（V1.10 起）：检索半径跟随地图视野（见 radiusTierOf）。
 *    因此 radius 必须进缓存 key —— 否则放大后仍会命中「1km 那一次」的缓存，
 *    表现就是本页最典型的一个 bug：提示搜到了 N 个网点，屏幕里却一个标记都看不到。
 *
 * 接口契约（需求 §4.2，实测于 2026-09-15）：
 *   GET https://apis.map.qq.com/ws/place/v1/search
 *   boundary=nearby(lat,lng,radius,1) 纬度在前；radius 上限 1000m；auto_extend=1
 *   keyword=彩票                       接口只允许 1 个关键词，单词覆盖福彩+体彩
 *   page_size=20&page_index=1&orderby=_distance&added_fields=category_code
 *   坐标体系 GCJ-02，与 wx.getLocation({type:'gcj02'}) 一致，无需转换
 *
 * ⚠️ **标记 = 自备彩色图标（V1.15 最终形态，走完三次反复后定案）**：
 *    演进路径（改前先读，别再走回头路）：
 *      V1.13 需求方要求「放弃使用所有的 png 图标」→ 改为原生默认标记（零自备图标）；
 *      V1.14 随即反馈「大乐透和双色球不能用同一个颜色」→ 用 `marker.label` 彩色角标补色；
 *      V1.15 需求方裁定「还是改回显示有颜色的图标」→ **恢复 4 张自备 PNG**。
 *    为什么角标方案最后没能满足：**原生 marker 没有任何改颜色的接口** ——
 *      官方 marker 字段（id / latitude / longitude / title / zIndex / iconPath / rotate / alpha /
 *      width / height / callout / customCallout / label / anchor / collision）里
 *      **没有一个是「给默认图钉上色」的**（`setLocMarkerIcon` 管的是定位蓝点、
 *      `initMarkerCluster` 只管聚合簇）。label 角标能给**文字**上色，但**图钉本体永远是同一个颜色**，
 *      而需求方要的正是「图标本身有颜色」→ 只能回到自备图标。
 *      **结论：「零自备图标」与「图标本身有颜色」在平台上不可兼得，现在按后者做。**
 *    实现（即 V1.12 的形态；白边问题已在 V1.12 修掉）：
 *      四类图标 `marker-{fucai|tiyu|both|unknown}.png`，出图 56×68 @2x、显示 28×34，
 *      `anchor {x:0.5, y:1}` 让水滴尖端对准坐标点；选中态放大到 32×39 并抬升 zIndex。
 *      ⚠️ **图标的唯一真相源是 `_dev_tools/gen_markers.py`** —— 改配色 / 尺寸必须改脚本重出图，
 *         **不要手工改 png**（脚本里曾有一层「形状外扩 5px」的白色描边，它就是真机上那圈白边的
 *         根源，撑出画布后只在水滴上下弧段与尖尾露出；V1.12 已删掉该层）。
 *    备份两份，用途不同别搞混：
 *      · `_dev_tools/marker_icons_retired/` —— V1.12 修好白边的版本（与本文件同源，可安全覆盖）
 *      · `_dev_tools/marker_icons_orig/`    —— **去白边之前**的版本，⚠️ 切勿用来覆盖 assets/
 */
const config = require('../config/index');
const mock = require('./mock');
// 二期（后端代理）：复用全站网络层的 token 注入 + 40100 自动重登重试
// 注意：api.js 不反向依赖本文件，不存在循环 require
const api = require('./api');

const CACHE_PREFIX = 'nearby_cache_';
const QUOTA_PREFIX = 'nearby_quota_';
const CACHE_GC_DAYS = 7;

// 腾讯位置服务错误码分组（需求 §3.5 异常态分流）
const QUOTA_STATUS = [120, 121, 122, 123]; // 配额类：日上限 / 并发 / 未分配额度
const KEY_STATUS = [110, 111, 112, 113];   // Key 类：来源未授权 / 签名 / IP / 功能未授权

// 后端代理不可用（网络失败 / 自家 code≠0）统一折叠成这个 status：
// 与后端 tencent-lbs.service.ts 的 LBS_STATUS_UNAVAILABLE 取同一个值，
// 且不属于 QUOTA_STATUS / KEY_STATUS → 页面按「加载失败 + 重试」处理（需求 §3.5）
const PROXY_STATUS_UNAVAILABLE = 199;

/* ========================================================================
 * 一、站点类型判定（需求 §3.4「前缀优先」规则，由 2026-09-15 实测订正）
 * 关键：不能只判「名称是否包含关键词」——腾讯 POI 存在「中国体育福利彩票」
 *      这类名称自相矛盾的记录，必须以前缀为首要信号。
 * ====================================================================== */

// 体彩前缀（先判，优先级最高）
const TIYU_PREFIX = ['中国体育彩票', '中国体育', '体育彩票', '体彩'];
// 福彩前缀
const FUCAI_PREFIX = ['中国福利彩票', '中国福利', '福利彩票', '福彩'];
// 关键词（用于「任意位置命中」兜底与兼营判断）
const TIYU_KEYS = ['体育彩票', '体彩', '大乐透', '竞彩', '竞猜'];
const FUCAI_KEYS = ['福利彩票', '福彩', '双色球'];

const TYPE_LABEL = {
  fucai: '福彩 · 双色球',
  tiyu: '体彩 · 大乐透',
  both: '福彩+体彩 · 均可',
  unknown: '彩票网点'
};

const TYPE_LOTTERIES = {
  fucai: ['双色球'],
  tiyu: ['大乐透'],
  both: ['双色球', '大乐透'],
  unknown: []
};

/* ========================================================================
 * 一·B、标记图标（V1.15：恢复自备彩色图标）
 *
 * 四类图标与「站点类型」一一对应，配色与号码球、列表 4 态标签同一套语义：
 *   fucai   只卖双色球（福彩）  → 红 #E63946 + 白心
 *   tiyu    只卖大乐透（体彩）  → 蓝 #4262FF + 白心
 *   both    福彩 + 体彩兼营     → 红底 + 白环 + 蓝心
 *   unknown 未识别              → 灰 #8E91A0 + 白心
 * 四类因此在地图上**一眼可辨** —— 这正是本次要解决的问题（V1.13 的原生图钉四类同色）。
 *
 * ⚠️ 图标由 `_dev_tools/gen_markers.py` 生成，**它是唯一真相源**：
 *    改配色 / 尺寸请改脚本重出图，**不要手工改 png**（那圈白边就是这么来的，见文件头）。
 * ====================================================================== */

const MARKER_ICON = {
  fucai: '/assets/marker-fucai.png',
  tiyu: '/assets/marker-tiyu.png',
  both: '/assets/marker-both.png',
  unknown: '/assets/marker-unknown.png'
};

// 标记显示尺寸（设计稿 §3.2：显示 28×34；选中态放大 1.15 倍 ≈ 32×39）
// 出图本身是 56×68 @2x，map 组件按这里的逻辑像素缩放。
const MARKER_SIZE = {
  normal: { width: 28, height: 34 },
  active: { width: 32, height: 39 }
};

function startsWithAny(text, list) {
  for (let i = 0; i < list.length; i++) {
    if (text.indexOf(list[i]) === 0) return true;
  }
  return false;
}

function containsAny(text, list) {
  for (let i = 0; i < list.length; i++) {
    if (text.indexOf(list[i]) >= 0) return true;
  }
  return false;
}

/**
 * 判定站点类型。
 * 顺序（与需求 §3.4 流程图一致）：
 *   1. 体彩前缀开头 → tiyu（先判体彩，覆盖「中国体育福利彩票」这类矛盾名称）
 *   2. 福彩前缀开头 → 名称其余部分若含体彩关键词 → both，否则 fucai
 *   3. 任意位置命中关键词 → 单类 fucai / tiyu，两类都有 → both
 *   4. 都没有 → unknown（照常落点，仅标签弱化、转灰）
 * @param {string} title POI 名称
 * @returns {'fucai'|'tiyu'|'both'|'unknown'}
 */
function classifyPoi(title) {
  const t = String(title || '').replace(/\s/g, '');
  if (startsWithAny(t, TIYU_PREFIX)) return 'tiyu';
  if (startsWithAny(t, FUCAI_PREFIX)) {
    return containsAny(t, TIYU_KEYS) ? 'both' : 'fucai';
  }
  const hasFucai = containsAny(t, FUCAI_KEYS);
  const hasTiyu = containsAny(t, TIYU_KEYS);
  if (hasFucai && hasTiyu) return 'both';
  if (hasFucai) return 'fucai';
  if (hasTiyu) return 'tiyu';
  return 'unknown';
}

/* ========================================================================
 * 二、格式化与模型转换
 * ====================================================================== */

/** 距离格式化：<1000m 显示「320 米」，≥1000m 显示「1.2 公里」（需求 §4.2）
 *  注意先取整再判阈值 —— 否则 999.6m 会四舍五入成「1000 米」，是个会露到界面上的边界 bug */
function formatDistance(meters) {
  const m = Number(meters);
  if (!isFinite(m) || m < 0) return '';
  const rounded = Math.round(m);
  if (rounded < 1000) return rounded + ' 米';
  return (m / 1000).toFixed(1) + ' 公里';
}

/**
 * 腾讯原始 POI → 页面业务模型（需求 §4.3）
 * @param {object} poi 接口 data[] 中的一项
 * @returns {object} 站点业务模型
 */
function toStation(poi) {
  const location = poi.location || {};
  const type = classifyPoi(poi.title);
  return {
    id: String(poi.id || poi.title || ''),
    name: poi.title || '彩票网点',
    address: poi.address || '地址暂无',
    category: poi.category || '',
    // 实测为 142410（生活服务:彩票:彩票彩券销售点）；仅用于诊断，不作类型判定依据
    categoryCode: poi.category_code || '',
    distance: Number(poi._distance) || 0,
    distanceText: formatDistance(poi._distance),
    type,
    typeLabel: TYPE_LABEL[type],
    lotteries: TYPE_LOTTERIES[type],
    // 标记图标随类型走（V1.15）：四类四种颜色，地图上不再同色
    iconPath: MARKER_ICON[type],
    latitude: Number(location.lat) || 0,
    longitude: Number(location.lng) || 0,
    tel: poi.tel || ''
  };
}

/** 按 POI id 去重（auto_extend 扩大范围时边界会重叠，需求 §4.3 坑 2） */
function dedupeStations(list) {
  const seen = {};
  const out = [];
  (list || []).forEach((item) => {
    const key = item.id || `${item.latitude}_${item.longitude}`;
    if (seen[key]) return;
    seen[key] = true;
    out.push(item);
  });
  return out;
}

/**
 * 站点列表 → map 组件的 markers（需求 §4.3 坑 1）
 * marker.id 必须是 Number，而腾讯 POI id 是字符串 → 用 index+1 做映射表，
 * 点击时按 `index = markerId - 1` 回查 stations，**不要强转 POI id**。
 *
 * ⚠️ V1.15：**恢复自备彩色图标**（`iconPath` + 四类四色）。
 *    设了 `iconPath` 就必须同时给 `width` / `height` —— 否则触发
 *    `[渲染层错误] width and height of marker id X are required`；
 *    `anchor {x:0.5, y:1}` 让水滴尖端对准坐标点（默认锚点不是尖端，不能省）。
 * @param {Array} stations 站点业务模型数组
 * @param {number} selectedIndex 当前选中下标，-1 表示无选中
 */
function buildMarkers(stations, selectedIndex) {
  const size = MARKER_SIZE.normal;
  const sizeActive = MARKER_SIZE.active;
  return (stations || []).map((s, i) => {
    const active = i === selectedIndex;
    return {
      id: i + 1,
      latitude: s.latitude,
      longitude: s.longitude,
      // 自备彩色图标（V1.15）：四类四色，地图上一眼可辨
      iconPath: s.iconPath || MARKER_ICON[s.type] || MARKER_ICON.unknown,
      width: active ? sizeActive.width : size.width,
      height: active ? sizeActive.height : size.height,
      anchor: { x: 0.5, y: 1 },   // 水滴尖端对准坐标点
      zIndex: active ? 20 : 10    // 选中项置顶
    };
  });
}

/* ========================================================================
 * 三、定位（需求 §5.2 实现约束：必须封装在独立函数里）
 *    审批通过后若要换实现，只改 getCurrentLocation，页面零改动。
 * ====================================================================== */

/** 隐私授权预检（需求 §3.5「隐私未同意」态） */
function ensurePrivacy() {
  return new Promise((resolve) => {
    if (typeof wx.getPrivacySetting !== 'function') {
      resolve(true);
      return;
    }
    wx.getPrivacySetting({
      success: (res) => {
        if (!res || !res.needAuthorization) {
          resolve(true);
          return;
        }
        wx.requirePrivacyAuthorize({
          success: () => resolve(true),
          fail: () => resolve(false)
        });
      },
      // 基础库不支持 / 未配置隐私协议 → 不阻断，交给 getLocation 自行处理
      fail: () => resolve(true)
    });
  });
}

/**
 * 获取当前定位。
 * ⚠️ 全项目唯一调用 wx.getLocation 的地方（页面不得直接调）。
 * @returns {Promise<{latitude:number, longitude:number}|null>} 失败统一 resolve(null)，
 *          不 reject —— 页面按「定位被拒」态处理，走默认城市兜底。
 */
function getCurrentLocation() {
  return ensurePrivacy().then((granted) => {
    if (!granted) {
      console.warn('[nearby] 隐私授权未通过，走默认城市兜底');
      return null;
    }
    return new Promise((resolve) => {
      wx.getLocation({
        // 必须 gcj02：与腾讯 LBS 返回坐标系一致，用 wgs84 会整体偏移几百米
        type: 'gcj02',
        success: (res) => resolve({
          latitude: res.latitude,
          longitude: res.longitude
        }),
        fail: (err) => {
          // 定位失败不是异常路径，是预期分支（权限审批中 / 用户拒绝 / 系统开关关闭）
          console.warn('[nearby] getLocation 失败，走默认城市兜底:', (err && err.errMsg) || err);
          resolve(null);
        }
      });
    });
  });
}

/** 默认兜底中心点（定位不可用时使用，需求 §3.5） */
function getFallbackCenter() {
  const c = config.DEFAULT_CENTER || {};
  return {
    latitude: c.latitude || 39.908491,
    longitude: c.longitude || 116.423545,
    city: c.city || ''
  };
}

/* ========================================================================
 * 四、缓存与配额（需求 §4.4）
 * ====================================================================== */

// L1 内存缓存：{ [gridKey]: { ts, stations, center } }
const memoryCache = {};

function gridKeyOf(latitude, longitude) {
  const precision = (config.nearby && config.nearby.gridPrecision) || 3;
  return `${Number(latitude).toFixed(precision)}_${Number(longitude).toFixed(precision)}`;
}

/**
 * 缓存 key = 网格 + 半径档位。
 * ⚠️ radius 必须进 key（V1.10 起）。同一网格在不同缩放级别下检索半径不同，
 *    共用 key 会出现「放大到很细，拿到的还是 1km 那次的结果」——
 *    表现就是本页最典型的 bug：提示搜到了 N 个网点，屏幕里一个标记都看不到。
 */
function cacheKeyOf(gridKey, radius) {
  return `${gridKey}@${radius}`;
}

/**
 * 放大（档位变小）时复用更粗档位的缓存 —— **零配额**。
 *
 * 正确性依据：上游按 `_distance` 升序返回**最近的 page_size 条**。所以
 *   「大半径的结果集」必然包含「小半径结果集」的全部条目 —— 任何一个落在小半径内的点，
 *   都比半径外那些点更近，排序一定更靠前，一定在那 20 条里。
 * 于是过滤 `distance ≤ radius` 就是小半径下的完整结果，不会漏点。
 *
 * 收益：缩放是这里最高频的操作，放大路径几乎总能命中（先搜过大范围就免配额），
 *      而「缩放自动重搜」正是靠它把配额风险压下来的。
 */
function readCoarserCache(gridKey, radius) {
  const tiers = radiusTiers();
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i] <= radius) continue;      // 只找严格更粗的档位
    const key = cacheKeyOf(gridKey, tiers[i]);
    const rec = memoryCache[key] || readStorageCache(key);
    if (rec && Array.isArray(rec.stations)) return { rec, tier: tiers[i] };
  }
  return null;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function cacheTtl() {
  return (config.nearby && config.nearby.cacheTtlMs) || 24 * 60 * 60 * 1000;
}

function dailyLimit() {
  return (config.nearby && config.nearby.dailyLimit) || 30;
}

/**
 * 读 L2 本地缓存（同时做惰性过期清理）
 * ⚠️ 这里用 `rec.total || stations.length` 兜底：历史版本写缓存时**没有存 total**，
 *    导致同一份数据在「首次真实请求」与「二次进页面读 L2」两条路径下数量显示不同
 *    （实测出现过 96 → 20 的跳变）。新写入一律带 total（见 writeStorageCache）。
 */
function readStorageCache(gridKey) {
  try {
    const rec = wx.getStorageSync(CACHE_PREFIX + gridKey);
    if (!rec || !rec.ts || !Array.isArray(rec.stations)) return null;
    if (Date.now() - rec.ts > cacheTtl()) {
      wx.removeStorageSync(CACHE_PREFIX + gridKey);
      return null;
    }
    return rec;
  } catch (e) {
    return null;
  }
}

/**
 * 写 L2 本地缓存。
 * @param {number} [total] 服务端给的匹配总数；缺省退化为 stations.length。
 *        必须存下来 —— 否则「同一份数据、不同进入路径显示不同数量」。
 */
function writeStorageCache(gridKey, stations, center, total) {
  try {
    wx.setStorageSync(CACHE_PREFIX + gridKey, {
      ts: Date.now(),
      stations,
      center,
      total: Number(total) || stations.length
    });
  } catch (e) {
    // Storage 写满等异常不影响主流程
    console.warn('[nearby] 缓存写入失败:', e);
  }
}

/** 取任意一条未过期缓存 —— 配额耗尽 / 请求失败时用于「有缓存就先展示」 */
function readAnyCache() {
  try {
    const info = wx.getStorageInfoSync();
    const keys = (info && info.keys) || [];
    let best = null;
    keys.forEach((k) => {
      if (k.indexOf(CACHE_PREFIX) !== 0) return;
      const rec = wx.getStorageSync(k);
      if (!rec || !rec.ts || !Array.isArray(rec.stations)) return;
      if (Date.now() - rec.ts > cacheTtl()) return;
      if (!best || rec.ts > best.ts) best = rec;
    });
    return best;
  } catch (e) {
    return null;
  }
}

/** 每日首次访问清理 7 天前的缓存项，避免 Storage 无限增长 */
function gcExpiredCache() {
  const flagKey = 'nearby_gc_' + todayKey();
  try {
    if (wx.getStorageSync(flagKey)) return;
    wx.setStorageSync(flagKey, 1);
    const info = wx.getStorageInfoSync();
    const dead = Date.now() - CACHE_GC_DAYS * 24 * 60 * 60 * 1000;
    (info.keys || []).forEach((k) => {
      if (k.indexOf(CACHE_PREFIX) !== 0 && k.indexOf('nearby_gc_') !== 0) return;
      const rec = wx.getStorageSync(k);
      if (rec && typeof rec === 'object' && rec.ts && rec.ts < dead) {
        wx.removeStorageSync(k);
      } else if (k.indexOf('nearby_gc_') === 0 && Number(k.slice(10)) < Number(todayKey())) {
        wx.removeStorageSync(k);
      }
    });
  } catch (e) {
    // 忽略
  }
}

/** 读当日已用次数 */
function readQuotaUsed() {
  try {
    return Number(wx.getStorageSync(QUOTA_PREFIX + todayKey())) || 0;
  } catch (e) {
    return 0;
  }
}

/** 当日计数 +1（仅在真实发起请求后调用） */
function bumpQuotaUsed() {
  const used = readQuotaUsed() + 1;
  try {
    wx.setStorageSync(QUOTA_PREFIX + todayKey(), used);
  } catch (e) {
    // 忽略
  }
  return used;
}

/* ========================================================================
 * 五、检索半径：跟随地图视野（V1.10 新增）
 *   症状：地图放大后提示「已找到 20 个网点」，屏幕里却一个标记都没有。
 *   原因：检索半径恒为 1000m，而放大后的可视范围只有两三百米 —— 返回的 20 条
 *        全都散在视野之外。半径不与视野挂钩，这个现象就必然复现。
 *   解法：检索半径 = 当前视野的等效半径（向上取到档位，见 radiusTierOf）。
 * ====================================================================== */

/** 1 度纬度 ≈ 111.32km（经度要再乘 cos(纬度)） */
const METERS_PER_DEG_LAT = 111320;

/** 档位表（升序）。取不到配置时退化为「只有 1000」—— 行为与 V1.9 完全一致 */
function radiusTiers() {
  const t = config.nearby && config.nearby.radiusTiers;
  return t && t.length ? t : [1000];
}

/** 兜底半径（地图未就绪 / 视野读不出时使用） */
function defaultRadius() {
  return (config.nearby && config.nearby.radius) || 1000;
}

/**
 * 把任意半径**向上**归到最近的档位。
 * 向上取（宁大勿小）的理由：检索范围必须覆盖整个可视区，否则屏幕边上看得见的网点搜不到；
 * 反过来多返回几条落在屏外的点无害（用户拖一下就看到），漏搜却是要命的。
 * @param {number} value 目标半径（米）；非法/≤0 时返回最大档
 * @returns {number} 档位值，如 500
 */
function radiusTierOf(value) {
  const tiers = radiusTiers();
  const v = Number(value);
  if (!isFinite(v) || v <= 0) return tiers[tiers.length - 1];
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i] >= v) return tiers[i];
  }
  return tiers[tiers.length - 1];
}

/**
 * 地图可视范围 → 等效检索半径（米，对角半径）。
 *
 * 取**对角半径**：屏幕四角能看到的网点都在检索范围内，不漏搜。
 * 只做几何换算、不套「scale ↔ 米」的经验公式 —— 各机型 DPR、地图容器高度、
 * 纬度（经度缩放系数）都不同，公式必然在某台机器上是错的，getRegion 给的是实测值。
 *
 * @param {{northeast:{latitude,longitude}, southwest:{latitude,longitude}}} region
 *        MapContext.getRegion() 的 success 回调参数
 * @returns {number} 等效半径（米）；region 不可用时返回 0（调用方据此回落到上次档位）
 */
function viewRadiusMeters(region) {
  const ne = region && region.northeast;
  const sw = region && region.southwest;
  if (!ne || !sw) return 0;
  const lat1 = Number(ne.latitude);
  const lat2 = Number(sw.latitude);
  const lng1 = Number(ne.longitude);
  const lng2 = Number(sw.longitude);
  if (!isFinite(lat1) || !isFinite(lat2) || !isFinite(lng1) || !isFinite(lng2)) return 0;

  const midLat = (lat1 + lat2) / 2;
  const halfNS = (Math.abs(lat1 - lat2) / 2) * METERS_PER_DEG_LAT;
  const halfEW = (Math.abs(lng1 - lng2) / 2) * METERS_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const d = Math.sqrt(halfNS * halfNS + halfEW * halfEW);
  return d > 0 ? d : 0;
}

/* ========================================================================
 * 六、检索主入口（唯一网络出口）
 * ====================================================================== */

/** 拼装地点搜索 URL（需求 §4.2「本项目固定写法」，除 radius 外参数取自 config.nearby） */
function buildSearchUrl(latitude, longitude, radius) {
  const n = config.nearby || {};
  const r = radiusTierOf(radius == null ? defaultRadius() : radius);
  const autoExtend = n.autoExtend == null ? 1 : n.autoExtend;
  const pageSize = n.pageSize || 20;
  const keyword = n.keyword || '彩票';
  return config.TENCENT_LBS_SEARCH_URL
    + `?boundary=nearby(${latitude},${longitude},${r},${autoExtend})`
    + `&keyword=${encodeURIComponent(keyword)}`
    + `&page_size=${pageSize}&page_index=1&orderby=_distance&added_fields=category_code`
    + `&key=${config.TENCENT_LBS_KEY}`;
}

function requestLbs(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      timeout: 8000,
      success: (res) => resolve(res.data || {}),
      fail: (err) => reject(err)
    });
  });
}

/** 是否走后端代理（方案 B）。开关在 config.nearby.useBackendProxy，见需求 §4.7 */
function useBackendProxy() {
  return !!(config.nearby && config.nearby.useBackendProxy);
}

/**
 * 二期：走后端代理检索（方案 B，需求 §4.7）。
 *
 * 后端返回体与腾讯同构（status / message / count / data），所以**上层的分流逻辑一行都不用改**，
 * 这里只负责把自家 { code, message, data } 外壳剥掉。
 * 走 api.request 是为了复用全站的 X-Device-Token 注入与 40100 自动重登重试 ——
 * 附近页是全站唯一不走 api.js 的页面，切代理后这条差异必须收敛掉。
 *
 * 约定：**传输层失败（超时 / 非 2xx / wx.request fail）继续 reject**，交给调用方的 catch
 * 走「先展示任意缓存 + 网络失败浮层」；只有业务层错误（code≠0）才折叠成 status 返回。
 */
function requestBackendProxy(latitude, longitude, radius) {
  const n = config.nearby || {};
  const r = radiusTierOf(radius == null ? defaultRadius() : radius);
  return api
    .request({
      url: n.backendPath || '/poi/nearby',
      data: { lat: latitude, lng: longitude, radius: r }
    })
    .then((body) => {
      if (!body || body.code !== 0) {
        console.warn('[nearby] 代理接口返回业务错误:', body && body.code, body && body.message);
        return {
          status: PROXY_STATUS_UNAVAILABLE,
          message: (body && body.message) || '代理接口返回错误',
          count: 0,
          data: []
        };
      }
      return body.data || {
        status: PROXY_STATUS_UNAVAILABLE,
        message: '代理接口无数据',
        count: 0,
        data: []
      };
    });
}

/** 检索出口二选一 —— 全项目唯一的分支点（换数据源只改这里，需求 §4.6.7）
 *  直连：wx.request → apis.map.qq.com（Key 在小程序包内）
 *  代理：wx.request → {apiBaseUrl}/poi/nearby（Key 在服务端，且服务端有跨设备缓存） */
function performSearch(latitude, longitude, proxy, radius) {
  return proxy
    ? requestBackendProxy(latitude, longitude, radius)
    : requestLbs(buildSearchUrl(latitude, longitude, radius));
}

/**
 * 检索附近彩票站点。**这是页面对接 LBS 的唯一入口**。
 *
 * @param {{latitude:number, longitude:number}} center 检索中心点（gcj02）
 * @param {{radius:number}} [options] radius = 检索半径（米）。缺省走 config.nearby.radius。
 *        页面应按当前地图视野传入（nearby.viewRadiusMeters → radiusTierOf），
 *        传什么值都会被归到档位，所以传原始视野半径即可。
 * @returns {Promise<{list:Array, fromCache:false|'memory'|'storage'|'coarser'|'server',
 *                    total:number, quotaExceeded:boolean, error:string|null,
 *                    used:number, limit:number}>}
 *   error 取值：null | 'network' | 'key' | 'quota' | 'empty'
 */
function fetchNearbyPois(center, options) {
  const opts = options || {};
  const latitude = center && center.latitude;
  const longitude = center && center.longitude;
  const gridKey = gridKeyOf(latitude, longitude);
  const radius = radiusTierOf(opts.radius == null ? defaultRadius() : opts.radius);
  const cacheKey = cacheKeyOf(gridKey, radius);
  const limit = dailyLimit();
  const proxy = useBackendProxy();

  // ---- L1 内存缓存 ----
  if (memoryCache[cacheKey]) {
    const rec = memoryCache[cacheKey];
    return Promise.resolve({
      list: rec.stations,
      total: rec.total || rec.stations.length,
      fromCache: 'memory',
      quotaExceeded: false,
      error: null,
      used: readQuotaUsed(),
      limit
    });
  }

  // ---- L2 本地缓存 ----
  const cached = readStorageCache(cacheKey);
  if (cached) {
    memoryCache[cacheKey] = cached;
    return Promise.resolve({
      list: cached.stations,
      total: cached.total || cached.stations.length,
      fromCache: 'storage',
      quotaExceeded: false,
      error: null,
      used: readQuotaUsed(),
      limit
    });
  }

  // ---- L2b 更粗档位缓存过滤复用（放大时零配额，见 readCoarserCache）----
  const coarser = readCoarserCache(gridKey, radius);
  if (coarser) {
    const picked = coarser.rec.stations.filter((s) => Number(s.distance) <= radius);
    const rec = { ts: Date.now(), stations: picked, total: picked.length };
    memoryCache[cacheKey] = rec;
    writeStorageCache(cacheKey, picked, { latitude, longitude }, picked.length);
    return Promise.resolve({
      list: picked,
      total: picked.length,
      fromCache: 'coarser',
      quotaExceeded: false,
      error: picked.length ? null : 'empty',
      used: readQuotaUsed(),
      limit
    });
  }

  // ---- mock 兜底：USE_MOCK=true 时不消耗配额，直接返回假站点 ----
  if (config.USE_MOCK) {
    const stations = dedupeStations((mock.nearbyStations || []).map(toStation));
    // mock 不过滤 radius —— 它的用途是「四种类型标签 / 配色都能在无网络时调出来」
    memoryCache[cacheKey] = { ts: Date.now(), stations, total: stations.length };
    return new Promise((resolve) => {
      setTimeout(() => resolve({
        list: stations,
        total: stations.length,
        fromCache: false,
        quotaExceeded: false,
        error: stations.length ? null : 'empty',
        used: 0,
        limit
      }), 300);
    });
  }

  // ---- L3 当日计数（仅直连模式；代理模式的配额由服务端权威计数，见需求 §4.7）----
  const used = readQuotaUsed();
  if (!proxy && used >= limit) {
    const rescue = readAnyCache();
    return Promise.resolve({
      list: rescue ? rescue.stations : [],
      total: rescue ? rescue.stations.length : 0,
      fromCache: rescue ? 'storage' : false,
      quotaExceeded: true,
      error: 'quota',
      used,
      limit
    });
  }

  // ---- 真实请求（直连或代理，消耗 1 次配额）----
  gcExpiredCache();
  return performSearch(latitude, longitude, proxy, radius)
    .then((body) => {
      const status = Number(body.status);
      if (status === 0) {
        // 直连：本次真实请求自增本地计数；代理：配额由服务端计数并回传（本地不自增，
        // 否则两套计数会互相打架 —— 代理模式下以服务端为准，见需求 §4.7）
        const usedNow = proxy ? Number(body.used) || 0 : bumpQuotaUsed();
        const nextLimit = proxy && body.limit ? Number(body.limit) : limit;
        const raw = (body.data && Array.isArray(body.data)) ? body.data : [];
        const stations = dedupeStations(raw.map(toStation));
        if (stations.length) {
          const total = body.count || stations.length;
          const rec = { ts: Date.now(), stations, total };
          memoryCache[cacheKey] = rec;
          writeStorageCache(cacheKey, stations, { latitude, longitude }, total);
        }
        return {
          list: stations,
          total: body.count || stations.length,
          // 代理模式下服务端可能命中它自己的缓存（跨设备共享），如实带出便于排查
          fromCache: body.fromCache ? 'server' : false,
          quotaExceeded: false,
          error: stations.length ? null : 'empty',
          used: usedNow,
          limit: nextLimit
        };
      }
      // Key / 配额类错误：不写缓存，直接上报给页面分流提示。
      // 配额耗尽时兜底展示「最近一次缓存」—— 有数据总比空屏好（需求 §3.5 配额耗尽行）
      const quota = QUOTA_STATUS.indexOf(status) >= 0;
      const rescue = quota ? readAnyCache() : null;
      return {
        list: rescue ? rescue.stations : [],
        total: rescue ? rescue.total || rescue.stations.length : 0,
        fromCache: rescue ? 'storage' : false,
        quotaExceeded: quota,
        error: quota ? 'quota' : KEY_STATUS.indexOf(status) >= 0 ? 'key' : 'network',
        status,
        message: body.message || '',
        used,
        limit
      };
    })
    .catch((err) => {
      console.warn('[nearby] 地点搜索请求失败:', err);
      const rescue = readAnyCache();
      return {
        list: rescue ? rescue.stations : [],
        total: rescue ? rescue.stations.length : 0,
        fromCache: rescue ? 'storage' : false,
        quotaExceeded: false,
        error: 'network',
        used,
        limit
      };
    });
}

module.exports = {
  // 类型判定与模型
  classifyPoi,
  formatDistance,
  toStation,
  dedupeStations,
  buildMarkers,
  TYPE_LABEL,
  // 标记图标（V1.15：四类四色的自备图标 + 显示尺寸）
  MARKER_ICON,
  MARKER_SIZE,
  // 检索半径（V1.10：跟随地图视野）
  radiusTiers,
  radiusTierOf,
  defaultRadius,
  viewRadiusMeters,
  // 定位
  getCurrentLocation,
  getFallbackCenter,
  // 检索
  fetchNearbyPois,
  buildSearchUrl,
  // 检索出口二选一（二期后端代理，需求 §4.7）
  useBackendProxy,
  requestBackendProxy,
  performSearch,
  PROXY_STATUS_UNAVAILABLE,
  // 缓存 / 配额（页面用于展示剩余次数，调试时也可直接读）
  gridKeyOf,
  cacheKeyOf,
  readQuotaUsed,
  dailyLimit,
  readAnyCache
};
