# 彩票小助手 · 后端部署方案 v2（腾讯云轻量服务器 · PM2 直部署）

> 更新时间：2026-08-20 17:30 ｜ v1（Docker 方案）因实测服务器现状作废
> 目标：停掉旧应用（Memory Map 后端），部署彩票小助手后端（NestJS + Prisma + MySQL 8）

---

## 一、服务器实测现状（SSH 实测，非推测）

| 项 | 值 |
|---|---|
| 实例 | Node.js-ErGJ / `YOUR_INSTANCE_ID` / 北京 ap-beijing / YOUR_SERVER_IP |
| 系统 | OpenCloudOS 9.2（腾讯云自家 Linux） |
| 资源 | 1.7G 内存（已用 964M）、40G 磁盘（剩 32G，21%） |
| **Node.js** | **v22.12.0** ✅（`/usr/local/lighthouse/softwares/nodejs/node-v22.12.0-linux-x64/bin/node`，正好是项目要求的 Node 22 LTS） |
| **PM2** | v6.0.14 ✅（托管旧应用） |
| **MySQL** | **8.0.45** 原生安装（systemd `mysqld`，已运行） |
| **nginx** | ✅ **已配置 `lottery.memorymap.cn:443` → 127.0.0.1:3000**（`/etc/nginx/conf.d/lottery.memorymap.cn.conf`）；旧 `api.memorymap.cn.conf` 未删，留作回退 |
| **HTTPS 证书** | ✅ **Let's Encrypt（certbot 管理）**：`/etc/letsencrypt/live/lottery.memorymap.cn/`（2027-01-28 到期，webroot 续期）；**自动续期已启用**（`certbot.timer` 每日两次 + reload nginx）。旧 `api.memorymap.cn` 证书（2026-12-29 到期）随子域移交另行处理 |
| 旧应用 | `/srv/app`（memory-map-backend，PM2 托管，`.env` 存在，含 DB 凭据） |
| 自动续费 | ✅ 已开通 |
| 防火墙 | 22/80/443 已放行 ✅ |

**重大结论**：服务器**不需要装 Docker**（1.7G 内存也不适合）。Node/PM2/MySQL/nginx/HTTPS **全部现成**，只需"停旧换新"，改动面最小。

> 📌 **证书治理（2026-09-30 修复，重要）**
>
> 2026-08-21 曾把 nginx 的证书路径改指腾讯云免费证书 `a9PKQTQq`（`/etc/nginx/certs/api.memorymap.cn/`，TrustAsia DV，11-18 到期），**但没有同步本文档**——文档一直写着「certbot 已生效」，而 nginx 实际用的是腾讯云那份。**文档与线上不一致，是这次隐患长期没被发现的根源。**
>
> 该配置有两个叠加的致命缺陷：
> 1. 腾讯云免费证书 **`RenewAble: false`、`AutoRenewFlag: 0`，官方已取消自动续期**，每 90 天必须去控制台手工重签 + 手工部署；
> 2. 服务器上 **`certbot.timer` 单元文件根本不存在**（OpenCloudOS 的 certbot rpm 不附带 systemd unit，这是 RHEL 系通病），所以 certbot 管的那份证书同样从不自动续期。
>
> 两者叠加 ⇒ **2026-11-18 必然静默失效**，症状是「突然全挂」，极易被误判成服务器故障。
>
> **当前状态：已统一到 certbot / Let's Encrypt。** nginx 证书路径改回 `/etc/letsencrypt/live/`；自建 `certbot.service` + `certbot.timer`（每日 00:00/12:00 + 随机延迟，`--deploy-hook` reload nginx）。已强制续期一次做端到端实战验证（ACME 签发 → installer 自动部署 → reload nginx 全通），当前到期 **2026-12-29**。
>
> 腾讯云那份证书**保留**在 `/etc/nginx/certs/` 作应急回退（仍是有效证书）。**回退方式**：把 `/etc/nginx/conf.d/api.memorymap.cn.conf` 第 14/15 行路径改回 `/etc/nginx/certs/api.memorymap.cn/…` 后 `systemctl reload nginx`；配置备份见 `…conf.bak.20260930-110738`。

---

## 二、目标架构（零架构变化）

