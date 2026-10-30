/**
 * WebSocket 关闭码分类（纯函数，便于单测）。
 *
 * 服务端契约（server/src/ws/handler.ts + services/channelStore.ts）：
 * - 1001：通道过期 / 被主动关闭（服务端先发 channel_expired）—— 视为「已过期」，**不重连**；
 * - 1012：服务端重启（Service Restart）—— 通道仍可能存在，**重连**，保留最后一屏二维码；
 * - 4001：握手时通道不存在 —— 视为分享码无效，不重连；
 * - 4002：观看者已满 —— 不重连，但文案必须与「已过期」区分；
 * - 其它：网络类断开，走指数退避重连。
 *
 * 注意：过期原因**只认关闭码/消息类型**，绝不显示服务端下发的中文 message。
 */

export type WSCloseKind = 'expired' | 'invalid_code' | 'room_full';

export interface WSCloseClassification {
  kind: WSCloseKind | null;
  /** 是否应该重连 */
  reconnect: boolean;
}

export function classifyCloseCode(code: number): WSCloseClassification {
  switch (code) {
    case 1001:
      return { kind: 'expired', reconnect: false };
    case 1012:
      // 服务重启：通道数据本来就会丢，但让客户端先重试一轮，
      // 重启时间短于退避窗口（约 31s）时观看端无需人工干预即可恢复。
      return { kind: null, reconnect: true };
    case 4001:
      return { kind: 'invalid_code', reconnect: false };
    case 4002:
      return { kind: 'room_full', reconnect: false };
    default:
      return { kind: null, reconnect: true };
  }
}
