# 彩票小助手 · 服务端后台开发技术文档

> 文档版本：V1.3.4
> 编制目的：用于指导"彩票小助手"微信小程序主板版本的后台架构设计、接口开发、部署上线与后续运维
> 当前状态：**前后端已联调通过并部署上线**（`https://api.memorymap.cn/api`，2026-08-21），本文已按实际落地代码反向同步
> 适用范围：个人自用 / 低并发小程序产品，部署目标为腾讯云轻量应用服务器
> 关联文档：
> - `微信小程序需求规格文档_V1.0.md`（前端需求与页面交互合同）
> - `彩票小助手-小程序/`（前端代码与 mock 数据，本文档字段口径来源）
> - `部署方案_腾讯云轻量服务器.md`（实际部署方案 v2：PM2 直部署）
> - `backend/`（已落地后端代码，本文与其不一致时**以代码为准**）

---

## 0. 版本变更说明

V1.3.4 相对 V1.3.3 的变更（**OCR 视觉模型统一为 deepseek-v4-1-flash**，2026-10-27）：

1. **OCR 视觉模型统一为 `deepseek-v4-1-flash-261017`**：代码默认值（`configuration.ts` / `vision.service.ts`）与服务器 `.env` 的 `ARK_VISION_MODEL` 同步改为该模型，`doubao-seed-2.0-lite` 退为备选。
2. **上线前实测结论（直连方舟，非推测）**：该模型存在且 Key 有权限；**支持 `image_url` 图片输入**；支持 `response_format={'type':'json_object'}` 与 `thinking={'type':'disabled'}`（与 OCR 现有调用参数完全兼容）。
3. **新增一条参数约束（易踩）**：方舟对 `response_format=json_object` 的统一校验是「prompt 里必须出现 `json` 字样」，否则直接 400 `InvalidParameter: Prompt must contain the word 'json'`。`OCR_PROMPT` 已含 `JSON`，无需改动；**后续若改写 prompt，务必保留该字样**。
4. 变更范围仅 `ARK_VISION_MODEL` 一处（含代码默认值兜底 + 文档/示例），`/api/ticket/ocr` 契约、返回结构、校验逻辑均未变。

V1.3.3 相对 V1.3.2 的变更（**彩票市场休市日历事故修复**，2026-10-07）：

**事故现象**：用户当日录入的大乐透票（第 2026114 期，当晚 21:25 开奖）保存后 20 毫秒即被判为「未中奖」；首页「下一期奖池信息」的期号与金额长期不刷新。

**根因（三层叠加）**：

1. **期号推算缺休市日历**：`issueOfDate` 用硬日历「周一/三/六＝大乐透」，未扣除彩票市场休市日。依《财政部关于 2026 年彩票市场休市安排的公告》（2025 年第 14 号），2026 春节休市 02-14 0:00～02-23 24:00、国庆休市 10-01 0:00～10-04 24:00，休市期间停止销售/开奖/兑奖。国庆 4 天吞掉了大乐透 10-03 一期、双色球 10-01 与 10-04 两期 → **系统期号比官方领先 1 期（大乐透）/ 2 期（双色球）**：系统认定 2026-10-07 ＝ 大乐透第 2026115 期，官方实为第 2026114 期。
2. **脏开奖数据**：定时同步按错误期号去搜「尚未开奖的期」，搜索返回站点首页/推荐页时，兜底解析把页面上的**号码矩阵表头**（`前区 后区 01 02 03 04 05 06 07 08 …` 的前缀）与**彩评师推荐号**当成开奖号码写入 `draw_results`。
3. **兑奖只认期号、不校验开奖日**：`afterSaveDrawCheck` 见到同期号记录即触发结算，票面开奖日尚未到也照判。

**修复**：

- `lottery-rules.ts` 内建 `MARKET_CLOSED_RANGES` 休市日历，由 `isDrawDayOfType` 前置判定 —— 一处收口即覆盖 `issueOfDate` / `nextDrawDate` / `previousDrawDate` / `countDrawDatesInMonth` / `syncDrawByDate`（详见 §9.4.1）；
- `search-infinity.service.ts` 剔除站点首页 URL、扩充垃圾页关键词（擂台/彩评师/胆码/杀号等）、丢弃「从 01 起的整段连号」表头特征；
- 兑奖增设双层防线：票面开奖日晚于开奖记录开奖日 → 挂起不结算（详见 §9.5.1）；
- 数据订正：删除 2 条脏开奖记录（dlt 2026114 / ssq 2026114）、修正 2 期历史错号（dlt 2026107 / ssq 2026112）、重置受影响票据并重算。

**回归用例**：`backend/scripts/check-issue-calendar.ts`（18 条断言，含 2026 休市前后的官方期号对照）。**每年财政部公告次年休市安排后，必须更新 `MARKET_CLOSED_RANGES` 并补充该年度对照用例**，否则会再次静默错位。

V1.3.2 相对 V1.3.1 的变更（**Rokid 眼镜端口令绑定上线**，2026-08-25，依《现有小程序前后台改造说明.md》V1.2）：

1. **新增 2 个口令接口 + 1 张表**：
   - `POST /api/auth/rokid/passcode`（§8.3.1c）：小程序端设置/更新口令验证码（6 位纯数字，upsert 覆盖、旧口令立即失效；1 分钟 >3 次限流 42900）；
   - `POST /api/auth/rokid/bind`（§8.3.1d）：**眼镜端对接接口**——`{userId, code}` 校验后签发 `client_type='rokid_glasses'` token，并失效该用户旧 rokid token（只保留最新）；幂等可重复；10 分钟失败 ≥5 次锁定（42900）；响应携带 `userConfig`（含 `name` 供眼镜端顶栏展示）；
   - 新增表 `rokid_passcode`（§7.3）：`{userId UNIQUE, codeHash(sha256(userId+code+salt)), createdAt, updatedAt}`，口令长期有效无过期；服务端经 `$queryRaw` 访问（Prisma client 未 regenerate，schema 已同步）。
2. **`GET /api/user/config` 响应新增 `userId`**（BigInt 字符串化，§8.3.2）——口令绑定不依赖配置完成，未初始化用户也返回 `userId`。
3. **服务器 `.env` 新增 `PAIRING_SALT`**（codeHash 加盐）。
4. 眼镜端完整对接说明（口令格式 `R{userId}-{code}`、24h 免登录、页面态对应）见《现有小程序前后台改造说明.md》与《眼镜端功能需求说明书.md》V1.2。

V1.3.1 相对 V1.3.0 的变更（**线上事故修复 + 微信登录上线**，2026-08-21 下午）：

1. **🚨 多用户数据隔离（严重越权修复）**：原 `/api/auth/register` 采用"个人单用户"设计（`findFirst` 复用第一个用户），导致**所有登录设备共享同一份数据**（线上事故：他人可见开发者本人购彩数据）。已改为**每次注册创建独立用户**（§8.3.1），并 `TRUNCATE device_tokens` 使全部存量设备重新注册。个人产品单用户假设作废。
2. **微信登录上线（openid 身份验证）**：新增 `POST /api/auth/login`（§8.3.1b）——`wx.login` code → `code2session` 换 `openid` → 按 openid upsert 用户 → 签发 token（`client_type='wechat_openid'`）。**同一微信号手机/PC 多端为同一用户**。`users` 表新增 `openid VARCHAR(64) UNIQUE`（§7.3；ALTER TABLE 已落地，服务端经 `$queryRawUnsafe` 访问，本地 schema 已同步、Prisma client 后续统一 regenerate）。服务器 `.env` 新增 `WECHAT_APPID` / `WECHAT_APPSECRET`。匿名 `register` 保留（眼镜端等无微信环境使用）。
3. **异常友好化**：`validateBalls` 号码校验由裸 `Error` 改为 `ApiException(40001)`（此前被统一过滤器误报 50000「服务器内部错误」）；`http-exception.filter` 对 `MulterError`/`PayloadTooLargeException(413)` 返回 `40001 图片超过 2048KB 上限`（此前 FileInterceptor 将 multer 超限转 413 后被误报 50000）。
4. **金额展示统一整数元**：`fmtMoney` 输出 `¥3,000`（去角分，`Math.round` 取整）；存储与计算仍为"分"精度，仅展示层变更。
5. **nginx 上传限制**：`client_max_body_size 5m`（原默认 1MB 导致相册照片上传直接被 nginx 413 拦截，请求到不了后端；已上线，配置备份 `.bak.20260821`）。
6. **多端身份迁移注意事项**：存量匿名 token 不会自动升级为 openid 用户；正式发布前应再次清空 `device_tokens`，使全部用户以 openid 身份进入（联调期数据少，无损失）。

V1.3.0 相对 V1.2.3 的变更（**依据联调部署通过后的实际代码反向更新**）：

1. **部署方式改写为 PM2 直部署**：原 Docker Compose 方案因服务器现状作废（OpenCloudOS 9.2 / 1.7G 内存，Node 22 + PM2 + MySQL 8 + Nginx + HTTPS 全部现成，无需 Docker）。详见 §4.2、§14 与《部署方案_腾讯云轻量服务器.md》。生产域名定为 `api.memorymap.cn`。
2. **SearchInfinity 端点更新**：旧端点 `torchlight.byteintlapi.com` 已失效，实际使用 `https://open.feedcoopapi.com/search_api/web_search`（§6.1、§13）。
3. **日志方案落地为 NestJS 内置 Logger**：未引入 nestjs-pino（个人项目从简），§3.1、§12.1 同步修正；HTTP 客户端用 Node 22 原生 `fetch`，未引入 axios/undici。
4. **接口契约补齐（联调中新增/细化的字段）**：
   - `POST /api/ticket` 响应返回 `{ id, status }`，`status` 为保存后自动开奖比对的结果（§8.3.4）；
   - `GET /api/ticket` 列表项新增 `id`、`winningRed`、`winningBlue`（该期真实开奖号码，供前端逐球高亮），`bets[]` 新增 `matchedRed`、`matchedBlue`（§8.3.5）；
   - `POST /api/redeem/confirm` 支持 `id`（RedeemRecord.id）或 `ticketId`（Ticket.id）二选一（§8.3.8）；
   - `GET /api/statistics` 新增 `totalSpent`、`totalWon`（本月花费/中奖总额，分），前端统计卡改为"已购/花费/中奖"三项（§8.3.12）；
   - `POST /api/recommend` 新增可选参数 `refresh`（绕过当日缓存强制重算，"重新生成"按钮用）（§8.3.14）。
5. **OCR 图片上限统一为 2MB**（`OCR_IMAGE_MAX_BYTES` 默认 2097152），修正原 1MB 口径（§9.2、§13）。
6. **热力图等级阈值落地口径**：L1 ≤¥4 / L2 ≤¥10 / L3 ≤¥30 / L4 >¥30（图例文案仍为"¥50+"）；API 实时聚合，`HeatmapDailyStat` 保留作缓存扩展（§9.7）。
7. **开奖同步定时任务定型**：每天凌晨 1 点拉取"前一日及之前最近一期"（次日凌晨同步绝无竞态），替代原"开奖日 21:00-23:00 每 10 分钟"方案；§10.2/§10.3 同步。
8. **开发实施顺序（§15）与前端联调待办（§15.2.1）已全部完成**，标记为落地状态。

V1.2.3 相对 V1.2.2 的变更（OCR 模型二次切换）：

1. **OCR 视觉模型切换为 `doubao-seed-2.0-lite`**：`doubao-seed-2.0-lite` 亦将下线（用户实测反馈），且用户已开通 `doubao-seed-2.0-lite` / `doubao-seed-2.0-mini`（官方公告推荐替代的多模态深度思考模型）。默认模型统一改为 **`doubao-seed-2.0-lite`**，备选 `doubao-seed-2.0-mini`；模型名直调失败时可在方舟创建推理接入点，将 `ep-xxx` 填入 `ARK_VISION_MODEL`（代码支持 ep- 接入点直填）。

V1.2.2 相对 V1.2.1 的变更（OCR 模型替代）：

1. **OCR 视觉模型切换**：`Doubao-1.5-vision-pro` 全部版本已于 2026-03-31 被火山引擎 LAS 平台官方下线（下线公告：`volcengine.com/docs/6492/2275237`）。本文档与代码中的 OCR 模型先替换为 **`doubao-seed-1.6-vision`**（256K 视觉理解，输入 0.8 元/百万 tokens，支持图片/视频/音频输入；后因该模型亦将下线，已在 V1.2.3 再次切换为 `doubao-seed-2.0-lite`）。

V1.2.1 相对 V1.2 的变更（开发启动前审查修订）：

1. **补齐 3 个遗漏接口**：`DELETE /api/ticket/:id`（台账票据删除）、`POST /api/redeem/confirm`（兑奖确认）、`GET /health`（健康检查）。前两者的前端操作（`ledger.js` 的删除/兑奖按钮）当前为本地 mock 行为，联调时前端需补上真实 API 调用，否则刷新后状态丢失。
2. **修复 `LotteryStatus` 表设计矛盾**：原 `purchased` 字段是 per-user 语义，不能落在全局彩种缓存表。已从表中移除，改为 `/api/lottery/status` 查询时根据当前用户票据动态计算。
3. **补齐容器时区配置（关键坑）**：Docker 容器默认 UTC，不设 `TZ=Asia/Shanghai` 会导致 cron 在错误时间执行（21:00 UTC = 北京时间次日 05:00）。已在 Dockerfile、docker-compose、@Cron 配置三处补齐。
4. **补齐 3 个接口的响应契约**：`/api/statistics`、`/api/lunar`、`/api/lottery/draw`（含 `issue` 可选参数语义）。
5. **修复代码示例错误**：Controller 示例补 `UploadedFile` import；docker-compose 补 MySQL healthcheck 与 app 启动依赖条件；移除已废弃的 `version` 字段。
6. **明确 `period` 字段存储与输出格式**：库存纯数字（如 `2026101`），API 输出格式化为"第 2026101 期"。

