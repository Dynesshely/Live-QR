/**
 * 上传结果的分类规则（纯函数，便于单测）。
 *
 * 分类直接决定三件事：是否入离线队列、是否重试、界面显示什么文案。
 * 原先的实现把所有 fetch 成功但 `!resp.ok` 的响应一律当成 'error' 并入队，
 * 于是永久性拒绝（如 400 TEXT_TOO_LONG）会在离线队列里每 250ms 重试一次，
 * 把队列堵死（HANDOFF-AUDIT §4.2）。
 */

export type UploadOutcome =
  /** 服务端已接受 */
  | 'ok'
  /** 通道限流（429）：内容本身没问题，稍后重试有意义 */
  | 'rate_limited'
  /** 通道不存在/已过期（404）：需要重建通道，且不能入离线队列 */
  | 'expired'
  /** 永久性拒绝（其余 4xx）：重试也不可能成功，必须直接丢弃并提示 */
  | 'rejected'
  /** 网络错误或 5xx：暂时性失败，可入离线队列重试 */
  | 'network_error';

/**
 * 按 HTTP 状态码分类上传结果。
 *
 * - 2xx → ok
 * - 404 → expired（服务端通道已不存在）
 * - 429 → rate_limited
 * - 5xx → network_error（服务端临时故障，允许重试）
 * - 其余（含 400/401/403/413）→ rejected（永久性，重试无意义）
 */
export function classifyUploadStatus(status: number): UploadOutcome {
  if (status === 404) return 'expired';
  if (status === 429) return 'rate_limited';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 500) return 'network_error';
  return 'rejected';
}

/**
 * 上传去重状态。
 *
 * 与上传结果的分类一一对应，抽成纯函数是为了让「429 要不要更新去重基准」
 * 这类规则可以被单测锁住（HANDOFF-AUDIT §4.3）。
 */
export interface UploadDedupState {
  /**
   * 最近一次「服务端已接受**或限流**」的文本。
   * 429 也必须记在这里：服务端限流窗口只有 1s，若不更新基准，
   * 250ms 的扫描循环会把同一条内容反复重发，既无效又持续触发 429。
   */
  lastAcceptedText: string | null;
  /** 最近一次被永久拒绝（4xx）的文本 —— 不再重试，也不进离线队列 */
  lastRejectedText: string | null;
}

/** 根据上传结果推进去重基准（纯函数，不修改入参） */
export function applyUploadOutcome(
  state: UploadDedupState,
  outcome: UploadOutcome,
  text: string,
): UploadDedupState {
  switch (outcome) {
    case 'ok':
    case 'rate_limited':
      return { lastAcceptedText: text, lastRejectedText: state.lastRejectedText };
    case 'rejected':
      return { lastAcceptedText: state.lastAcceptedText, lastRejectedText: text };
    // expired / network_error：基准不变（换通道时由调用方显式重置）
    default:
      return state;
  }
}

/**
 * 服务端错误码白名单。
 *
 * 与 `server/src/routes/*` 的 `error` 字段一一对应；新增服务端错误码时
 * 必须同步补 locale 的 `serverErrors.*`（三语键集合测试会兜底）。
 */
export const SERVER_ERROR_CODES = [
  'INVALID_SHARE_CODE',
  'TEXT_EMPTY',
  'TEXT_TOO_LONG',
  'INVALID_EXPIRE_SECONDS',
  'CHANNEL_NOT_FOUND',
  'RATE_LIMITED',
  'VERIFY_RATE_LIMITED',
  'TOO_MANY_VIEWERS',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

/**
 * 服务端错误码 → i18n 键。未知码返回 null，由调用方回退到通用文案。
 * 服务端下发的 `message` 是中文硬编码，**绝不直接显示**。
 */
export function serverErrorKey(error: unknown): `serverErrors.${ServerErrorCode}` | null {
  if (typeof error !== 'string') return null;
  return (SERVER_ERROR_CODES as readonly string[]).includes(error)
    ? (`serverErrors.${error as ServerErrorCode}`)
    : null;
}
