# Live-QR 交接文档

> **面向接手本项目的 AI 会话 / 开发者：读完这一份即可开工。**
> 最后更新：2026-10-30 · 基线提交 `1861144`（`main`，已推送）
>
> **本轮（2026-10-30）改动尚未提交**：server / web / 合规 UI / 部署面 / CI 共约 68 个文件
> 停在工作区（含未跟踪的 `.develop/HANDOFF.md`、`.develop/HANDOFF-AUDIT.md`、`.github/`）。
> 接手第一步先 `git status` 确认；提交需要 GPG 解锁，见 §14。
>
> 本轮门禁实测：**server 193 passed（11 文件）· web 60 passed（10 文件）· 双 lint / 双 typecheck /
> 双 build 全绿**（含审计日志子系统与合规文案的用例；审计用例仍在补充，准确值以 `pnpm test` 输出为准）。与旧文档冲突时，
> **以本文为准**；历史文档的时效说明见 §15。

---

## 0. 一句话

扫码即传的实时二维码投递：**上传端**用摄像头扫二维码 → 解码成文本 → 推到服务器；
**观看端**输入 8 位分享码 → 实时收到文本 → 重新渲染成二维码。

线上实例：<https://qr-live.cxs.apps.dynesshely.top> （已验证可解析、HTTPS 200）
仓库：<https://github.com/Dynesshely/Live-QR> （AGPL-3.0，约 106 stars）

---

## 1. 项目定位

解决的问题：**摄像头扫一次码，远端就能持续看到内容变化**。

典型场景：手机上扫一个随时会变的二维码（登录码、动态令牌、大文件分片传参），
把内容实时投到大屏/另一台设备上显示。

三个角色：

| 角色 | 载体 | 职责 |
| --- | --- | --- |
| 上传端 | `web` 的 Scanner 模式（手机浏览器） | 调摄像头 + `jsQR` 解码 + 去重/节流/离线队列 → `POST /api/upload` |
| 服务器 | `server`（Node.js） | 通道管理、限流、WebSocket 广播、过期清理、访问日志 |
| 观看端 | `web` 的 Viewer 模式 | 输分享码 → 验证 → WS 订阅 → `qrcode` 渲染 |

> 上传端和观看端是**同一个 Vue 应用**的两种模式，不是两个 App。
> 没有原生 App，没有数据库。

本项目是**技术演示**，不是通讯服务；合规文案与声明见 §16。

---

## 2. 架构与数据流

```
上传端(浏览器/手机)                    服务器                      观看端(浏览器)
  摄像头 → jsQR 解码                     ┌────────────────────────┐
  去重 / 节流 / 离线队列  ──POST /api/upload──▶│ Express :41601          │
                                        │  channels Map（纯内存） │
  分享码 ◀──POST /api/channel/create────│  attemptStore（限流窗口）│
                                        │  每连接心跳定时器        │
  订阅 ◀──────ws /ws?shareCode=───────▶│ WS server :41602        │───text/viewer_count──▶ qrcode 渲染
                                        └────────────────────────┘
```

- **纯内存存储**（`Map<string, ChannelState>`），**没有数据库**。
  → **进程重启 = 所有通道丢失**。这是设计选择，不是缺陷（§13）。
- 生产环境由 **Caddy** 统一入口：`/api/*` → 41601，`/ws` → 41602，其余静态文件；
  TLS 通常由外层网关（EdgeOne / openresty）终止，容器内只跑 HTTP（§11）。
- 访问日志中间件在 body parser **之前**（`server/src/app.ts:20,25`），所以被 body 大小/JSON
  解析拒绝的请求也会被记录；`/api/health` 不记（`server/src/middleware/accessLog.ts:12`）。
- **审计日志副本**：开启时把每次上传（含明文文本、收发双方 IP/UA）与观看者连接/断开
  追加到磁盘 `AUDIT_LOG_DIR/transfer-YYYY-MM-DD.jsonl`，默认保留 243 天（详见 §2.5/§16.4）。

### 2.1 运行时关键参数（`server/src/config.ts`，可用环境变量覆盖）

| 项 | 默认 | 范围 / 取值 | 说明 |
| --- | --- | --- | --- |
| `PORT_HTTP` | 41601 | 1–65535 | HTTP API（`config.ts:31`） |
| `PORT_WS` | 41602 | 1–65535 | WebSocket（`config.ts:32`） |
| `CHANNEL_TTL_SECONDS` | 1800 | **60–86400** | 默认通道 TTL（`config.ts:33`） |
| `CLEANUP_INTERVAL_SECONDS` | 60 | 10–3600 | 过期扫描间隔（`config.ts:34`） |
| `UPLOAD_RATE_LIMIT` | 2 | 1–100 | 每通道每秒上传上限（`config.ts:35`） |
| `CREATE_RATE_LIMIT` | 10 | 1–1000 | **新增**：每 IP 每分钟建通道上限（`config.ts:36`） |
| `MAX_VIEWERS_PER_CHANNEL` | 50 | 1–500 | 每通道 WS 观看者上限 |
| `VERIFY_RATE_LIMIT` | 10 | 1–1000 | 每 IP 每分钟 verify 上限 |
| `MAX_TEXT_LENGTH` | 2000 | 1–10000 | 文本上限，**按 Unicode 码点**计 |
| `TRUST_PROXY` | `loopback` | `false` / 跳数 / `loopback` / `linklocal` / `uniquelocal` / IP / CIDR（可逗号列表） | Express trust proxy（`config.ts:42-44,78-84`） |
| `WS_ALLOWED_ORIGINS` | 空 | 逗号分隔 Origin / `*` | WS Origin 白名单；空 = 同源（`config.ts:47,86-92`） |

派生限制（`config.ts:54-75`）：

- `expire_seconds` 允许 **60–7200**（整数），越界/非整数在路由层直接 400；
- JSON body 上限 = `max(16 KiB, MAX_TEXT_LENGTH × 6 + 1 KiB)`，按最坏 JSON 转义估算。
  所以调大 `MAX_TEXT_LENGTH` 不会把合法上传变成 413/500。
- shareCode：`randomInt(10_000_000, 99_999_999)` → 恒 8 位；撞码最多重试 **5** 次后 503
  （`server/src/services/channelStore.ts:92-106`）。

### 2.2 per-channel TTL 与惰性过期（本轮修复的核心语义）

- `POST /api/channel/create` 的 `expire_seconds` **真实生效**：创建时冻结为通道自身的
  `ttlSeconds`，返回值里的 `expireAt = createdAt + ttlSeconds` 不再是装饰
  （`channelStore.ts:108-128`）。
- 过期锚点是 `lastUploadAt`（**创建也算一次活动**）；每次上传重置
  （`channelStore.ts:30-36,144-155`）。
- **惰性过期**：`getChannel` / `channelExists` / `getViewerCount` / `updateText` 都先走
  `getLiveChannel`，发现过期就通知观看者并以 1001 关闭、删除通道
  （`channelStore.ts:56-88`）。
- 因此过期后：verify/upload → 404；WS 握手/后续 → 4001；**上传不能复活已过期通道**
  （`channelStore.ts:144-147`，路由见 `server/src/routes/upload.ts:60-64`）。
- 扫描定时器仍会主动清理（`channelStore.ts:207-230`），同时 prune 限流表；
  扫描间隔不再影响「过期后还能不能读到」——读到就会立刻被判过期。

### 2.3 内存持有者：三处

