# Enhancements #1 — 技术栈改进

**日期**: 2026-06-17  
**状态**: [DONE] 全部实施完成

> ⚠️ **时效说明（2026-10-30）**：本文记录的是 2026-06-17 的改进决策与当时实现，
> 数字/片段可能与当前代码不一致（已就地标注）。**当前权威文档是 `.develop/HANDOFF.md`**。
> 已过时的具体数字：server 测试 37 → **134**，web 测试 4 → **59**；
> theme-color `#2563EB` → **`#3B82F6`**；品牌名 `QR-Live` → **`Live QR`**。

---

## 决策总览

| #   | 类别   | 改进项                                     | 决策                                                                                   | 状态   |
| --- | ------ | ------------------------------------------ | -------------------------------------------------------------------------------------- | ------ |
| 1   | [CRIT] | Dockerfile `pnpm-workspace.yaml` COPY 问题 | **跳过** — 文件用于 `pnpm approve-builds`，需保留                                      | [SKIP] |
| 2   | [CRIT] | Caddy 安装方式（curl 无版本/架构锁定）     | **方案 A** — 改用 `apk add caddy`（Alpine 仓库，版本受控、架构自动适配）               | [DONE] |
| 3   | [IMPT] | Caddyfile 仅 HTTP(:80)，无 HTTPS           | **跳过** — 中央反代负责 SSL 证书，服务本身提供 HTTP 即可                               | [SKIP] |
| 4   | [IMPT] | 缺少环境变量校验                           | **引入 Zod** — 运行时校验 + 自动类型推导，非法配置立即报错                             | [DONE] |
| 5   | [IMPT] | 缺少 `.env` 自动加载                       | **添加 dotenv** — 本地开发自动读取 `.env` 文件                                         | [DONE] |
| 6   | [IMPT] | 无测试框架                                 | **引入 Vitest** — server 端 + supertest 集成测试，web 端 + happy-dom + @vue/test-utils | [DONE] |
| 7   | [IMPT] | 无代码规范工具                             | **引入 ESLint + Prettier** — flat config，TS + Vue SFC 支持                            | [DONE] |
| 8   | [NICE] | jsQR 已停止维护                            | **保持现状** — 功能稳定，无需替换                                                      | [SKIP] |
| 9   | [NICE] | HTTP / WS 两个独立端口                     | **保持现状** — Caddy 代理已处理，无合并必要                                            | [SKIP] |
| 10  | [NICE] | 安全响应头缺失                             | **添加** — `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`    | [DONE] |
| 11  | [NICE] | 静态资源无压缩                             | **添加** — Caddyfile `encode gzip zstd`                                                | [DONE] |
| 12  | [NICE] | `index.html` 缺少 meta 标签                | **添加** — description, OG tags, theme-color, favicon.svg                              | [DONE] |
| 13  | [NICE] | 优雅关闭竞态条件                           | **修复** — `Promise.all` 并行关闭 WS + HTTP server，防重入                             | [DONE] |
| 14  | [NICE] | entrypoint.sh 未等待 server 就绪           | **跳过**                                                                               | [SKIP] |
| 15  | [NICE] | Tailwind CSS v3 → v4                       | **升级** — CSS-first config，`@tailwindcss/vite` 插件，移除 PostCSS                    | [DONE] |

---

## 实施详情

### 1. Zod 环境变量校验 (`server/src/config.ts`)

```typescript
import "dotenv/config";
import { z } from "zod";

const numberFromEnv = (def: string, min: number, max: number) =>
  z
    .string()
    .default(def)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const appConfigSchema = z.object({
  PORT_HTTP: numberFromEnv("41601", 1, 65535),
  PORT_WS: numberFromEnv("41602", 1, 65535),
  CHANNEL_TTL_SECONDS: numberFromEnv("1800", 60, 86400),
  CLEANUP_INTERVAL_SECONDS: numberFromEnv("60", 10, 3600),
  UPLOAD_RATE_LIMIT: numberFromEnv("2", 1, 100),
  MAX_VIEWERS_PER_CHANNEL: numberFromEnv("50", 1, 500),
  VERIFY_RATE_LIMIT: numberFromEnv("10", 1, 1000),
  MAX_TEXT_LENGTH: numberFromEnv("2000", 1, 10000),
});
```

- `dotenv/config` 自动加载 `.env` 文件（从**进程工作目录**读取；本地开发放 `server/.env`）
- 非法值在启动时立即报错（如 `PORT_HTTP=abc`）
- `AppConfig` 类型从 schema 自动推导
- **2026-10-30 现状**：schema 已增加 `CREATE_RATE_LIMIT` / `TRUST_PROXY` /
  `WS_ALLOWED_ORIGINS`，并派生 body 上限与 `expire_seconds` 范围，见 `HANDOFF.md` §7。

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