V1.2 相对 V1.1 的主要变更：

1. **技术栈整体切换为 Node.js**：用户熟悉 Node.js，维护成本与上手成本是单人项目的压倒性因素。火山方舟三款产品均兼容 OpenAI SDK 协议，Node.js 用 `openai` npm 包即可调用，不需要 Python 专属 SDK。
2. **技术栈定型**：NestJS + TypeScript + Prisma + MySQL 8 + @nestjs/schedule + openai npm 包 + pino + Docker Compose + Nginx。
3. **所有代码示例改为 TypeScript**：SearchInfinity 调用、Doubao Vision OCR、火山方舟 LLM、定时任务均给出 TS 实现。
4. **保留业务设计不变**：数据库表结构、API 字段对齐、模块职责、火山引擎接入逻辑、定时任务清单、安全合规、部署方案均沿用 V1.1。

V1.1 相对 V1.0 的变更（保留备查）：

1. 火山引擎产品接入方式澄清（SearchInfinity 实为豆包搜索联网 API）。
2. 三款火山引擎产品定型。
3. 前端字段对齐（基于 `彩票小助手-小程序/utils/api.js` + `utils/mock.js`）。
4. 数据库表结构修订。
5. 接入代码示例补全。
6. 移除腾讯云 COS 依赖，图片 base64 直传多模态模型。

---

## 1. 文档目标

本文聚焦微信小程序主板版本的完整后台方案，从小程序当前页面与交互出发，定义一套适合个人产品的后端技术架构。

目标如下：

1. 为当前小程序前端提供完整、稳定、低成本的后台能力；
2. 支撑初始化配置、OCR 录入、开奖同步、兑奖提醒、推荐生成、台账统计全链路；
3. 适配腾讯云轻量应用服务器的单机部署场景，优先控制复杂度与运维成本；
4. 接入火山引擎三款产品：
   - 开奖结果查询：`SearchInfinity`（豆包搜索）
   - 彩票 OCR：`deepseek-v4-1-flash-261017` 多模态视觉理解模型
   - 号码推荐 LLM：火山方舟 `doubao-seed-2-1-pro` 系列文本大模型
5. 预留后续扩展空间，但当前实现坚持"单体优先、模块清晰、能跑能维护"。

---

## 2. 业务范围

当前后台需要支撑以下业务模块：

1. 设备注册与轻量鉴权
2. 用户配置读写
3. 彩票图片上传与 OCR 结构化识别
4. 彩票票据存档与查询
5. 开奖状态同步与开奖结果落库
6. 待兑奖记录计算与状态处理
7. 首页统计数据聚合
8. 台账热力图与开奖记录联动
9. 趣味号码推荐生成与缓存

### 2.1 与前端页面对应关系

| 前端页面 | 后台能力 | 主要接口 |
|---|---|---|
| `pages/init` | 用户配置保存、读取 | `/api/auth/register`、`/api/user/config` |
| `pages/home` | 待兑奖提醒、当前开奖状态、购彩统计 | `/api/redeem/pending`、`/api/lottery/status`、`/api/statistics`、`/api/ticket`、`/api/redeem/confirm` |
| `pages/record` | OCR、票据保存、选号规则校对 | `/api/ticket/ocr`、`/api/ticket` |
| `pages/recommend` | 用户配置读取、推荐生成、分析摘要 | `/api/user/config`、`/api/recommend` |
| `pages/ledger` | 热力图、票据列表、开奖说明、状态流转、补差同步 | `/api/heatmap`、`/api/ticket`、`/api/lottery/status`、`/api/lottery/draw`、`/api/lottery/sync`、`/api/ticket/:id`（DELETE）、`/api/redeem/confirm` |

---

## 3. 推荐技术架构

### 3.1 总体建议

对于"个人自用 + 腾讯云轻量服务器 + 外部 AI 服务接入"的组合，采用：

- **架构形态**：模块化单体后端
- **运行时**：Node.js 22 LTS
- **语言**：TypeScript 5.x
- **Web 框架**：NestJS
- **ORM / 数据迁移**：Prisma
- **数据库**：MySQL 8.0
- **缓存**：Redis 可选，首期可不强依赖
- **图片处理**：base64 直传多模态模型，不持久化（OCR 完成即释放）
- **AI SDK**：`openai` npm 包（兼容火山方舟协议）
- **HTTP 客户端**：undici（Node.js 内置）或 axios
- **校验**：class-validator + class-transformer（NestJS 标配）
- **定时任务**：@nestjs/schedule（封装 node-cron）
- **日志**：NestJS 内置 `Logger`（V1.3 落地口径：个人项目从简，未引入 pino；结构化需求升高后再切换 nestjs-pino）
- **HTTP 客户端**：Node.js 22 原生 `fetch`（SearchInfinity 调用）+ `openai` npm 包（方舟 OCR/LLM）
- **反向代理**：Nginx（服务器已配置 `api.memorymap.cn:443` → `127.0.0.1:3000`，certbot 证书）
- **进程与部署**：PM2 直部署（V1.3 落地口径：Docker Compose 方案作废保留备选，见 §14）

### 3.2 选择理由

**为什么选 NestJS 而不是 Fastify / Express**：

1. 项目有 9 个业务模块（auth/user/ticket/lottery/redeem/recommend/statistics/heatmap/lunar），NestJS 的 Module 系统天然适合模块化拆分；
2. 装饰器 + 依赖注入让控制器、服务、仓储分层清晰，单人维护时也容易定位代码；
3. 内置 OpenAPI / Swagger 文档生成，方便前端联调；
4. `@nestjs/schedule` 装饰器直接写定时任务，无需额外进程；
5. class-validator 做 DTO 校验，与 Pydantic 体验对齐。

**为什么选 Prisma 而不是 TypeORM / Drizzle**：

1. Schema-first：`schema.prisma` 一份文件定义全部表结构 + 关系 + 索引，直观；
2. 类型安全最强：生成的 Prisma Client 类型与 schema 严格对齐，TS 项目里 DX 最好；
3. 迁移工具 `prisma migrate` 成熟，比 TypeORM 迁移更稳定；
4. 个人项目查询简单，Prisma 的查询 API 完全够用。

**为什么用 `openai` npm 包调火山方舟**：

火山方舟三款产品（SearchInfinity 走 HTTP、Doubao Vision、doubao-seed LLM）都兼容 OpenAI Chat Completions 协议。Node.js 直接用官方 `openai` npm 包，把 `baseURL` 改成 `https://ark.cn-beijing.volces.com/api/v3` 即可，无需火山引擎专属 SDK。

### 3.3 为什么不推荐微服务

当前项目不建议直接做微服务，原因如下：

1. 并发规模小，单体架构足以承载；
2. 部署目标是单台腾讯云轻量服务器，微服务会明显增加运维复杂度；
3. 业务模块虽多，但大多数是共享用户、票据、开奖结果等核心数据；
4. 外部依赖已经较多，再叠加服务拆分会使问题定位更困难。

当前阶段更合理的策略是：

- **代码按模块拆分**（NestJS Module）
- **服务按单体部署**（一个 Node.js 进程）
- **任务按同步/异步分类**（同步 API + 定时任务）
- **数据按统一模型治理**（Prisma schema）

### 3.4 备选方案

如果后续有特殊需求：

- **更轻的框架**：Fastify（性能更高，但需要自己组织模块结构）
- **更接近 SQL 的 ORM**：Drizzle ORM（适合复杂 SQL 场景）
- **需要队列**：BullMQ + Redis（首期不需要，未来若有重试需求再引入）

---

## 4. 部署目标与资源建议

### 4.1 腾讯云轻量服务器建议（实际已落地）

实际部署服务器（SSH 实测，2026-08-20）：

- **实例**：腾讯云轻量 `YOUR_INSTANCE_ID`（北京 ap-beijing，YOUR_SERVER_IP）
- **系统**：OpenCloudOS 9.2（1.7G 内存 / 40G 磁盘）
- **Node.js**：v22.12.0 ✅（正好是项目要求的 Node 22 LTS）
- **PM2**：v6.0.14 ✅（进程守护）
- **MySQL**：8.0.45 原生安装（systemd `mysqld`，新建 `lottery_helper` 库）
- **Nginx**：已配置 `api.memorymap.cn:443` → `127.0.0.1:3000`
- **HTTPS**：certbot 证书已生效（腾讯云免费证书留作备用）

这套配置足够支撑：

- 小程序 API 服务（Node.js 单进程，PM2 托管）
- MySQL
- Nginx
- 定时任务（同进程内）
- 少量本地日志

如后续推荐调用频率升高、需要 BullMQ 队列，建议升级到 4 核 8 GB。

### 4.2 部署方式（实际：PM2 直部署）

**已落地为 PM2 直部署**（"停旧换新"，改动面最小）：

1. 上传代码（tar 打包，排除 node_modules/dist/.env）→ `npm install` → `npm run build`（tsc → dist/）
2. 配置生产 `.env` → `npx prisma migrate deploy` → `pm2 start dist/main.js --name lottery-helper`
3. Nginx + HTTPS 证书沿用服务器现有配置，零改动

> 原 Docker Compose 方案（nginx/app/mysql/redis 四容器）因服务器 1.7G 内存不适合跑 Docker、且 Node/PM2/MySQL/Nginx/HTTPS 全部现成而作废，配置文件保留于 §14 作备选。详见《部署方案_腾讯云轻量服务器.md》。

### 4.3 域名与 HTTPS（已上线）

生产域名已定并完成配置：

- `https://api.memorymap.cn/api`（小程序 `config/index.js` 的 `apiBaseUrl`）

已完成的配置：

1. 腾讯云 DNS 解析 ✅
2. 微信小程序"request 合法域名"配置 ✅
3. Nginx HTTPS 证书部署（certbot，自动续期）✅

---

## 5. 系统架构设计

### 5.1 分层设计

后台按以下层次组织：

```
Controller Layer    ─── NestJS Controller，负责 HTTP 入参/出参、鉴权装饰器
  │
Service Layer      ─── 业务编排（user/ticket/redeem/recommend/...）
  │
Domain Layer        ─── 彩种规则、兑奖规则、推演 Prompt 模板
  │
Repository Layer    ─── Prisma Client 数据访问
  │
External Adapter   ─── 火山引擎三产品（openai npm + 原生 fetch）
  │
Scheduler          ─── @nestjs/schedule 装饰器
```

### 5.2 模块划分（实际落地结构）

```text
backend/
  src/
    main.ts                     # 应用入口（全局 ValidationPipe + CORS，监听 0.0.0.0:3000）
    app.module.ts               # 根模块
    api/
      v1/                       # 10 个 Controller（统一 api/ 路由前缀）
        auth.controller.ts      # POST /api/auth/register
        user.controller.ts      # GET/POST /api/user/config
        ticket.controller.ts    # POST /api/ticket/ocr、POST/GET /api/ticket、DELETE /api/ticket/:id
        lottery.controller.ts   # GET /api/lottery/status|draw、POST /api/lottery/sync
        redeem.controller.ts    # GET /api/redeem/pending、POST /api/redeem/confirm
        recommend.controller.ts # POST /api/recommend
        statistics.controller.ts# GET /api/statistics
        heatmap.controller.ts   # GET /api/heatmap
        lunar.controller.ts     # GET /api/lunar
        health.controller.ts    # GET /health（无鉴权，探活）
    modules/                    # 业务模块（service + dto）
      auth/
      user/
      ticket/
      lottery/                  # lottery-rules.ts（彩种规则/开奖日历/期号锚点）、
                               # draw-sync.service.ts（SearchInfinity 同步 + 解析 + 多候选投票）
      redeem/                   # prize-rules.ts（双色球六等/大乐透八等中奖规则）
      recommend/
      statistics/
      heatmap/
      lunar/
    integrations/               # 外部服务适配层
      volcengine/
        search-infinity.service.ts   # 豆包搜索（开奖查询，open.feedcoopapi.com 端点）
        vision.service.ts            # deepseek-v4-1-flash-261017（OCR，base64 直传）
        ark.service.ts               # 火山方舟 LLM（号码推荐，ep-xxx 接入点）
        local-mock.ts                # 无 Key 兜底 mock（联调用）
    prisma/
      prisma.module.ts
      prisma.service.ts
    jobs/                       # @nestjs/schedule 定时任务
      draw-sync.job.ts          # 每天凌晨 1 点开奖同步 + 每 5 分钟状态刷新
      redeem-compute.job.ts     # 每 15 分钟兑奖预计算兜底
      heatmap-aggregate.job.ts  # 每小时热力图聚合（缓存预写）
      cleanup.job.ts            # 凌晨 3 点清推荐缓存 / 4 点清外部调用日志
    common/                     # 横切能力（扁平文件）
      device-token.guard.ts     # X-Device-Token 鉴权 Guard
      transform.interceptor.ts  # 统一 {code, message, data} 包装
      http-exception.filter.ts  # 异常 → 错误码映射
      api-exception.ts          # 业务异常类
      public.decorator.ts       # @Public() 跳过鉴权
      date-utc.ts               # utcDate/utcToday/addDaysUtc（⚠️ Prisma DATE UTC 陷阱）
      format.ts                 # fmtDate/fmtMoney/fmtDuration
    config/
      configuration.ts          # 环境变量集中读取
  prisma/
    schema.prisma               # 12 张表（以该文件为唯一真源）
    migrations/
    seed.ts                     # 种子数据（彩种状态 + 开发 Token）
  scripts/
    check-volcengine.ts         # 三产品连通性检查（npm run check:volcengine）
    verify.ts                   # 核心逻辑自检（npm run verify）
  package.json
  tsconfig.json
```

### 5.3 模块职责

