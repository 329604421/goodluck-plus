/**
 * config/index.js - 全局配置
 * USE_MOCK: true 时前端使用本地 mock 数据独立调试，不发起真实网络请求
 * 本地联调：USE_MOCK 置 false，apiBaseUrl 指向本地后端（backend/ 目录 npm run dev）
 * 注意：微信开发者工具需勾选「详情-本地设置-不校验合法域名」
 */
module.exports = {
  USE_MOCK: false,

  // 构建版本标记（2026-09-04 建立；2026-09-15 附近功能；2026-10-16 深色模式；同日配色 V2.0；
  // 同日 首页配置入口改齿轮 + 地图个性化底图接入点；同日 录入页 OCR 徽章空文案修复）
  // 每次部署前端改动后更新此值，vConsole/启动日志中可见
  // 真机排查铁律：先确认这里与体验版一致 —— 改了没上传 = 旧包
  BUILD_VERSION: '20261030-0940-domain-lottery',

  // 后端 API 基础地址（生产：lottery.memorymap.cn；本地联调可改回 http://localhost:3000/api）
  // 注意：api.js 中各接口的相对路径不带 /api（如 '/ticket/ocr'），前缀在此统一补齐
  // 2026-10-30 由 api.memorymap.cn 迁入：api 子域收回给其他项目使用。
  // 回退：改回 'https://api.memorymap.cn/api' 即可（后端、nginx、证书均仍在，未下线）
  apiBaseUrl: 'https://lottery.memorymap.cn/api',

  // 开奖日配置：每周开奖日 → 彩种
  // 周一/三/六 = 大乐透，周二/四/日 = 双色球，周五不开奖
  drawDays: {
    1: 'dlt', // 周一 大乐透
    2: 'ssq', // 周二 双色球
    3: 'dlt', // 周三 大乐透
    4: 'ssq', // 周四 双色球
    5: null,  // 周五 不开奖
    6: 'dlt', // 周六 大乐透
    0: 'ssq'  // 周日 双色球
  },

  // 彩种展示名
  lotteryNames: {
    ssq: '双色球',
    dlt: '大乐透'
  },

  // 兑奖规则（产品规则，2026-08-17 固化）
  redeemRule: {
    deadlineDays: 60,              // 开奖之日起 60 个自然日
    shopThreshold: 10000,          // 单注 ¥1 万以下 → 彩票店兑付
    centerThreshold: 10000         // ¥1 万及以上 → 彩票中心
  },

  // ============ 「附近」功能（2026-09-15 立项，仅小程序端） ============
  // 腾讯位置服务 Key —— 占位符，请替换为你自己的：
  //   控制台 lbs.qq.com → 应用管理 → 添加 Key（场景=微信小程序、勾 WebServiceAPI、绑定你的 AppID）
  //   再到「配额管理 → 账户额度」给该 Key 分配额度，否则接口返回配额错误（不是「Key 无效」）
  // 说明：下方 useBackendProxy=true 时走服务端 /api/poi/nearby，本值不会被使用；
  //       只有回退到一期直连模式（useBackendProxy=false）才需要填真值。
  TENCENT_LBS_KEY: 'YOUR_TENCENT_LBS_KEY',

  // 腾讯位置服务·地点搜索接口（唯一天然需要网络的 LBS 接口）
  TENCENT_LBS_SEARCH_URL: 'https://apis.map.qq.com/ws/place/v1/search',

  // ============ 地图个性化底图（深色模式用，**默认关闭**） ============
  // 背景：微信原生 map 组件不保证跟随深色主题 —— iOS 实测会自动变暗，
  //       安卓（微信 8.0.65 / 基础库 3.10.2 有人反馈）仍是浅色底图。
  //       要 100% 可控（含安卓）只能用「地图个性化样式」。
  // ⚠️ 该能力自 2023-06-29 起**需付费**：微信公众平台 → 管理 → 付费管理 → 地图个性化样式。
  //    企业开发者有免费版（可创建/绑定各 1 个样式、基础模板）；高级版 ¥399 / 31 天。
  //    另外：个性化地图**不支持在开发者工具中调试**，必须真机验证。
  // 关闭状态下的行为 = 不传 subkey（空串等价于未设置）、layer-style 取官方默认值 1，
  // 因此与「没有这两个属性」完全等价，不影响现有地图功能（有判据守住，见 check_nearby.js）。
  // 开启步骤：① MP 平台购买并配置样式（可挑官方深色模板），记下**样式编号**；
  //          ② subkey 填已绑定该样式的 key（留空则复用 TENCENT_LBS_KEY）；
  //          ③ enabled 改 true，然后**真机**验证。
  // 浅/深两态由 layer-style 跟随系统主题动态切换（layer-style 支持动态改，subkey 不支持）。
  mapCustomStyle: {
    enabled: false,
    subkey: '',
    styleLight: 1,
    styleDark: 2
  },

  // 默认兜底中心点：定位不可用（权限被拒 / 审批未通过 / 定位失败）时使用
  // TODO 待确认常驻城市后替换（详见需求文档 §7 第 5 项）
  DEFAULT_CENTER: {
    latitude: 39.908491,
    longitude: 116.423545,
    city: '北京'
  },

  // 附近检索参数（配额保护，详见需求文档 §2.3 / §4.4）
  nearby: {
    // ---- 二期：后端代理开关（方案 B，详见需求文档 §4.7）----
    // false = 一期直连腾讯 LBS：Key 在小程序代码包内，缓存只在本机
    // true  = 走后端 /api/poi/nearby：Key 收到服务端、缓存跨设备共享、配额闸门在服务端
    // ✅ 2026-09-15 已切换为 true —— 前置条件已全部满足并通过生产联调：
    //    后端已部署（/opt/lottery-helper，dist 全量 md5 审计 62/62 一致）
    //    服务端 .env 已配 TENCENT_LBS_KEY，`GET /api/poi/nearby` 实测 39 项断言全绿
    // 回退：改回 false 即可（一行），行为立刻退回一期直连，无需动后端
    useBackendProxy: true,
    backendPath: '/poi/nearby',

    keyword: '彩票',        // 实测：单词即可覆盖福彩+体彩两类站点，勿改成「福利彩票」
    radius: 1000,           // 兜底半径（地图未就绪 / 视野读不出时使用）；1000 也是接口上限
    // 检索半径档位（V1.10 新增）：检索半径跟随地图视野 —— 视野半径向上取到最近档位。
    // 为什么离散：radius 直接进缓存 key，连续取值会让缓存永不命中，把配额烧穿。
    // 为什么向上取：宁可多返回一点（个别点位略在屏外），也不能漏搜（屏内有点却搜不到）。
    radiusTiers: [200, 300, 500, 700, 1000],
    autoExtend: 1,          // 1 = 自动扩大范围
    pageSize: 20,           // 接口上限 20
    cacheTtlMs: 24 * 60 * 60 * 1000,  // 本地缓存 24 小时
    gridPrecision: 3,       // 缓存网格精度（小数位，3 位 ≈ 100 米）
    dailyLimit: 30          // 直连模式下单日最多真实调用次数（官方上限 200 次/日）；
                            // 代理模式下本层不计数，以服务端 POI_DAILY_LIMIT 为准
  }
};
