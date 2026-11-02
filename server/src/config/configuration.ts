export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appPort: Number(process.env.APP_PORT ?? 3000),

  databaseUrl: process.env.DATABASE_URL ?? '',

  volcSearchApiKey: process.env.VOLC_SEARCH_API_KEY ?? '',

  arkApiKey: process.env.ARK_API_KEY ?? '',
  arkBaseUrl: process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
  arkVisionModel: process.env.ARK_VISION_MODEL ?? 'deepseek-v4-1-flash-261017',
  arkLlmEndpointId: process.env.ARK_LLM_ENDPOINT_ID ?? '',

  drawSyncEnabled: (process.env.DRAW_SYNC_ENABLED ?? 'true') === 'true',
  recommendCacheDays: Number(process.env.RECOMMEND_CACHE_DAYS ?? 7),
  redeemDeadlineDays: Number(process.env.REDEEM_DEADLINE_DAYS ?? 60),
  redeemShopThresholdCent: Number(process.env.REDEEM_SHOP_THRESHOLD_CENT ?? 1000000),
  ocrImageMaxBytes: Number(process.env.OCR_IMAGE_MAX_BYTES ?? 2097152),

  seedDeviceToken: process.env.SEED_DEVICE_TOKEN ?? 'dev-token-local-only',

  // 微信登录（code2session）：同一微信号（openid）多端为同一用户（2026-08-21）
  wechatAppid: process.env.WECHAT_APPID ?? '',
  wechatAppSecret: process.env.WECHAT_APPSECRET ?? '',

  // Rokid 口令绑定盐（2026-08-25）：codeHash = sha256(userId + code + salt)
  pairingSalt: process.env.PAIRING_SALT ?? 'lottery-pairing-salt-v1',

  // ===== 腾讯位置服务（「附近」功能二期后端代理，2026-09-15）=====
  // Key 从「小程序代码包里」挪到服务端（需求 §4.1 方案 B）；仍绑定 AppID wx173a0e58dde32561
  tencentLbsKey: process.env.TENCENT_LBS_KEY ?? '',
  tencentLbsSearchUrl:
    process.env.TENCENT_LBS_SEARCH_URL ?? 'https://apis.map.qq.com/ws/place/v1/search',
  // 关键词固定「彩票」：实测单词即覆盖福彩+体彩两类站点（§2.7），改「福利彩票」会漏体彩站
  poiKeyword: process.env.POI_KEYWORD ?? '彩票',
  // 检索参数：radius 接口硬上限 1000m（超出会被上游拒绝），配合 autoExtend 实际覆盖约 1.5km
  poiRadius: Number(process.env.POI_RADIUS ?? 1000),
  poiAutoExtend: Number(process.env.POI_AUTO_EXTEND ?? 1),
  poiPageSize: Number(process.env.POI_PAGE_SIZE ?? 20),
  poiTimeoutMs: Number(process.env.POI_TIMEOUT_MS ?? 8000),
  // 服务端单日真实调用上限（腾讯个人开发者账号级上限 200 次/日）
  poiDailyLimit: Number(process.env.POI_DAILY_LIMIT ?? 100),
  // 进程内缓存：TTL 与容量（3 位小数网格 ≈ 100 米，越小越省配额、越大越省内存）
  poiCacheTtlHours: Number(process.env.POI_CACHE_TTL_HOURS ?? 24),
  poiCacheMaxEntries: Number(process.env.POI_CACHE_MAX_ENTRIES ?? 200),
  poiGridPrecision: Number(process.env.POI_GRID_PRECISION ?? 3),
});