| 模块 | 职责 |
|---|---|
| `auth` | 设备注册、Token 签发与校验 |
| `user` | 用户配置读写、字段兼容映射 |
| `ticket` | OCR 结果接收、票据保存、列表查询、规则校验 |
| `lottery` | 开奖状态、开奖结果、彩种规则 |
| `redeem` | 待兑奖计算、兑奖处理（含 60 天时效与渠道判定） |
| `recommend` | 推荐生成、摘要缓存、免责声明输出 |
| `statistics` | 首页统计聚合 |
| `heatmap` | 热力图数据与台账筛选支撑 |
| `lunar` | 农历干支计算 |
| `jobs` | 定时同步开奖、兑奖预计算、缓存刷新 |

---

## 6. 火山引擎三产品接入方案

### 6.1 开奖结果查询：SearchInfinity（豆包搜索）

#### 6.1.1 产品本质澄清

火山引擎 `SearchInfinity` 在控制台路径为 `console.volcengine.com/search-infinity/web-search-exp`，本质是**面向 Agent 的联网搜索 API**（即"豆包搜索"），并非结构化数据查询接口。

它的返回特征：

- 返回清洗后的正文（中文热点约 1100 字/条）
- 每条结果带发布时间戳 + 来源链接
- 附 `ContentTokenCount`（每条结果的 token 计数）
- 对股票、黄金、外汇、航班、车次、演出等返回结构化"如意卡片"

对彩票开奖场景而言，它**不是直接返回 `{红球:[], 蓝球:[]}` 的结构化接口**，而是返回搜索结果（含正文与可能的卡片）。**后端必须做二次结构化解析**才能落库。

#### 6.1.2 推荐用法

将 SearchInfinity 作为**开奖结果查询主入口**，但不要将其原始返回直接透传给前端，而应经过后台统一结构化。

后台处理流程（实际落地，见 `draw-sync.service.ts`）：

1. 定时任务按彩种构造查询语句（如"双色球 2026101 期 开奖号码"）。**期号必须用官方写法：ssq 7 位（2026090）、dlt 5 位（26090）**——格式不一致会导致搜索召回偏移、抓错期的号码
2. 调用 SearchInfinity 获取搜索结果（二轮策略：先带官方三站过滤 `zhcw.com|cwl.gov.cn|sporttery.cn`，失败后无站点过滤重搜——历史期官方三站召回不足，地方福彩公告有完整正文）
3. 服务端正则解析红蓝球，**多候选投票**：多个来源解析出的号码组合一致才判定高置信，避免单一脏源污染
4. 格式标准化与规则校验（球号范围、数量、不重复）
5. upsert `DrawResult`（`lotteryType + period` 唯一索引，幂等）与更新 `LotteryStatus`
6. 触发兑奖计算

#### 6.1.3 调用示例（TypeScript）

```typescript
// src/integrations/volcengine/search-infinity.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ⚠️ V1.3：旧端点 torchlight.byteintlapi.com 已失效，现为 open.feedcoopapi.com
const SEARCH_INFINITY_BASE = 'https://open.feedcoopapi.com/search_api/web_search';

export interface SearchInfinityResult {
  redBalls: string[];
  blueBalls: string[];
  sourceName?: string;
  sourceUrl?: string;
  sourceRaw?: string;
}

@Injectable()
export class SearchInfinityService {
  private readonly logger = new Logger(SearchInfinityService.name);

  constructor(private readonly config: ConfigService) {}

  async searchDrawResult(lotteryName: string, issueNo: string): Promise<unknown> {
    const query = `${lotteryName} 第 ${issueNo} 期 开奖号码 红球 蓝球`;
    const payload = {
      query,
      count: 5,
      language: 'ZH-HANS',
      filters: { sites: 'zhcw.com|cwl.gov.cn|sporttery.cn' },
    };
    const headers = {
      Authorization: `Bearer ${this.config.get<string>('VOLC_SEARCH_API_KEY')}`,
      'Content-Type': 'application/json',
    };
    const res = await fetch(SEARCH_INFINITY_BASE, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`SearchInfinity HTTP ${res.status}`);
    return res.json();
  }

  parseSsqDraw(searchResponse: any): SearchInfinityResult | null {
    const items = searchResponse?.data?.search_results ?? [];
    for (const item of items) {
      const content: string = item.content ?? '';
      const m = content.match(/红球[：:\s]*([\d\s]{17,})蓝球[：:\s]*(\d{2})/);
      if (!m) continue;
      const red = [...new Set(m[1].trim().split(/\s+/))].sort();
      const blue = m[2];
      if (red.length === 6 && red.every((x) => Number(x) >= 1 && Number(x) <= 33)) {
        return {
          redBalls: red.map((x) => String(Number(x)).padStart(2, '0')),
          blueBalls: [blue],
          sourceName: item.source,
          sourceUrl: item.url,
          sourceRaw: content.slice(0, 500),
        };
      }
    }
    return null;
  }
}
```

#### 6.1.4 优点与风险

**优点**：不需要自己维护彩票源站抓取逻辑；对个人产品更省时间；可借助检索结果覆盖不同信息源。

**风险与应对**：

| 风险 | 建议 |
|---|---|
| 搜索结果结构不稳定 | 后台必须做结构化解析与容错，解析失败保留原始响应供排查 |
| 数据源偶发延迟 | 允许"定时同步 + 手动补拉"双机制；开奖日凌晨再补一次 |
| 结果可信度问题 | 记录原始检索文本与来源 URL，便于人工核对 |
| 免费配额限制 | 豆包搜索每月 500 次免费配额，按彩种每周 2 期，每月约 16 次，配额充足 |

#### 6.1.5 落库建议

`DrawResult` 表新增字段：

- `sourceName`：数据来源名称
- `sourceUrl`：来源链接
- `sourceRaw`：原始检索内容（截断 500 字）
- `syncStatus`：`pending/synced/failed`
- `syncedAt`：同步时间

---

### 6.2 彩票 OCR：deepseek-v4-1-flash-261017 多模态视觉理解模型

#### 6.2.1 推荐用法

OCR 不采用传统 OCR + 规则解析的双段式，而采用：

- **图片 base64 编码**（内存中即用即弃，不落盘、不入库、不入 COS）
- **多模态视觉理解模型直接输出结构化 JSON**

目标是让模型直接从彩票照片中抽取并整理成指定格式。`deepseek-v4-1-flash-261017` 支持图片 + 文本混合输入（接受 http/https/tos/s3 URL、Base64 编码、原始二进制三种输入源），输出文本，完全契合本场景。

> **图片生命周期**：图片仅用于本次 OCR 识别，OCR 完成后立即从内存释放，不持久化、不展示、不入库。因此本项目**不需要腾讯云 COS 或任何对象存储**依赖。

#### 6.2.2 期望输出格式（与前端 `mock.ocrResult` 严格对齐）

```json
{
  "lotteryName": "双色球",
  "period": "第 2026101 期",
  "drawDate": "2026-08-19",
  "ocrStatus": "OCR 已识别",
  "betCount": 2,
  "multiplier": 1,
  "totalAmount": "¥ 4.00",
  "bets": [
    { "id": 1, "red": ["03","08","12","18","26","31"], "blue": ["09"], "mult": 1 },
    { "id": 2, "red": ["05","11","17","23","29","32"], "blue": ["07"], "mult": 1 }
  ]
}
```

> 注意：前端 `record.js` 的 `buildOcrState` 会在此基础上补 `lotteryType`、`amountSummaryText` 等字段，后台返回时只需给出上述原始字段即可。

#### 6.2.3 调用示例（TypeScript）

```typescript
// src/integrations/volcengine/vision.service.ts
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';

const VISION_MODEL = 'deepseek-v4-1-flash-261017'; // V1.3.4 统一；可由 ARK_VISION_MODEL 覆盖（支持填 ep-xxx 接入点）

const OCR_PROMPT = `你是一个彩票识别助手。请仔细识别这张彩票照片，输出严格的 JSON 格式：
{
  "lotteryName": "双色球" 或 "大乐透",
  "period": "第 XXXXXXX 期",
  "drawDate": "YYYY-MM-DD",
  "betCount": 注数,
  "multiplier": 整体倍数,
  "bets": [
    { "id": 1, "red": ["01"-"33" 共 6 个 双色球 / "01"-"35" 共 5 个 大乐透],
      "blue": ["01"-"16" 共 1 个 双色球 / "01"-"12" 共 2 个 大乐透],
      "mult": 单注倍数 }
  ]
}
只输出 JSON，不要解释。`;

export interface OcrResult {
  lotteryName: string;
  period: string;
  drawDate: string;
  ocrStatus: string;
  betCount: number;
  multiplier: number;
  totalAmount: string;
  bets: Array<{ id: number; red: string[]; blue: string[]; mult: number }>;
}

@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);
  private readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('ARK_API_KEY'),
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    });
  }

  /**
   * 调用 deepseek-v4-1-flash-261017 识别彩票图片。
   * 图片以 base64 编码直传模型，不落盘、不持久化。
   * 调用完成后 imageBytes 即可被 GC 回收。
   */
  async recognizeTicketImage(imageBytes: Buffer): Promise<OcrResult> {
    const imageB64 = imageBytes.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${imageB64}`;

    const completion = await this.client.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      // 强制 JSON 输出（部分模型支持 response_format）
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    return JSON.parse(raw) as OcrResult;
  }
}
```

> **关于图片体积**：base64 编码会让请求体膨胀约 33%。建议在 API 入口对图片做尺寸校验与压缩（前端 `wx.compressImage` 已在需求文档 §12.4 中提及），单张图片建议 ≤ 1MB，避免触发模型请求体上限。

#### 6.2.4 后台处理流程

```
前端上传图片（multipart/form-data, 字段名 file）
  └─ 后台读取图片 Buffer（不落盘）
      └─ base64 编码 → 调用 deepseek-v4-1-flash-261017
          └─ 要求输出 JSON
              └─ 服务端做 Schema 校验（class-validator）
                  └─ 通过彩种规则校验？
                      ├─ 是 → 返回 OCR 结果（Buffer 随函数返回即释放）
                      └─ 否 → 标记 needReview=true，前端走手动校对抽屉
```

#### 6.2.5 服务端必须校验的内容

双色球（`ssq`）：

- 红球数量必须为 6，蓝球数量必须为 1
- 红球范围 01-33，蓝球范围 01-16
- 不允许重复

大乐透（`dlt`）：

- 前区数量必须为 5，后区数量必须为 2
- 前区范围 01-35，后区范围 01-12
- 不允许重复

校验失败时，**不直接报错退出**，而是返回 `needReview=true`，由前端走 `pages/record` 的手动校对抽屉修正号码。

---

### 6.3 号码推荐 LLM：火山方舟 doubao-seed-2-1-pro 系列文本大模型

#### 6.3.1 产品说明

火山方舟（`https://console.volcengine.com/ark`）提供 `doubao-seed-2-1-pro-260628` 等文本大模型，**完全兼容 OpenAI SDK 协议**。Node.js 直接用 `openai` npm 包：

- `base_url`：`https://ark.cn-beijing.volces.com/api/v3`
- `api_key`：在火山方舟控制台「API Key 管理」创建
- `model` 参数：填**推理接入点 ID**（Endpoint ID，如 `ep-202606xxxxxx-xxxxx`），而非模型名

计费：按 token 计费，Pro 系列 0.02 元/千 tokens（输出），Lite 系列可低至 0.001 元/千 tokens。

#### 6.3.2 推荐用法

后台维护两套独立推演模板：

1. **星座占星**（`astrology`）
2. **五行推命**（`iching`）

模型输入：用户姓名、性别、出生日期、当前日期、农历干支、推演模式、彩种。
模型输出：号码结果（红球 + 蓝球）、简短分析摘要、娱乐免责声明。

#### 6.3.3 期望输出格式（与前端 `mock.recommend` 严格对齐）

```json
{
  "systemName": "星座占星",
  "date": "2026-08-19 周三",
  "userText": "春生 · 2000-01-15 生 · 今日 丙午年七月初一",
  "redLabel": "红球区 · 6 个",
  "blueLabel": "蓝球区 · 1 个",
  "redBalls": ["03","08","15","21","27","30"],
  "blueBalls": ["09"],
  "summary": "今日火星入命宫，红球偏向高频区 03/08/15/21/27/30，蓝球取幸运数位 9，祝您好运。",
  "disclaimer": "本推荐仅供娱乐，不构成任何购彩建议"
}
```

#### 6.3.4 调用示例（TypeScript）

```typescript
// src/integrations/volcengine/ark.service.ts
import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';

const ASTROLOGY_PROMPT_TEMPLATE = `你是星座占星推演助手。请基于以下信息，为用户生成一组双色球/大乐透号码，并给出简短分析。

用户信息：
- 姓名：{name}
- 性别：{gender}
- 出生日期：{birth}
- 今日：{date}
- 今日干支：{ganZhi}
- 彩种：{lotteryName}

要求：
1. 双色球：6 个红球（01-33）+ 1 个蓝球（01-16）；大乐透：5 个前区（01-35）+ 2 个后区（01-12）
2. 输出严格 JSON，字段：systemName/date/userText/redLabel/blueLabel/redBalls/blueBalls/summary/disclaimer
3. summary 控制在 80 字以内
4. disclaimer 固定为："本推荐仅供娱乐，不构成任何购彩建议"
只输出 JSON，不要解释。`;

const ICHING_PROMPT_TEMPLATE = `你是五行推命推演助手。请基于以下信息，结合今日卦象与五行旺相，为用户生成号码。

用户信息：{userBlock}