| # | 持有者 | 位置 | 清理时机 |
| --- | --- | --- | --- |
| 1 | 通道表 `channels: Map<shareCode, ChannelState>`（含 `wsClients: Set`） | `server/src/services/channelStore.ts:13` | 过期/主动关闭/重启 |
| 2 | 限流窗口 `attempts: Map<key, timestamp[]>`（verify + create 共用） | `server/src/services/attemptStore.ts:10` | 每个 cleanup tick `pruneAttempts`（`channelStore.ts:221`）/ `shutdownAll`（`:267`） |
| 3 | 每条 WS 连接的 `heartbeatTimer`（30s setInterval） | `server/src/ws/handler.ts:215` | `close` 事件清理（`handler.ts:226-231`）、过期/关服时 terminate |

> 旧文档漏了第 2 处、并说「每连接 2 个定时器」——旧的 `noMessageTimer` 已被删除，现在每连接只有 1 个心跳定时器。

### 2.4 `viewer_count` 实时广播

- `welcome` 仍携带连接时刻的 `viewerCount`；**加入/离开都会广播** `{type:'viewer_count', count}`
  （`channelStore.ts:162-201`）。
- 通道关闭（过期/主动 expire/关服）时**不广播** `viewer_count`，只发 `channel_expired` 再关闭。
- 前端 `useWebSocket` 两种字段都接受（`count` 优先），见 `web/src/types.ts:35-41`。

### 2.5 日志：访问日志（stdout）与审计日志（磁盘）

**访问日志 / 业务事件**（stdout，一行一个 JSON）：

- 每请求：`method / path / status / durationMs / clientIp / userAgent`，
  `/api/health` 排除（`accessLog.ts:11-29`、`logger.ts:58-72`）。
- 业务事件只用 `event / timestamp / shareCode / clientIp / message`；上传事件额外只有
  **文本长度**（`server/src/routes/upload.ts:66`）。
- **这套日志不含请求体与上传文本**；输出到 stdout（error 走 stderr），轮转由部署方负责。

**审计日志**（独立子系统，默认开启，写入磁盘）：

- 目录 `AUDIT_LOG_DIR`（默认 `logs`，相对 server 进程 cwd），文件
  `transfer-YYYY-MM-DD.jsonl`（**UTC 日期**），一行一个 JSON、追加写；
  目录 `0700`、文件 `0600`。
- `upload` 记录包含**文本原文** `text`、`textLength`、`uploaderIp`、`uploaderUa`、
  `recipients:[{ip, ua}]`（广播时在线的观看者快照）；另有 `viewer_connect` / `viewer_disconnect` /
  `audit_started` / `retention_purge`（字段见 §16.4）。
- **自动清理**：启动时 + 每次跨天滚动时删除早于「今天 − `AUDIT_LOG_RETENTION_DAYS`」的文件；
  默认 **243 天（约 8 个月）**，范围 1–3650。
- 容器内目录 `/var/log/live-qr`，由 compose 挂**命名卷** `live-qr-logs`（§11）；
  卷里是明文副本，读取权限按敏感数据处理（§16.4）。
- 日志量随「上传量 × 文本长度」增长，高流量部署要监控卷容量并考虑调小保留天数。
- **审计写入绝不影响请求**：所有写入 fire-and-forget，失败只向 stderr 记
  `audit_write_failed`；目录不可写时服务照常启动（审计降级，部署后要检查卷权限）。

---

## 3. 技术栈

| 层 | 选型 |
| --- | --- |
| 后端 | Node.js 22+ · **Express 5** · `ws` 8 |
| 前端 | **Vue 3**（`<script setup>`）· Vite 6 · **Tailwind CSS v4**（CSS-first） |
| 状态 | Pinia 3 + `pinia-plugin-persistedstate`（偏好持久化，键 `app-preferences`） |
| 二维码 | `jsqr`（解码）· `qrcode`（生成，1024px 位图 / H 级 / margin 4） |
| i18n | `vue-i18n` 11（zh / en / ja） |
| 校验 | Zod（环境变量）+ dotenv |
| 测试 | Vitest 4 + supertest（server）· happy-dom + @vue/test-utils（web） |
| 反代 | Caddy（安全头 + gzip/zstd；站点地址可配） |
| 容器 | Docker 三阶段（Node 22 Alpine + Caddy + tini，非 root uid 10001） |
| CI | GitHub Actions（test / typecheck / build / lint） |

本机工具链实测：Node `v24.20.0` · pnpm `11.25.0`（2026-10-30）。

---

## 4. 目录结构（当前实际）

```
Live-QR/
├── .develop/                       # 内部文档（HANDOFF-AUDIT / HANDOFF 本轮未跟踪）
│   ├── Requirements.md             # 原始需求（2026-06-16；顶部有实现差异说明）
│   ├── Enhancements #1.md          # 早期技术栈改进记录（部分过时，文内已标注）
│   ├── HANDOFF.md                  # ← 本文
│   └── HANDOFF-AUDIT.md            # 2026-10-30 审计记录 + 逐项处理状态
├── .github/workflows/ci.yml        # push/PR：test + typecheck + build + lint（两包都阻断）
├── assets/logo.svg                 # **生成物**（源：web/scripts/render-icon.mjs 的 ICON）
├── server/                         # 后端
│   ├── tsconfig.build.json         # 生产构建配置（排除 *.test.ts 与 src/testing/**）
│   ├── eslint.config.js / vitest.config.ts
│   └── src/
│       ├── index.ts                # 进程入口（仅直接运行时启动）
│       ├── server.ts               # createServers / start / close / 信号处理（可测试，不 import 即起服务）
│       ├── app.ts                  # Express 工厂：trust proxy / accessLog / body limit / JSON 404
│       ├── config.ts               # Zod 校验 + 派生限制（body 上限、TTL 范围、trust proxy 解析）
│       ├── types.ts                # 类型、WS 消息、日志事件与字段
│       ├── logger.ts               # JSON-per-line + access()
│       ├── routes/{channel,upload}.ts
│       ├── services/{channelStore,attemptStore,auditLog,clientIp}.ts
│       ├── ws/handler.ts           # 握手判定（纯函数）+ 心跳 + 观者上限
│       ├── middleware/{accessLog,validate,rateLimiter,errorHandler}.ts
│       ├── testing/                # 测试辅助（不进生产构建）
│       ├── middleware/{accessLog,errorHandler}.test.ts   # 本轮新增
│       ├── server.test.ts                                # 本轮新增（createServers / EADDRINUSE / close）
│       ├── ws/handler.test.ts                            # 本轮新增（握手 / 心跳 / 观者上限）
│       ├── services/{auditLog,clientIp}.test.ts          # 审计日志子系统
│       └── 其余既有测试            # config / rateLimiter / channel / upload / channelStore
│                                   # 合计 11 个测试文件 / 193 用例（持续增加）
├── web/                            # 前端
│   ├── vite.config.ts              # 41605，/api→41601，/ws→41602（ws:true）
│   ├── scripts/render-icon.mjs     # 图标单一几何定义 → SVG + PNG（pnpm icon）
│   ├── public/{favicon.svg,favicon-32.png,apple-touch-icon.png}
│   ├── index.html                  # favicon / apple-touch-icon / theme-color / 首屏防 FOUC
│   └── src/
│       ├── App.vue                 # home / scanner / viewer 三模式 + 合规弹窗挂载
│       ├── brand.ts                # APP_NAME 单一来源（品牌名不进 i18n）
│       ├── i18n.ts                 # 首访语言探测（localStorage > navigator > en）+ 同步 <html lang>
│       ├── style.css               # Tailwind v4 入口 + 移动端基础约定
│       ├── components/             # BrandMark · ScannerView · QRDisplay · ShareCodeInput ·
│       │                           # StatusIndicator · HistoryList · FooterBar ·
│       │                           # LegalBanner · LegalConsentDialog · LegalTermsDialog
│       ├── composables/            # useScanner · useWebSocket · useQRCode · useTheme · useLocale · useLegal
│       ├── legal/content.ts        # 中英日三层合规文案（纯数据）
│       ├── utils/                  # fetch(超时) · upload(分类/去重) · ws(关闭码) · scan(裁切)
│       ├── stores/preferences.ts   # app-preferences（locale 空串 = 未选择）
│       ├── locales/{zh,en,ja}.json # 各 87 个键，键集合一致性有测试
│       ├── typings/i18n.d.ts
│       └── *.test.ts               # 10 个测试文件（清单见 §9；本轮新增 useWebSocket/
│                                   # useLocale/i18n/locales/QRDisplay/ShareCodeInput/utils.*）
├── Caddyfile                       # {$CADDY_SITE_ADDRESS::80} + 安全头 + 压缩
├── Dockerfile                      # 三阶段：web → server（tsconfig.build）→ runtime（tini/非 root/HEALTHCHECK）
├── docker-compose.yml              # env_file + 变量默认值 + healthcheck + restart
├── entrypoint.sh                   # 信号转发 + 双进程监督（子进程死则容器退出）
└── .env.example                    # 16 个真实键（14 server + 2 部署）
```

