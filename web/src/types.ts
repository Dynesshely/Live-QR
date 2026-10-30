export type ConnectionStatus =
  | 'unconnected'
  | 'verifying'
  | 'waiting_data'
  | 'connected'
  | 'reconnecting'
  | 'expired';

/**
 * 观看端错误分类 —— 决定 App.vue 顶部横幅/输入页提示的文案，
 * 让「人满」与「通道过期」这类完全不同的原因不再共用一句话。
 */
export type ViewerErrorKind =
  | 'none'
  | 'invalid_code'
  | 'expired'
  | 'room_full'
  | 'connect_failed'
  | 'rate_limited'
  | 'verify_failed'
  | 'network';

export interface HistoryMessage {
  data: string;
  timestamp: number;
}

// WebSocket messages (Server → Client)
export interface WelcomeMessage {
  type: 'welcome';
  shareCode: string;
  viewerCount: number;
}

/** 服务端新增：观看人数变化时实时广播（原实现只在 welcome 里给一次，UI 数字会冻结） */
export interface ViewerCountMessage {
  type: 'viewer_count';
  count: number;
  /** 兼容旧字段名（服务端契约演进期间两种字段都接受） */
  viewerCount?: number;
}

export interface TextMessage {
  type: 'text';
  data: string;
  timestamp: number;
}

export interface HistoryWSMessage {
  type: 'history';
  messages: Array<{ data: string; timestamp: number }>;
}

export interface ChannelExpiredMessage {
  type: 'channel_expired';
  /**
   * 过期原因码（新增）。前端只认 code / 消息类型，
   * **绝不显示服务端下发的 message** —— 那是服务端硬编码的中文，
   * 会在 EN/JA 界面里原样漏出来。
   */
  code?: 'CHANNEL_EXPIRED';
  /** @deprecated 仅保留字段以兼容旧服务端，不再用于展示 */
  message?: string;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  serverTime: number;
}

export type ServerMessage =
  | WelcomeMessage
  | ViewerCountMessage
  | TextMessage
  | HistoryWSMessage
  | ChannelExpiredMessage
  | HeartbeatMessage;

// API responses
export interface VerifyResponse {
  code: number;
  valid: boolean;
  latestText: string | null;
  updatedAt: string | null;
}

export interface CreateChannelResponse {
  code: number;
  data: {
    shareCode: string;
    expireAt: string;
    createdAt: string;
  };
}