要求：
1. 双色球：6 红（01-33）+ 1 蓝（01-16）；大乐透：5 前区（01-35）+ 2 后区（01-12）
2. 输出严格 JSON，字段同上
3. summary 控制在 80 字以内
只输出 JSON，不要解释。`;

export interface RecommendResult {
  systemName: string;
  date: string;
  userText: string;
  redLabel: string;
  blueLabel: string;
  redBalls: string[];
  blueBalls: string[];
  summary: string;
  disclaimer: string;
}

interface UserConfig {
  name?: string;
  gender?: string;
  birth?: string;
}

interface LunarInfo {
  solarDate?: string;
  ganZhi?: Record<string, string>;
}

@Injectable()
export class ArkService {
  private readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('ARK_API_KEY'),
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    });
  }

  async generateRecommendation(
    userConfig: UserConfig,
    lunarInfo: LunarInfo,
    system: 'astrology' | 'iching',
    lottery: 'ssq' | 'dlt',
  ): Promise<RecommendResult> {
    const lotteryName = lottery === 'ssq' ? '双色球' : '大乐透';
    const template = system === 'astrology' ? ASTROLOGY_PROMPT_TEMPLATE : ICHING_PROMPT_TEMPLATE;
    const ganZhi = lunarInfo.ganZhi ? JSON.stringify(lunarInfo.ganZhi) : '';

    const prompt =
      system === 'astrology'
        ? template
            .replace('{name}', userConfig.name ?? '')
            .replace('{gender}', userConfig.gender ?? '')
            .replace('{birth}', userConfig.birth ?? '')
            .replace('{date}', lunarInfo.solarDate ?? '')
            .replace('{ganZhi}', ganZhi)
            .replace('{lotteryName}', lotteryName)
        : template.replace(
            '{userBlock}',
            `姓名：${userConfig.name ?? ''} / 性别：${userConfig.gender ?? ''} / 生日：${userConfig.birth ?? ''} / 今日：${lunarInfo.solarDate ?? ''} / 干支：${ganZhi}`,
          );

    const completion = await this.client.chat.completions.create({
      model: this.config.get<string>('ARK_LLM_ENDPOINT_ID'),  // ep-xxx
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    return JSON.parse(raw) as RecommendResult;
  }
}
```

#### 6.3.5 推荐策略

- 结果按 `userId + date + system + lottery` 做日级缓存
- 同一天重复进入推荐页时优先命中缓存
- 点击"重新生成"时支持 `refresh=true` 参数强制重算

对个人产品，建议默认：

- 同一天同配置走缓存
- 手动点击"重新生成"时强制刷新一次

---

### 6.4 火山引擎之外的备选方案

如果后续你希望进一步降低对单一供应商的依赖，推荐保留以下备选能力：

- **开奖结果备选**：官方福彩网（`cwl.gov.cn`）+ 体彩网（`sporttery.cn`）+ 结构化抓取
- **OCR 备选**：阿里云 / 百度 / 腾讯云通用 OCR + 自定义解析规则
- **LLM 备选**：支持 OpenAI 兼容协议的其他文本模型（DeepSeek、Moonshot Kimi、Qwen-Max）

建议做法不是立刻双活，而是在集成层预留 provider 抽象：

```typescript
// src/integrations/providers.interface.ts
export interface DrawProvider {
  fetchDraw(lottery: string, issue: string): Promise<DrawResult>;
}
export interface OcrProvider {
  recognize(imageBytes: Buffer): Promise<OcrResult>;
}
export interface RecommendProvider {
  generate(userConfig: UserConfig, lunar: LunarInfo, system: string, lottery: string): Promise<RecommendResult>;
}
```

首期只实现火山引擎 provider，后续再扩展。

---

## 7. 数据库设计

### 7.1 选型建议

推荐 MySQL 8.0，理由：

1. 在腾讯云轻量服务器上部署成熟；
2. 中文生态常见，排障资料多；
3. 当前业务以结构化数据为主；
4. 单人维护成本低。

### 7.2 核心表清单

建议至少包含以下数据表：

1. `User` — 用户主表
2. `DeviceToken` — 设备令牌
3. `UserConfig` — 用户配置
4. `Ticket` — 彩票票据主表
5. `TicketBet` — 票据多注明细
6. `DrawResult` — 开奖结果
7. `LotteryStatus` — 彩种当前状态缓存
8. `RedeemRecord` — 兑奖记录
9. `RecommendationCache` — 推荐结果缓存
10. `HeatmapDailyStat` — 热力图按日聚合
11. `JobRun` — 定时任务执行记录
12. `ExternalCallLog` — 外部服务调用日志

### 7.3 Prisma Schema

> 字段口径来源：`彩票小助手-小程序/utils/mock.js` 与 `utils/api.js`。金额单位统一「分」，球号统一两位字符串。
> **⚠️ V1.3 落地说明**：以下 schema 为设计基线，实际落地版本以 `backend/prisma/schema.prisma` 为唯一真源（`npx prisma migrate dev` 已生成迁移并 seed 完成）。落地中补充的关键字段：`TicketBet.matchedRed/matchedBlue/isWin/prizeLevel`（兑奖比对结果）、`UserConfig.rawPayload`（原始请求留档）、`RecommendationCache` 唯一键 `(userId, recommendDate, lotteryType, divinationSystem)`（支持同日多组合缓存）。

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id        BigInt    @id @default(autoincrement())
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  // 微信登录 openid（2026-08-21 新增：同一微信号多端同一用户；
  // 已 ALTER TABLE 落地，服务端经 $queryRaw 访问，Prisma client 待统一 regenerate）
  openid    String?   @unique @db.VarChar(64)

  deviceTokens   DeviceToken[]
  userConfig     UserConfig?
  tickets        Ticket[]
  redeemRecords  RedeemRecord[]
  recommendations RecommendationCache[]
  heatmapStats   HeatmapDailyStat[]

  @@map("users")
}

model DeviceToken {
  id          BigInt    @id @default(autoincrement())
  userId      BigInt    @map("user_id")
  deviceToken String    @unique @db.VarChar(128) @map("device_token")
  clientType  String    @default("wechat_mp") @db.VarChar(32) @map("client_type")
  status      Int       @default(1) @db.TinyInt
  lastSeenAt  DateTime? @map("last_seen_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@index([userId])
  @@map("device_tokens")
}

// Rokid 口令绑定（2026-08-25 改造说明 §6.1）：口令 = R{userId}-{code}，长期有效；
// codeHash = sha256(userId + code + PAIRING_SALT)；服务端经 $queryRaw 访问（Prisma client 未 regenerate）
model RokidPasscode {
  id        BigInt   @id @default(autoincrement())
  userId    BigInt   @unique
  codeHash  String   @db.VarChar(64)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("rokid_passcode")
}
}

model UserConfig {
  id                BigInt   @id @default(autoincrement())
  userId            BigInt   @unique @map("user_id")
  name              String?  @db.VarChar(64)
  gender            String?  @db.VarChar(16)
  birth             DateTime? @db.Date
  lotteryType       String?  @db.VarChar(16) @map("lottery_type")
  divinationSystem String?  @db.VarChar(32) @map("divination_system")
  rawPayload        Json?
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@map("user_configs")
}

model Ticket {
  id              BigInt   @id @default(autoincrement())
  userId          BigInt   @map("user_id")
  lotteryType     String   @db.VarChar(16) @map("lottery_type")
  lotteryName     String?  @db.VarChar(32) @map("lottery_name")
  period          String   @db.VarChar(32)
  drawDate        DateTime? @db.Date @map("draw_date")
  betCount        Int      @default(0) @map("bet_count")
  multiplier      Int      @default(1)
  totalAmountCent Int      @default(0) @map("total_amount_cent")
  status          String   @default("pending") @db.VarChar(16)
  winAmountCent   Int      @default(0) @map("win_amount_cent")
  source          String   @default("ocr") @db.VarChar(16)
  photoUrl        String?  @db.VarChar(512) @map("photo_url") // 已废弃，保留兼容旧迁移
  ocrStatus       String?  @db.VarChar(32) @map("ocr_status")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  user          User          @relation(fields: [userId], references: [id])
  bets          TicketBet[]
  redeemRecord  RedeemRecord?

  @@index([userId])
  @@index([lotteryType, period])
  @@map("tickets")
}

model TicketBet {
  id           BigInt  @id @default(autoincrement())
  ticketId     BigInt  @map("ticket_id")
  betIndex     Int     @default(1) @map("bet_index")
  redBalls     Json    @map("red_balls")
  blueBalls    Json    @map("blue_balls")
  mult         Int     @default(1)
  matchedRed   Int     @default(0) @map("matched_red")
  matchedBlue  Int     @default(0) @map("matched_blue")
  isWin        Int     @default(0) @db.TinyInt @map("is_win")
  createdAt    DateTime @default(now()) @map("created_at")

  ticket Ticket @relation(fields: [ticketId], references: [id])

  @@index([ticketId])
  @@map("ticket_bets")
}

model DrawResult {
  id            BigInt   @id @default(autoincrement())
  lotteryType   String   @db.VarChar(16) @map("lottery_type")
  period        String   @db.VarChar(32)
  drawDate      DateTime? @db.Date @map("draw_date")
  redBalls      Json     @map("red_balls")
  blueBalls     Json     @map("blue_balls")
  prizePoolCent BigInt?  @map("prize_pool_cent")
  sourceName    String?  @db.VarChar(64) @map("source_name")
  sourceUrl     String?  @db.VarChar(512) @map("source_url")
  sourceRaw     Json?    @map("source_raw")
  syncStatus    String   @default("pending") @db.VarChar(16) @map("sync_status")
  syncedAt      DateTime? @map("synced_at")
  createdAt     DateTime @default(now()) @map("created_at")

  @@unique([lotteryType, period])
  @@map("draw_results")
}

model LotteryStatus {
  id             BigInt   @id @default(autoincrement())
  lotteryType    String   @unique @db.VarChar(16) @map("lottery_type")
  currentIssue   String?  @db.VarChar(32) @map("current_issue")
  periodText     String?  @db.VarChar(64) @map("period_text")
  drawDate       DateTime? @map("draw_date")      // 下期开奖时间（countdown 基准）
  countdown      String?  @db.VarChar(64)          // 快照文案，API 响应时建议实时重算
  prizePoolAmount String? @db.VarChar(32) @map("prize_pool_amount")
  winningNumbers Json?    @map("winning_numbers")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@map("lottery_status")
}

// 注意：本表是「全局彩种缓存」，不含 per-user 字段。
// `purchased`（当前用户是否已录入本期）为 per-user 语义，
// 由 /api/lottery/status 查询时根据当前用户票据动态计算，不落此表。

model RedeemRecord {
  id            BigInt   @id @default(autoincrement())
  ticketId      BigInt   @unique @map("ticket_id")
  userId        BigInt   @map("user_id")
  lotteryType   String   @db.VarChar(16) @map("lottery_type")
  period        String   @db.VarChar(32)
  status        String   @default("pending") @db.VarChar(16)
  amountCent    Int      @default(0) @map("amount_cent")
  deadlineDate  DateTime? @db.Date @map("deadline_date")
  redeemChannel String?  @db.VarChar(16) @map("redeem_channel")
  daysLeft      Int      @default(0) @map("days_left")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  ticket Ticket @relation(fields: [ticketId], references: [id])
  user   User   @relation(fields: [userId], references: [id])

  @@index([userId])
  @@map("redeem_records")
}

model RecommendationCache {
  id                BigInt   @id @default(autoincrement())
  userId            BigInt   @map("user_id")
  recommendDate     DateTime @db.Date @map("recommend_date")
  lotteryType       String   @db.VarChar(16) @map("lottery_type")
  divinationSystem  String   @db.VarChar(32) @map("divination_system")
  resultJson        Json     @map("result_json")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, recommendDate, lotteryType, divinationSystem])
  @@map("recommendation_cache")
}

model HeatmapDailyStat {
  id          BigInt   @id @default(autoincrement())
  userId      BigInt   @map("user_id")
  date        DateTime @db.Date
  level       Int      @default(0) @db.TinyInt
  amountCent  Int      @default(0) @map("amount_cent")
  ticketCount Int      @default(0) @map("ticket_count")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, date])
  @@map("heatmap_daily_stats")
}

model JobRun {
  id         BigInt   @id @default(autoincrement())
  jobName    String   @db.VarChar(64) @map("job_name")
  status     String   @db.VarChar(16)
  startedAt  DateTime @map("started_at")
  finishedAt DateTime? @map("finished_at")
  error      String?  @db.Text
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([jobName, startedAt])
  @@map("job_runs")
}

model ExternalCallLog {
  id         BigInt   @id @default(autoincrement())
  provider   String   @db.VarChar(32)
  endpoint   String   @db.VarChar(128)
  status     String   @db.VarChar(16)
  costMs     Int      @map("cost_ms")
  request    Json?
  response   Json?
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([provider, createdAt])
  @@map("external_call_logs")
}
```

### 7.4 票据状态机

```
[*] --> pending            录入完成，等待开奖
pending --> drawn          开奖 cron 确认已开奖
drawn --> redeemed         已中奖，待/已兑奖（含金额 0 自动标记）
drawn --> not_win          已开奖未中奖
redeemed --> [*]
not_win --> [*]
```

前端展示态映射（中文）：

- `pending` → "待开奖"（灰）
- `redeemed` → "已兑奖"（绿）
- `drawn`（含待兑奖） → "待兑奖"（黄）
- `not_win` → "未中奖"（灰）

> 前端 `STATUS_CLASS` 映射在 `pages/ledger/ledger.js`，以中文为 key。

---

## 8. API 设计

### 8.1 统一规范

- 基础前缀：`/api`
- 协议：HTTPS
- 编码：UTF-8
- 时区：`Asia/Shanghai`
- Header：
  - `Content-Type: application/json`（图片上传为 `multipart/form-data`）
  - `X-Device-Token: <token>`
- 统一响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

### 8.2 接口清单（以前端 `api.js` 实际调用为准）

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/auth/register` | POST | 注册设备并返回 `deviceToken`（匿名；每次注册独立用户） |
| `/api/auth/login` | POST | 微信登录（body `{code}` → code2session 换 openid → 返回 `deviceToken`；同一微信号多端同一用户，2026-08-21） |
| `/api/auth/rokid/passcode` | POST | 设置/更新 Rokid 口令验证码（body `{code}` 6 位数字；小程序端调用，2026-08-25） |
| `/api/auth/rokid/bind` | POST | Rokid 口令绑定（body `{userId, code}`；眼镜端调用，幂等签发 `rokid_glasses` token，2026-08-25） |
| `/api/user/config` | GET | 获取用户配置 |
| `/api/user/config` | POST | 保存用户配置 |
| `/api/ticket/ocr` | POST | 图片 OCR 结构化识别（`multipart/form-data`，字段名 `file`） |
| `/api/ticket` | POST | 保存彩票票据 |
| `/api/ticket` | GET | 查询票据列表 |
| `/api/ticket/:id` | DELETE | 删除票据（台账页"删除"按钮） |
| `/api/redeem/pending` | GET | 查询待兑奖记录 |
| `/api/redeem/confirm` | POST | 兑奖确认（"待兑奖"→"已兑奖"） |
| `/api/lottery/status` | GET | 查询彩种开奖状态（参数 `type`） |
| `/api/lottery/draw` | GET | 查询开奖结果（参数 `type` 必填，`issue` 可选缺省取最新一期） |
| `/api/lottery/sync` | POST | 用户端补差：按开奖日期手动同步该期开奖结果（body `{type, date}`；幂等；日历"同步"按钮触发） |
| `/api/statistics` | GET | 查询首页统计 |
| `/api/heatmap` | GET | 查询热力图数据 |
| `/api/lunar` | GET | 获取日期相关农历信息 |
| `/api/recommend` | POST | 生成推荐号码与分析 |
| `/health` | GET | 健康检查（无鉴权，供 Docker healthcheck / 监控探活） |

