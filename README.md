# Live QR

实时二维码扫描与展示系统。上传端通过摄像头扫描二维码并解码为文本，观看端输入 8 位分享码后实时接收文本并重新渲染为二维码。

## 工作原理

<pre>
┌───────────────┐       HTTP POST        ┌────────────────┐       WebSocket       ┌───────────────┐
│   上传端      │ ──────────────────────▶│    服务器      │ ─────────────────────▶│   观看端      │
│  (浏览器扫码) │    /api/upload         │  Node.js + ws  │    text 消息          │  (浏览器展示) │
│               │◀───────────────────────│                │◀──────────────────────│               │
│  jsQR 解码    │    200 / 429 / 404     │  纯内存存储    │   heartbeat / pong    │  qrcode 渲染  │
│  2 次/秒限流  │                        │  30min TTL     │   指数退避重连        │  256px H 级   │
└───────────────┘                        └────────────────┘                       └───────────────┘
                                               │
                                          Caddy 反向代理
                                          /api →       41601
                                          /ws  →       41602
                                          /*   →       静态文件
</pre>

## 快速开始

### 本地开发

```bash
# 服务端
cd server
pnpm install
pnpm dev        # → http://localhost:41601

# Web 面板
cd web
pnpm install
pnpm dev        # → http://localhost:41605（已内置 /api 代理）
```

### Docker 部署

```bash
# 复制环境变量
cp .env.example .env

# 启动
docker compose up -d

# 访问 http://localhost:41605
```

## 技术栈

| 层级     | 技术                                            |
| -------- | ----------------------------------------------- |
| 后端     | Node.js 22 + Express 5 + `ws`                   |
| 前端     | Vue 3 + Vite 6 + Tailwind CSS 3                 |
| 二维码   | jsQR（解码）+ qrcode（生成）                    |
| 反向代理 | Caddy（自动 HTTPS + WS 代理）                   |
| 容器化   | Docker 三阶段构建（Node 22 Alpine）             |
| 数据存储 | 纯内存（`Map<string, ChannelState>`），无数据库 |

## 项目结构

```
Live-QR/
├── .develop/
│   └── Requirements.md          # 完整需求文档
├── server/
│   └── src/
│       ├── index.ts             # 入口（环境变量、优雅关闭）
│       ├── app.ts               # Express 应用工厂
│       ├── types.ts             # 类型定义
│       ├── logger.ts            # 结构化 JSON 日志
│       ├── routes/
│       │   ├── channel.ts       # POST /create · GET /verify
│       │   └── upload.ts        # POST /upload
│       ├── services/
│       │   └── channelStore.ts  # 内存通道管理 + 广播
│       ├── ws/
│       │   └── handler.ts       # WebSocket 服务器
│       └── middleware/
│           ├── rateLimiter.ts   # 滑动窗口限流
│           └── errorHandler.ts  # 全局错误处理
├── web/
│   └── src/
│       ├── App.vue              # 根组件（首页/扫描/观看三模式）
│       ├── components/
│       │   ├── ScannerView.vue      # 摄像头扫码界面
│       │   ├── QRDisplay.vue        # 二维码展示卡片
│       │   ├── ShareCodeInput.vue   # 8 位分享码输入
│       │   ├── StatusIndicator.vue  # 6 态连接状态灯
│       │   └── HistoryList.vue      # 历史文本列表
│       └── composables/
│           ├── useScanner.ts    # 摄像头 + 上传编排
│           ├── useWebSocket.ts  # WS 连接 + 重连
│           └── useQRCode.ts     # QR 生成封装
├── Caddyfile                    # 反向代理配置
├── Dockerfile                   # 三阶段构建
├── docker-compose.yml           # 单服务编排
├── entrypoint.sh                # 容器入口
└── .env.example                 # 环境变量模板
```

## API 参考

### 分享码申请

```http
POST /api/channel/create
Content-Type: application/json

{ "expire_seconds": 1800 }    # 可选，默认 1800，范围 [60, 7200]
```

```json
// 201 Created
{
  "code": 201,
  "data": { "shareCode": "12345678", "expireAt": "...", "createdAt": "..." }
}
```

### 文本上传

```http
POST /api/upload
Content-Type: application/json

{ "shareCode": "12345678", "text": "扫描到的文本内容" }
```

```json
// 200 OK
{ "code": 200, "message": "ok" }
```

### 分享码验证

```http
GET /api/channel/verify?shareCode=12345678
```

```json
// 200 OK
{ "code": 200, "valid": true, "latestText": "...", "updatedAt": "..." }
```

### WebSocket 实时通道

```
wss://<host>/ws?shareCode=12345678
```

| 消息类型          | 方向          | 说明                       |
| ----------------- | ------------- | -------------------------- |
| `welcome`         | 服务端→客户端 | 连接成功，含 `viewerCount` |
| `history`         | 服务端→客户端 | 连接前最新文本             |
| `text`            | 服务端→客户端 | 新上传的文本（含时间戳）   |
| `heartbeat`       | 服务端→客户端 | 每 30 秒心跳               |
| `pong`            | 客户端→服务端 | 心跳响应                   |
| `channel_expired` | 服务端→客户端 | 频道已过期                 |

关闭码：`4001` 频道不存在 / `4002` 观看者已满（最多 50 人）。

## 错误码

| 状态码 | error                    | 说明                          |
| ------ | ------------------------ | ----------------------------- |
| 400    | `INVALID_SHARE_CODE`     | 分享码格式无效（非 8 位数字） |
| 400    | `TEXT_TOO_LONG`          | 文本超过 2000 字符            |
| 400    | `TEXT_EMPTY`             | 文本为空                      |
| 400    | `INVALID_EXPIRE_SECONDS` | 过期时间超出 [60, 7200]       |
| 404    | `CHANNEL_NOT_FOUND`      | 分享码不存在或已过期          |
| 429    | `RATE_LIMITED`           | 上传频率超限（2 次/秒）       |
| 429    | `VERIFY_RATE_LIMITED`    | 验证频率超限（10 次/分钟/IP） |
| 429    | `TOO_MANY_VIEWERS`       | 观看者已满（50 人）           |

## 环境变量

| 变量                       | 默认值 | 说明                      |
| -------------------------- | ------ | ------------------------- |
| `PORT_HTTP`                | 41601  | HTTP API 端口             |
| `PORT_WS`                  | 41602  | WebSocket 端口            |
| `CHANNEL_TTL_SECONDS`      | 1800   | 无上传过期时间（30 分钟） |
| `CLEANUP_INTERVAL_SECONDS` | 60     | 过期清理间隔              |
| `UPLOAD_RATE_LIMIT`        | 2      | 每通道每秒最大上传        |
| `MAX_VIEWERS_PER_CHANNEL`  | 50     | 每通道最大观看者          |
| `VERIFY_RATE_LIMIT`        | 10     | 每 IP 每分钟最大验证      |
| `MAX_TEXT_LENGTH`          | 2000   | 上传文本最大字符数        |
| `CADDY_DOMAIN`             | —      | 域名（用于 HTTPS）        |
| `CADDY_EMAIL`              | —      | Let's Encrypt 通知邮箱    |

## 特性

- **去重上传** — 仅文本变化时才上传，避免重复流量
- **节流排队** — 限流时保留最新文本，下个窗口自动发送（合并中间态）
- **离线缓存** — 网络异常时缓存最多 6 条，恢复后 FIFO 重传
- **自动重建** — 频道过期后自动申请新分享码并恢复扫描
- **断线重连** — 指数退避（1s → 2s → … → 30s），最多 5 次，期间保留最后一个二维码
- **响应式** — Web 面板适配 PC / 平板 / 手机，二维码最小 200px
- **单容器部署** — Caddy + Node.js 打包为一个镜像，`docker compose up` 一键启动