```
https://lottery.memorymap.cn:443
   ▼ nginx（已配置，不动）
127.0.0.1:3000
   ▼ PM2 进程（新：lottery-helper）
NestJS app（dist/main.js）
   ├─ MySQL 8.0.45（原生，已运行，新建 lottery_helper 库）
   └─ 火山引擎（SearchInfinity / 方舟 OCR+LLM）
```

---

## 三、部署步骤（8 步）

### 第 1 步 · 停掉旧应用（Memory Map 后端）

```bash
# SSH 服务器执行（破坏性：删除旧应用，本地有备份）
export PATH=/usr/local/lighthouse/softwares/nodejs/node-v22.12.0-linux-x64/bin:$PATH
pm2 delete memory-map-backend      # 停止并删除 PM2 进程（若名称不符先用 pm2 list 确认）
pm2 save                           # 更新自启列表
# 可选：rm -rf /srv/app           # 删除旧代码（本地有备份，个人项目）
```

### 第 2 步 · 上传新代码

- 本地打包（排除 node_modules / dist / .git / .env）：
  ```bash
  tar czf lottery-helper.tar.gz --exclude=node_modules --exclude=dist --exclude=.git --exclude=.env -C backend .
  scp lottery-helper.tar.gz root@YOUR_SERVER_IP:/opt/
  ```
- 服务器解压：
  ```bash
  mkdir -p /opt/lottery-helper && tar xzf /opt/lottery-helper.tar.gz -C /opt/lottery-helper/
  ```

### 第 3 步 · 安装依赖 + 构建

```bash
cd /opt/lottery-helper
export PATH=/usr/local/lighthouse/softwares/nodejs/node-v22.12.0-linux-x64/bin:$PATH
npm install            # 全量（含 prisma CLI，migrate 需要）
npm run build          # tsc 编译到 dist/
```

### 第 4 步 · 配置生产 .env

```env
NODE_ENV=production
APP_PORT=3000          # nginx 已代理 3000，保持不变
DATABASE_URL="mysql://lottery:CHANGE_ME_DB_PASSWORD@127.0.0.1:3306/lottery_helper"
VOLC_SEARCH_API_KEY=...（沿用本地 .env 真 Key）
ARK_API_KEY=...（沿用）
ARK_LLM_ENDPOINT_ID=...（沿用）
SEED_DEVICE_TOKEN=生产设备 token
```
> MySQL root 密码可从旧应用 `/srv/app/.env` 读取（服务器内操作，不外传）。

### 第 5 步 · 初始化数据库

```bash
# 创建库与用户（密码取自旧 .env 或自定）
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS lottery_helper CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'lottery'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_DB_PASSWORD';
GRANT ALL ON lottery_helper.* TO 'lottery'@'127.0.0.1'; FLUSH PRIVILEGES;"
npx prisma migrate deploy   # 建表
npm run seed                # 种子数据
```

### 第 6 步 · PM2 启动新应用

```bash
pm2 start dist/main.js --name lottery-helper
pm2 save                    # 写入自启
pm2 status                  # 确认 online
```

### 第 7 步 · 验证

```bash
curl -I https://lottery.memorymap.cn                     # 期望 200
curl -s https://lottery.memorymap.cn/                    # 期望 {"code":50000,"message":"Cannot GET /"}（只读探活）
pm2 logs lottery-helper                                # 日志确认
```

### 第 8 步 · 收尾（可选，需确认）

- 删除旧代码目录 `/srv/app`（本地有备份）
- 防火墙删除 28786 规则（旧 OpenClaw 端口，实测未监听，可保留不动）
- 监控：内存 1.7G 若吃紧，加 2G swap（需确认后执行）

---

## 四、风险与注意事项

| 风险 | 说明 | 应对 |
|---|---|---|
| 内存 1.7G 偏小 | MySQL 400M + app ~150M，尚可 | 若 OOM 加 swap（2G） |
| MySQL root 密码 | 服务器内旧 .env 有凭据 | 服务器内读取使用，不外传 |
| 免费证书 3 个月 | certbot 自动续期**已启用**（`certbot.timer` 每日两次）；腾讯云证书 11-18 到期，仅作应急回退 | ✅ 已收口（2026-09-30） |
| 旧应用删除不可逆 | 本地有备份 | 确认后再删 /srv/app |
| 3000 端口冲突 | 旧应用先删再启新的，不冲突 | 第 1 步先行 |

---

## 五、待确认

