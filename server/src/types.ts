import type { WebSocket } from 'ws';

// Re-export config type (defined with zod in config.ts)
export type { AppConfig } from './config.js';

// ── Channel State ──

export interface ChannelState {
  shareCode: string;
  latestText: string | null;
  lastUploadAt: number; // ms timestamp
  createdAt: number; // ms timestamp
  uploadCount: number;
  uploadWindow: number[]; // timestamps in last 1s for sliding-window rate limit
  wsClients: Set<WebSocket>;
}

// ── API Responses ──

export interface CreateChannelData {
  shareCode: string;
  expireAt: string; // ISO 8601
  createdAt: string; // ISO 8601
}

export interface CreateChannelResponse {
  code: 201;
  data: CreateChannelData;
}

export interface VerifyChannelResponse {
  code: 200;
  valid: true;
  latestText: string | null;
  updatedAt: string | null; // ISO 8601 or null if no text
}

export interface UploadResponse {
  code: 200;
  message: 'ok';
}

export interface ErrorResponse {
  code: number;
  error: string;
  message: string;
}

// ── WebSocket Messages (Server → Client) ──

export interface WelcomeMessage {
  type: 'welcome';
  shareCode: string;
  viewerCount: number;
}

export interface TextMessage {
  type: 'text';
  data: string;
  timestamp: number; // Unix ms
}

export interface HistoryMessage {
  type: 'history';
  messages: Array<{ data: string; timestamp: number }>;
}

export interface ChannelExpiredMessage {
  type: 'channel_expired';
  message: string;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  serverTime: number; // Unix ms
}

export type ServerMessage =
  | WelcomeMessage
  | TextMessage
  | HistoryMessage
  | ChannelExpiredMessage
  | HeartbeatMessage;

// ── WebSocket Messages (Client → Server) ──

export interface PongMessage {
  type: 'pong';
}

export type ClientMessage = PongMessage;

// ── Logger ──

export type LogEvent =
  | 'channel_created'
  | 'channel_verified'
  | 'upload_success'
  | 'upload_rate_limited'
  | 'verify_rate_limited'
  | 'upload_channel_not_found'
  | 'ws_connected'
  | 'ws_disconnected'
  | 'ws_rejected'
  | 'channel_cleaned'
  | 'server_start'
  | 'server_shutdown';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: LogEvent;
  shareCode?: string;
  clientIp?: string;
  message: string;
}