规模：server/src 18 个非测试 `.ts`（约 2.5k 行，另有 11 个测试文件）；web/src 38 个 `.ts/.vue`（约 5.0k 行，含 10 个测试文件）。

---

## 5. HTTP API 契约

### 5.1 四种响应形状 + 错误包络

| 形状 | 谁用 | 例子 |
| --- | --- | --- |
| `{code, data}` | `POST /api/channel/create` | `{code:201, data:{shareCode, expireAt, createdAt}}` |
| `{code, message}` | `POST /api/upload` / `POST /api/channel/expire` | `{code:200, message:'ok'}` |
| **扁平** `{code, valid, latestText, updatedAt}` | `GET /api/channel/verify` | 没有 `data` 包裹（`types.ts:31-36`） |
| `{status:'ok'}` | `GET /api/health` | 没有 `code`（`app.ts:32-34`） |
| `{code, error, message}` | 所有失败 | `error` 是稳定契约；`message` 是中文文案，前端不直接展示 |

未知路径统一 **JSON 404** `{code:404,error:'NOT_FOUND'}`（`errorHandler.ts:91-93`、`app.ts:37`），
不再是 HTML。body parser 错误映射：`entity.parse.failed` → 400 `INVALID_JSON`；
`entity.too.large` → 413 `PAYLOAD_TOO_LARGE`；`entity.verify.failed` → 400 `INVALID_BODY`；
其它 4xx 透传为 `BAD_REQUEST`，5xx 兜底 `INTERNAL_ERROR`（`errorHandler.ts:50-88`）。

### 5.2 端点总览

| 方法 | 路径 | 限流 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/channel/create` | 每 IP `CREATE_RATE_LIMIT`/分钟 | 申请通道（可选 `expire_seconds`） |
| `POST` | `/api/upload` | 每通道 `UPLOAD_RATE_LIMIT`/秒 | 覆盖最新文本 |
| `GET` | `/api/channel/verify` | 每 IP `VERIFY_RATE_LIMIT`/分钟 | 校验 + 取最新文本 |
| `POST` | `/api/channel/expire` | —（靠分享码格式校验） | 主动关闭通道 |
| `GET` | `/api/health` | —（不记访问日志） | 探活 |

### 5.3 分享码申请

- 请求体可选：`{ "expire_seconds": 1800 }`，**整数，60–7200**；
  非 number / 非整数 / 越界 → 400 `INVALID_EXPIRE_SECONDS`（`routes/channel.ts:15-34`）。
- 不传则用 `CHANNEL_TTL_SECONDS`；TTL 冻结在通道上，`expireAt` 由此计算（§2.2）。
- 201 响应：`{code:201,data:{shareCode,expireAt,createdAt}}`，两个时间都是 ISO 8601。
- 限流：每 IP 每分钟 `CREATE_RATE_LIMIT` 次（默认 10），超限 429 `CREATE_RATE_LIMITED`
  （`rateLimiter.ts:82-101`）。
- 撞码重试 5 次仍失败 → 503 `SERVICE_UNAVAILABLE`（`routes/channel.ts:45-61`）。

### 5.4 文本上传

- 请求体 `{shareCode, text}` → 200 `{code:200,message:'ok'}`。
- 覆盖式：通道只保留最新一条；历史由观看端本地维护（≤200 条）。
- 校验顺序：shareCode 格式 → 文本非空/长度 → 限流（非法请求不消耗额度）。
- 文本：`text.trim().length === 0` → 400 `TEXT_EMPTY`；长度 `[...text].length`（**Unicode 码点**）
  > `MAX_TEXT_LENGTH` → 400 `TEXT_TOO_LONG`（`routes/upload.ts:15-43`）。
- 通道不存在/已过期 → 404 `CHANNEL_NOT_FOUND`；过期通道不会被上传复活。
- 429 `RATE_LIMITED` 由通道滑动窗口（1s）产生（`rateLimiter.ts:20-50`）。

### 5.5 分享码验证

- 200 扁平：`{code:200,valid:true,latestText,updatedAt}`；没有文本时两者都是 `null`。
- 分享码格式错误 → 400 `INVALID_SHARE_CODE`（**在限流之前**，不消耗额度）；
  不存在/过期 → 404 `CHANNEL_NOT_FOUND`；超限 → 429 `VERIFY_RATE_LIMITED`
  （`routes/channel.ts:64-88`、`middleware/validate.ts:15-26`）。

### 5.6 主动关闭通道

- 请求体 `{shareCode}`；成功 200 `{code:200,message:'ok'}`；不存在/已过期 404。
- 在线观看者先收到 `channel_expired`（含 `code:'CHANNEL_EXPIRED'`），随后连接以 **1001** 关闭。

### 5.7 健康检查

`GET /api/health` → `{status:'ok'}`，无 `code`、无访问日志；容器 HEALTHCHECK 与外部探活都打这里。

---

## 6. WebSocket 协议

连接：`wss://<host>/ws?shareCode=12345678`
（WS 服务器挂在**独立的** HTTP server 上，`server.ts:103-106,120`；路径只有 `/ws` 与 `/ws/`。）

### 6.1 握手拒绝矩阵（`ws/handler.ts:76-112`）

| 条件 | 结果 |
| --- | --- |
| path 不是 `/ws` 或 `/ws/` | **HTTP 403** `FORBIDDEN_PATH` |
| `shareCode` 缺失 / 不是 8 位数字 | **HTTP 400** `INVALID_SHARE_CODE`（不会得到 WS 关闭码） |
| Origin 存在且不允许（默认同源 host 比对；`WS_ALLOWED_ORIGINS` 白名单） | **HTTP 403** `FORBIDDEN_ORIGIN` |
| 握手通过但通道不存在/已过期 | WS close **4001** `CHANNEL_NOT_FOUND` |
| 观看者已满 | WS close **4002** `TOO_MANY_VIEWERS` |

