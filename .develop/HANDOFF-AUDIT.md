# HANDOFF.md 核验与补充（2026-10-30）

> 由指挥官会话组织 3 名智能体并行只读核验（server / web / ops），
> 结论均带 `文件:行` 或实测输出。本文保留修复前差异作为证据；**HANDOFF.md 已在同日
> 按本审计重写**，各条状态见下（✅/◐/⛔）。
> 修复前基线：HEAD `1861144`，工作区仅 `?? .develop/HANDOFF.md`；当时门禁 server 42 / web 5。
> 修复后基线（同日收口）：**server 134 passed / web 59 passed / 双 lint 双 typecheck 双 build 全绿**。
>
> **状态标记**：✅ 已修复 · ◐ 部分修复/已文档化 · ⛔ 未做（原因见 §0.2）。
>
> 注：审计日志子系统与合规文案合入后（2026-10-30 晚），门禁为 **server 193 / web 60**（审计用例仍在补充）；
> 本文其余 134/59 是修复轮当时的快照。

---

## 0. 处理结果摘要（2026-10-30 收口）

本轮的修复落在 4 条并行工作线：server 工程修复、web 工程修复、合规 UI、部署/文档。
下面按审计问题分类给结果；每条后面的 ✅ 指「代码或文档已落地且有门禁/实测支撑」。

| 类别 | 条目 | 状态 | 对应改动 / 文件 |
| --- | --- | --- | --- |
| 硬错误 6 项 | TTL 范围、expire_seconds 语义、心跳时长、关闭码、退避封顶、devctl status 语义 | ✅ 全部 | `config.ts`、`channelStore.ts`、`ws/handler.ts`、`useWebSocket.ts`、HANDOFF §2/§6/§12.3 |
| 记错/遗漏 13 项 | 内存持有者、惰性过期、响应形状、503/500、双端 lint、图标、画布、@theme、字号、目录树、端口、star、.develop 入库状态 | ✅ 全部 | HANDOFF §2/§4/§10/§12；Enhancements §7 标注 |
| 死配置 2 项 | `CADDY_DOMAIN` / `CADDY_EMAIL`、`.env` 不生效 | ✅ | Caddyfile `{$CADDY_SITE_ADDRESS::80}`、compose env_file + 默认值、`.env.example` |
| 静默失败 14 项 | 二维码容量、离线队列毒消息、429 去重、摄像头生命周期、队列清空、首访语言、trust proxy、body 错误、限流顺序、WS 路径/Origin、noMessageTimer、viewer 冻结、品牌名、服务端中文文案 | ✅ 全部 | `useQRCode.ts`/`QRDisplay.vue`/`HistoryList.vue`、`utils/upload.ts`、`useScanner.ts`、`i18n.ts`/`useLocale.ts`、`config.ts`/`app.ts`、`errorHandler.ts`、`handler.ts`、`channelStore.ts`、`brand.ts` |
| 部署/运维 8 项 | 容器信号、测试进镜像、healthcheck、.env、devctl list 慢、0.0.0.0/安全上下文、dist、docker build 未验证 | ✅ 6 / ⛔ 2（docker build、线上核对不做） | `Dockerfile`、`entrypoint.sh`、`docker-compose.yml`、`.github/workflows/ci.yml`、HANDOFF §11/§12 |
| 测试空洞 | 双端口/信号/关闭、WS 握手/心跳/观者、expire、errorHandler、TTL、限流时间推进 | ✅ 已补 | server 9 文件 / 134；web 10 文件 / 59；`server/src/{server,ws/handler,middleware/*,services/*}.test.ts` |
| 已知缺陷（测试自身） | rateLimiter 用例名反向、verifyAttempts 串味、channelStore TTL=0 扫全表 | ✅ 已修 | `rateLimiter.test.ts`、`attemptStore.ts`、`channelStore.test.ts` |

### 0.1 一句话结论（修订版）

交接文档的**架构判断、目录结构、验收门、踩坑记录基本可信**；修复前存在 6 处硬错误、
4 处默认值/范围记错、3 类未记载的静默失败、2 处死配置。**本轮已全部修复**，
并以 134/59 测试 + 双 lint/typecheck/build 收口。剩余风险不在代码：
镜像端到端、浏览器 E2E、CI 实跑、法务合规（见 §0.2）。