> 2026-10-30 现状：站点地址改为可配的 `{$CADDY_SITE_ADDRESS::80}`，并新增
> `handle /ws*` → 41602、`handle /api/*` → 41601 两段反代；以仓库根 `Caddyfile` 为准。

### 3. Dockerfile — Caddy 安装方式

```dockerfile
# 之前（无版本、架构硬编码）
RUN apk add --no-cache curl ca-certificates \
    && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/bin/caddy

# 之后（Alpine 社区仓库，版本受控）
RUN apk add --no-cache caddy ca-certificates
```

> 2026-10-30 现状：runtime 还安装了 `tini` 与 `libcap`（`setcap` 让非 root 绑 80/443）、
> 用 uid 10001 运行、加 `HEALTHCHECK`；Caddy 版本可选用 `--build-arg CADDY_VERSION` 钉死。
> 见 `Dockerfile` 与 `HANDOFF.md` §11。

### 4. 优雅关闭修复（原 `server/src/index.ts`）

- 添加 `shuttingDown` 标志防重入
- 使用 `Promise.all` 并行关闭 WS + HTTP server
- 两个 server 都关闭后才 `process.exit(0)`
- 2026-10-30 现状：启动/关闭逻辑搬到 `server/src/server.ts` 的 `createServers()` /
  `start()` / `close()`（可测试，import 不再起服务）；容器内由 `tini` + `entrypoint.sh` 转发信号。

### 5. Tailwind CSS v4 升级

| 变更      | v3                                          | v4                                 |
| --------- | ------------------------------------------- | ---------------------------------- |
| CSS 入口  | `@tailwind base/components/utilities`       | `@import "tailwindcss"`            |
| 配置方式  | `tailwind.config.js` + `postcss.config.js`  | CSS-first（无 JS 配置文件）        |
| Vite 集成 | PostCSS 插件                                | `@tailwindcss/vite` 原生 Vite 插件 |
| 暗色模式  | `tailwind.config.js` 中 `darkMode: 'class'` | `@variant dark (...)` in CSS       |

### 6. 测试覆盖

> **2026-10-30 现状**：server **9 个测试文件 / 134 用例**，web **10 个文件 / 59 用例**。
> 下表是 2026-06 的基线，仅作历史参考（已显著扩充）。

**Server（37 tests，2026-06-17 基线）**:

| 模块           | 测试文件               | 测试数 |
| -------------- | ---------------------- | ------ |
| Config (Zod)   | `config.test.ts`       | 5      |
| Channel Store  | `channelStore.test.ts` | 18     |
| Rate Limiter   | `rateLimiter.test.ts`  | 8      |
| Channel Routes | `channel.test.ts`      | 6      |
| Upload Routes  | `upload.test.ts`       | 6      |

**Web（4 tests，2026-06-17 基线）**:

| 模块    | 测试文件            | 测试数 |
| ------- | ------------------- | ------ |
| QR Code | `useQRCode.test.ts` | 4      |

### 7. Logo / Favicon

> ⚠️ **本节已过时（2026-10-30 标注）** —— 描述的是早期图标实现：三段式定位图案、
> 扫描光束、动画脉冲均已不存在，渐变也不是「蓝紫」而是纯蓝 `#3B82F6 → #1D4ED8`，
> 实时信标只有 1 个弧环（无「同心环」）。
> **现行实现以 `web/scripts/render-icon.mjs` 的 `ICON` 常量为唯一来源**
> （方环定位图案 + 单环信标），产物由 `cd web && pnpm icon` 生成，不要手改。
> 差异证据见 `.develop/HANDOFF-AUDIT.md` 第 2 节；现行说明以 `README.md`「图标」一节为准。

- ~~`assets/logo.svg` — 源文件~~（实为 `pnpm icon` 的生成物，源在 `render-icon.mjs`）
- ~~`web/public/favicon.svg` — Favicon（含动画脉冲）~~（无动画）
- ~~设计：蓝底圆角方块 + 3 个 QR 定位图案 + 绿色 Live 点 + 扫描光束~~（无扫描光束）

### 8. HTML Meta 标签

```html
<meta name="description" content="Live QR — Real-time QR code scanning and display system" />
<meta name="theme-color" content="#3B82F6" />
<meta property="og:title" content="Live QR" />
<meta property="og:description" content="Real-time QR code scanning and display system" />
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
