# 服务端 · Lottery Helper

好运夹 goodluck+ 的服务端：NestJS 10 + TypeScript + Prisma 6 + MySQL 8。
负责票据识别、开奖同步、期号推算、兑奖判定、号码推演、附近网点代理，以及热力图聚合。

## 目录

```
server/
├── src/
│   ├── main.ts               启动入口（全局 ValidationPipe + CORS）
│   ├── app.module.ts         模块装配 + 全局守卫/拦截器/过滤器
│   ├── api/v1/               11 个控制器，21 条路由
│   ├── modules/              业务模块（auth / user / ticket / lottery / redeem /
│   │                         recommend / statistics / heatmap / lunar / poi）
│   ├── integrations/         火山方舟（OCR + LLM）、豆包搜索（开奖）、腾讯位置服务
│   ├── jobs/                 定时任务：开奖同步 / 兑奖计算 / 热力图聚合 / 清理
│   ├── common/               鉴权守卫、统一响应、异常过滤、期号与日期工具
│   └── config/configuration.ts  环境变量 → 配置对象
├── prisma/                   schema + migrations + seed
├── scripts/                  自检脚本
├── docs/                     第三方服务配置指南
├── Dockerfile
└── docker-compose.yml
```

## 快速开始

```bash
npm install
cp .env.example .env          # 至少填 DATABASE_URL
docker compose up -d mysql    # 或改用本机 MySQL

npx prisma migrate deploy     # 建表
npm run seed                  # 种子数据（幂等）
npm run dev                   # http://localhost:3000
```

健康检查：`GET /health`

**没有第三方 Key 也能跑通全流程**：`ARK_API_KEY` / `VOLC_SEARCH_API_KEY` / `TENCENT_LBS_KEY`
留空时分别降级为本地 mock 识别、本地 mock 推演、开奖同步跳过、附近接口返回 `status=199`。
种子数据已含开奖结果，因此「存档 → 比对 → 兑奖」链路可直接验证。

## 常用命令

```bash
npm run dev              # 开发（node --env-file + watch）
npm run build            # 编译到 dist/
npm run start            # 运行编译产物
npm run seed             # 重灌种子数据（幂等）
npm run typecheck        # 类型检查
npm run verify           # 基础联通性自检
npm run check:volcengine # 火山引擎三件套连通性
npm run test:poi         # 附近代理断言（纯桩：不连库、不消耗配额）
npx prisma studio        # 可视化数据库
```

## 环境变量

见 [`.env.example`](./.env.example)。分七组：

| 组 | 变量 | 说明 |
|---|---|---|
| 应用 | `NODE_ENV` `APP_PORT` | 默认 `development` / `3000` |
| 数据库 | `DATABASE_URL` | `mysql://user:pass@host:3306/db` |
| 微信 | `WECHAT_APPID` `WECHAT_APPSECRET` | 缺省时微信登录报错，前端降级匿名注册 |
| 火山方舟 | `ARK_API_KEY` `ARK_BASE_URL` `ARK_VISION_MODEL` `ARK_LLM_ENDPOINT_ID` `ARK_LLM_MODEL` | OCR + 号码推演 |
| 豆包搜索 | `VOLC_SEARCH_API_KEY` | 开奖同步 |
| 腾讯位置服务 | `TENCENT_LBS_KEY` 及 `POI_*` 一组 | 附近网点代理与配额闸门 |
| 业务与安全 | `REDEEM_*` `RECOMMEND_CACHE_DAYS` `SEED_DEVICE_TOKEN` `PAIRING_SALT` | 见文件注释；后两个**生产必须替换** |

## 第三方服务

### 火山引擎

| 能力 | 控制台 | 用途 |
|---|---|---|
| 方舟 API Key | `console.volcengine.com/ark` → API Key 管理 | 票据 OCR + 号码推演 |
| 推理接入点 | 方舟 → 在线推理 → 推理接入点 | 号码推演用的 `ep-xxx` |
| SearchInfinity | `console.volcengine.com/search-infinity/web-search-exp` | 开奖号码联网检索 |

开通步骤与常见报错见 [`docs/火山引擎配置指南.md`](./docs/火山引擎配置指南.md)。

**OCR 的三个硬约束**（换模型或改 prompt 前必读）：