### 0.2 未做项（受环境 / 职责限制，不是遗漏）

1. **Docker 镜像端到端**：本机未跑完整 `docker build` / `compose up`（registry 网络 + 时间）；
   仅做了 `docker build --check`、runtime 用户/setcap 模拟、Caddyfile validate、entrypoint 假进程测试。
2. **浏览器 E2E / 真机**：web 只有 happy-dom 单测；摄像头、真机扫码、safe-area、iOS 字号仍需人工。
3. **CI 在 GitHub 实跑**：`.github/workflows/ci.yml` 为本轮新增，本地只做 YAML 解析与门禁手跑。
4. **CN 合规法务事项**：备案、实名、内容审核、日志留存时长属运营方义务，代码无法替代。
5. **日志轮转/保留**：代码只输出 stdout，保留策略由部署方配置。

---

## 1. 硬错误（按文档章节）

| # | 文档说法 | 实际（修复前） | 证据 | 状态 |
|---|---|---|---|---|
| 1 | §2「通道 TTL 范围 [60, 7200]」 | env 的 Zod 是 **60–86400**；60–7200 属于 `expire_seconds` | `config.ts:18` vs `routes/channel.ts:15-27` | ✅ 文档已改（HANDOFF §2.1 区分两者） |
| 2 | §5 `expire_seconds` 决定通道寿命 | 修复前是**装饰性参数**：只参与返回字符串，state 不存 TTL | `channelStore.ts:40,54,58,129`；实测 60s 通道 6 分钟后仍在 | ✅ 现为 per-channel TTL + 惰性过期（`channelStore.ts:30-36,108-128`） |
| 3 | §6「服务端 90s 未收到 pong 主动断开」 | 2 × 30s tick 无 pong 即 terminate（约 60s） | `ws/handler.ts:83-108`；实测 T+60.0s 收 1006 | ✅ 文档改为 60s/2 ticks；旧定时器删除 |
| 4 | §6 关闭码「4001 = 通道不存在/已过期」 | 过期走 `channel_expired` + **1001**；4001 只在握手「通道不存在」 | `channelStore.ts:135-142,158-174,184-193`；`handler.ts:53` | ✅ 文档 §6.3 重写；关服已改用 1012，与过期 1001 分离 |
| 5 | §6 退避「1→2→4→8→16→30s 封顶」 | 5 次上限，实际只到 **16s**，30s 不可达 | `useWebSocket.ts:5-7,129-137` | ✅ 常量删除；文档 §6.4 |
| 6 | §8「别只信 devctl status，见 12.4」 | 实测 shell 不在独立 PID namespace；返回空是**默认按会话作用域过滤** | `devctl status --all --json` → `alive:true, source:autostart` | ✅ 文档 §12.3 改写 |

## 2. 记错 / 遗漏（会误导接手者）

- **§2「纯内存 Map」不完整**：修复前另有 `verifyAttempts` Map（不清）与每连接 2 个定时器。
  → ✅ 现为三处持有者：`channels`、`attemptStore.attempts`、每连接 1 个 `heartbeatTimer`；
  `shutdownAll` 会清表（`channelStore.ts:259-268`、HANDOFF §2.3）。
- **§2「无上传自动过期」**：修复前真实存活无上限且上传可续命。
  → ✅ 现在每次公共读都做惰性过期，过期通道不能被 upload 复活（`channelStore.ts:77-88,144-155`）。
- **§5 响应形状/HTML 404**：修复前未知路径是 HTML 404。
  → ✅ 现在四种形状 + JSON 404（`errorHandler.ts:91-93`、`app.ts:37`、HANDOFF §5.1）。
- **§5 错误码漏 503/500、TOO_MANY_VIEWERS 不是 HTTP 码**。
  → ✅ 文档 §5.1/§6.3 补齐并标明 4002 仅 WS。
- **§9 web lint 坏 → server lint 也坏（6 个 any）**。
  → ✅ 双端 lint 绿；web 依赖已补（`web/package.json` devDeps）。
- **§10 图标描述全部过时**（三段式/蓝紫/同心环/动画/光束）。
  → ✅ HANDOFF §10 重写为 `ICON` 事实；`Enhancements #1.md` §7 已加过期标注。