- [x] 服务器续费（自动续费已开）
- [x] SSH（root 密码已重置）
- [x] HTTPS（Let's Encrypt + `certbot.timer` 自动续期，2026-09-30 端到端验证通过；腾讯云证书留作回退）
- [x] 服务域名 lottery.memorymap.cn（nginx 已配好；2026-10-30 由 api 子域迁入）
- [ ] **确认开始执行**：第 1 步停旧应用（PM2 delete）+ 上传代码（我会通过 SSH 全程执行，破坏性步骤逐条展示命令）

---

*所有信息均来自 SSH 实测与云 API 查询。*

---

## 六、静态介绍页部署（2026-10-30）

产品介绍页以**纯静态**方式与服务同域托管，域名复用 `https://lottery.memorymap.cn/`。

### 6.1 为什么同域不影响现有服务

后端路由只有两族（逐一核对 `backend/src/**/*.controller.ts`）：

| 路由族 | 控制器 | 处理 |
|---|---|---|
| `/api/*` | auth / ticket / lottery / redeem / statistics / heatmap / lunar / poi / recommend / user | 原样反代 `127.0.0.1:3000` |
| `/health` | health.controller | 原样反代 `127.0.0.1:3000` |
| 其余 | — | 静态目录 `/var/www/lottery-intro` |

因此把根路径改成静态后，小程序与眼镜端的**所有请求都落在 `/api` 前缀下，行为完全不变**（实测 40100 响应体与改前逐字节一致）。
全链路无 Cookie、无 301 改写；`proxy_set_header` 提到 server 层，两个 location 共同继承，避免复制粘贴漂移。

### 6.2 落地内容

- 站点根目录：`/var/www/lottery-intro/`（`index.html` + `assets/`，共 14 个文件、1.3MB）
- nginx：`/etc/nginx/conf.d/lottery.memorymap.cn.conf`，改前备份为 `*.conf.bak.20261030-intro`
- `location /assets/` 加 `expires 7d`；`location /` 用 `try_files $uri $uri/ =404`
  （**故意不做 SPA 回退**，避免把不存在的路径伪装成 200）
- 443/80 监听、证书路径、ACME webroot 三处**原样未动**

### 6.3 上传通道（重要）

TAT 的 `--Content` 有 64KB 上限，`tat.py put/putmany` 对**单个大文件**（图片）会 `InvalidParameterValue.TooLong`。
新增 `_dev_tools/push_tree.py`：按 24000 字节原始块切分，逐块 `base64 -d >>` 追加到 `.part`，最后一块顺带 `md5sum` 校验。

```
MSYS_NO_PATHCONV=1 python _dev_tools/push_tree.py <本地目录> /var/www/lottery-intro
```

🔴 **必须带 `MSYS_NO_PATHCONV=1`**：Git Bash 会把 `/var/www/...` 改写成
`D:/Program Files/wb/.../PortableGit/var/www/...`，远端报 `line 3: D:/Program: Is a directory`（本次首次运行即踩中）。
脚本内另加了「从脏参数里反解 `/var/www`」的兜底，但根治还是加环境变量。

### 6.4 回滚（一条命令）

```bash
cp -a /etc/nginx/conf.d/lottery.memorymap.cn.conf.bak.20261030-intro \
      /etc/nginx/conf.d/lottery.memorymap.cn.conf && nginx -t && systemctl reload nginx
```

回滚后根路径恢复为「反代到 Nest」，`/var/www/lottery-intro` 可留着不删，不影响任何服务。

### 6.5 验证清单（已全绿）

| 检查项 | 结果 |
|---|---|
| `GET /` | 200 `text/html`，47695B（与本地 md5 一致） |
| `GET /assets/*` | 12 个资源全 200，Content-Type 正确 |
| `GET /health` | 200 `application/json`，`{"code":0,...,"status":"ok"}` |
| `GET /api/lottery/status` | 200，`{"code":40100,...}` —— 鉴权链照常，与改前一致 |
| Header 透传 | 带 `X-Device-Token` 时返回「Token 无效」，不带时返回「缺少」→ 请求头确实到达 Nest |
| `GET /nope` | 404（无误导性 200） |
| `http://` | 301 → https；ACME 目录可访问 |
| 证书 | Let's Encrypt（YE2），2026-10-30 → 2027-01-28，nginx 侧仍是 certbot 那份 |
| 后端进程 | PM2 `lottery-helper` uptime 2D 未变 —— **未重启，仅 nginx reload** |