> Origin 缺失的非浏览器客户端放行；`*` 表示允许任意 Origin。
> 注意：**Origin 拒绝是 403**（不是 400）——以 `handler.ts:102-108` 与
> `handler.test.ts:90-96` 为准。

### 6.2 服务端 → 客户端

| type | 载荷 | 说明 |
| --- | --- | --- |
| `welcome` | `shareCode, viewerCount` | 连接成功时最先发 |
| `history` | `messages[]`（≤1 条） | 仅当已有文本 |
| `text` | `data, timestamp`（Unix ms） | 每次上传广播 |
| `viewer_count` | `count` | 观看者加入/离开时广播（§2.4） |
| `channel_expired` | `code:'CHANNEL_EXPIRED'`, `message` | 关闭前发；`message` 仅为兼容 |
| `heartbeat` | `serverTime` | 每 30s |

客户端 → 服务端只有 `{type:'pong'}`。

`channel_expired.message` 是服务端写死的英文 `Channel expired`，**前端只认 `code`**，
绝不直接展示（旧实现的中文硬编码已移除，见 `types.ts:74-83`、`web/src/types.ts:54-64`）。

### 6.3 关闭码

| 关闭码 | 含义 |
| --- | --- |
| `1001` | 通道过期 / 主动 expire（**先**收 `channel_expired`，通道确实已删除） |
| `1012` | **服务端重启**（Service Restart，无消息）——通道数据已丢但服务会回来，前端据此重连 |
| `4001` | 仅握手阶段「通道不存在/已过期」；缺/错 shareCode 是 HTTP 400 |
| `4002` | 观看者已满（`MAX_VIEWERS_PER_CHANNEL`） |
| `1006` | 非正常断开：心跳超时被 terminate 或网络中断（无关闭帧） |

> **1001 与 1012 的分工（别合并）**：1001 表示「这个通道没了」，前端不重连；
> 1012 表示「服务重启，通道可能还在」，前端按 1/2/4/8/16s 退避重连，保留最后一屏。
> 二者混用会导致「重启后全员卡在过期横幅」或「通道已删却无限重连」。
> 前端分类在 `web/src/utils/ws.ts`（`classifyCloseCode`），有单测护栏。

### 6.4 心跳与重连

- 服务端每 **30s** 发 `heartbeat`；每隔一个 tick 检查 `isAlive`，**连续 2 个 tick（约 60s）**
  没收到 `pong` 就 `terminate` → 客户端看到 1006（`handler.ts:213-224`）。
  旧的 `noMessageTimer`（60s 无 message 杀连接）**已删除**；旧文档里的心跳次数与超时数值已作废。
- 客户端 60s 没收到任何消息 → 主动断开并重连（`useWebSocket.ts:15,60-70`）。
- 重连退避：`1s → 2s → 4s → 8s → 16s`，最多 **5** 次（`useWebSocket.ts:12-22,188-203`）。
  代码里**没有额外上限**；第 5 次退避就是 16s。
- 重连期间保留最后一个二维码；成功重连后用 `history` 去重（`useWebSocket.ts:117-133`）。

---

## 7. 配置项

### 7.1 server 读取的 14 个键

| 键 | 默认 | 范围 / 说明 |
| --- | --- | --- |
| `PORT_HTTP` | 41601 | 1–65535 |
| `PORT_WS` | 41602 | 1–65535 |
| `CHANNEL_TTL_SECONDS` | 1800 | 60–86400 |
| `CLEANUP_INTERVAL_SECONDS` | 60 | 10–3600 |
| `UPLOAD_RATE_LIMIT` | 2 | 1–100 |
| `CREATE_RATE_LIMIT` | **10（新增）** | 1–1000，每 IP/分钟 |
| `MAX_VIEWERS_PER_CHANNEL` | 50 | 1–500 |
| `VERIFY_RATE_LIMIT` | 10 | 1–1000 |
| `MAX_TEXT_LENGTH` | 2000 | 1–10000（码点） |
| `TRUST_PROXY` | **`loopback`（新增）** | `false` / 跳数 / `loopback` / `linklocal` / `uniquelocal` / IP / CIDR；可逗号列表 |
| `WS_ALLOWED_ORIGINS` | **空（新增）** | 逗号分隔 Origin，`*` = 任意；空 = 同源 |
| `AUDIT_LOG_ENABLED` | `true` | **新增**：审计日志开关；true/false（也接受 1/0） |
| `AUDIT_LOG_DIR` | `logs` | **新增**：审计日志目录（相对 server cwd）；容器内固定 `/var/log/live-qr` |
| `AUDIT_LOG_RETENTION_DAYS` | 243 | **新增**：保留天数 1–3650（≈8 个月），按 UTC 日期切文件 |

### 7.2 部署侧 2 个键（server 不读）

| 键 | 默认 | 消费方 |
| --- | --- | --- |
| `CADDY_SITE_ADDRESS` | `:80` | Caddyfile 的 `{$CADDY_SITE_ADDRESS::80}`；填域名则容器内自动 HTTPS |
| `LIVE_QR_PORT` | 41606 | docker-compose 的宿主端口（容器内始终 80） |

> `CADDY_DOMAIN` / `CADDY_EMAIL` 从未被任何代码读取，已删除；设置它们**不会**启用 HTTPS。
> 旧文档中把它们当作可用开关的说法是错的。

**部署注意（TRUST_PROXY）**：默认只信任 loopback。如果反向代理**不在本机回环**
（另一台机器、Docker 的 bridge IP、K8s Service 等），必须把 `TRUST_PROXY` 设成代理的
IP/CIDR 或跳数，否则 `req.ip` 会全部变成代理地址，verify/create 的 per-IP 限流会把所有
用户合并成同一个桶；反过来，链路上有不可信段时不要设成 `true`。

**`.env` 的读取位置**：server 用 `dotenv/config`，从**进程工作目录**读 `.env`
（本地 `dev` 时是 `server/.env`）；docker compose 读**仓库根** `.env` 并注入容器。
`.env.example` 已按真实消费方写好注释。

---

## 8. 本机开发：DevHub（唯一合法启停入口）

> ⚠️ **不要** `pnpm dev &` / `nohup` / `pkill`。规则全文：`~/.devhub/README.md`。

项目已登记为 **`live-qr`**（`~/.devhub/registry/projects.json`）：

| 命令 | 端口 | 内容 |
| --- | --- | --- |
| `api` | **41601**(HTTP) + **41602**(WS) | `cd server && pnpm dev`（tsx watch） |
| `web` | **41605** | `cd web && pnpm exec vite --host 0.0.0.0 --port 41605 --strictPort` |
| `build` / `test` / `typecheck` | — | oneshot，按顺序跑两个包 |

`api` 是**一个进程同时监听两个端口**（`server/src/server.ts:115-129`），devctl 只锚定 41601，
回收时整组一起收。

```bash
export PATH="$HOME/.local/bin:$PATH"
~/.devhub/devctl status live-qr --json
~/.devhub/devctl start live-qr api --wait-ready
~/.devhub/devctl start live-qr web --wait-ready      # 必须在 api 之后
~/.devhub/devctl logs  live-qr api --tail 50
~/.devhub/devctl restart live-qr web                # 前端改了但页面不更新时
```

**autostart 已启用**（`delaySec` api=6 / web=10，`onRelease=unown`，systemd unit enabled，
`linger=yes`）。开机自动拉起为**无主（@roster）实例**，会话收尾的
`devctl stop --all` **不会**带走它们。