1. `content` 数组必须**图片在前、文本在后**。文本在前时模型会把 `response_format` 回显成字符串，导致空结果。
2. 方舟要求 `response_format=json_object` 时 prompt 内必须出现 `json` 字样，否则 400 `InvalidParameter`。
   代码里的 `OCR_PROMPT` 自带该字样，别删。
3. 识别到 0 注时必须重试一次再抛错（已实现）。否则空结果会被当成功返回，前端会存下一条空记录。

### 腾讯位置服务

`GET /api/poi/nearby` 是「附近彩站」页的服务端代理：Key 只在服务端、网格缓存跨设备共享、配额闸门在服务端。

| 约束 | 值 |
|---|---|
| 地点搜索配额 | 个人开发者 200 次/日、并发 5；服务端 `POI_DAILY_LIMIT` 默认 100，留一半余量 |
| `radius` 上限 | 1000 米（代码内再夹一次） |
| `keyword` 数量 | 仅 1 个，固定「彩票」（单词即覆盖福彩 + 体彩，改成「福利彩票」会漏体彩站） |
| 坐标体系 | GCJ-02，全链路不转换 |
| 缓存 | 进程内，键为 `gridKey@radius`（3 位小数 ≈ 100 米格边长）+ TTL 24h + 容量上限 |

> Key 必须先在控制台「配额管理 → 账户额度」分配额度，否则接口返回配额错误而不是「Key 无效」。

## 鉴权与响应

- 鉴权：请求头 `X-Device-Token` → 守卫解析出 `req.userId`；`@Public()` 可跳过。
- 身份来源：微信登录（`code` → `code2session` → `openid`，同一微信号多端同账号）或匿名注册（眼镜端）。
  眼镜端用「口令 = `R{userId}-{6位验证码}`」换 token，`codeHash = sha256(userId + code + salt)` 入库。
- 响应：`{ code, message, data }`；业务异常抛 `ApiException`，返回 **HTTP 200 + 业务码**
  （`40001` 校验失败 / `40100` 身份失效 / `50000` 未知）。金额单位统一「分」。

## 定时任务

| 任务 | 频率 | 说明 |
|---|---|---|
| 开奖同步 | 开奖日定时 | 拉取最新开奖，三道过滤剔除站点首页 / 彩评师页面 / 表头连号 |
| 兑奖计算 | 同步后触发 | 待兑奖票据计算金额、档位、截止日与渠道 |
| 热力图聚合 | 每日 | 按用户 × 日期汇总金额与注数，落 5 阶等级 |
| 清理 | 每日 | 过期缓存与调用日志 |

容器时区在三处对齐 `Asia/Shanghai`（Dockerfile 的 `TZ`、compose 的 `environment`、`@Cron` 的 `timeZone`）——
少一处，任务就会按 UTC 执行。

## 部署

```bash
docker compose up -d --build     # nginx 只在 prod profile 里
```

或直接 PM2 托管 `dist/main.js`，前面挂 nginx 反代 `/api` 与 `/health`。
注意：**若新增控制器的路由不在 `/api` 前缀下，必须同步改 nginx location**，否则请求会被静态站点接走。

## 数据模型要点

13 张表，关键约定：

- 金额一律整数「分」（`*_cent`），避免浮点误差
- 球号一律两位字符串数组（`"03"` 而非 `3`），红蓝分列
- 日期列用 `DATE`，读写统一走 `src/common/date-utc.ts` 的 UTC 零点，避免时区漂移
- `draw_results` 对 `(lottery_type, period)` 建唯一索引，重复同步幂等
- `external_call_logs` 记录第三方调用，用于配额闸门与排障

> 历史原因，`users.openid` 与 `rokid_passcode` 表最初是直接在生产库上手工建的。
> 仓库里已补上对应迁移（`prisma/migrations/20261102000000_add_openid_and_rokid_passcode`），
> 新环境直接 `migrate deploy` 即可；**已存在的库请勿重复执行，标记为已应用即可**。

## 排查顺序

遇到「前端页面全空、结构都在、控制台不报错」：

1. 先看 nginx `access.log`，不要先读代码
2. HTTP 200 且字节数吻合（`/api/poi/nearby` ~6KB、`/api/ticket` ~15KB）→ 网络/鉴权/后端一次性排除
3. 响应体只有 60 字节左右 ≈ `{code:40100}`，即令牌失效
4. 真机异常而 IDE 正常 → 先清小程序缓存，再核对 `config.BUILD_VERSION` 与体验版是否一致（改了没上传 = 旧包）
