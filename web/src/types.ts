export type ConnectionStatus =
  | 'unconnected'
  | 'verifying'
  | 'waiting_data'
  | 'connected'
  | 'reconnecting'
  | 'expired';

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
  message: string;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  serverTime: number;
}

export type ServerMessage =
  | WelcomeMessage
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