启动后访问：<http://127.0.0.1:41605> ／ <http://10.0.30.61:41605>

> 摄像头只在**安全上下文**可用：`127.0.0.1` 或 HTTPS。用局域网 IP 打开开发实例时
> `getUserMedia` 会被浏览器拒绝（§12.9）。

---

## 9. 构建 / 测试 / 质量门

**没有 root script**，必须分别进两个包：

```bash
cd server && pnpm test        # 193 passed / 11 files（持续增长中，以实际输出为准）
cd web    && pnpm test        #  60 passed / 10 files

cd server && pnpm typecheck   # tsc --noEmit
cd web    && pnpm typecheck   # vue-tsc --noEmit
cd server && pnpm lint        # eslint src/
cd web    && pnpm lint        # eslint src/（依赖已补齐：eslint-plugin-vue + vue-eslint-parser）
cd server && pnpm build       # tsc -p tsconfig.build.json → server/dist
cd web    && pnpm build       # vue-tsc + vite build → web/dist
```

当前基线（2026-10-30 实测，含审计日志子系统）：**server 193 passed · web 60 passed ·
双 lint / 双 typecheck / 双 build 全绿**（审计用例仍在补充，数字以 `pnpm test` 为准）。server 的 `dist` 已确认不含 `*.test.js`（`tsconfig.build.json` 排除
`src/**/*.test.ts` 与 `src/testing/**`；Dockerfile 里还有一条防回归断言）。

**CI**：`.github/workflows/ci.yml` —— push / pull request 触发，Node 22 + pnpm 11，
`server` / `web` 矩阵分别跑 `install --frozen-lockfile` → `test` → `typecheck` → `build`，
第二组矩阵跑 `lint`，**两个包都阻断**（web 的 lint 依赖已在本轮补进
`web/package.json` 与 lockfile）。CI 尚未在 GitHub 上实际跑过（§13）。

> 测试文件：server 11 个（config / accessLog / errorHandler / rateLimiter / channel / upload /
> server / channelStore / ws-handler / auditLog / clientIp）；web 10 个（useQRCode / QRDisplay / ShareCodeInput /
> useWebSocket / useLocale / i18n / locales 键集合 / utils scan / utils upload / utils ws）。

---

## 10. 品牌图标流水线

**图形只有一份定义**：`web/scripts/render-icon.mjs` 里的 `ICON` 常量。

```bash
cd web && pnpm icon    # 一次性生成 4 个产物
```

产出：`assets/logo.svg`、`web/public/favicon.svg`、`web/public/favicon-32.png`、
`web/public/apple-touch-icon.png`。**`assets/logo.svg` 是生成物，不是源文件。**

现行设计（与旧文档/旧 Enhancements 的描述不同）：

- 超椭圆圆角方底，**纯蓝渐变** `#3B82F6 → #1D4ED8`（不是「蓝紫」）；
- 三个 **方环** 定位图案（无中心块；环厚 4 / 外沿半边长 8，刻意不做三段式，
  保证 16px favicon 仍可辨）；
- 右下角绿色「实时信标」= **1 个弧环 + 实心点**（没有「同心环」）；
- **没有动画脉冲、没有扫描光束**（对生成的 SVG grep `animate` = 0）。

实现要点：

- 脚本**零依赖**：`node:zlib` 手写 PNG 编码 + 解析式 SDF 超采样；本机没有
  `rsvg-convert / inkscape / cairosvg`。
- **改图形只改 `ICON` 后重跑**，不要手改生成物。
- 页面内统一走 `BrandMark.vue`（`<img src="/favicon.svg">`），不要内联 SVG。
- iOS 不认 SVG favicon，必须有 `apple-touch-icon.png`（180×180，满幅方角）。
- 品牌名唯一来源是 `web/src/brand.ts:10` 的 `APP_NAME`；`index.html` 的
  `<title>` / `og:title` 无法 import，需要手动同步。

---

## 11. 部署

```
Dockerfile 三阶段：web-builder(vite build) → server-builder(tsc -p tsconfig.build.json)
                  → runtime(node:22-alpine + Caddy + tini + libcap)
entrypoint.sh = node 后台 + caddy 后台 + trap TERM/INT 转发 + 监督循环
Caddyfile = {$CADDY_SITE_ADDRESS::80} { /ws* → :41602, /api/* → :41601, 其余静态 }
compose   = env_file(.env, 可选) + 变量默认值 + healthcheck + stop_grace_period: 20s
          + "${LIVE_QR_PORT:-41606}:80" + restart: unless-stopped
          + 命名卷 live-qr-logs:/var/log/live-qr（审计日志）
```

关键点：

- **端口**：宿主机 **41606** → 容器 80（`LIVE_QR_PORT` 可改）。本地开发端口
  41601/41602/41605 与 Docker 无关。
- **TLS 默认在边缘终止**：容器内 Caddy 只监听 `:80`，证书/HTTPS 交给外层网关。
- **容器内可选 HTTPS**（仅当没有外层网关时）：`.env` 设
  `CADDY_SITE_ADDRESS=qr.example.com` → 打开 compose 里 `443:443` 的注释，并解开
  `caddy-data` 挂载与顶级声明 → 确保 80/443 可达（ACME）→ 去掉前面的边缘代理。
  证书与 ACME 状态在 `/srv/caddy/data`，必须持久化。
- **信号/监督**：`tini` 是 PID 1；`entrypoint.sh` 把 TERM/INT 转发给 node 与 caddy，
  最多等 10s 再 SIGKILL；任一子进程自行退出 → 容器 `exit 1`（配 `restart: unless-stopped`）。
  本地用假的 node/caddy 验证过 3 个场景（TERM 转发、node 崩溃、caddy 崩溃），见
  `entrypoint.sh:25-85`。
- **非 root**：uid 10001；`setcap cap_net_bind_service=+ep` 让 caddy 能绑 80/443
  （`Dockerfile:43-44,73`）。
- **健康检查**：`HEALTHCHECK` 用 node fetch `/api/health`（`Dockerfile:76`），
  compose 里有一份等价定义（按解析后的 `PORT_HTTP` 探活）。
- **测试不进镜像**：server 阶段用 `tsconfig.build.json`，并断言 `dist` 无
  `*.test.js` / `testing/`（`Dockerfile:23-29`）。
- **`.env` 真正生效**：compose 的 `env_file`（长语法 `required:false`，需要
  Compose ≥2.24）+ 全部键的 `${VAR:-default}` 插值；不建 `.env` 也能起。
- **审计日志卷（必须命名卷）**：compose 用 `live-qr-logs:/var/log/live-qr`。
  **不要换成 bind mount**：容器以 uid 10001 运行，Docker 创建的宿主目录属于 root，
  应用写不进去（EACCES）。镜像 runtime 已 `mkdir /var/log/live-qr`、`chown app`、
  `chmod 700`，新建卷会继承该 owner/mode；若复用权限不对的旧卷，需手动
  `chown -R 10001:10001 /var/log/live-qr` + `chmod 700`。
- **卷生命周期与备份**：`docker compose down` 保留卷，`down -v` 删除；
  宿主磁盘故障或误删即丢日志。备份/手动删除命令见 README「日志与留存」。
- **容器内目录固定**：`AUDIT_LOG_DIR=/var/log/live-qr`（compose 的 environment 覆盖
  `.env` 中的同名键）。要换路径必须同时改卷挂载，否则数据落在容器可写层、重建即丢。