> ✅ **联调状态（2026-08-21）**：`DELETE /api/ticket/:id` 与 `POST /api/redeem/confirm` 的前端调用已补齐（`ledger.js` 的 `onDrawerAction` 调 `api.deleteTicket` / `api.confirmRedeem({ticketId})`，`home.js` 的 `onDrawerConfirm` 调 `api.confirmRedeem({id})`）。前端已切 `USE_MOCK=false` 指向生产域名，前后端全量联调通过。

### 8.3 关键接口字段对齐（基于前端代码）

> ⚠️ 本节字段以 `彩票小助手-小程序/utils/api.js` 与 `utils/mock.js` 实际使用的字段为准。

#### 8.3.1 POST /api/auth/register（匿名设备注册）

**响应**：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "deviceToken": "xxxxxxxxxxxxxxxx"
  }
}
```

> 字段名为 `deviceToken`，非 `token`。
>
> **⚠️ 多用户隔离（2026-08-21 修复）**：原实现"复用第一个用户"导致所有设备共享同一份数据（线上越权事故）。现每次注册创建**独立用户**，各设备数据完全隔离。匿名注册保留给眼镜端（无微信环境）使用；小程序端优先走微信登录（见 8.3.1b）。

#### 8.3.1b POST /api/auth/login（微信登录，2026-08-21 新增）

前端 `wx.login` 获取一次性 `code`（有效期约 5 分钟）后调用；后端调微信 `code2session` 换取 `openid`，按 openid upsert 用户并签发 `deviceToken`。**同一微信号（openid 固定）手机/PC 多端为同一用户**，数据互通。

**请求**：

```json
{ "code": "0a3wHX..." }
```

**响应**（成功）：

```json
{
  "code": 0,
  "message": "ok",
  "data": { "deviceToken": "xxxxxxxxxxxxxxxx" }
}
```

**失败**：微信返回错误码时统一为 `{ "code": 40100, "message": "微信登录失败（40029）" }`（40029=code 无效、45011=频率限制、-1=系统繁忙）；后端未配置 `WECHAT_APPID/WECHAT_APPSECRET` 时返回 `50000 微信登录未配置`。

**实现要点**：
- `users.openid VARCHAR(64) UNIQUE`：经 `$queryRawUnsafe` 访问（Prisma client 尚未 regenerate，schema.prisma 已同步声明 `openid String? @unique`）
- `device_tokens.client_type = 'wechat_openid'`
- 前端 `api.ensureToken()`：优先微信登录，失败降级匿名 `register`，保证可用性

#### 8.3.1c POST /api/auth/rokid/passcode（口令验证码设置，2026-08-25 新增）

**调用方**：小程序端（`X-Device-Token` 鉴权，走统一 request 封装）；**语义**：设置/更新当前用户的口令验证码（长期有效，upsert 覆盖 → 旧口令立即失效）。

**请求**：`{ "code": "730214" }`（6 位纯数字，否则 `40001`）

**响应**：`{ code: 0, message: 'ok', data: { userId: '1024' } }`

**限流**：同用户 1 分钟内 > 3 次 → `42900 操作过于频繁`。

**实现**：`codeHash = sha256(userId + code + PAIRING_SALT)` 存 `rokid_passcode`（不存明文）；经 `$executeRawUnsafe` upsert（`ON DUPLICATE KEY UPDATE`）。

#### 8.3.1d POST /api/auth/rokid/bind（口令绑定，2026-08-25 新增）—— 眼镜端对接接口

**调用方**：Rokid 眼镜端（无 token，口令即凭证）；**语义**：解析 `R{userId}-{code}` 后调用，校验通过签发绑定到该用户的 token。幂等可重复（每次快捷指令唤起重新 bind，刷新 24h 免登录窗口）。

**请求**：`{ "userId": "1024", "code": "730214" }`

**校验顺序**：
1. 格式：`userId` 数字串、`code` 6 位数字，否则 `40001`；
2. 用户存在，否则 `40401 用户不存在`；
3. `rokid_passcode` 匹配（`userId` + `codeHash`），否则 `40100 口令无效`；
4. 限流：同 `userId` 10 分钟失败 ≥ 5 次 → 锁定 10 分钟 → `42900`；
5. 通过：`device_tokens` 新增 `{ userId, clientType: 'rokid_glasses', status: 1 }`，同时该用户旧 `rokid_glasses` token 置 `status=0`（只保留最新）。

**响应**：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "deviceToken": "a1b2c3...",
    "userConfig": {
      "userId": "1024",
      "name": "春生",
      "gender": "male",
      "birth": "2000-01-15",
      "lotteryType": "ssq",
      "lotteryTypes": ["ssq"],
      "divinationSystem": "astrology"
    }
  }
}
```

> `userConfig.name` 必带（眼镜端顶栏展示用户姓名）；用户未配置时 `userConfig` 为 `null`（眼镜端按默认 ssq + astrology 兜底，顶栏姓名显示「未绑定」）。token 本身不设过期（沿用现状），24h 免登录窗口由眼镜端本地 `boundAt` 控制。

#### 8.3.2 GET /api/user/config

**响应**：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "userId": "1024",
    "name": "春生",
    "gender": "male",
    "birth": "2000-01-15",
    "lotteryType": "ssq",
    "lotteryTypes": ["ssq"],
    "divinationSystem": "astrology"
  }
}
```

> `userId`（BigInt 字符串化，2026-08-25 新增）：供 Rokid 口令绑定；未初始化用户（`initialized=false`）也返回 `userId`。
> 兼容：前端 `api.getUserConfig` 同时读取 `lotteryType`（主）与 `lotteryTypes`（兜底数组）。
> 字段口径：`birth`（非 `birthDate`）、`lotteryType`（非 `defaultLottery`）、`divinationSystem`（非 `defaultSystem`）。

#### 8.3.3 POST /api/ticket/ocr

**请求**：`multipart/form-data`，文件字段名 **`file`**（前端 `wx.uploadFile` 的 `name: 'file'`）。

**响应**（对齐 `mock.ocrResult`）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "lotteryName": "双色球",
    "period": "第 2026101 期",
    "drawDate": "2026-08-19",
    "ocrStatus": "OCR 已识别",
    "betCount": 2,
    "multiplier": 1,
    "totalAmount": "¥ 4.00",
    "bets": [
      { "id": 1, "red": ["03","08","12","18","26","31"], "blue": ["09"], "mult": 1 },
      { "id": 2, "red": ["05","11","17","23","29","32"], "blue": ["07"], "mult": 1 }
    ]
  }
}
```

#### 8.3.4 POST /api/ticket

**请求**（前端 `record.js` 的 `onSave` 提交字段）：

```json
{
  "lotteryType": "ssq",
  "period": "2026101",
  "drawDate": "2026-08-18",
  "bets": [
    { "id": 1, "red": ["03","08","12","18","26","31"], "blue": ["09"], "mult": 1 }
  ],
  "multiplier": 1,
  "totalAmount": 400
}
```

> 注意 1：`totalAmount` 单位为「分」（前端 `record.js` 中 `sum + (mult||1) * 200`，每注 200 分 = ¥2）。
> 注意 2：`drawDate` 为**可选**字段（票面 OCR 识别出的开奖日期，`YYYY-MM-DD`）。缺省时后端按「已落库开奖结果 → 下一开奖日」推算；**优先传票面值**——彩票印刷日期可信，否则扫描历史期可能把开奖日算成录入日。
> 注意 3（2026-08-20 新增）：**保存后自动触发开奖比对**——若该期已开奖（draw_results 有数据）直接兑奖比对；若票面开奖日早于今天且未同步，先按开奖日补同步（SearchInfinity）再比对；未来期保持 `pending`。返回 `status` 为**比对后**的最新状态（可能已流转为 `drawn`/`not_win`），保存响应因补同步会多耗 1-3 秒。

**响应**（2026-08-20 落地）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "3",
    "status": "待开奖"
  }
}
```

> `id` 为票据 ID 字符串（BigInt 序列化），供后续 `DELETE /api/ticket/:id` 使用；`status` 为自动开奖比对后的最新状态（中文，同列表态口径），可能已流转为"待兑奖"/"未中奖"。

#### 8.3.5 GET /api/ticket

**响应**（对齐 `mock.tickets` + 联调新增字段）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "3",
        "period": "第 2024092 期",
        "lottery": "dlt",
        "lotteryName": "大乐透",
        "status": "待开奖",
        "drawDate": "2026-08-22",
        "betAmount": "¥6.00",
        "winAmount": "",
        "winningRed": ["01", "07", "16", "24", "28"],
        "winningBlue": ["03", "11"],
        "bets": [
          { "id": 1, "red": "01 07 16 24 28", "blue": "03 11", "mult": "*2", "matchedRed": 3, "matchedBlue": 1 }
        ]
      }
    ]
  }
}
```

> 注意 1：列表项的 `bets[].red` 与 `bets[].blue` 在列表态用**空格分隔字符串**（非数组），`mult` 用 `"*2"` 字符串。这是前端 `mock.tickets` 的实际口径，后端在序列化列表时需要做这种格式转换；详情态再展开为数组。
> 注意 2：`status` 字段用中文："待开奖"/"已兑奖"/"待兑奖"/"未中奖"。
> 注意 3：**`period` 存储与输出格式**——数据库统一存**纯数字字符串**（如 `2024092`，前端 `record.js` 提交前已用 `.replace(/\D/g, '')` 清洗）；API 输出时格式化为 `"第 2024092 期"`。列表项还输出 `betAmount`（如 `"¥6.00"`）与 `winAmount`（如 `"¥3,000.00"` 或空串 `""`），均为格式化字符串。
> 注意 4（2026-08-20 联调新增）：**`id`** 为票据 ID 字符串（BigInt 序列化，供前端 `DELETE /api/ticket/:id` 使用）；**`winningRed` / `winningBlue`** 为该期真实开奖号码（两位字符串数组，按票据期号精确反查 `draw_results`，不依赖热力图 12 周窗口，**历史票也能逐球高亮**；未开奖/未同步时为空数组，前端据此不高亮）；**`bets[].matchedRed` / `matchedBlue`** 为兑奖引擎落库的命中数量（未比对时为 0）。

#### 8.3.6 DELETE /api/ticket/:id

**请求**：路径参数 `id` 为票据 ID（`POST /api/ticket` 返回的 `id`）。

**响应**：

```json
{ "code": 0, "message": "ok", "data": null }
```

> 对应 `pages/ledger/ledger.js` 的 `onDrawerAction`"删除"分支。后端应级联删除关联的 `TicketBet` 与 `RedeemRecord`（Prisma 关系 onDelete 或事务内显式删除）。

#### 8.3.7 GET /api/redeem/pending

**响应**（对齐 `api.getPendingRedeem` 的 mock）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "R001",
        "lottery": "ssq",
        "lotteryName": "双色球",
        "period": "第 2024090 期",
        "amount": 300000,
        "deadlineDate": "2024-10-12",
        "redeemChannel": "shop",
        "daysLeft": 12
      }
    ]
  }
}
```

> 字段对齐：`list`（非 `records`）、`amount`（非 `prizeAmount`，单位分）、`deadlineDate`、`redeemChannel`（`shop`/`center`）、`daysLeft`。
> 兑奖规则：单注 ¥1 万以下 → `shop`（彩票店）；¥1 万及以上 → `center`（彩票中心）。开奖日起 60 自然日有效。
> `daysLeft` 在每次请求时实时计算（`deadlineDate - today`），不依赖落库快照。
> `id` 必须稳定且唯一（前端 `home.js` 用它做 `dismissedRedeemIds` 的 key），建议直接用 `RedeemRecord.id` 字符串化。

#### 8.3.8 POST /api/redeem/confirm

**请求**（`id` 与 `ticketId` 二选一，均可选、字符串）：

```json
{ "id": "R001" }
```

或（台账抽屉只有票据 id 时）：

```json
{ "ticketId": "3" }
```

**响应**：

```json
{ "code": 0, "message": "ok", "data": { "status": "redeemed" } }
```

> 对应 `pages/ledger/ledger.js` `onDrawerAction`"兑奖"分支（传 `ticketId`）与 `pages/home/home.js` `onDrawerConfirm`（传 `id`，来自 `/redeem/pending`）。后端先按 `id` 查 `RedeemRecord`，未命中再按 `ticketId` 反查；将 `RedeemRecord.status` 置为 `redeemed`，同时联动更新关联 `Ticket.status` 为 `redeemed`（前端展示"已兑奖"）。记录已是 `redeemed` 时幂等返回。

#### 8.3.9 GET /api/lottery/status?type=ssq

**响应**（对齐 `mock.lotteryStatus.ssq`）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "type": "ssq",
    "name": "双色球",
    "period": "第 2026096 期",
    "drawDate": "2026-08-20",
    "drawTime": "21:15",
    "saleEndTime": "20:00",
    "saleEndAt": 1787133600000,
    "poolAmount": "¥20.1 亿",
    "countdown": "距停售 09:40:02",
    "purchased": true,
    "winningNumbers": ["03","08","15","21","27","30","09"]
  }
}
```

