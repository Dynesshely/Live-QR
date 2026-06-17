# Enhancements #1 — 技术栈改进

**日期**: 2026-06-17  
**状态**: ✅ 全部实施完成

---

## 决策总览

| # | 类别 | 改进项 | 决策 | 状态 |
|---|------|--------|------|------|
| 1 | 🔴 关键 | Dockerfile `pnpm-workspace.yaml` COPY 问题 | **跳过** — 文件用于 `pnpm approve-builds`，需保留 | — |
| 2 | 🔴 关键 | Caddy 安装方式（curl 无版本/架构锁定） | **方案 A** — 改用 `apk add caddy`（Alpine 仓库，版本受控、架构自动适配） | ✅ |
| 3 | 🟠 重要 | Caddyfile 仅 HTTP(:80)，无 HTTPS | **跳过** — 中央反代负责 SSL 证书，服务本身提供 HTTP 即可 | — |
| 4 | 🟠 重要 | 缺少环境变量校验 | **引入 Zod** — 运行时校验 + 自动类型推导，非法配置立即报错 | ✅ |
| 5 | 🟠 重要 | 缺少 `.env` 自动加载 | **添加 dotenv** — 本地开发自动读取 `.env` 文件 | ✅ |
| 6 | 🟠 重要 | 无测试框架 | **引入 Vitest** — server 端 + supertest 集成测试，web 端 + happy-dom + @vue/test-utils | ✅ |
| 7 | 🟠 重要 | 无代码规范工具 | **引入 ESLint + Prettier** — flat config，TS + Vue SFC 支持 | ✅ |
| 8 | 🟡 改进 | jsQR 已停止维护 | **保持现状** — 功能稳定，无需替换 | — |
| 9 | 🟡 改进 | HTTP / WS 两个独立端口 | **保持现状** — Caddy 代理已处理，无合并必要 | — |
| 10 | 🟡 改进 | 安全响应头缺失 | **添加** — `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` | ✅ |
| 11 | 🟡 改进 | 静态资源无压缩 | **添加** — Caddyfile `encode gzip zstd` | ✅ |
| 12 | 🟡 改进 | `index.html` 缺少 meta 标签 | **添加** — description, OG tags, theme-color, favicon.svg | ✅ |
| 13 | 🟡 改进 | 优雅关闭竞态条件 | **修复** — `Promise.all` 并行关闭 WS + HTTP server，防重入 | ✅ |
| 14 | 🟡 改进 | entrypoint.sh 未等待 server 就绪 | **跳过** | — |
| 15 | 🟡 改进 | Tailwind CSS v3 → v4 | **升级** — CSS-first config，`@tailwindcss/vite` 插件，移除 PostCSS | ✅ |

---

## 实施详情

### 1. Zod 环境变量校验 (`server/src/config.ts`)

```typescript
import 'dotenv/config';
import { z } from 'zod';

const numberFromEnv = (def: string, min: number, max: number) =>
  z.string().default(def).transform(Number).pipe(z.number().int().min(min).max(max));

export const appConfigSchema = z.object({
  PORT_HTTP:                numberFromEnv('41601', 1, 65535),
  PORT_WS:                  numberFromEnv('41602', 1, 65535),
  CHANNEL_TTL_SECONDS:      numberFromEnv('1800', 60, 86400),
  CLEANUP_INTERVAL_SECONDS: numberFromEnv('60', 10, 3600),
  UPLOAD_RATE_LIMIT:        numberFromEnv('2', 1, 100),
  MAX_VIEWERS_PER_CHANNEL:  numberFromEnv('50', 1, 500),
  VERIFY_RATE_LIMIT:        numberFromEnv('10', 1, 1000),
  MAX_TEXT_LENGTH:          numberFromEnv('2000', 1, 10000),
});
```

- `dotenv/config` 自动加载 `.env` 文件
- 非法值在启动时立即报错（如 `PORT_HTTP=abc`）
- `AppConfig` 类型从 schema 自动推导

### 2. Caddyfile 安全加固

```caddy
:80 {
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
    handle {
        root * /srv/web/dist
        try_files {path} /index.html
        file_server
        encode gzip zstd
    }
}
```

### 3. Dockerfile — Caddy 安装方式

```dockerfile
# 之前（无版本、架构硬编码）
RUN apk add --no-cache curl ca-certificates \
    && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/bin/caddy

# 之后（Alpine 社区仓库，版本受控）
RUN apk add --no-cache caddy ca-certificates
```

### 4. 优雅关闭修复 (`server/src/index.ts`)

- 添加 `shuttingDown` 标志防重入
- 使用 `Promise.all` 并行关闭 WS + HTTP server
- 两个 server 都关闭后才 `process.exit(0)`

### 5. Tailwind CSS v4 升级

| 变更 | v3 | v4 |
|------|----|----|
| CSS 入口 | `@tailwind base/components/utilities` | `@import "tailwindcss"` |
| 配置方式 | `tailwind.config.js` + `postcss.config.js` | CSS-first（无 JS 配置文件） |
| Vite 集成 | PostCSS 插件 | `@tailwindcss/vite` 原生 Vite 插件 |
| 暗色模式 | `tailwind.config.js` 中 `darkMode: 'class'` | `@variant dark (...)` in CSS |

### 6. 测试覆盖

**Server (37 tests)**:
| 模块 | 测试文件 | 测试数 |
|------|---------|--------|
| Config (Zod) | `config.test.ts` | 5 |
| Channel Store | `channelStore.test.ts` | 18 |
| Rate Limiter | `rateLimiter.test.ts` | 8 |
| Channel Routes | `channel.test.ts` | 6 |
| Upload Routes | `upload.test.ts` | 6 |

**Web (4 tests)**:
| 模块 | 测试文件 | 测试数 |
|------|---------|--------|
| QR Code | `useQRCode.test.ts` | 4 |

### 7. Logo / Favicon

- `assets/logo.svg` — 源文件
- `web/public/favicon.svg` — Favicon（含动画脉冲）
- 设计：蓝底圆角方块 + 3 个 QR 定位图案 + 绿色 Live 点 + 扫描光束

### 8. HTML Meta 标签

```html
<meta name="description" content="QR-Live — 实时二维码扫描与展示系统..." />
<meta name="theme-color" content="#2563EB" />
<meta property="og:title" content="QR-Live" />
<meta property="og:description" content="实时二维码扫描与展示系统" />
<meta property="og:type" content="website" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

---

## 新增开发命令

```bash
# Server
cd server && pnpm lint       # ESLint 检查
cd server && pnpm format     # Prettier 格式化
cd server && pnpm test       # 运行测试（单次）
cd server && pnpm test:watch # 运行测试（监听模式）

# Web
cd web && pnpm lint
cd web && pnpm format
cd web && pnpm test
cd web && pnpm test:watch
```