- **日志量**：每次上传一行且含 `text` 全文，高流量 + 长文本会快速占用磁盘；
  监控卷容量，必要时调小 `AUDIT_LOG_RETENTION_DAYS` 或 `AUDIT_LOG_ENABLED=false`。
- **审计降级不会阻止启动**：目录不可写/挂载错时，服务仍正常起（写失败只记
  `audit_write_failed`）。部署验收要确认当天 `transfer-*.jsonl` 里出现 `audit_started`，
  否则就是权限/路径没配好。
- **Caddy 版本**：默认不钉死（跟随 `node:22-alpine` 的 Alpine 仓库），需要可复现构建时
  用 `--build-arg CADDY_VERSION=<apk version>`。
- 旧 `CADDY_DOMAIN` / `CADDY_EMAIL` 已删除（从未被读取）。

> ⚠️ 镜像**没有**在本机做过完整 `docker build` / `compose up`（缺 registry 网络与时间），
> 只做了 `docker build --check`、setcap/uid 模拟、Caddyfile validate、entrypoint 假进程测试。
> 上线前请在能联网的环境跑一次完整构建与健康检查（§13）。

---

## 12. 踩坑记录（**接手前必读**，都是真实踩过的）

### 12.1 【最坑】本机 `node_modules` 曾被 SMB 同步压平

**症状**：`spawn EACCES`、`Cannot find package 'picomatch'`、`vue-tsc` 崩在 `estree-walker`。

**根因**：仓库从主力机（Windows）经 SMB 同步过来，pnpm 的**符号链接全部被复制成真实目录**
（`node_modules` 下 0 个软链），且 `.bin` 与 ELF 二进制**丢了执行位**。pnpm 的隔离布局靠
「软链 + `.pnpm/<pkg>@<ver>/node_modules/` 里同级依赖」工作，压平后 Node 的 ESM 解析走不到。

**修复方式**（已修好，实测 1258 条软链重建）：补执行位；按
`node_modules/.package-map.json` 重建顶层软链；`.pnpm/node_modules/` 回退层重建；
`.pnpm/**` 内 781 条依赖边改回软链；每次删除前校验 `package.json` 的 name+version。

**⚠️ 绝对不要直接 `pnpm install --force`**：本机 pnpm store 只覆盖两个 lockfile 的约 10%，
出网代理经常不可达 —— 它会**先删掉 node_modules 再失败**。

### 12.2 【本轮新增】pnpm store 不一致：`pnpm add` 报 `ERR_PNPM_UNEXPECTED_STORE`

实测（2026-10-30）：

- 当前配置的 store：`pnpm config get store-dir` → `/home/dynesshely/dsh-workspaces/tools/.pnpm-shared-store`
- 但两个包的 `node_modules/.modules.yaml` 记录的 store 是旧位置：
  `/home/dynesshely/.local/share/pnpm/store/v11`（server 与 web 都是）
- 直接 `pnpm add <pkg>` 会因「安装树的 store 与配置的 store 不一致」报
  `ERR_PNPM_UNEXPECTED_STORE` 并中止。

**本轮 web 补 lint 依赖时的可行做法**（保留既有安装树，不重装）：

```bash
cd web
pnpm add -D --store-dir /home/dynesshely/.local/share/pnpm/store/v11 \
  eslint-plugin-vue vue-eslint-parser
```

之后确认 `web/pnpm-lock.yaml` 已更新、`pnpm install --frozen-lockfile` 能过（CI 用）。
反方向（把安装树迁到配置的 store）需要先删 `node_modules` 再重装 —— 在本机 SMB 环境下
风险高，**没有做**。无论如何不要用 `--force`。

### 12.3 `devctl list --json` 很慢；`status` 默认按会话作用域过滤

- 实测 `devctl list --json` 要 **172s**（25 个项目 × 约 50 个 run 目录，每个项目再跑 3 次
  `runs_of`）。开工清单别先跑它；用 `devctl status live-qr --json` / `devctl show`（秒回）。
- 某些沙箱 shell 处在独立 PID namespace，`devctl status` 会误报 `process-gone`
  （HANDOFF-AUDIT §1.6）。判活改用 `ss -ltn` + `curl --noproxy '*' http://127.0.0.1:41601/api/health`。
- 这种 shell 里**不要跑 `devctl start`**（可能去删正在运行的实例登记目录）；`gc` 是安全的。

### 12.4 `qrcode` 库会写内联样式

`qrcode` 的 canvas renderer 每次渲染都写 `canvas.style.width/height = '<size>px'`，
内联样式优先级高于 Tailwind → 画布被锁死。旧版锁在 256px；现在位图是
`QR_BITMAP_SIZE = 1024`（`useQRCode.ts:14`），**若删掉渲染后的
`removeProperty('width'/'height')`，锁死值会变成 1024px**。
布局应完全交给 CSS；回归测试在 `useQRCode.test.ts`。

### 12.5 Vite transform 缓存偶发不失效

**症状**：源文件已改、vite 日志有 `hmr update`，但 `curl` 拿到的模块仍是旧代码。

**处置**：`~/.devhub/devctl restart live-qr web`。改完代码页面没变化时先这样验证：

```bash
curl -sS --noproxy '*' http://127.0.0.1:41605/src/components/ScannerView.vue | grep -F '你的新标记'
```

### 12.6 Tailwind v4 的两个特性（其中一个本仓库没有落点）

- `hover:` 被包进 `@media (hover: hover)` → **触屏设备不生效**。需要触屏反馈用
  `active:` 或写进组件 scoped CSS（LegalBanner/FooterBar 即如此）。
- 关于 `@theme` 被摇树、要写 `@theme static` 的说法**在本仓库没有落点**：本仓库
  **完全没有 `@theme` 指令**，颜色/间距都在 `style.css` 与工具类里。不要从别的项目
  搬这条进来；如果新引入 `@theme` 令牌，再按 v4 文档处理。

### 12.7 移动端三件套（已修，改动别回退）

- **`min-h-dvh` 而非 `min-h-screen`**：iOS 地址栏收放会改变可视高度。
- **安全区**：底部栏/页脚用 `pb-[max(1rem,env(safe-area-inset-bottom))]`，顶部同理。
- **表单控件移动端字号 ≥16px**：iOS Safari 聚焦 `<16px` 的 input/select 会放大整页。
  语言下拉是 `text-base lg:text-sm`（用 `lg:` 而不是 `sm:` —— iPad 同样是 iOS）。

### 12.8 Vite 代理下的 WS Host / Origin（本轮新增）

- `web/vite.config.ts:20-26`：`/api` → `http://localhost:41601`；`/ws` →
  `ws://localhost:41602` 且 `ws: true`。**没有设 `changeOrigin`**。
- Node `http-proxy` 默认保持原始 `Host`：浏览器连 `ws://127.0.0.1:41605/ws` 时，
  服务端看到 `Host: 127.0.0.1:41605`、`Origin: http://127.0.0.1:41605`，同源校验通过。
- 一旦给代理加 `changeOrigin: true`，`Host` 会变成 `localhost:41602` 而 `Origin` 仍是
  `127.0.0.1:41605` → 同源校验失败，握手 **403 FORBIDDEN_ORIGIN**。
- 前后端分域部署（前端静态站与 API/WS 不同 host）时，必须给
  `WS_ALLOWED_ORIGINS` 加前端 Origin，否则同样 403。