- **§12.2「画布锁死 256px」** → ✅ 现位图 1024；HANDOFF §12.4 写明删除清理代码会锁 1024。
- **§12.5「@theme 摇树」** → ✅ 本仓库没有 `@theme`，HANDOFF §12.6 明确「无落点」。
- **§12.6 语言下拉字号不一致** → ✅ 首页与仪表盘现均为 `text-base lg:text-sm`（`App.vue:137,345`）。
- **§4 目录树漏项/logo.svg 是生成物** → ✅ HANDOFF §4 补 `typings/i18n.d.ts`、configs、
  `utils/`、`legal/`、`.github/`，并标明 logo.svg 为生成物。
- **§13 README 端口** → ✅ 统一 41606（41605 仅本地 Vite）。
- **star 数已 106** → ✅ HANDOFF 写 106。
- **.develop「已入库」** → ✅ HANDOFF §4 注明 HANDOFF.md / HANDOFF-AUDIT.md 未跟踪。

## 3. 死配置：`CADDY_DOMAIN` / `CADDY_EMAIL`（修复前高危）

- 修复前：Caddyfile 硬编码 `:80`，未读这两个变量；server Zod 无此键；compose 无 `env_file`
  → `.env` 完全不生效；`EXPOSE 80 443` 但只发布 80。
  → ✅ 现方案：Caddyfile 站点地址 `{$CADDY_SITE_ADDRESS::80}`；compose `env_file` +
  `${VAR:-default}`；server 不读这两个键；容器内 HTTPS 改为可选项（需发布 443 + 持久化
  `/srv/caddy/data`）；README/`.env.example` 明说「TLS 默认在边缘终止」。两个旧键已删除。
  证据：HANDOFF §7.2/§11、`Caddyfile`、`docker-compose.yml`、`README.md`「Docker 部署」。

## 4. 未记载的静默失败（修复前，逐项状态）

1. **二维码容量超限静默留白** → ✅ `useQRCode.ts` 现在抛 `QRPayloadTooLargeError` 并暴露
   `failure`；`QRDisplay.vue`/`HistoryList.vue` 展示本地化「超出容量」提示；有测试。
2. **离线队列毒消息**（400 `TEXT_TOO_LONG` 也入队）→ ✅ `utils/upload.ts` 的
   `classifyUploadStatus` 把其余 4xx 归为 `rejected`，只提示不入队；有测试。
3. **429 不更新去重基准** → ✅ `applyUploadOutcome` 对 `rate_limited` 也更新
   `lastAcceptedText`，避免每 250ms 重发；有测试。
4. **离开扫码页摄像头可能不关** → ✅ `stop()` 先 `stopCamera()` 再发 expire；
   全仓请求走 `utils/fetch.ts`（`API_TIMEOUT_MS=8s`，expire 3s 且不 await）。
5. **离线队列随切模式清空** → ✅ 现为**有意策略**：`resetState` 保留队列（注释写明），
   只在新建通道（`useScanner.ts:649-651`）或通道过期重建（`:535-537`）时清空。
6. **首访语言恒为英文** → ✅ `i18n.ts` 探测 navigator；`preferences.ts` 的 `locale` 默认空串；
   `useLocale` 不把探测结果写回 store；`<html lang>` 在模块加载时同步。
7. **trust proxy 可伪造限流键** → ✅ 默认 `loopback`，可用 `TRUST_PROXY` 收紧/放宽
   （`config.ts:15-28,42-44`、`app.ts:17`）；有测试。
8. **body 异常一律 500** → ✅ 映射 400 `INVALID_JSON` / 413 `PAYLOAD_TOO_LARGE` /
   400 `INVALID_BODY`；upload/expire 补 req.body 守卫（`validate.ts`）。
9. **限流在参数校验之前** → ✅ 先 `requireShareCodeInQuery/InBody` + 文本校验，再进限流；
   另有 `CREATE_RATE_LIMIT` 建通道限流。
10. **WS 不校验路径/Origin** → ✅ 只接受 `/ws` 与 `/ws/`；其它 path 403 `FORBIDDEN_PATH`；
    Origin 默认同源、可配 `WS_ALLOWED_ORIGINS`（`ws/handler.ts:76-112`）。
11. **未记载的 60s noMessageTimer** → ✅ 已删除；只保留 30s 心跳 + 2 ticks 判死。
12. **观众数冻结** → ✅ 加入/离开广播 `viewer_count`（`channelStore.ts:188,200`）。
13. **品牌名硬编码 4 处** → ✅ 组件统一 `APP_NAME`（`brand.ts:10`）；`index.html` 的
    `title`/`og:title` 无法 import，已加同步注释。
