/**
 * 带超时的 fetch 封装。
 *
 * 背景：全仓 fetch 原先既没有超时也没有 AbortController，
 * 在网络半通（TCP 连上但不回包）时请求会一直挂着 —— 对扫码页来说这直接表现为
 * 「点了返回，摄像头关了但 stop() 还在 await 过期请求」，退出流程被网络拖住。
 *
 * 约定：
 * - 所有对外请求（`/api/*`）都必须走这里，不要裸 `fetch`；
 * - 超时同时通过 AbortController 真正中断请求，避免连接泄漏；
 * - 调用方传入的 `signal` 仍然生效（两者任一触发都会中断）。
 */

/** 普通 API 请求超时：建通道 / 上传 / 验证分享码 */
export const API_TIMEOUT_MS = 8000;

/** 过期请求超时：离开扫码页时 best-effort 通知服务端，慢网络下不该拖住退出 */
export const EXPIRE_TIMEOUT_MS = 3000;

export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms: ${url}`);
    this.name = 'FetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;

  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // AbortError 既可能来自超时，也可能来自上游取消：只有超时才转换成可辨识的错误
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new FetchTimeoutError(String(input), timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}