> 注意 1：`poolAmount` 与 `countdown` 都是**字符串**（前端直接展示，后端做格式化）。
> 注意 2：**`countdown` 语义为"距当期停售"**（2026-08-20 调整）：开奖日在晚上（ssq 21:15 / dlt 21:25），用户购买截止是停售时刻（ssq 开奖日 20:00 / dlt 21:00，配置于 `lottery-rules.ts` 的 `saleEndTime`/`drawTime`）。响应时实时计算：未停售 → `距停售 HH:MM:SS`（跨天含"N 天"）；当日已停售 → `已停售 · 今晚 HH:MM 开奖`；已过 → `已开奖`。`saleEndAt` 为停售时刻毫秒时间戳，前端据此做每秒跳动的实时倒计时（前端无此字段时回退静态文案）。
> 注意 3：`winningNumbers` 是红蓝拼接的统一数组（双色球 6 红 + 1 蓝 = 7 个；大乐透 5 + 2 = 7 个）。
> 注意 4：**`purchased` 为动态计算字段，不落库**——根据当前用户是否存在 `lotteryType=type AND period=currentIssue` 的票据判断。`LotteryStatus` 表本身是全局缓存，不含 per-user 字段。

#### 8.3.10 GET /api/lottery/draw?type=ssq&issue=2024091

**参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `type` | 是 | `ssq` / `dlt` |
| `issue` | 否 | 期号（纯数字）。缺省时返回该彩种**最新一期**开奖结果（前端 `api.getDraw(type)` 只传 `type`） |

**响应**：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "type": "ssq",
    "name": "双色球",
    "period": "第 2024091 期",
    "drawDate": "2024-08-15",
    "winningNumbers": ["03","08","15","21","27","30","09"]
  }
}
```

> 未开奖或期号不存在返回 `code: 40401`。
> `winningNumbers` 同样是红蓝拼接数组；前端 `pages/ledger/ledger.js` 的 `splitWinningNumbers` 按 `type` 切分红蓝（dlt 前 5 个为前区，ssq 前 6 个为红球）。

#### 8.3.10a POST /api/lottery/sync（用户端补差同步）

**请求**（body，JSON）：

```json
{ "type": "ssq", "date": "2026-08-06" }
```

**响应**：

```json
{ "code": 0, "message": "ok", "data": { "synced": true, "skipped": false, "period": "2026090" } }
```

> 语义：`date` 为该彩种开奖日（YYYY-MM-DD），后端校验"已过开奖日且非未来/非法日期"后，按官方锚点推算期号 → SearchInfinity 搜索（二轮：先官方三站带过滤，失败后无站点过滤重搜）→ 多候选投票解析红蓝球 → upsert `draw_results` → 触发兑奖预计算。
> 幂等：该期已存在返回 `skipped: true`；解析失败返回 `{ synced: false, message: "parse_failed" }`（前端提示稍后重试）。
> 场景：冷启动用户无历史开奖数据（定时任务未跑），在台账日历点击"号码待同步"格子的"同步开奖信息"按钮补差。落库后日历/兑奖链路自动可用。
> ⚠️ query 期号格式按彩种区分：ssq 用 7 位（2026090），dlt 用 5 位（26090，官方写法）——不一致会导致搜索召回偏移抓错期。

#### 8.3.11 GET /api/heatmap

**响应**（对齐 `mock.heatmap`）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "weeks": 12,
    "amounts": {
      "2026-06-01": 0,
      "2026-06-02": 2,
      "2026-06-08": 4
    },
    "draws": {
      "2026-08-18": {
        "lotteryType": "ssq",
        "period": "第 2026097 期",
        "red": ["03", "08", "15", "21", "27", "30"],
        "blue": ["09"]
      }
    },
    "legend": { "min": "¥0", "max": "¥50+" }
  }
}
```

> 字段对齐：`amounts` 是 `{'YYYY-MM-DD': 0~4}` 的 map，前端按自然周分列渲染。
> `draws`（2026-08-19 新增）：按开奖日期反查 `draw_results`，键为 `YYYY-MM-DD`，值为该期开奖信息（`period` 已带"第 x 期"格式、`red`/`blue` 两位字符串数组）。仅包含时间段内已同步的开奖；未开奖/未同步日期无 key，前端据此显示"待开奖/号码待同步"。
> 颜色梯度（前端 `LEVEL_COLORS`）：`['#EEF0F3','#C8E6C9','#81C784','#4CAF50','#2E7D32']` 5 阶。

#### 8.3.12 GET /api/statistics

**响应**（对齐 `mock.statistics` + 2026-08-21 新增字段，`pages/home/home.js` 消费）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "monthLabel": "2026 年 8 月",
    "monthTotalPeriods": 26,
    "purchasedPeriods": 12,
    "totalSpent": 2400,
    "totalWon": 300400,
    "monthCaption": "本月中奖 3 次 · 累计 ¥3,004.00"
  }
}
```

> 字段说明：
> - `monthLabel`：当前月份标签（格式 `"YYYY 年 M 月"`）
> - `monthTotalPeriods`：本月该彩种总开奖期数（按开奖日历推算，截至今天；**兼容保留，前端 2026-08-21 起已不再展示**）
> - `purchasedPeriods`：本月用户实际参与的期数（去重）
> - `totalSpent`（新增）：本月总花费（投入金额，**单位分**，前端 `formatAmount` 格式化展示）
> - `totalWon`（新增）：本月中奖总额（**单位分**）
> - `monthCaption`：本月中奖汇总文案（后端拼装：中奖次数 + 累计中奖金额，金额格式 `"¥3,004.00"`，无中奖时为 `"本月暂无中奖"`）
> 全部字段按当前用户配置的默认彩种（`userConfig.lotteryType`）统计。前端统计卡现为三项：**已购期数 / 本月花费 / 本月中奖**。

#### 8.3.13 GET /api/lunar

**响应**（前端 `api.getLunar` 当前 mock 只读 `lunar` 字段；推荐服务内部复用完整结构）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "solarDate": "2026-08-19",
    "lunar": "丙午年七月初一",
    "lunarDate": "丙午年七月初一",
    "ganZhi": { "year": "丙午", "month": "丙申", "day": "己卯" },
    "zodiac": "马",
    "constellation": "狮子座"
  }
}
```

> 说明：
> - `lunar` 为前端展示用的简短文案（格式 `"干支年农历月日"`，mock 为 `"甲辰年七月廿八"`）
> - `ganZhi` / `constellation` 供推荐服务填充 Prompt（星座占星用 `constellation`，五行推命用 `ganZhi`）
> - 缺省参数 `date` 时取今天；Node.js 实现建议用 `lunar-javascript`（`npm i lunar-javascript`）计算

#### 8.3.14 POST /api/recommend

**请求**：

```json
{
  "system": "astrology",
  "lottery": "ssq",
  "refresh": false
}
```

> `refresh` 为可选布尔（默认 `false`）：`true` 时绕过当天缓存强制重新生成（前端"重新生成"按钮传 `true`）；否则当日同 `userId + recommendDate + lotteryType + divinationSystem` 组合命中缓存秒回。

**响应**（对齐 `mock.recommend.ssqAstrology`）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "systemName": "星座占星",
    "date": "2026-08-19 周三",
    "userText": "春生 · 2000-01-15 生 · 今日 丙午年七月初一",
    "redLabel": "红球区 · 6 个",
    "blueLabel": "蓝球区 · 1 个",
    "redBalls": ["03","08","15","21","27","30"],
    "blueBalls": ["09"],
    "summary": "今日火星入命宫，红球偏向高频区 03/08/15/21/27/30，蓝球取幸运数位 9，祝您好运。",
    "disclaimer": "本推荐仅供娱乐，不构成任何购彩建议"
  }
}
```

> 注意：`userText` 由后端组装（姓名 + 生日 + 农历），前端在 `recommend.js` 的 `buildAnalysisText` 中会再次基于 `userText` + `summary` 拼接完整分析。

### 8.4 错误码（沿用接口约定）

| code | 含义 | 前端处理 |
|---|---|---|
| 0 | 成功 | 正常处理 |
| 40001 | 参数错误 | 检查请求参数 |
| 40010 | OCR 识别失败 | 转手动校对抽屉 |
| 40100 | 未认证/Token 无效 | 重新注册获取 Token |
| 40401 | 开奖数据不存在（未开奖） | 展示"待开奖" |
| 42900 | 请求过频限流 | 稍后重试 |
| 50000 | 服务器内部错误 | 提示稍后再试 |
| 50300 | 服务不可用 | 提示网络异常 |

### 8.5 NestJS Controller 示例

```typescript
// src/api/v1/ticket.controller.ts
import {
  Controller, Post, Get, Delete, Param, Body, Query,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TicketService } from '../../modules/ticket/ticket.service';
import { SaveTicketDto, TicketListQueryDto } from '../../modules/ticket/ticket.dto';

@Controller('api/ticket')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  @Post('ocr')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 },  // 单张图片 ≤ 2MB（实际代码值，可由 OCR_IMAGE_MAX_BYTES 覆盖）
  }))
  async ocr(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) {
      return { code: 40001, message: '缺少图片文件', data: null };
    }
    const data = await this.ticketService.recognizeTicket(file.buffer);
    return { code: 0, message: 'ok', data };
  }

  @Post()
  async save(@Body() dto: SaveTicketDto) {
    const data = await this.ticketService.saveTicket(dto);
    return { code: 0, message: 'ok', data };
  }

  @Get()
  async list(@Query() query: TicketListQueryDto) {
    const data = await this.ticketService.listTickets(query);
    return { code: 0, message: 'ok', data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.ticketService.deleteTicket(BigInt(id));
    return { code: 0, message: 'ok', data: null };
  }
}
```

> 提示：`Express.Multer.File` 类型需要安装 `@types/multer`（devDependency）。生产环境建议在 Controller 之上加全局 `TransformInterceptor`（统一包装 `{code, message, data}`）与 `HttpExceptionFilter`（异常映射错误码），实现见 §8.1 的统一响应约定，目录预留于 `src/common/`。

```typescript
// src/modules/ticket/ticket.dto.ts
import { IsString, IsArray, IsInt, IsOptional, Min, Max } from 'class-validator';

export class BetDto {
  @IsInt() id: number;
  @IsArray() @IsString({ each: true }) red: string[];
  @IsArray() @IsString({ each: true }) blue: string[];
  @IsInt() @Min(1) mult: number;
}

export class SaveTicketDto {
  @IsString() lotteryType: 'ssq' | 'dlt';
  @IsString() period: string;
  @IsArray() bets: BetDto[];
  @IsInt() @Min(1) multiplier: number;
  @IsInt() @Min(0) totalAmount: number;
}