- 服务端进程用 `server.listen(port)` 监听所有网卡：开发实例的 41601/41602 局域网可直连，
  绕过 Caddy。不要把开发实例当成生产入口。

### 12.9 摄像头需要安全上下文

`127.0.0.1` / `localhost` / HTTPS 才允许 `getUserMedia`。局域网地址
（如 `http://10.0.30.61:41605`）**不是**安全上下文，点「开始扫码」会报
`notSecure`/权限错误；要用手机实测，请走 HTTPS 反代或 `localhost` 端口转发。

### 12.10 代理环境变量

本机 shell 带 `http_proxy=...`，测本地/局域网地址必须加 `--noproxy '*'`（curl）或用
`NO_PROXY`（node/其他工具），否则请求会被代理吞掉。

### 12.11 服务端文案与前端本地化

服务端返回的 `message` 是中文硬编码，**前端不直接展示**：上传/验证错误走
`utils/upload.ts` 的 `serverErrorKey()` 映射到 `serverErrors.*`，WS 过期只认
`code`。新增服务端 error code 时，必须同步 `SERVER_ERROR_CODES` 与三份 locale
（`locales.test.ts` 会检查键集合一致）。

---

## 13. 已知问题 / 待办

### 13.1 仍未解决

| # | 问题 | 影响 | 处置建议 |
| --- | --- | --- | --- |
| 1 | **CI 未在 GitHub 实跑**：`.github/workflows/ci.yml` 是本轮新增，本地只做了 YAML 解析与门禁手跑 | 首次 push 才验证 action 组合（pnpm 11 / Node 22 / frozen lockfile） | push 后看第一次 Actions 结果；失败先修 workflow，不要放宽门禁 |
| 2 | **Docker 镜像未端到端验证**：未实跑完整 `docker build` 与 `compose up` | 构建链路（registry 网络、pnpm install、镜像健康检查）未证实 | 在能联网的环境跑一次 build + up + `docker compose ps` 看 healthy |
| 3 | **纯内存存储**：进程重启丢全部通道 | 设计如此，不是缺陷 | 如需持久化，按仓库 DB 铁律（只做加法、幂等 migration、测试用独立库） |
| 4 | **web 无浏览器 E2E**：只有 happy-dom 单测 | 摄像头、真机扫码、safe-area、iOS 字号等仍靠人工 | 需要时补 Playwright/真机清单；改动扫码/布局后按 §14.6 手测 |
| 5 | ~~1001 语义分歧~~ **已修复**：关服改用 1012（Service Restart），前端对 1012 重连、对 1001 不重连 | 滚动重启后观看端可自愈（约 31s 退避窗口） | 已收敛；改关闭码时同步 `utils/ws.ts` 与单测 |
| 6 | **stdout 访问/业务日志的轮转不在代码内**（审计日志有应用内 243 天清理） | 容器/宿主日志可能无限增长 | 部署侧配置日志驱动轮转；审计日志用 `AUDIT_LOG_RETENTION_DAYS` 控制 |
| 7 | **CN 合规的备案/实名/内容审核** | 不是代码能解决的 | 运营方义务；写入 README 免责声明（见 §16） |
| 8 | **审计日志卷是单点**：容器重建不丢（命名卷），但 `down -v`、宿主磁盘故障或误删会丢；卷内含**明文文本** | 丢失即无法满足留存义务；泄露即内容泄露 | 定期备份命名卷；限制宿主 root / docker 组访问；按法域设置保留期 |
| 9 | **审计日志目录不可写时服务仍会启动**（审计降级，仅 stderr 记 `audit_write_failed`） | 表面健康但审计缺失，可能造成合规留存缺口 | 部署后检查 `audit_started` 记录/卷权限；监控 `audit_write_failed` |

### 13.2 本轮已修复（旧文档/审计里的条目；修复版本 = 2026-10-30 工作区，尚未提交）

- ~~web lint 不可用（缺 `eslint-plugin-vue` / `vue-eslint-parser`）~~ → 依赖已加入
  `web/package.json` + lockfile，`pnpm lint` 绿；CI 对两包阻断。
- ~~server lint 有 6 个 `no-explicit-any`~~ → 已清零。
- ~~README Docker 端口写 41605~~ → 统一 41606（41605 仅本地 Vite）。
- ~~README/API/WS 与实现不一致（心跳阈值、退避序列、关闭码、响应形状）~~ → 已按代码重写。
- ~~`expire_seconds` 是装饰性参数~~ → per-channel TTL + 惰性过期。
- ~~body 错误一律 500 / 未知路径返回 HTML 错误页~~ → 400/413/JSON 404 映射。
- ~~`CADDY_DOMAIN`/`CADDY_EMAIL` 死配置、`.env` 不生效~~ → `CADDY_SITE_ADDRESS` + env_file + 默认值。
- ~~容器内优雅关闭是死代码 / 无 healthcheck / 测试进镜像~~ → tini + 监督 + HEALTHCHECK + tsconfig.build。
- ~~Enhancements #1.md 图标一节过时~~ → 已加过期标注并纠正描述。
- ~~无 CI~~ → 新增 `.github/workflows/ci.yml`（但尚未实跑，见 13.1-1）。

---

## 14. 新会话开工清单

1. **确认运行态**：`ss -ltn | grep -E '41601|41602|41605'` +
   `curl --noproxy '*' http://127.0.0.1:41601/api/health`（应返回 `{"status":"ok"}`）。
   不要只信 `devctl status`（§12.3）；没起来就 `devctl start live-qr api` → `web`。
2. **确认工作区状态**：`git -C /home/dynesshely/projects/Dynesshely/Live-QR status -sb`。
   本轮改动提交前会显示大量修改；**不要** checkout/丢弃别人的改动。基线提交是 `1861144`。
3. **跑基线**：`cd server && pnpm test`（当前 193，审计用例仍在增加）+ `cd web && pnpm test`（60），
   再跑双 typecheck / 双 lint；改了构建相关再补 `pnpm build`。
4. **动代码前先读** §12（尤其 12.1 store、12.2 pnpm store、12.8 WS Host/Origin）。
5. **加依赖前先读 12.2**；不要 `pnpm install` / `--force`。新增依赖要同步 lockfile 与 CI。
6. **UI 改动验收**：typecheck + test + build；真实视口 320 / 390 / 844×390 横屏 / 1280，
   检查控制台无 error/warning；扫码/摄像头改动要用 HTTPS 或 localhost 真机验证（§12.9）。
7. **提交**：本仓库 `commit.gpgsign=true`，需要 `gpg-unlock`；**签名失败不要用
   `--no-gpg-sign` 绕过**，提醒用户解锁后重试。
8. **改日志/合规文案前先读 §16**；改服务端日志字段必须同步 `web/src/legal/content.ts`。

---

## 15. 参考文档