14. **服务端中文文案直进 UI** → ✅ `channel_expired` 带 `code`，服务端文案改为英文
    `Channel expired`；前端只认 code/type，不展示 `message`。

## 5. 部署 / 运维补充（修复前）

- **容器内优雅关闭是死代码** → ✅ tini + `entrypoint.sh` trap 转发 + 监督；子进程死则容器退出。
- **镜像带测试代码** → ✅ `tsconfig.build.json` 排除 + Dockerfile 断言。
- **无 healthcheck** → ✅ Dockerfile `HEALTHCHECK` + compose healthcheck。
- **.env 无效** → ✅ 见 §3。
- **devctl `list --json` 实测 172s** → ✅ 已写入 HANDOFF §12.3（行为未改，属工具现状）。
- **0.0.0.0 / 非安全上下文** → ✅ 写入 HANDOFF §12.8/§12.9；开发实例仍绑 0.0.0.0（未改绑定）。
- **dist 现状** → ✅ 本轮 build 已刷新；发布前仍应重跑 `pnpm build`。
- **线上核对（无漂移）** → 📌 历史记录，保持原样。
- **未实跑 `docker build`** → ⛔ 仍未做（HANDOFF §13.1-2）。

## 6. 测试空洞（修复前）→ 现已补

- `index.ts`（双端口/信号/关闭顺序）→ ✅ `server.test.ts`（createServers / EADDRINUSE / close）。
- `ws/handler.ts`（handshake、4001/4002、心跳、viewer 上限）→ ✅ `ws/handler.test.ts`。
- `expireChannel` / `/api/channel/expire` → ✅ `channelStore.test.ts` + `channel.test.ts`。
- `errorHandler` / `createApp` → ✅ `errorHandler.test.ts`、`accessLog.test.ts`、
  路由测试覆盖 JSON 404/400/413。
- 限流时间推进、TTL 语义 → ✅ `rateLimiter.test.ts`、`channelStore.test.ts`（假时钟）。
- 测试自身缺陷：`rateLimiter.test.ts` 反向断言 → ✅；`verifyAttempts` 串味 → ✅
  （抽到 `attemptStore`，`shutdownAll`/测试可清）；`channelStore.test.ts` TTL=0 扫全表 → ✅ 假时钟。
- 修复轮数字：**server 9 文件 / 134 用例；web 10 文件 / 59 用例**（审计日志合入后为 11 文件 / 193+，见文首注）。

## 7. 建议的修复顺序（原计划）→ 执行结果

| 优先级 | 事项 | 状态 |
|---|---|---|
| P0 | 二维码超限静默留白 | ✅ 显式失败 + 本地化提示 + 测试 |
| P0 | README 端口 / .env 死配置 | ✅ 41606；`CADDY_SITE_ADDRESS` + env_file |
| P1 | `stop()` 停摄像头顺序 + fetch 超时 | ✅ `utils/fetch.ts` + 先关流 |
| P1 | 429 更新去重基准；400 不入离线队列 | ✅ `utils/upload.ts` + 测试 |
| P1 | trust proxy 收紧 | ✅ 默认 `loopback` + `TRUST_PROXY` |
| P1 | body 错误映射 400/413 + body 守卫 | ✅ `errorHandler.ts` + `validate.ts` |
| P2 | `expire_seconds` 语义定案 | ✅ per-channel TTL + 惰性过期 |
| P2 | 服务端过期文案改 code、前端本地化 | ✅ `code:'CHANNEL_EXPIRED'` + 前端不展示 message |
| P2 | 心跳/重连文档对齐（60s、16s） | ✅ HANDOFF §6.4 |
| P2 | 补 `ws/handler` 与 `index` 测试；修 `verifyAttempts` | ✅ 134 用例 |
| P3 | server lint 6 个 any；web lint 补依赖 | ✅ 双端 lint 绿 |
| P3 | `.github/workflows` 跑 test/typecheck/build | ◐ 已新增 CI（含 lint），尚未在 GitHub 实跑 |

> 任何涉及持久化的改动，按仓库铁律：只做加法、幂等 migration、测试连独立库。