export class TicketListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() period?: string;
}
```

---

## 9. 关键服务实现说明

### 9.1 用户配置服务

职责：

- 保存用户资料（姓名、性别、生日、彩种、推演模式）
- 返回推荐页、配置页、首页所需默认值
- 兼容新旧字段命名（`lotteryType` 主字段 + `lotteryTypes` 兼容数组）

实现建议：

- 存库时统一转成标准字段
- 返回前端时同时输出 `lotteryType` 与 `lotteryTypes`（兼容前端 `normalizeLotteryType` 读取）
- `rawPayload` 保留原始请求，便于兼容迁移

### 9.2 OCR 服务

职责：

- 接收上传图片字节流（multipart/form-data，字段名 `file`）
- 直接 base64 编码传给 `deepseek-v4-1-flash-261017`（**不落盘、不入 COS**）
- 校验结构化结果
- 返回给录入页

实现建议：

1. **图片不落盘**：Controller 接收 `Express.Multer.File.buffer`，直接编码 base64 提交给模型，函数返回后 buffer 由 GC 回收
2. 模型输出必须要求 JSON，不接受自由文本
3. OCR 结果不直接入库，先回到前端供用户确认（前端 `record.js` 的手动校对抽屉）
4. OCR 失败时返回 `code: 40010`，前端进入 `fallbackManual` 走手动校对
5. **图片体积控制**：Multer 配置 `limits.fileSize = 2MB`（`OCR_IMAGE_MAX_BYTES` 默认 2097152，服务端二次校验），超限直接返回 `40001`
6. **隐私优势**：图片不持久化意味着即使用户后续删除票据，也无图片残留
7. **调用参数（实际落地）**：`response_format: { type: 'json_object' }` + `thinking: { type: 'disabled' }`——deepseek-v4-1-flash-261017 默认开深度思考时单次 20s+ 且可能吞掉输出，关闭后 2s 内返回合规 JSON

### 9.3 票据服务

职责：

- 保存确认后的票据
- 查询票据列表
- 删除票据（级联）
- 支撑台账页筛选

实现说明（实际落地）：

- 保存时用 Prisma 事务同步写入 `Ticket` 与 `TicketBet`，逐注 `validateBalls` 规则校验 + 金额重算校验（每注 ¥2 × 倍数）
- 状态初始为 `pending`（"待开奖"）
- **保存后自动触发开奖比对**（`afterSaveDrawCheck`）：该期已开奖 → 直接兑奖比对；票面开奖日已过但未同步 → 先 `syncDrawByDate` 补同步再比对；未来期 → 保持 `pending`。比对失败不影响落库（定时任务兜底），返回值为比对后的最新 `status`
- 列表查询返回前端所需格式（`bets[].red` 用空格分隔字符串，`mult` 用 `"*N"` 格式），并按期号批量反查 `draw_results` 附带 `winningRed`/`winningBlue`（历史票也可逐球高亮）
- 删除为事务级联：`RedeemRecord` → `TicketBet` → `Ticket`

### 9.4 开奖同步服务

职责：

- 定时调用 SearchInfinity（豆包搜索）拉取开奖结果
- 对搜索响应做结构化解析（正则匹配红蓝球）
- 更新开奖状态
- 触发兑奖引擎

实现建议：

- 以彩种为维度，每周开奖日 21:35 后多次拉取
- 对最新若干期做幂等更新（`lotteryType + period` 唯一索引）
- 解析失败时保留 `sourceRaw` 供人工核对
- 每次运行记录 `JobRun`

#### 9.4.1 期号推算与休市日历（2026-10-07 事故修复，**修改前必读**）

**期号必须由「官方锚点 + 开奖日增量」推算，而"开奖日"必须扣除彩票市场休市日。**

`lottery-rules.ts` 的 `MARKET_CLOSED_RANGES` 是唯一真相源：

| 年度 | 春节休市 | 国庆休市 | 依据 |
|---|---|---|---|
| 2026 | 02-14 0:00 ～ 02-23 24:00（10 天） | 10-01 0:00 ～ 10-04 24:00（4 天） | 财政部公告 2025 年第 14 号 |

`isDrawDayOfType()` 在查星期表之前先判 `isMarketClosed()`，因此**所有**依赖它的逻辑自动正确：`issueOfDate`（期号推算）、`nextDrawDate`（下一开奖日）、`previousDrawDate`（定时同步的"前一日及之前最近一期"）、`countDrawDatesInMonth`（月度期数）、`syncDrawByDate`（非开奖日拒绝补差）。

**一旦漏扣休市日，后果是复合的**（2026 国庆实例）：

| 环节 | 错误后果 |
|---|---|
| 期号推算 | 系统期号领先官方 1～2 期 |
| 用户录票 | 票面期号撞上"错位后被认为已开奖"的记录 → 未开奖先结算 |
| 定时同步 | 按错误期号搜"尚未开奖的期" → 抓到站点首页，写入脏号码 |
| 首页展示 | `lottery_status` 的期号/奖池/号码三者互相矛盾 |

**为什么不用"换锚点"解决**：早期方案是跨春节手动更新 `ISSUE_ANCHORS`，依赖人工记忆、且只在跨节后才发现错位。内建休市日历后可长期保持单一锚点。

**验证**：`./node_modules/.bin/tsx scripts/check-issue-calendar.ts`（18 条断言）。该用例是**唯一**能阻止此类静默错位的手段，改动 `MARKET_CLOSED_RANGES` 或 `DRAW_DAYS` 后必须重跑。

### 9.5 兑奖引擎

职责：

- 比对票据与开奖结果
- 更新命中数（`matchedRed`/`matchedBlue`）
- 计算是否中奖与奖级
- 生成待兑奖记录（含 `deadlineDate` 与 `redeemChannel`）

**大乐透奖级规则（2026-08-28 按官方 2026-02-02 新规则（26014 期起）升级，`prize-rules.ts`）**：

奖级 9→7，固定奖按**开奖时奖池**分两档浮动（阈值 8 亿元；判定取"上一期开奖后滚存奖池"）：

| 奖级 | 中奖条件 | 奖池 <8 亿 | 奖池 ≥8 亿 |
|---|---|---|---|
| 一等奖 | 5+2 | 浮动（单期封顶 1 亿） | |
| 二等奖 | 5+1 | 浮动 | |
| 三等奖 | 5+0 或 4+2 | ¥5,000 | ¥6,666 |
| 四等奖 | 4+1 | ¥300 | ¥380 |
| 五等奖 | 4+0 或 3+2 | ¥150 | ¥200 |
| 六等奖 | 3+1 或 2+2 | ¥15 | ¥18 |
| 七等奖 | 3+0 / 2+1 / 1+2 / 0+2 | ¥5 | ¥7 |

其余组合（1+1、2+0、0+1、1+0 等）不中奖。追加投注仅参与一二等奖分配。实测案例：26096 期（摇奖前奖池 8.01 亿 → 高档）2 注七等奖 = ¥14，与官方兑付一致。

实现建议：

1. 先只实现"是否中奖 + 中奖金额占位/基础计算"
2. 双色球六等奖级、大乐透七等奖级（含奖池浮动档）规则已全部实现（2026-08-28）
3. 兑奖渠道判定：单注中奖金额 < ¥1 万 → `shop`；≥ ¥1 万 → `center`
4. 兑奖截止日 = 开奖日 + 60 天
5. `daysLeft` 在每次 `/redeem/pending` 请求时实时计算
6. 保持逻辑独立，方便单元测试

#### 9.5.1 结算前置条件：票面开奖日必须 ≤ 开奖记录开奖日（2026-10-07 事故修复）

**`draw_results` 里存在同期号记录 ≠ 这张票已经开奖。** 期号错位期间（如未扣休市日）两者会撞车，造成"今晚才开奖的票被旧记录判成未中奖"。

因此 `computeForDraw` 在逐票结算前、`afterSaveDrawCheck` 在触发结算前，都校验：

```
ticket.drawDate > draw.drawDate  →  挂起，保持 pending，记 WARN 日志
```

正常票两者相等（票面开奖日即官方开奖日）或票面未填时以开奖记录日期兜底，不受影响。

**排查指引**：日志出现 `票面开奖日 … 晚于开奖记录开奖日 …，跳过结算` 时，说明期号体系出现错位，应立刻核查 `MARKET_CLOSED_RANGES` 是否覆盖了当期休市安排，而**不是**去调这条防线。

### 9.6 推荐服务

职责：

- 读取用户配置
- 复用 `LunarService` 获取当日农历干支（模块内直接注入调用，不走 HTTP）
- 构造推荐 Prompt（星座占星 / 五行推命两套模板）
- 调用火山方舟 `doubao-seed-2-1-pro`
- 校验推荐号码合法性
- 缓存推荐结果

实现建议：

- Prompt 与号码规则分离
- 先让模型给出候选结果
- 服务端做二次合法化修正（数量、范围、不重复）
- 同一天同配置走缓存，`refresh=true` 时强制重算

### 9.7 热力图服务

职责：

- 按日聚合用户购彩金额
- 映射为 0-4 五个等级
- 返回 `{date: level}` 的 map + 该时段开奖信息 `draws`

实现说明（实际落地）：

- **API 实时聚合**：个人数据量级小，`/api/heatmap` 直接对 `tickets` 按日 `groupBy` 聚合，不依赖缓存表；`HeatmapDailyStat` 表保留作缓存扩展（聚合 job 每小时预写，两者等价）
- 等级阈值（**实际落地口径**，对齐前端 5 阶色板，图例文案仍为"¥50+"）：
  - L0：¥0（未购彩或待开奖）
  - L1：≤ 400 分（约 ¥2-4，1~2 注）
  - L2：≤ 1000 分（约 ¥6-10）
  - L3：≤ 3000 分（约 ¥12-30）
  - L4：> 3000 分（¥30+，最深色；超过仍为 L4）
- `draws` 字段：按开奖日期反查 `draw_results`（键 `YYYY-MM-DD`，值含 `lotteryType`/`period`/`red`/`blue`），修复日历格子期号/号码与日期错位问题；未同步日期无 key，前端显示"号码待同步"
- ⚠️ 日期键一律用 `common/date-utc.ts` 的 `utcDate/utcToday` 构造（Prisma MySQL DATE 按 UTC 日期存取，本地零点会偏移一天）

---

## 10. 定时任务设计

### 10.1 使用 @nestjs/schedule

NestJS 自带的 `@nestjs/schedule` 包封装了 node-cron，用装饰器声明定时任务，与 NestJS DI 完美集成。首期不引入 BullMQ + Redis，避免运维负担。

> **⚠️ 时区关键提醒**：node-cron 默认读容器时区，Docker 容器默认 UTC。若不配置时区，`21:00` 的任务会在北京时间次日 05:00 执行。三层保障（缺一不可，见 §14.2 注释）：
> 1. Dockerfile `ENV TZ=Asia/Shanghai`（需 `apk add tzdata`）
> 2. docker-compose `environment.TZ=Asia/Shanghai`
> 3. `@Cron` 装饰器显式传 `{ timeZone: 'Asia/Shanghai' }`（代码层兜底，下例已含）

### 10.2 定时任务清单

| 任务 | Cron 表达式 | 说明 |
|---|---|---|
| 双色球开奖同步 | `0 0 1 * * *`（每天凌晨 1 点） | 调用 SearchInfinity 拉取**前一日及之前**最近一期已开奖（开奖在晚 21:15/21:25，次日凌晨同步最保险、无竞态；同步开奖号码 + 奖池 + 期号推进） |
| 大乐透开奖同步 | `0 0 1 * * *`（每天凌晨 1 点） | 同上（dlt query 用 5 位期号 26090） |
| 开奖状态刷新 | `0 */5 * * * *`（每 5 分钟） | 刷新当前期号/奖池；`countdown` 文案在 API 响应时实时计算，不依赖此任务 |
| 待兑奖计算 | `0 */15 * * * *` | 对已开奖未计算票据进行兑奖比对 |
| 热力图聚合刷新 | `0 0 * * * *`（每小时整点） | 刷新按日期聚合的金额统计 |
| 推荐缓存清理 | `0 0 3 * * *`（每天凌晨 3 点） | 清理 7 天前的推荐缓存 |
| 外部调用日志清理 | `0 0 4 * * *` | 清理 30 天前日志或归档 |

### 10.3 实现示例（实际落地代码）

```typescript
// src/jobs/draw-sync.job.ts（实际实现）
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DrawSyncService } from '../modules/lottery/draw-sync.service';

@Injectable()
export class DrawSyncJob {
  private readonly logger = new Logger(DrawSyncJob.name);

  constructor(private readonly drawSync: DrawSyncService) {}

  /** 每天凌晨 1 点：双色球（拉取前一日及之前最近一期已开奖，无竞态） */
  @Cron('0 0 1 * * *', { timeZone: 'Asia/Shanghai' })
  async syncSsq() {
    try {
      await this.drawSync.syncLatestDraw('ssq');
    } catch (err) {
      this.logger.warn(`双色球开奖同步失败: ${(err as Error).message}`);
    }
  }

  /** 每天凌晨 1 点：大乐透（dlt query 用 5 位期号） */
  @Cron('0 0 1 * * *', { timeZone: 'Asia/Shanghai' })
  async syncDlt() {
    try {
      await this.drawSync.syncLatestDraw('dlt');
    } catch (err) {
      this.logger.warn(`大乐透开奖同步失败: ${(err as Error).message}`);
    }
  }

  /** 每 5 分钟：期号推进检查 */
  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: 'Asia/Shanghai' })
  async refreshStatus() {
    try {
      await this.drawSync.refreshStatus();
    } catch (err) {
      this.logger.warn(`状态刷新失败: ${(err as Error).message}`);
    }
  }
}
```

> 原"开奖日 21:00-23:00 每 10 分钟轮询"方案已废弃：开奖在晚上（21:15/21:25），**次日凌晨 1 点同步最保险**——所有期都开完，绝无竞态；错过某期由用户端 `POST /api/lottery/sync` 手动补差兜底。

### 10.4 幂等要求

所有定时任务必须满足：

1. 可重复执行
2. 失败可重试
3. 不因重复执行造成重复写入

建议手段：

- 唯一索引（`DrawResult.lotteryType + period`）
- Prisma 的 `upsert` 操作
- `JobRun` 执行记录表（含 `startedAt`/`finishedAt`/`status`/`error`）

---

## 11. 安全与合规

### 11.1 鉴权

当前项目为个人产品，可采用轻量鉴权：

1. 小程序首次调用 `POST /api/auth/register`
2. 返回 `deviceToken`
3. 后续请求统一携带 `X-Device-Token`
4. 后台用 NestJS Guard 校验 Token 有效性，无效返回 `401`（`code=40100`）

如果未来扩展多用户，可追加：

- 微信登录态（`wx.login` + `code2session`）
- JWT
- 用户体系

### 11.2 数据安全

- 敏感配置通过环境变量管理（`.env` 不入库）
- **彩票图片不持久化**：OCR 完成后 Buffer 即释放，无任何磁盘残留；服务器无图片文件可被窃取
- 日志中不要打印完整 Token（只打印 hash）
- 外部服务密钥单独配置，不写入仓库
- 火山引擎 API Key 与推理接入点 ID 分离管理

### 11.3 合规说明

- 推荐结果仅供娱乐，接口必须返回 `disclaimer` 字段
- 不提供实际购彩建议、代购、支付类能力
- 开奖结果必须注明数据来源（`sourceName` + `sourceUrl`）或在后台可追溯
- 彩票类小程序可能受限，需评估微信小程序类目与审核要求

---

## 12. 观测与运维

### 12.1 日志（实际：NestJS 内置 Logger）

**V1.3 落地口径**：个人项目从简，未引入 nestjs-pino，直接使用 NestJS 内置 `Logger`（`pm2 logs lottery-helper` 查看）。关键服务（OCR/开奖同步/兑奖）均已埋点：

- OCR 请求到达字节数 / 识别成功（彩种+期号+注数）/ 识别失败原因
- 开奖同步成功（期号+号码）/ 解析失败
- 兑奖计算命中（票据 id + 奖级 + 金额）
- 定时任务失败告警（`logger.warn`）

如后续需要结构化 JSON 日志（trace_id / costMs / provider 字段），再按下方方案引入 nestjs-pino：

```typescript
// src/app.module.ts
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: { target: 'pino-pretty' },  // 开发环境美化
        level: process.env.LOG_LEVEL || 'info',
      },
    }),
    // ...
  ],
})
export class AppModule {}
```

### 12.2 监控

首期至少覆盖以下监控项：

1. Node.js 进程存活（PM2 或 Docker healthcheck）
2. MySQL 可连接性
3. 磁盘剩余空间
4. 火山引擎三产品调用失败率
5. 定时任务连续失败次数

### 12.3 告警

对于个人产品，建议先采用简单方案：

- 企业微信 / 飞书机器人
- 邮件告警

触发条件：

- 连续 3 次开奖同步失败
- OCR 调用连续失败
- 推荐接口错误率异常
- 服务器磁盘不足

---

## 13. 环境变量（实际生效清单，见 `src/config/configuration.ts`）

```env
# 应用
NODE_ENV=production
APP_PORT=3000