| 文档 | 用途 | 时效 |
| --- | --- | --- |
| `README.md` | 对外介绍：架构、API/WS、错误码、部署、免责声明 | ✅ 当前（2026-10-30） |
| `.develop/HANDOFF.md` | **本文**，当前状态唯一权威 | ✅ 当前（2026-10-30） |
| `.develop/Requirements.md` | 原始需求与完整接口设计（32 KB） | ⚠️ 历史（2026-06-16）；顶部有「实现差异」表，冲突以本文为准 |
| `.develop/Enhancements #1.md` | 早期技术栈改进与决策 | ⚠️ 部分过时（§7 图标已标注；测试数字/theme-color 已更正） |
| `.develop/HANDOFF-AUDIT.md` | 2026-10-30 审计证据 + 逐项处理状态 | 📌 归档（作为问题清单与修复证据） |
| `web/src/legal/content.ts` | 三层合规文案（与日志/存储行为绑定） | ✅ 当前；改服务端日志必须同步 |
| `Caddyfile` / `Dockerfile` / `docker-compose.yml` / `entrypoint.sh` / `.env.example` | 部署真身 | ✅ 当前 |
| `.github/workflows/ci.yml` | CI 定义（两包 test/typecheck/build/lint） | ✅ 当前；未在 GitHub 实跑 |
| `~/.devhub/README.md` | DevHub 启停规则全文（R1–R12） | ✅ 平台级 |
| <https://github.com/Dynesshely/Live-QR> | 仓库 / 线上实例 <https://qr-live.cxs.apps.dynesshely.top> | — |

---

## 16. 合规与演示声明（改服务端日志前必读）

### 16.1 定位

- 本项目是**技术演示**：没有数据库、通道纯内存、重启即丢；不承诺存储、备份、可用性。
- **不是通讯服务**，8 位分享码不是访问控制机制（可被枚举/猜测），不要用于敏感信息。
- Demo 的 API 有频控、随时可能变更；源码以 AGPL-3.0 分发，网络服务提供者需向用户提供源码。
- 公网部署的备案、实名、日志留存、内容审核等义务由**部署方**承担（README「免责声明」）。

### 16.2 三层提示的落点

| 层 | 文件 | 行为 |
| --- | --- | --- |
| 1. 顶部告警条 | `web/src/components/LegalBanner.vue` | 首页 / 观看端输入页 / 仪表盘顶部；**全屏扫码页刻意不放**；关闭状态只存 **sessionStorage** `live-qr-legal-banner-dismissed-v1`（`LegalBanner.vue:18`） |
| 2. 首次确认（阻断） | `web/src/components/LegalConsentDialog.vue` + `composables/useLegal.ts` | 无记录时弹；同意写 **localStorage** `live-qr-legal-consent-v1`（ISO 时间，`useLegal.ts:21,111`）；存储不可用则每次提示，不假装已同意 |
| 3. 完整条款 | `web/src/components/LegalTermsDialog.vue` + 页脚入口 | 页脚常驻「查看完整条款」（`FooterBar.vue:36-42`）；`#terms` 可深链（`useLegal.ts:24,54-65`）；关闭时用 `replaceState` 清 hash |

- 文案唯一来源：`web/src/legal/content.ts`（中/英/日三份，`LEGAL_UPDATED_AT = '2026-10-30'`，
  `content.ts:68`）。三语键集合不在这里做测试（法律文案是独立模块），但
  `locales/*.json` 的 UI 键有 `locales.test.ts` 兜底。
- 挂载点：`App.vue:124,270,288`（三个页面级容器）+ 弹窗 `App.vue:449-455`；
  Scanner 模式（`App.vue:263-264`）只有全屏取景，没有 Banner/Footer。

### 16.3 浏览器存储

| 键 | 存储 | 内容 |
| --- | --- | --- |
| `app-preferences` | localStorage | 主题 + 语言（`stores/preferences.ts:15-17`）；`locale` 空串 = 用户没选过 |
| `live-qr-legal-consent-v1` | localStorage | 同意时间 ISO 字符串 |
| `live-qr-legal-banner-dismissed-v1` | sessionStorage | 本次会话关闭了顶部提示 |
| `#terms` | URL hash | 打开完整条款（`history.replaceState`，不产生历史栈） |

> 当前 `index.html` **没有任何第三方脚本/统计/Cookie**；如果将来接入统计、广告或外部字体，
> 必须先更新 `legal/content.ts` 的隐私段落，否则文案与事实不符。

### 16.4 日志的边界：访问日志（不含文本） vs 审计日志（含明文）

**访问日志 / 业务事件**（stdout，一行一个 JSON，参数见 `types.ts:128-141`）：

- **请求元数据**：`method / path / status / durationMs / clientIp / userAgent`
  （UA 截断 200 字符），`/api/health` 不记（`accessLog.ts:11-29`、`logger.ts:58-72`）。
- **业务事件**：通道创建/验证、上传成功、限流、WS 连接/断开、清理、错误等；
  只带 `event / timestamp / shareCode / clientIp / message`，上传事件额外只有**文本长度**，
  **这套日志没有请求体、没有上传文本**（`routes/upload.ts:66`）。
- 用途：限流、排障、安全审计；保留/轮转由部署方设定。

**审计日志**（磁盘 JSONL，默认开启）：

| 事件 | 字段 |
| --- | --- |
| `upload` | `ts, shareCode, uploaderIp, uploaderUa, text, textLength, recipients:[{ip, ua}]` |
| `viewer_connect` | `ts, shareCode, ip, ua` |
| `viewer_disconnect` | `ts, shareCode, ip, durationMs` |
| `audit_started` | `ts, dir, retentionDays` |
| `retention_purge` | `ts, cutoff, deleted[]` |

- 文件：`<AUDIT_LOG_DIR>/transfer-YYYY-MM-DD.jsonl`，UTF-8、一行一个 JSON、追加写、
  **UTC 日期**切分；目录 `0700`、文件 `0600`。
- 保留：启动时 + 跨天滚动时删除早于「今天 − `AUDIT_LOG_RETENTION_DAYS`」的文件，
  默认 **243 天（≈8 个月）**，范围 1–3650；`AUDIT_LOG_ENABLED=false` 可完全关闭。
- **谁可以读**：容器内只有 uid 10001 写；宿主 root、docker 组、能挂载该卷/读宿主磁盘的人
  都能读取明文。日志**不通过 HTTP API 暴露**；备份/快照同样按敏感数据处理。
- 用途：满足留存与溯源义务；因此**它保存文本原文**，与访问日志的边界不同。

> ✅ **文案已同步**：站内合规文案（`web/src/legal/content.ts`，中/英/日）已包含审计日志说明
> （文本原文 + 双方 IP/UA、243 天、仅服务账号读写）。再改字段/保留期时必须继续同步该文件。

- **改动边界**：新增/删除审计字段、改变保留期或目录，必须同一次改动里同步 README「日志与留存」、
  本文 §2.5/§16.4/§16.5 与 `legal/content.ts`。

### 16.5 改服务端行为时的同步清单

| 服务端改动 | 必须同步 |
| --- | --- |
| 新增/删除访问日志字段、日志目的地 | `web/src/legal/content.ts`（隐私/日志段落）、本文 §2.5/§16.4 |
| 改变 TTL 默认值/范围（当前 30 分钟、60–86400） | `legal/content.ts` 里提到「30 分钟」的中英日文案 |
| 新增/修改 API 错误码 | `web/src/utils/upload.ts` 的 `SERVER_ERROR_CODES` + 三份 `locales/*.json` + README 错误码 |
| 改变 WS 关闭码语义 | `web/src/utils/ws.ts`、README/本文 §6.3 |
| 新增浏览器存储键或接入第三方脚本 | `legal/content.ts`、§16.3 |
| 审计日志字段/开关/保留期/目录 | README「日志与留存」、本文 §2.5/§16.4、`legal/content.ts` 隐私段 |
| 审计日志卷或容器内路径 | `docker-compose.yml`、`Dockerfile`、README「日志与留存」、§11 |