# 数据库
DATABASE_URL="mysql://lottery:change_me@127.0.0.1:3306/lottery_helper"

# 火山引擎 · 豆包搜索（SearchInfinity）
VOLC_SEARCH_API_KEY=xxx
# 端点（V1.3 更新，旧 torchlight 端点已失效）：https://open.feedcoopapi.com/search_api/web_search
# 控制台：https://console.volcengine.com/search-infinity/web-search-exp

# 火山引擎 · 火山方舟（视觉理解 + 文本 LLM）
ARK_API_KEY=xxx
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VISION_MODEL=deepseek-v4-1-flash-261017  # OCR 视觉模型（可填 ep-xxx 接入点）
ARK_LLM_ENDPOINT_ID=ep-202608xxxxxx-xxxxx   # 推荐 LLM 推理接入点 ID（必填，非模型名）

# 业务开关
DRAW_SYNC_ENABLED=true                       # 开奖同步任务总开关
RECOMMEND_CACHE_DAYS=7                       # 推荐缓存保留天数（凌晨 3 点清理）
REDEEM_DEADLINE_DAYS=60                      # 兑奖有效期（自然日）
REDEEM_SHOP_THRESHOLD_CENT=1000000           # ¥1 万 = 1000000 分（渠道判定阈值）
OCR_IMAGE_MAX_BYTES=2097152                  # 单张图片上限 2MB

# 种子数据（prisma/seed.ts 用，生产可不设）
SEED_DEVICE_TOKEN=dev-token-local-only
```

> 未使用的变量不再列出：`REDIS_*`（未引入 Redis）、`APP_BASE_URL` / `LOG_LEVEL` / `ARK_LLM_MODEL`（代码未读取）。无 `ARK_API_KEY` 时 OCR/推荐自动降级为本地 mock（`integrations/volcengine/local-mock.ts`），联调可走通全流程。

---

## 14. 部署（实际：PM2 直部署；Docker 方案保留备选）

### 14.0 实际部署方案（已上线，2026-08-21）

> 原规划的 Docker Compose 方案**已作废**：实测服务器（OpenCloudOS 9.2 / 1.7G 内存）已有 Node 22 + PM2 + MySQL 8 + Nginx + certbot HTTPS，跑 Docker 反而增加负担。完整步骤见《部署方案_腾讯云轻量服务器.md》。

```bash
# 1. 打包上传（排除 node_modules/dist/.git/.env）
tar czf lottery-helper.tar.gz --exclude=node_modules --exclude=dist --exclude=.git --exclude=.env -C backend .
scp lottery-helper.tar.gz root@YOUR_SERVER_IP:/opt/

# 2. 服务器解压 + 依赖 + 构建
mkdir -p /opt/lottery-helper && tar xzf /opt/lottery-helper.tar.gz -C /opt/lottery-helper/
cd /opt/lottery-helper
npm install && npm run build        # tsc → dist/

# 3. 生产 .env（见 §13）+ 数据库迁移
npx prisma migrate deploy

# 4. PM2 托管（沿用服务器现有 PM2）
pm2 start dist/main.js --name lottery-helper
pm2 save && pm2 startup             # 更新自启列表
```

实际 Nginx 配置（服务器已存在，仅确认即可）：

```nginx
# /etc/nginx/conf.d/api.memorymap.cn.conf（已生效）
server {
    listen 443 ssl http2;
    server_name api.memorymap.cn;
    # certbot 证书 /etc/letsencrypt/live/api.memorymap.cn/
    client_max_body_size 5M;         # 图片上传限制（OCR 2MB 上限 + base64 裕量）
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;      # 兼顾 OCR/LLM 调用延迟
    }
}
```

> 时区提醒（PM2 直部署版）：OpenCloudOS 系统时区为 CST（北京时间），node-cron 读系统时区即可正确执行；代码层所有 `@Cron` 仍显式传 `{ timeZone: 'Asia/Shanghai' }` 兜底（见 §10.1）。

以下 Docker 方案为**备选**（若未来迁移到全新服务器可参考）：

### 14.1 Dockerfile（备选）

```dockerfile
# docker/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 关键：容器默认 UTC，不设 TZ 会导致 @Cron 定时任务在错误时间执行
# （21:00 UTC = 北京时间次日 05:00）。alpine 镜像需安装 tzdata。
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --spider -q http://localhost:3000/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

### 14.2 Docker Compose（备选）

```yaml
# docker-compose.yml
# 注：Compose V2 已废弃 version 字段，直接省略

services:
  nginx:
    image: nginx:stable
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx:/etc/nginx/conf.d
      - ./docker/certs:/etc/nginx/certs
    depends_on:
      - app
    restart: always

  app:
    build: .
    env_file:
      - .env
    environment:
      TZ: Asia/Shanghai   # 关键：@Cron 按 Asia/Shanghai 执行（与 Dockerfile ENV 双保险）
    depends_on:
      mysql:
        condition: service_healthy   # 等 MySQL 真正就绪再启动，避免 prisma migrate 连接失败
    restart: always

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: lottery_helper
      MYSQL_USER: lottery
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:?}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?}
      TZ: Asia/Shanghai
    command: >
      --default-authentication-plugin=mysql_native_password
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_unicode_ci
      --default-time-zone=+08:00
    volumes:
      - mysql_data:/var/lib/mysql
    restart: always
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -uroot -p$$MYSQL_ROOT_PASSWORD"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  redis:
    image: redis:7-alpine
    restart: always
    # 可选，首期可注释掉

volumes:
  mysql_data:
```

> **时区三处配置缺一不可**（详见 §0 变更说明第 3 条）：
> 1. Dockerfile：`apk add tzdata` + `ENV TZ=Asia/Shanghai`（node-cron 读取 TZ）
> 2. docker-compose app：`environment.TZ`（覆盖式双保险）
> 3. mysql：`TZ` + `--default-time-zone=+08:00`（保证 DATETIME 存取一致）
>
> 另建议在 `@Cron` 装饰器显式传 `{ timeZone: 'Asia/Shanghai' }` 作为代码层兜底（见 §10.2 说明）。

### 14.3 Nginx 配置示例（备选，Docker 方案用）

```nginx
server {
    listen 443 ssl http2;
    server_name lottery-api.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    client_max_body_size 5M;  # 图片上传限制

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;  # 兼顾 OCR/LLM 调用延迟
    }
}

server {
    listen 80;
    server_name lottery-api.example.com;
    return 301 https://$host$request_uri;
}
```

---

## 15. 开发实施顺序（✅ 已全部完成）

### 15.1 第一阶段：MVP（✅ 已完成）

最小闭环已落地：

1. 项目脚手架：NestJS + Prisma + 全局响应拦截器/异常过滤器 + `GET /health` ✅
2. `auth/register` + 设备 Token 鉴权（NestJS Guard）✅
3. `user/config`（GET/POST）✅
4. `ticket/ocr`（接入 deepseek-v4-1-flash-261017）✅
5. `ticket`（POST/GET/DELETE）✅
6. `lottery/status`（含 `purchased` 动态计算、`countdown` 实时计算）✅
7. `statistics` ✅
8. `recommend`（接入火山方舟 LLM）✅
9. `lunar`（lunar-javascript，recommend 依赖它）✅

### 15.2 第二阶段：台账与兑奖（✅ 已完成）

已补齐：

1. `heatmap` ✅
2. `redeem/pending` ✅
3. `redeem/confirm` ✅
4. `lottery/draw` ✅
5. 开奖同步任务（接入 SearchInfinity，凌晨 1 点方案）✅
6. 兑奖计算任务（每 15 分钟兜底）✅
7. `lottery/sync` 手动补差（冷启动历史数据）✅（阶段中新增）

### 15.2.1 前端联调待办（✅ 已全部完成，2026-08-21 联调通过）

| 待办 | 位置 | 状态 |
|---|---|---|
| 补删除票据 API 调用 | `pages/ledger/ledger.js` `onDrawerAction` | ✅ 已调 `DELETE /api/ticket/:id` |
| 补兑奖确认 API 调用 | `pages/ledger/ledger.js` + `pages/home/home.js` | ✅ 已调 `POST /api/redeem/confirm`（id / ticketId 两种入参） |
| 替换 API 基础域名 | `config/index.js` + `app.js` | ✅ `https://api.memorymap.cn/api`，合法域名已配置 |
| `getDraw` 补 issue 语义 | `utils/api.js` | ✅ 后端缺省取最新一期，前端只传 `type` |
| 40100 自动重注册 | `utils/api.js` | ✅ `request` 与 `ocrUpload` 均支持 Token 失效自动重注册并重试一次（清库后不卡死） |

### 15.3 第三阶段：稳定性增强（部分完成，按需推进）

1. Redis 缓存（未引入，按压力再评估）
2. 任务重试与幂等增强（✅ 幂等已实现：upsert + 状态流转防重）
3. 外部依赖降级（✅ 无 Key 时本地 mock 兜底；provider 抽象待按需落地）
4. 运维监控与告警（PM2 进程守护已上线，告警待接入）
5. 火山引擎调用配额监控（待接入，`ExternalCallLog` 表已建）

---

## 16. 最终推荐结论

结合当前项目特点，推荐方案如下：

| 维度 | 推荐（实际落地） |
|---|---|
| **部署形态** | 腾讯云轻量服务器单机 PM2 直部署（OpenCloudOS，Nginx + 原生 MySQL；Docker 方案备选） |
| **架构模式** | 模块化单体 |
| **主技术栈** | NestJS + TypeScript + Prisma + MySQL 8 + Nginx |
| **运行时** | Node.js 22 LTS |
| **图片处理** | base64 直传多模态模型，不持久化（无对象存储依赖） |
| **开奖查询** | 火山引擎 SearchInfinity（豆包搜索联网 API，open.feedcoopapi.com 端点） |
| **彩票 OCR** | 火山引擎 deepseek-v4-1-flash-261017 多模态视觉理解模型 |
| **号码推荐** | 火山引擎火山方舟 doubao-seed-2-1-pro 系列文本大模型（ep-xxx 接入点） |
| **AI SDK** | `openai` npm 包（兼容火山方舟协议）+ Node 22 原生 fetch |
| **定时任务** | @nestjs/schedule（封装 node-cron，显式 Asia/Shanghai 时区） |
| **日志** | NestJS 内置 Logger（个人项目从简；压力升高后切 nestjs-pino） |
| **缓存策略** | 无 Redis；推荐结果入库缓存，热力图实时聚合，HeatmapDailyStat 保留缓存扩展 |

这是当前"个人产品、小程序主板、单机部署、外部 AI 能力丰富"场景下最合理的平衡点：

- 足够简单
- 足够完整
- 成本可控
- 用户熟悉 Node.js，维护成本最低
- 易于后续演进

### 16.1 关于备选方案

- **开奖查询的备选**：在 SearchInfinity 之外，可以同时维护一份"官方源站抓取"作为兜底（`cwl.gov.cn` 福彩网、`sporttery.cn` 体彩网都有结构化的开奖 JSON）。建议：SearchInfinity 为主，源站抓取为兜底，避免搜索 API 偶发延迟或解析失败时无数据可用。
- **OCR 的备选**：传统 OCR（如腾讯云通用印刷体）+ 自定义解析规则，成本更低但需要自己写解析逻辑。deepseek-v4-1-flash-261017 的优势是直接输出结构化 JSON，开发量小。建议：首期用多模态模型，若成本压力上来再考虑切到传统 OCR。
- **LLM 的备选**：DeepSeek-V3、Moonshot Kimi、Qwen-Max 都兼容 OpenAI SDK 协议，切换成本低（在 Node.js 里改 `baseURL` 即可）。火山方舟的优势是生态完整（视觉 + 文本 + 搜索一站式），首期统一供应商更省心。

---

## 17. 后续建议（V1.3 更新）

当前已完成：后端全量开发 + 本地/生产联调 + 火山引擎真实 Key 接入（`npm run check:volcengine` 全绿）+ PM2 部署上线。后续建议方向：

1. **《云后台接口约定.md》已由本文 §8 取代**：接口字段唯一合同来源为本文 §8 + `彩票小助手-小程序/utils/api.js`，旧约定文档可归档。
2. **运维告警接入**：开奖同步连续失败、OCR 连续失败、磁盘不足的主动通知（企业微信/邮件机器人）。
3. **火山引擎配额监控**：SearchInfinity 每月 500 次免费配额，基于 `ExternalCallLog` 表做月度用量统计。
4. **跨春节锚点维护**：`lottery-rules.ts` 的期号锚点（ssq 2026-08-18=2026095 / dlt 2026-08-17=2026093）在跨春节休市后需以真实同步数据校准。
5. **数据备份**：MySQL `lottery_helper` 库定期 mysqldump（cron 每周），防服务器故障丢票据数据。

---

> 本文档以"个人产品、单机部署、火山引擎三件套、Node.js 技术栈"为核心约束，作为当前服务端后台开发的主参考。接口字段以本文 §8 与 `彩票小助手-小程序/utils/api.js` 为唯一合同来源；若前端字段变更须双方同步。
